import { describe, it, expect } from "vitest";
import { buildOnboardingPlan } from "@/lib/engines/data-gap-analysis/onboarding-plan";
import type {
  AssetCoverage,
  AssetValueAtRisk,
  DataGapResult,
} from "@/lib/engines/data-gap-analysis/types";
import type { ResolvedSourceSystem } from "@/lib/engines/data-gap-analysis/source-systems";

// -- Test fixtures -----------------------------------------------------------

function makeCoverage(
  assetId: string,
  resolvedSourceSystems: ResolvedSourceSystem[],
): AssetCoverage {
  return {
    assetId,
    assetName: assetId,
    assetFamily: "test",
    systemLocation: "",
    systemKind: undefined,
    present: false,
    matchedTables: [],
    mcUseCaseCount: 0,
    vaUseCaseCount: 0,
    mcUseCaseNames: [],
    recommendations: [],
    resolvedSourceSystems,
  };
}

function makeVar(
  assetId: string,
  totalMid: number,
  blockedUseCases: string[] = [],
): AssetValueAtRisk {
  return {
    assetId,
    assetName: assetId,
    blockedUseCases,
    reducedUseCases: [],
    impactedUseCases: [],
    byImpactCategory: {},
    totalLow: totalMid * 0.5,
    totalMid,
    totalHigh: totalMid * 1.5,
  };
}

function makeResult(coverage: AssetCoverage[], valueAtRisk: AssetValueAtRisk[]): DataGapResult {
  return {
    industryId: "test",
    industryName: "Test",
    generatedAt: "2026-01-01T00:00:00Z",
    summary: {
      industryId: "test",
      industryName: "Test",
      totalAssets: coverage.length,
      presentAssets: 0,
      missingAssets: coverage.length,
      mcCovered: 0,
      mcMissing: 0,
      vaCovered: 0,
      vaMissing: 0,
      mcCoveragePct: 0,
      valueAtRiskLow: 0,
      valueAtRiskMid: 0,
      valueAtRiskHigh: 0,
    },
    coverage,
    valueAtRisk,
  };
}

const SALESFORCE: ResolvedSourceSystem = {
  name: "Salesforce",
  origin: "lineage",
  systemKind: "CRM",
  preferredStrategy: "lakeflow_connect",
};
const SAP: ResolvedSourceSystem = {
  name: "SAP",
  origin: "master-repo",
  systemKind: "ERP",
  preferredStrategy: "lakebridge_migrate",
};
const UNKNOWN: ResolvedSourceSystem = {
  name: "Unknown",
  origin: "unknown",
  systemKind: null,
  preferredStrategy: null,
};
/** Category-style master-repo row (post-honesty-refresh). */
const CRM_CATEGORY: ResolvedSourceSystem = {
  name: "CRM systems",
  origin: "master-repo",
  systemKind: "CRM",
  preferredStrategy: "lakeflow_connect",
  exampleVendors: ["Salesforce", "HubSpot", "Microsoft Dynamics 365"],
};
const UNKNOWN_CRM: ResolvedSourceSystem = {
  name: "Unknown",
  origin: "unknown",
  systemKind: null,
  preferredStrategy: null,
  likelyCategories: ["CRM"],
};
const UNKNOWN_ERP: ResolvedSourceSystem = {
  name: "Unknown",
  origin: "unknown",
  systemKind: null,
  preferredStrategy: null,
  likelyCategories: ["ERP"],
};

// -- Tests -------------------------------------------------------------------

describe("buildOnboardingPlan — empty / no-source paths", () => {
  it("returns [] when there's no value at risk", () => {
    expect(buildOnboardingPlan(makeResult([], []))).toEqual([]);
  });

  it("skips assets that have no resolved sources at all", () => {
    const result = makeResult([makeCoverage("a1", [])], [makeVar("a1", 100_000)]);
    expect(buildOnboardingPlan(result)).toEqual([]);
  });
});

describe("buildOnboardingPlan — single-source attribution", () => {
  it("groups all single-source assets under one row per system", () => {
    const result = makeResult(
      [
        makeCoverage("a1", [SALESFORCE]),
        makeCoverage("a2", [SALESFORCE]),
        makeCoverage("a3", [SAP]),
      ],
      [
        makeVar("a1", 100_000, ["UC1"]),
        makeVar("a2", 50_000, ["UC2"]),
        makeVar("a3", 200_000, ["UC3"]),
      ],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan).toHaveLength(2);
    // SAP wins on value ($200K > $150K Salesforce)
    expect(plan[0]?.systemName).toBe("SAP");
    expect(plan[0]?.valueMid).toBe(200_000);
    expect(plan[1]?.systemName).toBe("Salesforce");
    expect(plan[1]?.valueMid).toBe(150_000);
    expect(plan[1]?.assetCount).toBe(2);
  });

  it("preserves preferredStrategy and origin on the grouped row", () => {
    const result = makeResult(
      [makeCoverage("a1", [SALESFORCE])],
      [makeVar("a1", 100_000, ["UC1"])],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan[0]?.preferredStrategy).toBe("lakeflow_connect");
    expect(plan[0]?.origin).toBe("lineage");
  });
});

describe("buildOnboardingPlan — multi-source attribution split", () => {
  it("splits an asset's value evenly across N resolved systems", () => {
    const result = makeResult(
      [makeCoverage("a1", [SALESFORCE, SAP])],
      [makeVar("a1", 100_000)],
    );
    const plan = buildOnboardingPlan(result);
    // 100K / 2 = 50K to each
    expect(plan.find((p) => p.systemName === "Salesforce")?.valueMid).toBe(50_000);
    expect(plan.find((p) => p.systemName === "SAP")?.valueMid).toBe(50_000);
  });

  it("dedupes use cases across multi-source contributions", () => {
    const result = makeResult(
      [makeCoverage("a1", [SALESFORCE, SAP])],
      [makeVar("a1", 100_000, ["UC1", "UC2"])],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan.find((p) => p.systemName === "Salesforce")?.useCaseCount).toBe(2);
    expect(plan.find((p) => p.systemName === "SAP")?.useCaseCount).toBe(2);
  });
});

describe("buildOnboardingPlan — unconfirmed bucket", () => {
  it("collapses all unknown contributions into a single 'Unconfirmed sources' row", () => {
    const result = makeResult(
      [makeCoverage("a1", [UNKNOWN]), makeCoverage("a2", [UNKNOWN])],
      [makeVar("a1", 100_000), makeVar("a2", 200_000)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.systemName).toBe("Unconfirmed sources");
    expect(plan[0]?.valueMid).toBe(300_000);
  });

  it("pins 'Unconfirmed sources' to the bottom even when it has highest value", () => {
    const result = makeResult(
      [makeCoverage("a1", [SALESFORCE]), makeCoverage("a2", [UNKNOWN])],
      [makeVar("a1", 50_000), makeVar("a2", 999_999)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan[0]?.systemName).toBe("Salesforce");
    expect(plan[plan.length - 1]?.systemName).toBe("Unconfirmed sources");
  });

  it("aggregates likelyCategories across all unknown contributors and dedupes", () => {
    const result = makeResult(
      [
        makeCoverage("a1", [UNKNOWN_CRM]),
        makeCoverage("a2", [UNKNOWN_CRM]),
        makeCoverage("a3", [UNKNOWN_ERP]),
      ],
      [makeVar("a1", 100_000), makeVar("a2", 50_000), makeVar("a3", 75_000)],
    );
    const plan = buildOnboardingPlan(result);
    const unconfirmed = plan.find((p) => p.systemName === "Unconfirmed sources");
    expect(unconfirmed).toBeDefined();
    expect(unconfirmed?.likelyCategories).toEqual(["CRM", "ERP"]);
  });
});

describe("buildOnboardingPlan — master-repo CRM rollup (honesty refresh)", () => {
  it("rolls up THREE ref-arch CRM assets into ONE 'CRM systems' row carrying exampleVendors", () => {
    const result = makeResult(
      [
        makeCoverage("a1", [CRM_CATEGORY]),
        makeCoverage("a2", [CRM_CATEGORY]),
        makeCoverage("a3", [CRM_CATEGORY]),
      ],
      [makeVar("a1", 100_000), makeVar("a2", 80_000), makeVar("a3", 60_000)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.systemName).toBe("CRM systems");
    expect(plan[0]?.assetCount).toBe(3);
    expect(plan[0]?.valueMid).toBe(240_000);
    expect(plan[0]?.origin).toBe("master-repo");
    expect(plan[0]?.preferredStrategy).toBe("lakeflow_connect");
    expect(plan[0]?.exampleVendors).toEqual([
      "Salesforce",
      "HubSpot",
      "Microsoft Dynamics 365",
    ]);
  });

  it("keeps a lineage-confirmed Salesforce row separate from the rolled-up 'CRM systems' row", () => {
    const result = makeResult(
      [makeCoverage("a1", [SALESFORCE]), makeCoverage("a2", [CRM_CATEGORY])],
      [makeVar("a1", 200_000), makeVar("a2", 100_000)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan).toHaveLength(2);
    const names = plan.map((p) => p.systemName);
    expect(names).toContain("Salesforce");
    expect(names).toContain("CRM systems");
    // Lineage row has no exampleVendors — we have the actual vendor.
    expect(plan.find((p) => p.systemName === "Salesforce")?.exampleVendors).toBeUndefined();
  });
});

describe("buildOnboardingPlan — sorting & truncation", () => {
  it("sorts rows by valueMid descending (excluding Unknown)", () => {
    const result = makeResult(
      [
        makeCoverage("a1", [SALESFORCE]),
        makeCoverage("a2", [SAP]),
      ],
      [makeVar("a1", 250_000), makeVar("a2", 750_000)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan[0]?.systemName).toBe("SAP");
    expect(plan[1]?.systemName).toBe("Salesforce");
  });

  it("truncates the per-row assets list to 8 entries", () => {
    const coverage: AssetCoverage[] = [];
    const valueAtRisk: AssetValueAtRisk[] = [];
    for (let i = 0; i < 12; i++) {
      coverage.push(makeCoverage(`a${i}`, [SALESFORCE]));
      valueAtRisk.push(makeVar(`a${i}`, (12 - i) * 10_000));
    }
    const plan = buildOnboardingPlan(makeResult(coverage, valueAtRisk));
    expect(plan[0]?.assets).toHaveLength(8);
    // Assets sorted descending by valueMid — top should be a0 (highest)
    expect(plan[0]?.assets[0]?.assetId).toBe("a0");
  });

  it("truncates the per-row useCases list to 12 entries", () => {
    const useCases = Array.from({ length: 20 }, (_, i) => `UC${i}`);
    const result = makeResult(
      [makeCoverage("a1", [SALESFORCE])],
      [makeVar("a1", 100_000, useCases)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan[0]?.useCases).toHaveLength(12);
  });
});

describe("buildOnboardingPlan — origin escalation", () => {
  it("upgrades origin to 'lineage' when at least one contributor is lineage", () => {
    const result = makeResult(
      [
        makeCoverage("a1", [SAP]),
        makeCoverage("a2", [{ ...SAP, origin: "lineage" }]),
      ],
      [makeVar("a1", 100_000), makeVar("a2", 50_000)],
    );
    const plan = buildOnboardingPlan(result);
    expect(plan[0]?.systemName).toBe("SAP");
    expect(plan[0]?.origin).toBe("lineage");
  });
});
