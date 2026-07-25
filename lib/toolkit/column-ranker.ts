/**
 * LLM-based column ranking for the adaptive column budget engine.
 *
 * When the adaptive engine determines that tables need trimming, this module
 * makes a single lightweight LLM call per batch to rank columns by business
 * relevance. Falls back to the heuristic scorer on any failure.
 *
 * @module toolkit/column-ranker
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import type { Logger } from "@/lib/ports/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMColumnRankingInput {
  fqn: string;
  tableComment: string | null;
  columns: Array<{ name: string; dataType: string; comment: string | null }>;
  keepCount: number;
}

export interface LLMColumnRankings {
  /** Per-table ordered list of column names to keep (table FQN -> column names). */
  rankings: Map<string, string[]>;
  /**
   * Set of table FQNs that were successfully ranked by the LLM (or served
   * from a prior-LLM cached entry in the same run).
   */
  llmTables: Set<string>;
  /**
   * Set of table FQNs that should fall back to heuristic scoring because the
   * LLM did not produce a valid ranking for them.
   */
  heuristicTables: Set<string>;
  /** True if this call actually issued an LLM request (false when fully cached). */
  callMade: boolean;
  /** @deprecated Prefer `llmTables.size > 0`. Kept for caller compatibility. */
  fromLLM: boolean;
}

/**
 * Run-scoped cache for LLM column rankings. Keyed by `${fqn}|${keepCount}`.
 *
 * Identical (table, keepCount) pairs can legitimately appear across
 * concurrent batches in a single run (e.g. the same wide table surfaces in
 * two statistical-generation batches); the cache prevents re-ranking them.
 */
export class ColumnRankingCache {
  private store = new Map<string, string[]>();
  private hitCount = 0;
  private missCount = 0;

  get(fqn: string, keepCount: number): string[] | undefined {
    const key = `${fqn}|${keepCount}`;
    const cached = this.store.get(key);
    if (cached) {
      this.hitCount++;
      return cached;
    }
    this.missCount++;
    return undefined;
  }

  set(fqn: string, keepCount: number, cols: string[]): void {
    this.store.set(`${fqn}|${keepCount}`, cols);
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hitCount, misses: this.missCount, size: this.store.size };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise an FQN for matching: strip backticks and lowercase. */
function normaliseFqn(fqn: string): string {
  return fqn.replace(/`/g, "").toLowerCase();
}

function buildTablesJson(tables: LLMColumnRankingInput[]): string {
  const payload = tables.map((t) => ({
    table: t.fqn,
    description: t.tableComment || "(no description)",
    select_count: t.keepCount,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.dataType,
      description: c.comment || null,
    })),
  }));
  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Rank columns for trimmed tables via a single lightweight LLM call.
 *
 * Returns an ordered list of column names per table with per-table success
 * tracking. On any failure, the affected tables are reported in
 * `heuristicTables` so the caller can fall back to heuristic scoring.
 *
 * Accepts an optional run-scoped `cache`. Identical `(fqn, keepCount)` pairs
 * hit the cache and do not incur a second LLM round trip.
 */
export async function rankColumnsViaLLM(
  tables: LLMColumnRankingInput[],
  businessContextSummary: string,
  endpoint: string,
  log: Logger,
  cache?: ColumnRankingCache,
): Promise<LLMColumnRankings> {
  const rankings = new Map<string, string[]>();
  const llmTables = new Set<string>();
  const heuristicTables = new Set<string>();

  if (tables.length === 0) {
    return { rankings, llmTables, heuristicTables, callMade: false, fromLLM: false };
  }

  // Pre-fill from cache so we only send uncached tables to the LLM.
  const uncachedTables: LLMColumnRankingInput[] = [];
  for (const t of tables) {
    const cached = cache?.get(t.fqn, t.keepCount);
    if (cached) {
      rankings.set(t.fqn, cached);
      llmTables.add(t.fqn);
    } else {
      uncachedTables.push(t);
    }
  }

  // Every table served from cache: no LLM call required.
  if (uncachedTables.length === 0) {
    return {
      rankings,
      llmTables,
      heuristicTables,
      callMade: false,
      fromLLM: llmTables.size > 0,
    };
  }

  try {
    const result = await executeAIQuery({
      promptKey: "COLUMN_RANKING_PROMPT",
      variables: {
        business_context_summary: businessContextSummary,
        tables_json: buildTablesJson(uncachedTables),
      },
      modelEndpoint: endpoint,
      responseFormat: "json_object",
      temperature: 0,
      retries: 1,
      step: "column-ranking",
    });

    const parsed = parseLLMJson(result.rawResponse, "rankColumnsViaLLM") as {
      rankings?: Record<string, string[]>;
    };

    if (!parsed || typeof parsed !== "object" || !parsed.rankings) {
      log.warn("LLM column ranking: unexpected response shape, falling back to heuristic", {
        fn: "rankColumnsViaLLM",
      });
      for (const t of uncachedTables) heuristicTables.add(t.fqn);
      return { rankings, llmTables, heuristicTables, callMade: true, fromLLM: llmTables.size > 0 };
    }

    // Build a normalised lookup so case- or backtick-variant keys from the
    // LLM still match their original FQN.
    const fqnLookup = new Map<string, string>();
    const keepCountLookup = new Map<string, number>();
    for (const t of uncachedTables) {
      fqnLookup.set(normaliseFqn(t.fqn), t.fqn);
      keepCountLookup.set(t.fqn, t.keepCount);
    }

    const rankedFqns = new Set<string>();
    for (const [llmKey, cols] of Object.entries(parsed.rankings)) {
      const originalFqn = fqnLookup.get(normaliseFqn(llmKey));
      if (!originalFqn) continue;
      if (!Array.isArray(cols) || cols.some((c) => typeof c !== "string")) {
        log.warn("LLM column ranking: malformed entry for table, skipping", {
          fn: "rankColumnsViaLLM",
          table: originalFqn,
        });
        continue;
      }
      rankings.set(originalFqn, cols);
      llmTables.add(originalFqn);
      rankedFqns.add(originalFqn);
      if (cache) {
        const keepCount = keepCountLookup.get(originalFqn) ?? cols.length;
        cache.set(originalFqn, keepCount, cols);
      }
    }

    // Any uncached table the LLM didn't rank falls back to heuristic.
    for (const t of uncachedTables) {
      if (!rankedFqns.has(t.fqn)) heuristicTables.add(t.fqn);
    }

    log.info("LLM column ranking completed", {
      fn: "rankColumnsViaLLM",
      tablesRanked: rankedFqns.size,
      tablesRequested: uncachedTables.length,
      tablesFromCache: tables.length - uncachedTables.length,
      tablesHeuristic: heuristicTables.size,
      durationMs: result.durationMs,
    });

    return { rankings, llmTables, heuristicTables, callMade: true, fromLLM: llmTables.size > 0 };
  } catch (error) {
    log.warn("LLM column ranking failed, falling back to heuristic scorer", {
      fn: "rankColumnsViaLLM",
      error: error instanceof Error ? error.message : String(error),
    });
    for (const t of uncachedTables) heuristicTables.add(t.fqn);
    return { rankings, llmTables, heuristicTables, callMade: true, fromLLM: llmTables.size > 0 };
  }
}
