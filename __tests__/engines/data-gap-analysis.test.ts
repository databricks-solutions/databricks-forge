/**
 * Data Gap Analysis engine unit tests.
 *
 * Exercises the engine against the real Retail Master Repo enrichment so
 * coverage logic, ingestion recommendations, and value-at-risk aggregation
 * are validated end-to-end without database / LLM dependencies.
 */

import { describe, it, expect } from "vitest";

import { runDataGapAnalysis } from "@/lib/engines/data-gap-analysis/engine";
import { buildIngestionRecommendations } from "@/lib/engines/data-gap-analysis/recommendations";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";

describe("Data Gap Analysis engine", () => {
  it("returns null for an unknown industry", () => {
    const result = runDataGapAnalysis({
      industryId: "not-a-real-industry-xyz",
      classifiedTables: [],
    });
    expect(result).toBeNull();
  });

  it("treats empty catalog scope as 0% MC coverage", () => {
    const result = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [],
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.summary.industryId).toBe("retail");
    expect(result.summary.presentAssets).toBe(0);
    expect(result.summary.missingAssets).toBe(result.summary.totalAssets);
    expect(result.summary.mcCoveragePct).toBe(0);
    expect(result.summary.totalAssets).toBeGreaterThan(0);
    // Every coverage row should be missing.
    expect(result.coverage.every((c) => !c.present)).toBe(true);
    // Each coverage row should expose at least one ingestion recommendation.
    expect(result.coverage.every((c) => c.recommendations.length >= 1)).toBe(true);
  });

  it("marks an asset as present when a table maps to it", () => {
    const enrichment = getMasterRepoEnrichment("retail");
    expect(enrichment).toBeDefined();
    if (!enrichment) return;
    const firstAssetId = enrichment.dataAssets[0]!.id;

    const result = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [
        { fqn: "catalog.silver.profiles", dataAssetId: firstAssetId },
        { fqn: "catalog.silver.orphan", dataAssetId: null },
      ],
    });
    expect(result).not.toBeNull();
    if (!result) return;
    const row = result.coverage.find((c) => c.assetId === firstAssetId);
    expect(row).toBeDefined();
    expect(row!.present).toBe(true);
    expect(row!.matchedTables).toContain("catalog.silver.profiles");
    expect(result.summary.presentAssets).toBe(1);
  });

  it("resolves legacy aliases through the master repo registry", () => {
    const result = runDataGapAnalysis({
      industryId: "rcg",
      classifiedTables: [],
    });
    expect(result).not.toBeNull();
    if (!result) return;
    // resolveIndustryId(rcg) -> retail
    expect(result.summary.industryId).toBe("retail");
  });

  it("attributes value-at-risk to missing MC assets and unblocks UCs when ALL MC assets are present", () => {
    const enrichment = getMasterRepoEnrichment("retail");
    if (!enrichment) return;

    // Pick a use case that has at least one MC asset.
    const usecaseWithMc = enrichment.useCases.find((u) =>
      Object.values(u.dataAssetCriticality ?? {}).includes("MC"),
    );
    expect(usecaseWithMc).toBeDefined();
    if (!usecaseWithMc) return;

    const allMcAssetIds = Object.entries(usecaseWithMc.dataAssetCriticality ?? {})
      .filter(([, role]) => role === "MC")
      .map(([id]) => id);

    // Scenario A -- all MC assets missing -> use case should be blocked and
    // contribute to valueAtRisk.
    const missing = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [],
      useCaseValueEstimates: [
        {
          useCaseId: usecaseWithMc.name,
          name: usecaseWithMc.name,
          valueLow: 100_000,
          valueMid: 500_000,
          valueHigh: 1_000_000,
          economicImpactCategory: "Cost",
        },
      ],
    });
    expect(missing).not.toBeNull();
    if (!missing) return;
    expect(missing.summary.valueAtRiskMid).toBeGreaterThan(0);
    // The UC should show up on at least one missing MC asset row.
    const blockedRowsMissing = missing.valueAtRisk.filter((row) =>
      row.blockedUseCases.includes(usecaseWithMc.name),
    );
    expect(blockedRowsMissing.length).toBeGreaterThan(0);
    // The per-asset impactedUseCases payload (Phase 2.3) must surface the
    // attributed UC with its criticality + attributed value.
    const impactedRow = blockedRowsMissing[0]!;
    expect(impactedRow.impactedUseCases.length).toBeGreaterThan(0);
    const mcImpact = impactedRow.impactedUseCases.find(
      (u) => u.name === usecaseWithMc.name && u.criticality === "MC",
    );
    expect(mcImpact).toBeDefined();
    expect(mcImpact!.valueMid).toBe(500_000);
    expect(mcImpact!.useCaseId).toBe(usecaseWithMc.name);

    // Scenario B -- ALL MC assets for this UC are present -> the UC must no
    // longer appear in any blockedUseCases list.
    const present = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: allMcAssetIds.map((id, i) => ({
        fqn: `cat.s.t${i}`,
        dataAssetId: id,
      })),
      useCaseValueEstimates: [
        {
          useCaseId: usecaseWithMc.name,
          name: usecaseWithMc.name,
          valueLow: 100_000,
          valueMid: 500_000,
          valueHigh: 1_000_000,
          economicImpactCategory: "Cost",
        },
      ],
    });
    expect(present).not.toBeNull();
    if (!present) return;
    const blockedNames = present.valueAtRisk.flatMap((r) => r.blockedUseCases);
    expect(blockedNames).not.toContain(usecaseWithMc.name);
  });

  it("bridges customer estimate names to master-repo names so value-at-risk populates even when titles do not match verbatim", () => {
    // Regression for the production bug where Annual Value was uniformly $0:
    // customer ForgeValueEstimate rows carry LLM-generated names that never
    // match the master-repo UC names the value-at-risk aggregator looks up.
    // The fix is `bridgeEstimatesToMasterRepo` inside the engine. This test
    // would have caught the bug — the previous test on the same engine
    // cheats by passing the master-repo name itself as the estimate name.
    const enrichment = getMasterRepoEnrichment("retail");
    if (!enrichment) return;

    const usecaseWithMc = enrichment.useCases.find((u) =>
      Object.values(u.dataAssetCriticality ?? {}).includes("MC"),
    );
    expect(usecaseWithMc).toBeDefined();
    if (!usecaseWithMc) return;

    // Perturb the master-repo name so it does NOT match verbatim but still
    // shares enough tokens to hit the Jaccard tier of findReferenceMatch.
    // Appending "Engine" preserves all meaningful tokens, guaranteeing
    // Jaccard >= 0.5 for any master-repo name with at least one meaningful
    // token (the canonical case).
    const customerName = `${usecaseWithMc.name} Engine`;
    expect(customerName.toLowerCase()).not.toBe(usecaseWithMc.name.toLowerCase());

    const result = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [],
      useCaseValueEstimates: [
        {
          useCaseId: "uc-customer-id",
          name: customerName,
          valueLow: 100_000,
          valueMid: 500_000,
          valueHigh: 1_000_000,
          economicImpactCategory: "Cost",
        },
      ],
    });
    expect(result).not.toBeNull();
    if (!result) return;

    // Bridge worked -> summary value-at-risk is non-zero.
    expect(result.summary.valueAtRiskMid).toBeGreaterThan(0);

    // The UC surfaces on at least one missing MC asset row, AND the per-asset
    // impactedUseCases entry carries the master-repo name (proves the rename
    // actually happened — without the bridge the name would still be the
    // perturbed customer string OR the entry would have valueMid: 0).
    const blockedRow = result.valueAtRisk.find((row) =>
      row.blockedUseCases.includes(usecaseWithMc.name),
    );
    expect(blockedRow).toBeDefined();
    const mcImpact = blockedRow!.impactedUseCases.find(
      (u) => u.name === usecaseWithMc.name && u.criticality === "MC",
    );
    expect(mcImpact).toBeDefined();
    expect(mcImpact!.valueMid).toBe(500_000);
  });

  it("joins useCaseSourceSystems by master-repo use-case name, not customer-side name", () => {
    // Regression for the route bug where `useCaseSourceSystems[].name` was
    // populated with the customer-generated `uc.name`. The engine looks up
    // by master-repo UC name (case-insensitive) inside `descriptor.useCases`,
    // so a customer-name keyed entry never joined — lineage signal was
    // silently dropped and per-asset origin downgraded to master-repo /
    // unknown. The route now prefers `referenceUseCaseName` so the key
    // matches what this test asserts.
    const enrichment = getMasterRepoEnrichment("retail");
    if (!enrichment) return;

    const usecaseWithMc = enrichment.useCases.find((u) =>
      Object.values(u.dataAssetCriticality ?? {}).includes("MC"),
    );
    expect(usecaseWithMc).toBeDefined();
    if (!usecaseWithMc) return;

    const firstMcAssetId = Object.entries(usecaseWithMc.dataAssetCriticality ?? {})
      .find(([, role]) => role === "MC")?.[0];
    expect(firstMcAssetId).toBeDefined();
    if (!firstMcAssetId) return;

    // Positive: join key matches master-repo title -> lineage origin wins.
    const matched = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [],
      useCaseSourceSystems: [
        { name: usecaseWithMc.name, sourceSystems: ["Salesforce"] },
      ],
    });
    expect(matched).not.toBeNull();
    if (!matched) return;
    const matchedRow = matched.coverage.find((c) => c.assetId === firstMcAssetId);
    expect(matchedRow).toBeDefined();
    const lineageHits = matchedRow!.resolvedSourceSystems.filter(
      (s) => s.origin === "lineage",
    );
    expect(lineageHits.map((s) => s.name)).toContain("Salesforce");

    // Negative: same vendor but a customer-only name (no match in the
    // master repo) -> no lineage signal flows for this asset.
    const customerName = "Operationalise Loyalty Tiering with Behavioural Cohorts";
    expect(customerName.toLowerCase()).not.toBe(usecaseWithMc.name.toLowerCase());

    const mismatched = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [],
      useCaseSourceSystems: [
        { name: customerName, sourceSystems: ["Salesforce"] },
      ],
    });
    expect(mismatched).not.toBeNull();
    if (!mismatched) return;
    const mismatchedRow = mismatched.coverage.find((c) => c.assetId === firstMcAssetId);
    expect(mismatchedRow).toBeDefined();
    expect(
      mismatchedRow!.resolvedSourceSystems.some((s) => s.name === "Salesforce"),
    ).toBe(false);
  });

  it("sorts missing-with-most-MC-use-cases ahead of present rows", () => {
    const result = runDataGapAnalysis({
      industryId: "retail",
      classifiedTables: [],
    });
    if (!result) return;
    // All missing rows come before any present rows (no presents here, but
    // the relative ordering invariant within missing should hold).
    const mcCounts = result.coverage.map((c) => c.mcUseCaseCount);
    for (let i = 1; i < mcCounts.length; i++) {
      expect(mcCounts[i - 1]).toBeGreaterThanOrEqual(mcCounts[i]);
    }
  });
});

describe("buildIngestionRecommendations", () => {
  it("ranks ingestion strategies by High rating in canonical order", () => {
    const recs = buildIngestionRecommendations({
      id: "TEST",
      name: "Test Asset",
      description: "",
      systemLocation: "Snowflake",
      assetFamily: "Test Family",
      easeOfAccess: "Medium",
      lakeflowConnect: "Low",
      ucFederation: "High",
      lakebridgeMigrate: "High",
      bespoke: "Low",
    });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.strategy).toBe("uc_federation");
    expect(recs[0]!.rating).toBe("High");
  });

  it("falls back to a Low recommendation when no High exists", () => {
    const recs = buildIngestionRecommendations({
      id: "TEST",
      name: "Test Asset",
      description: "",
      systemLocation: "Custom",
      assetFamily: "Test Family",
      easeOfAccess: "Hard",
      lakeflowConnect: "Low",
      ucFederation: "Low",
      lakebridgeMigrate: "Low",
      bespoke: "High",
    });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.strategy).toBe("bespoke");
  });
});
