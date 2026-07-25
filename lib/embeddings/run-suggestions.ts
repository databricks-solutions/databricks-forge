/**
 * Embedding-powered run configuration suggestions.
 *
 * When starting a new run, suggest relevant past use cases based on
 * business context similarity to previous runs. Also enables semantic
 * comparison between runs.
 */

import { generateEmbedding } from "./client";
import { searchByVector } from "./store";
import type { SearchResult } from "./types";
import { isEmbeddingEnabled } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimilarUseCase {
  name: string;
  domain: string;
  runId: string;
  score: number;
  content: string;
}

export interface RunSimilarity {
  runId: string;
  avgScore: number;
  matchingUseCases: number;
  topMatches: SimilarUseCase[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find use cases from previous runs that are most similar to a given
 * business context description or search query.
 */
export async function suggestSimilarUseCases(
  query: string,
  opts: { excludeRunId?: string; topK?: number; minScore?: number } = {},
): Promise<SimilarUseCase[]> {
  if (!isEmbeddingEnabled()) return [];

  const topK = opts.topK ?? 15;
  const minScore = opts.minScore ?? 0.5;

  const queryVector = await generateEmbedding(query);

  const results: SearchResult[] = await searchByVector(queryVector, {
    kinds: ["use_case"],
    topK,
    minScore,
  });

  return results
    .filter((r) => !opts.excludeRunId || r.runId !== opts.excludeRunId)
    .map((r) => ({
      name: extractName(r.contentText),
      domain: (r.metadataJson?.domain as string) ?? "Unknown",
      runId: r.runId ?? "",
      score: r.score,
      content: r.contentText,
    }));
}

/**
 * Find runs that have similar use cases to a given run.
 * Useful for semantic run comparison.
 */
export async function findSimilarRuns(
  runId: string,
  opts: { topK?: number; minScore?: number } = {},
): Promise<RunSimilarity[]> {
  if (!isEmbeddingEnabled()) return [];

  const topK = opts.topK ?? 30;
  const minScore = opts.minScore ?? 0.5;

  // Get use case embeddings from the source run
  const { getPrisma } = await import("@/lib/prisma");
  const prisma = await getPrisma();

  const sourceRows: Array<{ embedding: string }> = await prisma.$queryRawUnsafe(`
    SELECT embedding::text FROM forge_embeddings
    WHERE kind = 'use_case' AND run_id = '${runId}'
    LIMIT 20
  `);

  if (sourceRows.length === 0) return [];

  // Search for similar use cases across other runs
  const allMatches = new Map<string, { scores: number[]; matches: SimilarUseCase[] }>();

  for (const row of sourceRows.slice(0, 5)) {
    const vec = JSON.parse(row.embedding) as number[];
    const results = await searchByVector(vec, {
      kinds: ["use_case"],
      topK,
      minScore,
    });

    for (const r of results) {
      if (!r.runId || r.runId === runId) continue;
      const entry = allMatches.get(r.runId) ?? { scores: [], matches: [] };
      entry.scores.push(r.score);
      entry.matches.push({
        name: extractName(r.contentText),
        domain: (r.metadataJson?.domain as string) ?? "Unknown",
        runId: r.runId,
        score: r.score,
        content: r.contentText,
      });
      allMatches.set(r.runId, entry);
    }
  }

  return Array.from(allMatches.entries())
    .map(([rid, data]) => ({
      runId: rid,
      avgScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
      matchingUseCases: data.matches.length,
      topMatches: data.matches.sort((a, b) => b.score - a.score).slice(0, 5),
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);
}

function extractName(content: string): string {
  const firstLine = content.split("\n")[0] ?? "";
  return firstLine.replace(/^(Use Case:|Name:)\s*/i, "").trim() || firstLine;
}
