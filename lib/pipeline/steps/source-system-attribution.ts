/**
 * Pipeline helper: source-system attribution (Phase 3.1).
 *
 * Runs immediately after use case generation completes. Calls the pure
 * resolver in `lib/domain/source-system-attribution.ts` with the freshly
 * generated use cases + the lineage graph loaded by Step 2 (metadata
 * extraction) + the table list (also from Step 2), then mutates
 * `ctx.useCases` in place with the attributed `sourceSystems` and
 * `sourceSystemsOrigin`.
 *
 * The function is non-blocking on lineage availability: when
 * `ctx.lineageGraph` is null (e.g. discovery-only runs with no Estate
 * Scan), the resolver falls back to naming + comment heuristics. The
 * `ctx.metadata?.tables` list provides per-table comments which is the
 * other major signal source.
 *
 * Failures are logged as warnings and the pass returns silently — the
 * pipeline continues without attribution and downstream consumers see
 * `sourceSystems === null` (their existing fallback path).
 */

import { attributeSourceSystems } from "@/lib/domain/source-system-attribution";
import type { PipelineContext } from "@/lib/domain/types";
import { logger as fallbackLogger } from "@/lib/logger";

export interface AttributionSummary {
  attributedCount: number;
  totalUseCases: number;
  systemsSeen: string[];
}

/**
 * Run source-system attribution and mutate `ctx.useCases` in place.
 * Returns a small summary for run-message + activity-log purposes.
 */
export function runSourceSystemAttribution(ctx: PipelineContext): AttributionSummary {
  const log = ctx.logger ?? fallbackLogger;
  const totalUseCases = ctx.useCases.length;
  const empty: AttributionSummary = {
    attributedCount: 0,
    totalUseCases,
    systemsSeen: [],
  };

  if (totalUseCases === 0) return empty;

  const tables = ctx.metadata?.tables ?? [];
  if (tables.length === 0 && !ctx.lineageGraph) {
    log.warn("Source-system attribution skipped — no tables or lineage available", {
      fn: "runSourceSystemAttribution",
    });
    return empty;
  }

  try {
    const results = attributeSourceSystems({
      useCases: ctx.useCases.map((uc) => ({ id: uc.id, tablesInvolved: uc.tablesInvolved })),
      lineageGraph: ctx.lineageGraph,
      tables: tables.map((t) => ({
        fqn: t.fqn,
        catalog: t.catalog,
        schema: t.schema,
        tableName: t.tableName,
        comment: t.comment,
      })),
    });

    const byUseCaseId = new Map(results.map((r) => [r.useCaseId, r] as const));
    const systemsSeen = new Set<string>();
    let attributedCount = 0;
    for (const uc of ctx.useCases) {
      const r = byUseCaseId.get(uc.id);
      if (!r || r.sourceSystems.length === 0) {
        uc.sourceSystems = null;
        uc.sourceSystemsOrigin = null;
        continue;
      }
      uc.sourceSystems = r.sourceSystems;
      uc.sourceSystemsOrigin = r.origin;
      attributedCount++;
      for (const s of r.sourceSystems) systemsSeen.add(s);
    }

    log.info("Source-system attribution complete", {
      fn: "runSourceSystemAttribution",
      attributedCount,
      totalUseCases,
      systemsCount: systemsSeen.size,
      hasLineage: Boolean(ctx.lineageGraph),
      tableCount: tables.length,
    });

    return {
      attributedCount,
      totalUseCases,
      systemsSeen: [...systemsSeen].sort(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Source-system attribution failed (continuing without attribution)", {
      fn: "runSourceSystemAttribution",
      error: msg,
    });
    return empty;
  }
}
