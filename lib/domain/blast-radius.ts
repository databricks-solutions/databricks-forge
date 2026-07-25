/**
 * Downstream Blast Radius — Phase 3.2
 *
 * For each use case, walk `ForgeTableLineage` downstream (BFS over
 * `LineageEdge.sourceTableFqn === current → targetTableFqn`) starting
 * from every FQN in `tablesInvolved`, count the distinct downstream
 * tables reached, group by the producing `entityType` (JOB / NOTEBOOK /
 * PIPELINE / DASHBOARD / OTHER), sum the total event count, and compute
 * a small additive `feasibilityBoost` rewarding use cases whose
 * underlying tables are already proven by real downstream consumption.
 *
 * Pure function — no I/O. Unit-tested in
 * `__tests__/domain/blast-radius.test.ts`.
 *
 * Limitation: the underlying `walkLineage` SQL filters out edges where
 * `target_table_full_name IS NULL`, which means dashboard / query-only
 * consumers are NOT captured today. The `dashboard` bucket therefore
 * counts table-targeted edges whose `entityType === "DASHBOARD"` only.
 * Lifting the NULL filter on a future iteration will let us count true
 * dashboard reads — `BlastRadiusSummary.byEntityType.dashboard` is the
 * forward-compatible slot.
 */

import type { BlastRadiusSummary, LineageEdge, LineageGraph, UseCase } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BlastRadiusInput {
  useCases: Pick<UseCase, "id" | "tablesInvolved">[];
  lineageGraph: LineageGraph | null;
  /** Max BFS hops downstream per seed (default 4 — diminishing returns past 4). */
  maxDownstreamHops?: number;
}

export interface BlastRadiusResult {
  useCaseId: string;
  summary: BlastRadiusSummary;
}

// ---------------------------------------------------------------------------
// Tuning constants — exported for tests + UI tooltips
// ---------------------------------------------------------------------------

/**
 * Linear feasibility boost: each downstream table is worth `BOOST_PER_TABLE`
 * of additional `feasibilityScore`, capped at `MAX_BOOST`. Tables already
 * powering real downstream workflows are de-risked from a "can we get to
 * the data?" perspective.
 */
export const BOOST_PER_TABLE = 0.03;
export const MAX_BOOST = 0.15;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/**
 * Build a forward-edge index: source FQN (lower-cased) → outgoing edges.
 * Returns an empty map when `lineageGraph` is null.
 */
function buildForwardIndex(
  lineageGraph: LineageGraph | null,
): Map<string, LineageEdge[]> {
  const index = new Map<string, LineageEdge[]>();
  if (!lineageGraph) return index;
  for (const edge of lineageGraph.edges) {
    if (!edge.sourceTableFqn || !edge.targetTableFqn) continue;
    const key = lower(edge.sourceTableFqn);
    const existing = index.get(key);
    if (existing) existing.push(edge);
    else index.set(key, [edge]);
  }
  return index;
}

/** Bucket the raw `entityType` string into the canonical summary slots. */
function bucketEntityType(
  entityType: string | null | undefined,
  buckets: BlastRadiusSummary["byEntityType"],
): void {
  const tag = (entityType ?? "").toUpperCase();
  if (tag === "JOB") buckets.job++;
  else if (tag === "NOTEBOOK") buckets.notebook++;
  else if (tag === "PIPELINE") buckets.pipeline++;
  else if (tag === "DASHBOARD" || tag === "QUERY") buckets.dashboard++;
  else buckets.other++;
}

/** Compute the feasibility boost from the distinct downstream table count. */
export function computeFeasibilityBoost(downstreamTables: number): number {
  if (downstreamTables <= 0) return 0;
  const raw = downstreamTables * BOOST_PER_TABLE;
  return Math.min(MAX_BOOST, Math.round(raw * 100) / 100);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Compute the blast radius summary for every input use case. Returns one
 * result per use case (including those with empty `tablesInvolved` — they
 * receive a zeroed summary so callers can render a stable badge).
 */
export function computeBlastRadius(input: BlastRadiusInput): BlastRadiusResult[] {
  const maxHops = input.maxDownstreamHops ?? 4;
  const forwardIndex = buildForwardIndex(input.lineageGraph);
  const results: BlastRadiusResult[] = [];

  for (const uc of input.useCases) {
    const buckets: BlastRadiusSummary["byEntityType"] = {
      job: 0,
      notebook: 0,
      pipeline: 0,
      dashboard: 0,
      other: 0,
    };
    let totalEventCount = 0;
    const seedSet = new Set((uc.tablesInvolved ?? []).map(lower));
    const visited = new Set<string>(seedSet);
    const downstream = new Set<string>();
    // Track which (downstream, edge) pairs we've credited so the same
    // edge isn't double-counted when multiple seeds converge on it.
    const countedEdges = new Set<string>();

    // BFS layer-by-layer downstream.
    let frontier: string[] = [...seedSet];
    let depth = 0;
    while (frontier.length > 0 && depth < maxHops) {
      depth++;
      const next: string[] = [];
      for (const fqn of frontier) {
        const outgoing = forwardIndex.get(fqn) ?? [];
        for (const edge of outgoing) {
          const target = edge.targetTableFqn;
          if (!target) continue;
          const targetKey = lower(target);
          // Don't count the seeds themselves as downstream.
          if (seedSet.has(targetKey)) continue;
          // Count each unique edge exactly once.
          const edgeKey = `${lower(edge.sourceTableFqn)}|${targetKey}|${edge.entityType ?? ""}`;
          if (countedEdges.has(edgeKey)) continue;
          countedEdges.add(edgeKey);
          bucketEntityType(edge.entityType, buckets);
          totalEventCount += Math.max(0, edge.eventCount ?? 0);
          if (!visited.has(targetKey)) {
            visited.add(targetKey);
            downstream.add(target);
            next.push(targetKey);
          }
        }
      }
      frontier = next;
    }

    const downstreamTableCount = downstream.size;
    const feasibilityBoost = computeFeasibilityBoost(downstreamTableCount);
    results.push({
      useCaseId: uc.id,
      summary: {
        downstreamTableCount,
        byEntityType: buckets,
        totalEventCount,
        feasibilityBoost,
      },
    });
  }
  return results;
}

/**
 * Convenience helper: apply the `feasibilityBoost` additively to a single
 * use case's `feasibilityScore` and propagate one-third of the boost into
 * `overallScore` (the standard contribution feasibility makes to the
 * equal-weight blend).
 *
 * This propagation strategy is intentional: the scoring step's *calibration*
 * pass writes `overallScore` directly from a cross-domain LLM call, so
 * we must NOT recompute overall from the components — that would silently
 * undo calibration. Instead we add a proportional bump on top.
 *
 * Mutates the input use case in place. Never lowers any score.
 */
export function applyBlastRadiusBoost(uc: UseCase, summary: BlastRadiusSummary): void {
  if (summary.feasibilityBoost <= 0) return;
  const fBefore = uc.feasibilityScore ?? 0;
  uc.feasibilityScore = Math.min(1, fBefore + summary.feasibilityBoost);
  const oBefore = uc.overallScore ?? 0;
  // One-third boost into overall: same proportion feasibility carries
  // in the canonical equal-weight blend, preserves calibration order.
  uc.overallScore = Math.min(1, oBefore + summary.feasibilityBoost / 3);
}
