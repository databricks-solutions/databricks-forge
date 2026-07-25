import { describe, it, expect } from "vitest";
import { buildDashboardDesignPrompt } from "@/lib/dashboard/prompts";
import type { UseCase } from "@/lib/domain/types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";

function makeUseCase(overrides?: Partial<UseCase>): UseCase {
  return {
    id: "uc-1",
    runId: "run-1",
    useCaseNo: 1,
    name: "Test Use Case",
    statement: "Analyse revenue by region",
    type: "Statistical",
    analyticsTechnique: "Dashboard",
    solution: "",
    businessValue: "",
    beneficiary: "",
    sponsor: "",
    domain: "Sales",
    subdomain: "",
    tablesInvolved: ["catalog.schema.orders"],
    sqlCode: "SELECT region, SUM(amount) FROM catalog.schema.orders GROUP BY region",
    priorityScore: 0.8,
    feasibilityScore: 0.8,
    impactScore: 0.8,
    overallScore: 0.8,
    userPriorityScore: null,
    userFeasibilityScore: null,
    userImpactScore: null,
    userOverallScore: null,
    scoreRationale: null,
    consultingScorecard: null,
    sqlStatus: null,
    feedback: null,
    feedbackAt: null,
    enrichmentTags: null,
    sourceSystems: null,
    sourceSystemsOrigin: null,
    blastRadius: null,
    referenceUseCaseName: null,
    referenceUseCaseResolvedAt: null,
    ...overrides,
  };
}

const semanticManifest: SemanticAssetManifest = {
  version: "1",
  domain: "Sales",
  subdomains: [],
  metricViews: [],
  measures: [
    {
      id: "measure:genie:sales:total_revenue",
      name: "total_revenue",
      source: "genie_expression",
      sql: "SUM(governed_secret_amount)",
      instructions: "Use for revenue analysis",
      synonyms: [],
      fallback: true,
    },
  ],
  dimensions: [
    {
      id: "dimension:genie:sales:region",
      name: "region",
      source: "genie_expression",
      sql: "region",
      instructions: "Use for regional breakdowns",
      isTimePeriod: false,
      synonyms: [],
      fallback: true,
    },
  ],
  filters: [],
  generatedAt: "2026-07-24T00:00:00.000Z",
};

describe("buildDashboardDesignPrompt", () => {
  it("includes filter widget types in the output schema", () => {
    const prompt = buildDashboardDesignPrompt({
      businessName: "Test Corp",
      businessContext: null,
      domain: "Sales",
      subdomains: [],
      useCases: [makeUseCase()],
      tables: ["catalog.schema.orders"],
      columnSchemas: ["catalog.schema.orders: region (STRING), amount (DECIMAL)"],
    });

    expect(prompt).toContain("filter-multi-select");
    expect(prompt).toContain("filter-single-select");
    expect(prompt).toContain("filter-date-range-picker");
  });

  it("includes filter instructions section", () => {
    const prompt = buildDashboardDesignPrompt({
      businessName: "Test Corp",
      businessContext: null,
      domain: "Sales",
      subdomains: [],
      useCases: [makeUseCase()],
      tables: ["catalog.schema.orders"],
      columnSchemas: [],
    });

    expect(prompt).toContain("Filter widgets");
    expect(prompt).toContain('role: "filter"');
  });

  it("includes filter candidates when provided", () => {
    const prompt = buildDashboardDesignPrompt({
      businessName: "Test Corp",
      businessContext: null,
      domain: "Sales",
      subdomains: [],
      useCases: [makeUseCase()],
      tables: ["catalog.schema.orders"],
      columnSchemas: [],
      filterCandidates: [
        {
          name: "order_date",
          column: "order_date",
          tableFqn: "catalog.schema.orders",
          dataType: "DATE",
        },
      ],
    });

    expect(prompt).toContain("## Filter Candidates");
    expect(prompt).toContain("order_date");
  });

  it("does not include metric view sections (dashboards use standalone SQL)", () => {
    const prompt = buildDashboardDesignPrompt({
      businessName: "Test Corp",
      businessContext: null,
      domain: "Sales",
      subdomains: [],
      useCases: [makeUseCase()],
      tables: ["catalog.schema.orders"],
      columnSchemas: [],
    });

    expect(prompt).not.toContain("## Metric Views");
    expect(prompt).not.toContain("CRITICAL Metric View SQL Rules");
  });

  it("uses the canonical double-quoted DATE_TRUNC example", () => {
    const prompt = buildDashboardDesignPrompt({
      businessName: "Test Corp",
      businessContext: null,
      domain: "Sales",
      subdomains: [],
      useCases: [makeUseCase()],
      tables: ["catalog.schema.orders"],
      columnSchemas: ["catalog.schema.orders: order_date (DATE)"],
    });

    expect(prompt).toContain('DATE_TRUNC(\\"MONTH\\", `date_col`)');
    expect(prompt).toContain("YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, MINUTE, SECOND");
  });

  it("requests dataset intent and stable semantic IDs instead of metric-view SQL", () => {
    const prompt = buildDashboardDesignPrompt({
      businessName: "Test Corp",
      businessContext: null,
      domain: "Sales",
      subdomains: [],
      useCases: [makeUseCase()],
      tables: ["catalog.schema.orders"],
      columnSchemas: [],
      semanticManifest,
    });

    expect(prompt).toContain("measure:genie:sales:total_revenue");
    expect(prompt).toContain("dimension:genie:sales:region");
    expect(prompt).toContain('"measureIds"');
    expect(prompt).toContain('"dimensionIds"');
    expect(prompt).toContain('"purpose"');
    expect(prompt).not.toContain("governed_secret_amount");
  });
});
