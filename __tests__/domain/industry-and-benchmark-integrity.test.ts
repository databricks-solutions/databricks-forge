import { describe, expect, it } from "vitest";
import { INDUSTRY_OUTCOMES } from "@/lib/domain/industry-outcomes";
import {
  getMasterRepoEnrichment,
  getMasterRepoIndustryIds,
} from "@/lib/domain/industry-outcomes/master-repo-registry";
import { runDataGapAnalysis } from "@/lib/engines/data-gap-analysis/engine";

describe("PR-07 Master Repo v2 100% industry coverage & formula syntax integrity", () => {
  it("registers Master Repo v2 enrichments for all 22 outcome-map industries", () => {
    const registeredIds = new Set(getMasterRepoIndustryIds());
    for (const outcome of INDUSTRY_OUTCOMES) {
      expect(
        registeredIds.has(outcome.id),
        `Missing Master Repo enrichment for ${outcome.id}`,
      ).toBe(true);

      const enrichment = getMasterRepoEnrichment(outcome.id);
      expect(enrichment).toBeDefined();
      expect(enrichment!.useCases.length).toBeGreaterThanOrEqual(5);
      expect(enrichment!.dataAssets.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("ensures every use case dataAssetId resolves to a valid ReferenceDataAsset in the same industry", () => {
    for (const outcome of INDUSTRY_OUTCOMES) {
      const enrichment = getMasterRepoEnrichment(outcome.id)!;
      const assetIds = new Set(enrichment.dataAssets.map((a) => a.id));

      for (const uc of enrichment.useCases) {
        for (const id of uc.dataAssetIds ?? []) {
          expect(
            assetIds.has(id),
            `Industry ${outcome.id} use case "${uc.name}" references unknown asset ${id}`,
          ).toBe(true);
        }
      }
    }
  });

  it("ensures no economicFormula contains un-separated AdoptCapture / AdoptCap tokens", () => {
    for (const outcome of INDUSTRY_OUTCOMES) {
      const enrichment = getMasterRepoEnrichment(outcome.id)!;
      for (const uc of enrichment.useCases) {
        if (!uc.economicFormula) continue;
        expect(uc.economicFormula).not.toMatch(/AdoptCapture|AdoptCap\b/);
        expect(uc.economicFormula).toMatch(/[*×/+-]/);
      }
    }
  });

  it("executes runDataGapAnalysis cleanly for the 5 newly enriched industries", () => {
    for (const industryId of [
      "water-utilities",
      "rail-transport",
      "automotive-mobility",
      "superannuation",
      "construction-infrastructure",
    ]) {
      const enrichment = getMasterRepoEnrichment(industryId)!;
      const gap = runDataGapAnalysis({
        industryId,
        classifiedTables: [
          { fqn: "main.core.asset_a01", dataAssetId: "A01" },
          { fqn: "main.core.asset_a02", dataAssetId: "A02" },
        ],
      })!;

      expect(gap).not.toBeNull();
      expect(gap.summary.totalAssets).toBe(enrichment.dataAssets.length);
      expect(gap.summary.presentAssets).toBe(2);
      expect(gap.summary.missingAssets).toBe(enrichment.dataAssets.length - 2);
      expect(gap.coverage.length).toBe(enrichment.dataAssets.length);
    }
  });
});
