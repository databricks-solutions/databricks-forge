/**
 * Data Gap Analysis -- engine entry point.
 *
 * Pure function. No DB, no LLM, no network. Takes a classified catalog
 * scope plus optional per-use-case dollar estimates and returns the full
 * coverage matrix + value-at-risk view.
 *
 * Designed to run synchronously after `classifySchema()` completes in an
 * estate scan or pipeline run. Production code path:
 *
 *   const tables = await classifySchema(...);
 *   const result = runDataGapAnalysis({
 *     industryId,
 *     classifiedTables: tables.map(t => ({ fqn: t.fqn, dataAssetId: t.dataAssetId })),
 *     useCaseValueEstimates: estimates,
 *   });
 *   await saveDataGapAnalysis(scanId, result);
 */

import { resolveIndustryId } from "@/lib/domain/industry-outcomes";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import { getIndustryOutcome } from "@/lib/domain/industry-outcomes";
import { buildIngestionRecommendations } from "./recommendations";
import {
  bridgeEstimatesToMasterRepo,
  computeSummaryValueAtRisk,
  computeValueAtRisk,
} from "./economic-value";
import { resolveAssetSourceSystems } from "./source-systems";
import type {
  AssetCoverage,
  AssetDescriptor,
  DataGapInput,
  DataGapResult,
  DataGapSummary,
} from "./types";

export function runDataGapAnalysis(input: DataGapInput): DataGapResult | null {
  const resolvedId = resolveIndustryId(input.industryId) ?? input.industryId;
  // Prefer caller-supplied enrichment (supports LLM-generated custom
  // industries that the sync built-in registry does not know about).
  // Falls back to the sync registry for the canonical 15 industries.
  const enrichment = input.enrichment ?? getMasterRepoEnrichment(resolvedId);
  if (!enrichment) return null;
  const outcome = getIndustryOutcome(resolvedId);
  const industryName = outcome?.name ?? resolvedId;

  // Build per-asset descriptors with use-case linkage.
  const descriptors: AssetDescriptor[] = enrichment.dataAssets.map((asset) => ({
    asset,
    useCases: [],
  }));
  const descriptorById = new Map(descriptors.map((d) => [d.asset.id, d]));

  for (const uc of enrichment.useCases) {
    if (!uc.dataAssetIds) continue;
    for (const assetId of uc.dataAssetIds) {
      const descriptor = descriptorById.get(assetId);
      if (!descriptor) continue;
      const criticality = uc.dataAssetCriticality?.[assetId] ?? "VA";
      descriptor.useCases.push({ uc, criticality });
    }
  }

  // Determine which assets are present in the catalog scope.
  const tablesByAsset = new Map<string, string[]>();
  for (const t of input.classifiedTables) {
    if (!t.dataAssetId) continue;
    const arr = tablesByAsset.get(t.dataAssetId) ?? [];
    arr.push(t.fqn);
    tablesByAsset.set(t.dataAssetId, arr);
  }

  const presentAssetIds = new Set<string>();
  const missingAssetIds = new Set<string>();

  // Build a lookup of per-use-case source systems (Phase 3.1 output) so
  // the per-asset resolver below can upgrade master-repo guesses with
  // lineage-confirmed signals. Master-repo use cases carry no customer-
  // side id, so matching is by case-insensitive name only.
  const useCaseSourceSystems = input.useCaseSourceSystems ?? [];
  const sourceSystemsByName = new Map<string, string[]>();
  for (const entry of useCaseSourceSystems) {
    const nameKey = entry.name?.trim().toLowerCase();
    if (nameKey) sourceSystemsByName.set(nameKey, entry.sourceSystems);
  }

  const coverage: AssetCoverage[] = descriptors.map((d) => {
    const matched = tablesByAsset.get(d.asset.id) ?? [];
    const present = matched.length > 0;
    if (present) presentAssetIds.add(d.asset.id);
    else missingAssetIds.add(d.asset.id);

    const mcLinks = d.useCases.filter((l) => l.criticality === "MC");
    const vaLinks = d.useCases.filter((l) => l.criticality === "VA");

    // Union of lineage-attributed source systems across every use case
    // linked to this asset (MC + VA). Master-repo use cases may not have
    // an id on the customer side, so we match by case-insensitive name.
    const ucNameHits = new Set<string>();
    for (const link of d.useCases) {
      const nameKey = link.uc.name?.trim().toLowerCase();
      const lineageHits = (nameKey && sourceSystemsByName.get(nameKey)) ?? [];
      for (const s of lineageHits) ucNameHits.add(s);
    }

    // Resolve concrete source systems first — they are then fed into the
    // ingestion-recommendations builder so the top strategy reflects the
    // resolved source (Phase 3.4 source-system override).
    const resolvedSourceSystems = resolveAssetSourceSystems({
      asset: d.asset,
      useCaseSourceSystems: [...ucNameHits],
    });

    return {
      assetId: d.asset.id,
      assetName: d.asset.name,
      assetFamily: d.asset.assetFamily,
      systemLocation: d.asset.systemLocation,
      systemKind: d.asset.systemKind,
      present,
      matchedTables: matched,
      mcUseCaseCount: mcLinks.length,
      vaUseCaseCount: vaLinks.length,
      mcUseCaseNames: mcLinks.slice(0, 10).map((l) => l.uc.name),
      recommendations: buildIngestionRecommendations(d.asset, resolvedSourceSystems),
      resolvedSourceSystems,
    };
  });

  // Sort coverage: missing-with-most-MC-use-cases first, then present.
  coverage.sort((a, b) => {
    if (a.present !== b.present) return a.present ? 1 : -1;
    if (!a.present) return b.mcUseCaseCount - a.mcUseCaseCount;
    return a.assetId.localeCompare(b.assetId);
  });

  // Aggregate MC/VA coverage counters.
  let mcCovered = 0;
  let mcMissing = 0;
  let vaCovered = 0;
  let vaMissing = 0;
  for (const uc of enrichment.useCases) {
    for (const assetId of uc.dataAssetIds ?? []) {
      const isMC = uc.dataAssetCriticality?.[assetId] === "MC";
      const present = presentAssetIds.has(assetId);
      if (isMC) {
        if (present) mcCovered++;
        else mcMissing++;
      } else {
        if (present) vaCovered++;
        else vaMissing++;
      }
    }
  }

  // Value-at-risk
  //
  // Bridge customer estimate names onto the master-repo namespace BEFORE the
  // aggregators run. The aggregators look up by master-repo name (`link.uc.
  // name`), but customer estimates carry the LLM-generated UC name. Without
  // this bridge, every estimate hits the $0 passthrough branch and the
  // Annual Value column is uniformly $0. See `bridgeEstimatesToMasterRepo`
  // for the matching / aggregation semantics.
  const estimates = bridgeEstimatesToMasterRepo(
    input.useCaseValueEstimates ?? [],
    enrichment.useCases,
  );
  const valueAtRisk = estimates.length
    ? computeValueAtRisk(descriptors, missingAssetIds, presentAssetIds, estimates)
    : [];
  const summaryVal = estimates.length
    ? computeSummaryValueAtRisk(descriptors, missingAssetIds, estimates)
    : { low: 0, mid: 0, high: 0 };

  const totalAssets = descriptors.length;
  const mcDenom = mcCovered + mcMissing;
  const summary: DataGapSummary = {
    industryId: resolvedId,
    industryName,
    totalAssets,
    presentAssets: presentAssetIds.size,
    missingAssets: missingAssetIds.size,
    mcCovered,
    mcMissing,
    vaCovered,
    vaMissing,
    mcCoveragePct: mcDenom > 0 ? mcCovered / mcDenom : 0,
    valueAtRiskLow: summaryVal.low,
    valueAtRiskMid: summaryVal.mid,
    valueAtRiskHigh: summaryVal.high,
  };

  return {
    industryId: resolvedId,
    industryName,
    generatedAt: new Date().toISOString(),
    summary,
    coverage,
    valueAtRisk,
  };
}
