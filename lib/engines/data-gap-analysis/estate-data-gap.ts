/**
 * Estate-scope Data Gap orchestration.
 *
 * Glues the (pure) data-gap engine to a persisted estate scan: loads the
 * scan's tables, maps them to the industry reference assets (reusing any
 * classification already on the world model), computes coverage + value-at-risk,
 * persists the analysis keyed by scanId, and returns the result.
 */

import { getEnvironmentScan, updateDetailDataAssets } from "@/lib/lakebase/environment-scans";
import { saveDataGapAnalysis } from "@/lib/lakebase/data-gap-analyses";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import { resolveIndustryId } from "@/lib/domain/industry-outcomes";
import type { MasterRepoUseCase } from "@/lib/domain/industry-outcomes/master-repo-types";
import { logger } from "@/lib/logger";
import { runDataGapAnalysis } from "./engine";
import { classifyEstateTablesToAssets, type EstateClassifierDeps } from "./estate-classifier";
import type { DataGapInput, DataGapResult } from "./types";

const BENCHMARK_BASELINE_USD = 2_500_000;

/**
 * Build deterministic Master Repo benchmark value estimates for standalone
 * estate scans where no Discovery / Business Value pipeline run has produced
 * customer-specific ForgeValueEstimate rows yet.
 */
export function buildBenchmarkEstimatesFromMasterRepo(
  useCases: readonly MasterRepoUseCase[],
): NonNullable<DataGapInput["useCaseValueEstimates"]> {
  return useCases.map((uc, idx) => {
    const match = uc.benchmarkImpact?.match(/(\d+(?:\.\d+)?)/);
    const rawPct = match ? parseFloat(match[1]) : 12;
    const pct = Number.isFinite(rawPct) ? Math.min(Math.max(rawPct, 5), 50) : 12;
    const valueMid = Math.round(BENCHMARK_BASELINE_USD * (pct / 100));
    const valueLow = Math.round(valueMid * 0.5);
    const valueHigh = Math.round(valueMid * 1.6);
    return {
      useCaseId: `benchmark:${idx + 1}`,
      name: uc.name,
      referenceUseCaseName: uc.name,
      valueLow,
      valueMid,
      valueHigh,
      economicImpactCategory: uc.economicImpactCategory ?? "Cost",
    };
  });
}

export interface ComputeEstateDataGapInput {
  scanId: string;
  industryId: string;
  ownerEmail: string;
}

export async function computeEstateDataGap(
  input: ComputeEstateDataGapInput,
  deps: EstateClassifierDeps = {},
): Promise<DataGapResult | null> {
  const { scanId, industryId, ownerEmail } = input;
  const resolvedId = resolveIndustryId(industryId) ?? industryId;
  const enrichment = getMasterRepoEnrichment(resolvedId);
  if (!enrichment) {
    logger.warn("[estate-data-gap] No master-repo enrichment for industry", {
      industryId,
      resolvedId,
    });
    return null;
  }

  const scan = await getEnvironmentScan(scanId);
  if (!scan) return null;

  // Reuse classifications already on the world model; classify the rest.
  const preclassified = scan.details
    .filter((d) => d.dataAssetId)
    .map((d) => ({
      fqn: d.tableFqn,
      dataAssetId: d.dataAssetId!,
      dataAssetName: d.dataAssetName ?? d.dataAssetId!,
    }));
  const unclassified = scan.details.filter((d) => !d.dataAssetId);

  let newlyClassified: Array<{ fqn: string; dataAssetId: string; dataAssetName: string }> = [];
  if (unclassified.length > 0) {
    newlyClassified = await classifyEstateTablesToAssets(
      unclassified.map((d) => ({
        fqn: d.tableFqn,
        dataDomain: d.dataDomain,
        comment: d.comment ?? d.generatedDescription,
      })),
      enrichment.dataAssets,
      deps,
    );
    // Persist back so a later replay does not re-pay the LLM cost.
    await updateDetailDataAssets(scanId, newlyClassified).catch((err) =>
      logger.warn("[estate-data-gap] Failed to persist classifications (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const classifiedTables = [...preclassified, ...newlyClassified].map((c) => ({
    fqn: c.fqn,
    dataAssetId: c.dataAssetId,
  }));

  const useCaseValueEstimates = buildBenchmarkEstimatesFromMasterRepo(enrichment.useCases);

  const result = runDataGapAnalysis({
    industryId: resolvedId,
    classifiedTables,
    useCaseValueEstimates,
  });
  if (!result) return null;

  await saveDataGapAnalysis({ result, scanId, ownerEmail }).catch((err) =>
    logger.warn("[estate-data-gap] Failed to persist analysis (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  return result;
}
