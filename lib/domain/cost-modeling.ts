/**
 * Implementation cost modeling -- T-shirt sizing to dollar estimates and ROI.
 *
 * Provides deterministic cost estimates based on effort T-shirt sizes and
 * calculates net ROI from value estimates minus implementation costs.
 *
 * Also includes the Master Repository LOE matrix for model-type-aware
 * effort estimation and Databricks connectivity feasibility scoring.
 */

import type { EffortEstimate } from "@/lib/domain/types";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import {
  LOE_MATRIX as MASTER_REPO_LOE_MATRIX,
  LOE_TO_EFFORT as MASTER_REPO_LOE_TO_EFFORT,
  normalizeModelType as masterRepoNormalizeModelType,
  resolveLoeLevel as masterRepoResolveLoeLevel,
  type AccessDifficulty,
  type LOELevel as MasterRepoLOELevel,
  type ModelType as MasterRepoModelType,
} from "@/lib/domain/loe-matrix";

export interface CostEstimate {
  effortEstimate: EffortEstimate;
  label: string;
  fteMonths: { low: number; mid: number; high: number };
  costUsd: { low: number; mid: number; high: number };
  durationWeeks: { low: number; mid: number; high: number };
}

export interface RoiResult {
  valueMid: number;
  costMid: number;
  netRoi: number;
  roiPercent: number;
  paybackMonths: number | null;
}

const FTE_MONTHLY_COST = 15_000;

const EFFORT_TABLE: Record<
  EffortEstimate,
  {
    label: string;
    fteMonths: { low: number; mid: number; high: number };
    durationWeeks: { low: number; mid: number; high: number };
  }
> = {
  xs: {
    label: "Extra Small",
    fteMonths: { low: 0.25, mid: 0.5, high: 1 },
    durationWeeks: { low: 1, mid: 2, high: 3 },
  },
  s: {
    label: "Small",
    fteMonths: { low: 1, mid: 2, high: 3 },
    durationWeeks: { low: 2, mid: 4, high: 6 },
  },
  m: {
    label: "Medium",
    fteMonths: { low: 3, mid: 5, high: 8 },
    durationWeeks: { low: 6, mid: 10, high: 16 },
  },
  l: {
    label: "Large",
    fteMonths: { low: 6, mid: 10, high: 16 },
    durationWeeks: { low: 12, mid: 20, high: 32 },
  },
  xl: {
    label: "Extra Large",
    fteMonths: { low: 12, mid: 20, high: 30 },
    durationWeeks: { low: 24, mid: 40, high: 52 },
  },
};

export function estimateCost(effort: EffortEstimate): CostEstimate {
  const e = EFFORT_TABLE[effort];
  return {
    effortEstimate: effort,
    label: e.label,
    fteMonths: e.fteMonths,
    costUsd: {
      low: Math.round(e.fteMonths.low * FTE_MONTHLY_COST),
      mid: Math.round(e.fteMonths.mid * FTE_MONTHLY_COST),
      high: Math.round(e.fteMonths.high * FTE_MONTHLY_COST),
    },
    durationWeeks: e.durationWeeks,
  };
}

export function calculateRoi(annualValueMid: number, effort: EffortEstimate): RoiResult {
  const cost = estimateCost(effort);
  const costMid = cost.costUsd.mid;
  const netRoi = annualValueMid - costMid;
  const roiPercent = costMid > 0 ? ((annualValueMid - costMid) / costMid) * 100 : 0;
  const paybackMonths = annualValueMid > 0 ? Math.round((costMid / annualValueMid) * 12) : null;

  return { valueMid: annualValueMid, costMid, netRoi, roiPercent, paybackMonths };
}

export function getEffortLabel(effort: EffortEstimate | string | null): string {
  if (!effort) return "—";
  return EFFORT_TABLE[effort as EffortEstimate]?.label ?? effort.toUpperCase();
}

export function getEffortOrder(effort: EffortEstimate): number {
  const order: Record<EffortEstimate, number> = {
    xs: 1,
    s: 2,
    m: 3,
    l: 4,
    xl: 5,
  };
  return order[effort] ?? 3;
}

// ---------------------------------------------------------------------------
// Master Repository LOE Matrix (back-compat wrapper)
// ---------------------------------------------------------------------------
//
// The canonical matrix now lives in `lib/domain/loe-matrix.ts`. This module
// keeps the legacy `estimateLOEFromModelType(modelType, mcCount)` wrapper for
// callers that have not yet been migrated to the explicit
// `mcAccessDifficulty` input from the Master Repository.

export type ModelType = MasterRepoModelType;
export type DataCriticality = "low" | "medium" | "high";
export type { MasterRepoLOELevel as LOELevel };

function difficultyFromMcCount(mcCount: number): AccessDifficulty {
  if (mcCount <= 1) return "Low";
  if (mcCount <= 3) return "Medium";
  return "High";
}

function difficultyToLegacyCriticality(d: AccessDifficulty): DataCriticality {
  return d === "Low" ? "low" : d === "Medium" ? "medium" : "high";
}

/**
 * Legacy entry point that derives an LOE from model type + MC asset count.
 * New callers should use `estimateLOEFromAccessDifficulty` instead, passing
 * the explicit `mcAccessDifficulty` value from `MasterRepoUseCase`.
 */
export function estimateLOEFromModelType(
  modelType: string,
  mcCount: number,
): { effort: EffortEstimate; loeLevel: MasterRepoLOELevel; dataCriticality: DataCriticality } | null {
  const resolved = masterRepoNormalizeModelType(modelType);
  if (!resolved) return null;

  const difficulty = difficultyFromMcCount(mcCount);
  const loeLevel = MASTER_REPO_LOE_MATRIX[resolved][difficulty];

  return {
    effort: MASTER_REPO_LOE_TO_EFFORT[loeLevel],
    loeLevel,
    dataCriticality: difficultyToLegacyCriticality(difficulty),
  };
}

/**
 * Resolve LOE using the explicit Master Repository `mcAccessDifficulty` bucket.
 * Preferred over `estimateLOEFromModelType` once a use case has been re-seeded.
 */
export function estimateLOEFromAccessDifficulty(
  modelType: string,
  accessDifficulty: AccessDifficulty,
): { effort: EffortEstimate; loeLevel: MasterRepoLOELevel } | null {
  const loeLevel = masterRepoResolveLoeLevel(modelType, accessDifficulty);
  if (!loeLevel) return null;
  return {
    effort: MASTER_REPO_LOE_TO_EFFORT[loeLevel],
    loeLevel,
  };
}

// ---------------------------------------------------------------------------
// Databricks connectivity feasibility
// ---------------------------------------------------------------------------

/**
 * Estimate data access feasibility for a set of data assets within an industry.
 *
 * Looks up each asset's Databricks connectivity scores (Lakeflow Connect,
 * UC Federation, Lakebridge Migrate) and returns a 0-1 feasibility score
 * based on the proportion of "High" connectivity ratings across all assets
 * and methods.
 *
 * Returns null if the industry has no enrichment data or no matching assets.
 */
export function estimateDataAccessFeasibility(
  industryId: string,
  assetIds: string[],
): { score: number; totalRatings: number; highRatings: number } | null {
  if (assetIds.length === 0) return null;

  const enrichment = getMasterRepoEnrichment(industryId);
  if (!enrichment || enrichment.dataAssets.length === 0) return null;

  const assetIndex = new Map(enrichment.dataAssets.map((da) => [da.id, da]));
  let totalRatings = 0;
  let highRatings = 0;

  for (const id of assetIds) {
    const da = assetIndex.get(id);
    if (!da) continue;

    const ratings = [da.lakeflowConnect, da.ucFederation, da.lakebridgeMigrate];
    for (const r of ratings) {
      totalRatings++;
      if (r === "High") highRatings++;
    }
  }

  if (totalRatings === 0) return null;

  return {
    score: highRatings / totalRatings,
    totalRatings,
    highRatings,
  };
}
