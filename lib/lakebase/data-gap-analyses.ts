/**
 * Lakebase CRUD for ForgeDataGapAnalysis.
 *
 * Persists the output of `runDataGapAnalysis()` from
 * `lib/engines/data-gap-analysis/engine.ts`. One row per (scope, runId/scanId)
 * with `ownerEmail` populated for per-user isolation.
 */

import { withPrisma } from "@/lib/prisma";
import type { DataGapResult } from "@/lib/engines/data-gap-analysis/types";
import { getNewestReferenceUseCaseResolvedAt } from "@/lib/lakebase/usecases";

export interface SaveDataGapInput {
  result: DataGapResult;
  runId?: string;
  scanId?: string;
  ownerEmail: string;
}

export interface CachedDataGap {
  result: DataGapResult;
  createdAt: Date;
}

export async function saveDataGapAnalysis(input: SaveDataGapInput): Promise<string> {
  const { result, runId, scanId, ownerEmail } = input;
  if (!runId && !scanId) {
    throw new Error("saveDataGapAnalysis requires runId or scanId");
  }
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDataGapAnalysis.create({
      data: {
        runId: runId ?? null,
        scanId: scanId ?? null,
        industryId: result.industryId,
        industryName: result.industryName,
        totalAssets: result.summary.totalAssets,
        presentAssets: result.summary.presentAssets,
        missingAssets: result.summary.missingAssets,
        mcCovered: result.summary.mcCovered,
        mcMissing: result.summary.mcMissing,
        vaCovered: result.summary.vaCovered,
        vaMissing: result.summary.vaMissing,
        mcCoveragePct: result.summary.mcCoveragePct,
        valueAtRiskLow: result.summary.valueAtRiskLow,
        valueAtRiskMid: result.summary.valueAtRiskMid,
        valueAtRiskHigh: result.summary.valueAtRiskHigh,
        coverageJson: JSON.stringify(result.coverage),
        valueAtRiskJson: JSON.stringify(result.valueAtRisk),
        ownerEmail,
      },
    });
    return row.id;
  });
}

export async function getLatestDataGapAnalysisForRun(
  runId: string,
  ownerEmail: string,
): Promise<CachedDataGap | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDataGapAnalysis.findFirst({
      where: { runId, ownerEmail },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return { result: rowToResult(row), createdAt: row.createdAt };
  });
}

export async function getLatestDataGapAnalysisForScan(
  scanId: string,
  ownerEmail: string,
): Promise<CachedDataGap | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDataGapAnalysis.findFirst({
      where: { scanId, ownerEmail },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return { result: rowToResult(row), createdAt: row.createdAt };
  });
}

/**
 * Determine whether a cached Data Gap row should be re-served or discarded
 * and recomputed.
 *
 * The Data Gap engine evolves (per-asset source-system attribution shipped
 * in P3.3, ingestion-strategy override in P3.4, etc.) and its inputs
 * change over the lifetime of a run (BV runs in the background AFTER the
 * pipeline completes, so a cache written before BV finished will carry
 * `valueAtRiskMid = 0` forever unless we invalidate). Without this check
 * the GET handler short-circuits to the cached row and serves stale data.
 *
 * Pure function for the shape signals; one Prisma roundtrip for the BV
 * signal so we can avoid recomputing when nothing has changed.
 *
 * Stale when ANY of:
 *
 *   1. **Schema drift (P3.3)** — at least one `coverage[i]` is missing the
 *      `resolvedSourceSystems` array. Pre-P3.3 rows render as `--` in the
 *      Source System column.
 *   2. **BV-after-cache** — `valueAtRiskMid === 0` AND the run has
 *      `ForgeValueEstimate` rows that did not contribute to the cache.
 *      Catches the common case where the user opens the page during the
 *      BV background window.
 *   3. **Rerun-BV** — the newest `ForgeValueEstimate.generatedAt` for the
 *      run is greater than `createdAt`. Catches manual reruns of BV.
 *   4. **Reference-link backfill** — the newest
 *      `ForgeUseCase.referenceUseCaseResolvedAt` for the run is greater
 *      than `createdAt`. Without this signal the very first Data Gap
 *      compute on a legacy run writes a cache with the fresh links,
 *      which is fine; but if the legacy cache was written FIRST (engine
 *      missed because the column was still null) and the backfill
 *      landed later (on a re-open), the second open would short-circuit
 *      to the stale $0 cache. This invalidates that case so the next
 *      open recomputes against the now-populated FK column.
 */
export async function isDataGapCacheStale(
  cached: CachedDataGap,
  runId: string,
): Promise<{ stale: boolean; reason?: string }> {
  // (1) Schema drift — pure check, no DB.
  const missingResolved = cached.result.coverage.some(
    (c) => !Array.isArray((c as { resolvedSourceSystems?: unknown }).resolvedSourceSystems),
  );
  if (missingResolved) {
    return { stale: true, reason: "missing resolvedSourceSystems (pre-P3.3 cache)" };
  }

  // (4) Reference-link backfill — a separate Prisma roundtrip on a
  // different table. Kept out of the aggregate below so we don't pay the
  // join cost on every poll; the column has an index on (runId).
  const newestRefResolvedAt = await getNewestReferenceUseCaseResolvedAt(runId);
  if (
    newestRefResolvedAt &&
    newestRefResolvedAt.getTime() > cached.createdAt.getTime()
  ) {
    return {
      stale: true,
      reason: `reference link backfilled after cache (resolved=${newestRefResolvedAt.toISOString()}, cache=${cached.createdAt.toISOString()})`,
    };
  }

  // (2) BV freshness — recompute when BV estimates have been generated
  // after the cache was written. NOTE: an earlier version also
  // short-circuited on `valueAtRiskMid === 0 && estimateCount > 0`, but
  // `$0 mid` is a legitimate steady-state outcome (every reference
  // asset already covered). Combined with estimates existing at cache
  // time, that clause caused every poll to invalidate the cache. The
  // timestamp comparison below already handles the only real stale
  // case (BV regenerated since cache).
  return withPrisma(async (prisma) => {
    const agg = await prisma.forgeValueEstimate.aggregate({
      where: { runId },
      _max: { generatedAt: true },
    });
    const newestGeneratedAt = agg._max.generatedAt;

    if (newestGeneratedAt && newestGeneratedAt.getTime() > cached.createdAt.getTime()) {
      return {
        stale: true,
        reason: `BV estimate generated after cache (estimate=${newestGeneratedAt.toISOString()}, cache=${cached.createdAt.toISOString()})`,
      };
    }

    return { stale: false };
  });
}

export async function deleteDataGapAnalysesForRun(runId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeDataGapAnalysis.deleteMany({ where: { runId } });
  });
}

export async function deleteDataGapAnalysesForScan(scanId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeDataGapAnalysis.deleteMany({ where: { scanId } });
  });
}

function rowToResult(row: {
  industryId: string;
  industryName: string;
  totalAssets: number;
  presentAssets: number;
  missingAssets: number;
  mcCovered: number;
  mcMissing: number;
  vaCovered: number;
  vaMissing: number;
  mcCoveragePct: number;
  valueAtRiskLow: number;
  valueAtRiskMid: number;
  valueAtRiskHigh: number;
  coverageJson: string;
  valueAtRiskJson: string | null;
  createdAt: Date;
}): DataGapResult {
  return {
    industryId: row.industryId,
    industryName: row.industryName,
    generatedAt: row.createdAt.toISOString(),
    summary: {
      industryId: row.industryId,
      industryName: row.industryName,
      totalAssets: row.totalAssets,
      presentAssets: row.presentAssets,
      missingAssets: row.missingAssets,
      mcCovered: row.mcCovered,
      mcMissing: row.mcMissing,
      vaCovered: row.vaCovered,
      vaMissing: row.vaMissing,
      mcCoveragePct: row.mcCoveragePct,
      valueAtRiskLow: row.valueAtRiskLow,
      valueAtRiskMid: row.valueAtRiskMid,
      valueAtRiskHigh: row.valueAtRiskHigh,
    },
    coverage: JSON.parse(row.coverageJson),
    valueAtRisk: row.valueAtRiskJson ? JSON.parse(row.valueAtRiskJson) : [],
  };
}
