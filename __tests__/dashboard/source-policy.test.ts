import { describe, expect, it } from "vitest";
import { selectDatasetSource, summarizeDatasetSourceKind } from "@/lib/dashboard/source-policy";
import type {
  GovernedDimension,
  GovernedMeasure,
  SemanticAssetManifest,
  VerifiedMetricViewAsset,
} from "@/lib/semantic-assets/types";

const metricMeasure: GovernedMeasure = {
  id: "measure:mv:sales:total_revenue",
  name: "total_revenue",
  source: "metric_view",
  metricViewId: "metric_view:sales",
  definition: {
    kind: "expression",
    name: "total_revenue",
    expr: "SUM(source.amount)",
  },
  synonyms: [],
  fallback: false,
};

const metricDimension: GovernedDimension = {
  id: "dimension:mv:sales:order_date",
  name: "order_date",
  source: "metric_view",
  metricViewId: "metric_view:sales",
  definition: {
    kind: "local",
    name: "order_date",
    expr: "source.order_date",
  },
  synonyms: [],
  fallback: false,
};

const expressionMeasure: GovernedMeasure = {
  id: "measure:genie:sales:margin",
  name: "margin",
  source: "genie_expression",
  sql: "SUM(amount - cost)",
  instructions: "Use for margin analysis",
  synonyms: [],
  fallback: true,
};

const expressionDimension: GovernedDimension = {
  id: "dimension:genie:sales:region",
  name: "region",
  source: "genie_expression",
  sql: "region",
  instructions: "Use for geographic breakdowns",
  isTimePeriod: false,
  synonyms: [],
  fallback: true,
};

function metricView(overrides: Partial<VerifiedMetricViewAsset> = {}): VerifiedMetricViewAsset {
  return {
    id: "metric_view:sales",
    intendedFqn: "catalog.schema.sales_metrics",
    validationState: "valid",
    measures: [metricMeasure],
    dimensions: [metricDimension],
    representativeQueries: [],
    deploymentState: "proposal",
    sourceTables: ["catalog.schema.sales"],
    ...overrides,
  };
}

function manifest(overrides: Partial<SemanticAssetManifest> = {}): SemanticAssetManifest {
  return {
    version: "1",
    domain: "Sales",
    subdomains: [],
    metricViews: [metricView()],
    measures: [metricMeasure, expressionMeasure],
    dimensions: [metricDimension, expressionDimension],
    filters: [],
    generatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectDatasetSource", () => {
  it("keeps table SQL when metric-first rollout is disabled", () => {
    const result = selectDatasetSource({
      purpose: "trend",
      measureIds: [metricMeasure.id],
      dimensionIds: [metricDimension.id],
      manifest: manifest(),
      metricFirstEnabled: false,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("does not select a validation-only proposal whose temporary view was removed", () => {
    const result = selectDatasetSource({
      purpose: "trend",
      measureIds: [metricMeasure.id],
      dimensionIds: [metricDimension.id],
      manifest: manifest(),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it.each([
    metricView({
      deploymentState: "deployed",
      deployedFqn: "published.sales.sales_metrics",
    }),
    metricView({
      deploymentState: "deployed",
      deployedFqn: "existing.sales.sales_metrics",
    }),
  ])("selects demonstrably live deployed or reused metric views", (asset) => {
    const result = selectDatasetSource({
      purpose: "trend",
      measureIds: [metricMeasure.id],
      dimensionIds: [metricDimension.id],
      manifest: manifest({ metricViews: [asset] }),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "metric_view", asset });
  });

  it("rejects deployed state without an observed deployed FQN", () => {
    const result = selectDatasetSource({
      purpose: "trend",
      measureIds: [metricMeasure.id],
      dimensionIds: [metricDimension.id],
      manifest: manifest({
        metricViews: [metricView({ deploymentState: "deployed" })],
      }),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("ignores an unverified metric view", () => {
    const result = selectDatasetSource({
      purpose: "kpi",
      measureIds: [metricMeasure.id],
      dimensionIds: [],
      manifest: manifest({
        metricViews: [metricView({ validationState: "unverified" })],
      }),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("falls back when a verified metric view is missing a requested dimension", () => {
    const result = selectDatasetSource({
      purpose: "trend",
      measureIds: [metricMeasure.id],
      dimensionIds: ["dimension:mv:sales:missing"],
      manifest: manifest(),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("always chooses table SQL for detail datasets", () => {
    const result = selectDatasetSource({
      purpose: "detail",
      measureIds: [metricMeasure.id],
      dimensionIds: [metricDimension.id],
      manifest: manifest(),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("keeps unbound semantic-expression IDs on table SQL", () => {
    const result = selectDatasetSource({
      purpose: "breakdown",
      measureIds: [expressionMeasure.id],
      dimensionIds: [expressionDimension.id],
      manifest: manifest({ metricViews: [] }),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("fails closed to table SQL when a requested semantic ID is fabricated", () => {
    const result = selectDatasetSource({
      purpose: "breakdown",
      measureIds: [expressionMeasure.id, "measure:genie:sales:fabricated"],
      dimensionIds: [expressionDimension.id],
      manifest: manifest({ metricViews: [] }),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });

  it("keeps dimension-only requests on table SQL", () => {
    const result = selectDatasetSource({
      purpose: "breakdown",
      measureIds: [],
      dimensionIds: [metricDimension.id],
      manifest: manifest(),
      metricFirstEnabled: true,
    });

    expect(result).toEqual({ kind: "table" });
  });
});

describe("summarizeDatasetSourceKind", () => {
  it.each([
    [["metric_view", "semantic_expression"], "mixed"],
    [["table", "table"], "table"],
    [["metric_view", "table"], "mixed"],
  ] as const)("reports %s decisions as %s", (kinds, expected) => {
    expect(summarizeDatasetSourceKind([...kinds])).toBe(expected);
  });

  it("does not count an unbound semantic-expression decision as governed", () => {
    expect(summarizeDatasetSourceKind(["semantic_expression"])).toBe("table");
  });
});
