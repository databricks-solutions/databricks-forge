/**
 * Pipeline helper: downstream blast-radius computation (Phase 3.2).
 *
 * Runs after the scoring step completes, so we have a stable
 * `feasibilityScore` to boost. Walks the lineage graph forward from each
 * use case's `tablesInvolved` FQNs (via `computeBlastRadius`), then
 * applies the resulting `feasibilityBoost` to each use case in place via
 * `applyBlastRadiusBoost`.
 *
 * Stores the per-use-case `BlastRadiusSummary` on `uc.blastRadius` so the
 * subsequent `persistUseCases` checkpoint serialises it into the
 * `blast_radius_json` column. Downstream consumers (use case cards, BV
 * stakeholder analysis, Data Gap card) read it directly from there.
 *
 * Non-blocking on lineage availability: when `ctx.lineageGraph` is null
 * every use case gets a zeroed summary and `uc.blastRadius` is set to
 * null so the UI hides the blast-radius badge.
 */

import { applyBlastRadiusBoost, computeBlastRadius } from "@/lib/domain/blast-radius";
import type { PipelineContext } from "@/lib/domain/types";
import { logger as fallbackLogger } from "@/lib/logger";

export interface BlastRadiusPassSummary {
  /** How many use cases received a non-zero feasibility boost. */
  boostedCount: number;
  /** Total use cases processed (matches ctx.useCases.length on entry). */
  totalUseCases: number;
  /** Total distinct downstream tables seen across the whole run. */
  totalDownstreamTables: number;
  /** Top-5 most-blasted use case ids (for logging only). */
  topUseCaseIds: string[];
}

export function runBlastRadiusPass(ctx: PipelineContext): BlastRadiusPassSummary {
  const log = ctx.logger ?? fallbackLogger;
  const totalUseCases = ctx.useCases.length;
  const empty: BlastRadiusPassSummary = {
    boostedCount: 0,
    totalUseCases,
    totalDownstreamTables: 0,
    topUseCaseIds: [],
  };
  if (totalUseCases === 0) return empty;

  if (!ctx.lineageGraph || ctx.lineageGraph.edges.length === 0) {
    log.info("Blast-radius pass skipped — no lineage edges available", {
      fn: "runBlastRadiusPass",
    });
    for (const uc of ctx.useCases) uc.blastRadius = null;
    return empty;
  }

  try {
    const results = computeBlastRadius({
      useCases: ctx.useCases.map((uc) => ({ id: uc.id, tablesInvolved: uc.tablesInvolved })),
      lineageGraph: ctx.lineageGraph,
    });
    const byUseCaseId = new Map(results.map((r) => [r.useCaseId, r] as const));

    let boostedCount = 0;
    let totalDownstreamTables = 0;
    const ranked: { id: string; count: number }[] = [];

    for (const uc of ctx.useCases) {
      const r = byUseCaseId.get(uc.id);
      if (!r) {
        uc.blastRadius = null;
        continue;
      }
      uc.blastRadius = r.summary;
      totalDownstreamTables += r.summary.downstreamTableCount;
      if (r.summary.feasibilityBoost > 0) {
        applyBlastRadiusBoost(uc, r.summary);
        boostedCount++;
      }
      ranked.push({ id: uc.id, count: r.summary.downstreamTableCount });
    }

    ranked.sort((a, b) => b.count - a.count);
    const topUseCaseIds = ranked.slice(0, 5).map((r) => r.id);

    log.info("Blast-radius pass complete", {
      fn: "runBlastRadiusPass",
      boostedCount,
      totalUseCases,
      totalDownstreamTables,
      topUseCaseIds,
    });

    return { boostedCount, totalUseCases, totalDownstreamTables, topUseCaseIds };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Blast-radius pass failed (continuing without boost)", {
      fn: "runBlastRadiusPass",
      error: msg,
    });
    for (const uc of ctx.useCases) uc.blastRadius = null;
    return empty;
  }
}
