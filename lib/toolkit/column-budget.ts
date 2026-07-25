/**
 * Column Budget Engine -- adaptive column selection for LLM prompts.
 *
 * Two layers:
 *  1. Token-aware adaptive budgeting (computeAdaptiveColumnLimits) determines
 *     HOW MANY columns each table gets via a fill-then-trim algorithm.
 *  2. LLM-based column ranking (rankColumnsViaLLM, separate module) determines
 *     WHICH columns to keep when trimming is needed.
 *
 * Heuristic fallback uses a three-tier scoring strategy:
 *   Tier 1: Prior LLM classifications (EnrichedColumn from estate scan)
 *   Tier 2: Column comments + business keyword detection
 *   Tier 3: Deterministic heuristics (inferColumnRole from deterministic.ts)
 *
 * @module toolkit/column-budget
 */

import { inferColumnRole } from "@/lib/metadata/deterministic";
import type { EnrichedColumn } from "@/lib/metadata/types";
import type { ColumnInfo } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ColumnBudgetConfig {
  /** Max columns per table in schema markdown (default: 40, large: 25). */
  maxColumnsPerTable: number;
  /** Max comment length in schema markdown (default: 80, large: 60). */
  maxCommentLength: number;
  /** Max columns in sample data SELECT (0 = unlimited). */
  maxSampleColumns: number;
  /** SQL LIMIT for listColumns queries (default: 500_000, large: 200_000). */
  maxColumnRowsPerScope: number;
  /** Use compact `name(type)` format without comments for overflow hints. */
  compactFormat: boolean;
}

const DEFAULT_BUDGET: ColumnBudgetConfig = {
  maxColumnsPerTable: 40,
  maxCommentLength: 80,
  maxSampleColumns: 0,
  maxColumnRowsPerScope: 500_000,
  compactFormat: false,
};

/**
 * Fetch-level limits applied automatically when wide tables are detected.
 * Reduces memory pressure on massive estates without requiring a manual toggle.
 */
export const WIDE_SCHEMA_FETCH_LIMITS = {
  maxColumnRowsPerScope: 200_000,
  maxSampleColumns: 18,
} as const;

/**
 * Column count used when ESTIMATING per-table token cost in batch packing.
 * The adaptive engine still decides the real limit at render time; this only
 * affects how many tables we pack into one LLM call.
 *
 * Set slightly above the pre-adaptive default (40) so the adaptive engine has
 * room to include more when it fits, without fragmenting batches on wide
 * schemas the way an uncapped estimator did.
 */
export const BATCH_ESTIMATION_COL_CAP = 60;

/**
 * Returns the default column budget config.
 * The adaptive engine (computeAdaptiveColumnLimits) handles per-prompt column
 * caps dynamically, so this is used only for maxCommentLength, compactFormat,
 * and non-pipeline consumers (comment engine, Genie engine, etc.).
 */
export function resolveColumnBudget(): ColumnBudgetConfig {
  return { ...DEFAULT_BUDGET };
}

/**
 * Apply wide-schema fetch limits to a resolved column budget when wide tables
 * were detected in the source schema. Returns a shallow copy with
 * `maxSampleColumns` (and, where applicable, `maxColumnRowsPerScope`) lowered
 * to the defensive values from `WIDE_SCHEMA_FETCH_LIMITS`.
 *
 * Narrow schemas pass through unchanged.
 */
export function applyWideSchemaLimits(
  budget: ColumnBudgetConfig,
  wideSchemaDetected: boolean,
): ColumnBudgetConfig {
  if (!wideSchemaDetected) return { ...budget };
  return {
    ...budget,
    maxSampleColumns:
      budget.maxSampleColumns > 0
        ? Math.min(budget.maxSampleColumns, WIDE_SCHEMA_FETCH_LIMITS.maxSampleColumns)
        : WIDE_SCHEMA_FETCH_LIMITS.maxSampleColumns,
    maxColumnRowsPerScope: Math.min(
      budget.maxColumnRowsPerScope,
      WIDE_SCHEMA_FETCH_LIMITS.maxColumnRowsPerScope,
    ),
  };
}

// ---------------------------------------------------------------------------
// Business keyword detection
// ---------------------------------------------------------------------------

const BUSINESS_KEYWORDS = new Set([
  "revenue",
  "profit",
  "margin",
  "customer",
  "order",
  "invoice",
  "payment",
  "transaction",
  "churn",
  "retention",
  "conversion",
  "risk",
  "fraud",
  "compliance",
  "forecast",
  "budget",
  "sales",
  "pipeline",
  "campaign",
  "engagement",
  "satisfaction",
  "nps",
  "ltv",
  "lifetime",
  "segment",
  "cohort",
  "inventory",
  "shipment",
  "delivery",
  "subscription",
  "renewal",
  "discount",
  "price",
  "cost",
  "expense",
  "asset",
  "liability",
  "equity",
  "balance",
  "quota",
  "target",
  "kpi",
  "metric",
  "score",
  "rating",
  "rank",
  "tier",
  "priority",
  "status",
  "category",
  "classification",
]);

function commentHasBusinessKeyword(comment: string | null | undefined): boolean {
  if (!comment) return false;
  const lower = comment.toLowerCase();
  for (const kw of BUSINESS_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Column scoring
// ---------------------------------------------------------------------------

/** Role-based score contribution (Tier 3). */
const ROLE_SCORES: Record<string, number> = {
  pk: 25,
  fk: 20,
  measure: 18,
  timestamp: 12,
  flag: 10,
  code: 8,
  free_text: 5,
};

export interface ColumnScoreOptions {
  /** Prior LLM-enriched columns keyed by column name (from a previous estate scan). */
  enrichedColumns?: Map<string, EnrichedColumn>;
  /** FK constraint column names (columns that have explicit FK relationships). */
  fkColumnNames?: Set<string>;
}

/**
 * Score a single column for selection priority.
 *
 * Higher scores = more likely to be included in token-budgeted prompts.
 */
export function scoreColumn(
  col: { columnName: string; dataType: string; comment: string | null },
  options?: ColumnScoreOptions,
): number {
  let score = 0;

  // Tier 1: Prior LLM classification
  const enriched = options?.enrichedColumns?.get(col.columnName);
  if (enriched?.inferredRole) {
    score += 30;
  }

  // Tier 2: Column comments
  if (col.comment) {
    score += 15;
    if (commentHasBusinessKeyword(col.comment)) {
      score += 10;
    }
  }

  // Tier 3: Deterministic heuristic
  const heuristicRole = inferColumnRole(col.columnName, col.dataType);
  if (heuristicRole) {
    score += ROLE_SCORES[heuristicRole] ?? 0;
  }

  // Bonus for explicit FK constraints
  if (options?.fkColumnNames?.has(col.columnName)) {
    score += 5;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Intelligent column selection
// ---------------------------------------------------------------------------

export interface ColumnSelectionResult<C> {
  /** Columns selected for inclusion (sorted by score descending). */
  selected: C[];
  /** Number of columns omitted. */
  omittedCount: number;
  /** Up to 3 sample names from omitted columns as LLM hints. */
  omittedHints: string[];
}

/**
 * Select the most representative columns from a table, using the three-tier
 * scoring strategy.
 *
 * Returns at most `maxCount` columns, prioritised by business relevance.
 * When all columns fit within the budget, all are returned unchanged.
 */
export function selectRepresentativeColumns<C extends ColumnInfo>(
  columns: C[],
  maxCount: number,
  options?: ColumnScoreOptions,
): ColumnSelectionResult<C> {
  if (maxCount <= 0 || columns.length <= maxCount) {
    return { selected: columns, omittedCount: 0, omittedHints: [] };
  }

  const scored = columns.map((col) => ({
    col,
    score: scoreColumn(col, options),
  }));

  // Stable sort: by score descending, then by ordinal position ascending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.col.ordinalPosition - b.col.ordinalPosition;
  });

  const selected = scored.slice(0, maxCount).map((s) => s.col);
  const omitted = scored.slice(maxCount).map((s) => s.col);

  // Pick up to 3 hint names from the omitted set, spread across the list
  const hints: string[] = [];
  if (omitted.length > 0) {
    const step = Math.max(1, Math.floor(omitted.length / 3));
    for (let i = 0; i < omitted.length && hints.length < 3; i += step) {
      hints.push(omitted[i].columnName);
    }
  }

  return {
    selected,
    omittedCount: omitted.length,
    omittedHints: hints,
  };
}

/**
 * Build a compact column descriptor for overflow hints.
 */
export function buildCompactColumnLine(col: { columnName: string; dataType: string }): string {
  return `${col.columnName}(${col.dataType})`;
}

// ---------------------------------------------------------------------------
// Wide schema detection
// ---------------------------------------------------------------------------

/** Any table with more columns than this triggers wide-schema fetch limits. */
export const WIDE_TABLE_COLUMN_THRESHOLD = 100;

export interface WideSchemaInfo {
  hasWideTables: boolean;
  maxColumnCount: number;
  wideTableCount: number;
}

/**
 * Detect whether the schema contains wide tables (100+ columns).
 * Used by metadata-extraction and standalone-scan to auto-apply fetch limits.
 */
export function detectWideSchema(columnsByTable: Map<string, unknown[]>): WideSchemaInfo {
  let maxColumnCount = 0;
  let wideTableCount = 0;
  for (const cols of columnsByTable.values()) {
    if (cols.length > maxColumnCount) maxColumnCount = cols.length;
    if (cols.length >= WIDE_TABLE_COLUMN_THRESHOLD) wideTableCount++;
  }
  return {
    hasWideTables: wideTableCount > 0,
    maxColumnCount,
    wideTableCount,
  };
}

// ---------------------------------------------------------------------------
// Adaptive column budget (Layer 1: fill-then-trim)
// ---------------------------------------------------------------------------

export const MIN_COLUMNS_PER_TABLE = 10;
const TOKENS_PER_COLUMN_ESTIMATE = 12;
const TOKENS_PER_TABLE_OVERHEAD = 20;

export interface AdaptiveColumnLimits {
  /** Per-table column cap (table FQN -> max columns). */
  limits: Map<string, number>;
  /** True if any table was trimmed below its full column count. */
  trimmed: boolean;
  /** Total columns across all tables before trimming. */
  totalBefore: number;
  /** Total columns across all tables after trimming. */
  totalAfter: number;
  /** Per-table trim details (only tables that were trimmed). */
  trimDetails: Array<{ fqn: string; original: number; kept: number }>;
  /**
   * True when the corrective pass had to shave columns to stay under
   * `availableSchemaTokens` (rare; indicates the fair-share math alone
   * wasn't enough).
   */
  correctivePassApplied?: boolean;
  /**
   * True when even collapsing every table to `MIN_COLUMNS_PER_TABLE` still
   * exceeds the available token budget. The returned `limits` are floor-only
   * and the caller should either accept an oversized prompt or reduce batch
   * size. A warning should be logged by the caller.
   */
  budgetImpossible?: boolean;
}

/**
 * Compute per-table column limits that maximise included columns within the
 * available token budget.
 *
 * Algorithm ("fill then trim"):
 * 1. If all columns fit at full fidelity, return them all (no trimming).
 * 2. Otherwise, compute a fair-share token budget per table.
 * 3. Narrow tables that need fewer tokens than their share donate surplus.
 * 4. Surplus is redistributed to wide tables proportionally.
 * 5. Every table keeps at least MIN_COLUMNS_PER_TABLE columns.
 */
export function computeAdaptiveColumnLimits(
  tables: Array<{ fqn: string }>,
  columnsByTable: Map<string, Array<{ columnName: string }>>,
  availableSchemaTokens: number,
): AdaptiveColumnLimits {
  const limits = new Map<string, number>();
  const trimDetails: AdaptiveColumnLimits["trimDetails"] = [];

  let totalBefore = 0;
  const tableCols: Array<{ fqn: string; count: number }> = [];

  for (const table of tables) {
    const cols = columnsByTable.get(table.fqn);
    const count = cols?.length ?? 0;
    totalBefore += count;
    tableCols.push({ fqn: table.fqn, count });
  }

  if (tables.length === 0) {
    return { limits, trimmed: false, totalBefore: 0, totalAfter: 0, trimDetails };
  }

  // Estimate total tokens at full fidelity
  const fullTokens = tableCols.reduce(
    (sum, t) => sum + TOKENS_PER_TABLE_OVERHEAD + t.count * TOKENS_PER_COLUMN_ESTIMATE,
    0,
  );

  // If everything fits, no trimming needed
  if (fullTokens <= availableSchemaTokens) {
    for (const t of tableCols) {
      limits.set(t.fqn, t.count);
    }
    return { limits, trimmed: false, totalBefore, totalAfter: totalBefore, trimDetails };
  }

  // Compute fair share per table
  const fairShareTokens = Math.floor(availableSchemaTokens / tables.length);
  const fairShareCols = Math.max(
    MIN_COLUMNS_PER_TABLE,
    Math.floor((fairShareTokens - TOKENS_PER_TABLE_OVERHEAD) / TOKENS_PER_COLUMN_ESTIMATE),
  );

  // Pass 1: assign limits -- narrow tables keep everything, wide tables get fair share
  let surplusTokens = 0;
  const wideTables: Array<{ fqn: string; count: number; assigned: number }> = [];

  for (const t of tableCols) {
    if (t.count <= fairShareCols) {
      // Narrow table: keep all columns, donate surplus
      limits.set(t.fqn, t.count);
      const usedTokens = TOKENS_PER_TABLE_OVERHEAD + t.count * TOKENS_PER_COLUMN_ESTIMATE;
      surplusTokens += fairShareTokens - usedTokens;
    } else {
      // Wide table: start with fair share, may get more from surplus
      limits.set(t.fqn, fairShareCols);
      wideTables.push({ fqn: t.fqn, count: t.count, assigned: fairShareCols });
    }
  }

  // Pass 2: redistribute surplus to wide tables proportionally
  if (surplusTokens > 0 && wideTables.length > 0) {
    const totalDeficit = wideTables.reduce((sum, t) => sum + (t.count - t.assigned), 0);

    for (const t of wideTables) {
      const deficit = t.count - t.assigned;
      const share = totalDeficit > 0 ? deficit / totalDeficit : 1 / wideTables.length;
      const extraTokens = Math.floor(surplusTokens * share);
      const extraCols = Math.floor(extraTokens / TOKENS_PER_COLUMN_ESTIMATE);
      const newLimit = Math.min(t.count, t.assigned + extraCols);
      limits.set(t.fqn, newLimit);
    }
  }

  // Enforce floor (capped at actual column count)
  for (const t of tableCols) {
    let limit = limits.get(t.fqn) ?? t.count;
    const floor = Math.min(MIN_COLUMNS_PER_TABLE, t.count);
    limit = Math.max(floor, Math.min(limit, t.count));
    limits.set(t.fqn, limit);
  }

  // Corrective pass: ensure the total never exceeds availableSchemaTokens.
  // When many wide tables hit the MIN_COLUMNS_PER_TABLE floor simultaneously,
  // the fair-share math above can still overshoot. Shave one column at a time
  // from the largest kept-count table (above the floor) until we fit or every
  // table is at the floor.
  let correctivePassApplied = false;

  const computeTotalTokens = (): number => {
    let total = 0;
    for (const t of tableCols) {
      const limit = limits.get(t.fqn) ?? t.count;
      total += TOKENS_PER_TABLE_OVERHEAD + limit * TOKENS_PER_COLUMN_ESTIMATE;
    }
    return total;
  };

  let totalTokens = computeTotalTokens();
  if (totalTokens > availableSchemaTokens) {
    // Guard against pathological loops: bound by the maximum possible shave count.
    let shaveBudget =
      tableCols.reduce((sum, t) => sum + (limits.get(t.fqn) ?? t.count), 0) -
      tableCols.reduce(
        (sum, t) => sum + Math.min(MIN_COLUMNS_PER_TABLE, t.count),
        0,
      );

    while (totalTokens > availableSchemaTokens && shaveBudget > 0) {
      // Find the table with the highest current limit that is still above its floor.
      let targetFqn: string | null = null;
      let targetLimit = -1;
      for (const t of tableCols) {
        const limit = limits.get(t.fqn) ?? t.count;
        const floor = Math.min(MIN_COLUMNS_PER_TABLE, t.count);
        if (limit > floor && limit > targetLimit) {
          targetFqn = t.fqn;
          targetLimit = limit;
        }
      }
      if (!targetFqn) break;
      limits.set(targetFqn, targetLimit - 1);
      totalTokens -= TOKENS_PER_COLUMN_ESTIMATE;
      shaveBudget--;
      correctivePassApplied = true;
    }
  }

  const budgetImpossible = totalTokens > availableSchemaTokens;

  // Collect trim details and final total after any corrective shaving.
  let totalAfter = 0;
  for (const t of tableCols) {
    const limit = limits.get(t.fqn) ?? t.count;
    totalAfter += limit;
    if (limit < t.count) {
      trimDetails.push({ fqn: t.fqn, original: t.count, kept: limit });
    }
  }

  return {
    limits,
    trimmed: trimDetails.length > 0,
    totalBefore,
    totalAfter,
    trimDetails,
    correctivePassApplied,
    budgetImpossible,
  };
}
