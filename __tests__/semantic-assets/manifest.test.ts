import { describe, expect, it } from "vitest";

import { buildSemanticAssetManifest } from "@/lib/semantic-assets/manifest";
import type { MetricViewDefinition, MetricViewProposal } from "@/lib/metric-views/types";
import { METRIC_VIEW_PROBE_VALIDATOR_VERSION } from "@/lib/validation/evidence";

const definition: MetricViewDefinition = {
  version: "1.1",
  name: "revenue_metrics",
  source: { kind: "table", table: "main.sales.orders" },
  joins: [],
  dimensions: [
    {
      kind: "local",
      name: "order_month",
      expr: "DATE_TRUNC('MONTH', order_date)",
      synonyms: ["month"],
    },
  ],
  measures: [
    {
      kind: "expression",
      name: "total_revenue",
      expr: "SUM(amount)",
      displayName: "Total revenue",
      synonyms: ["revenue"],
    },
  ],
  filter: "is_test = false",
  requiredFeatures: [],
};

const fullValidationProvenance = {
  validatorVersion: METRIC_VIEW_PROBE_VALIDATOR_VERSION,
  validatedAt: "2026-07-24T04:00:00.000Z",
  validationEvidence: [
    {
      stage: "metric_view_static",
      status: "passed" as const,
      code: "METRIC_VIEW_STATIC_VALIDATION_PASSED",
      message: "Static validation passed",
    },
    {
      stage: "metric_view_create",
      status: "passed" as const,
      code: "TEMP_METRIC_VIEW_CREATED",
      message: "Temporary metric view created",
    },
    {
      stage: "metric_view_probe",
      status: "passed" as const,
      code: "ATOMIC_MEASURE_PROBE_PASSED",
      message: "Atomic measure probes passed",
    },
    {
      stage: "metric_view_cleanup",
      status: "passed" as const,
      code: "TEMP_METRIC_VIEW_DROPPED",
      message: "Temporary metric view dropped",
    },
  ],
};

function proposal(overrides: Partial<MetricViewProposal> = {}): MetricViewProposal {
  return {
    name: "revenue_metrics",
    description: "Governed revenue semantics",
    definition,
    yaml: 'version: "1.1"',
    ddl:
      "CREATE OR REPLACE VIEW `published`.`sales`.`revenue_metrics`\n" +
      "WITH METRICS\nLANGUAGE YAML\nAS $$\nversion: 1.1\n$$",
    sourceTables: ["main.sales.orders", "main.sales.customers"],
    hasJoins: true,
    hasFilteredMeasures: false,
    hasWindowMeasures: false,
    hasMaterialization: false,
    validationStatus: "valid",
    validationIssues: [],
    ...fullValidationProvenance,
    ...overrides,
  };
}

function build(overrides: Partial<Parameters<typeof buildSemanticAssetManifest>[0]> = {}) {
  return buildSemanticAssetManifest({
    domain: "Sales",
    subdomains: ["Revenue", "Orders"],
    proposals: [proposal()],
    genieMeasures: [
      {
        name: "Total Revenue",
        sql: "SUM(amount)",
        synonyms: ["revenue"],
        instructions: "Fallback revenue expression",
      },
    ],
    genieDimensions: [
      {
        name: "Order Month",
        sql: "DATE_TRUNC('MONTH', order_date)",
        synonyms: ["month"],
        instructions: "Fallback month expression",
        isTimePeriod: true,
      },
    ],
    genieFilters: [
      {
        name: "Completed Orders",
        sql: "status = 'completed'",
        synonyms: ["completed"],
        instructions: "Use for completed orders",
        isTimePeriod: false,
      },
    ],
    now: new Date("2026-07-24T05:00:00.000Z"),
    ...overrides,
  });
}

describe("buildSemanticAssetManifest", () => {
  it("accepts proposals with a missing optional description", () => {
    expect(() =>
      buildSemanticAssetManifest({
        domain: "Sales",
        subdomains: [],
        proposals: [
          { ...proposal(), description: undefined } as unknown as MetricViewProposal,
          proposal(),
        ],
        genieMeasures: [],
        genieDimensions: [],
        genieFilters: [],
      }),
    ).not.toThrow();
  });

  it("promotes only deployable valid typed proposals to verified metric views", () => {
    const manifest = build({
      proposals: [
        proposal(),
        proposal({ name: "warning", validationStatus: "warning" }),
        proposal({ name: "unverified", validationStatus: "unverified" }),
        proposal({ name: "error", validationStatus: "error" }),
        proposal({ name: "stale", validatorVersion: "metric-view-probes-v0" }),
        proposal({ name: "untyped", definition: undefined }),
      ],
    });

    expect(manifest.version).toBe("1");
    expect(manifest.metricViews).toHaveLength(1);
    expect(manifest.metricViews[0]).toMatchObject({
      intendedFqn: "published.sales.revenue_metrics",
      validationState: "valid",
      deploymentState: "proposal",
    });
  });

  it("marks verified reuse as an observed live asset at its exact existing FQN", () => {
    const manifest = build({
      proposals: [
        proposal({
          classification: "reuse",
          existingFqn: "existing.sales.revenue_metrics",
        }),
      ],
    });

    expect(manifest.metricViews[0]).toMatchObject({
      intendedFqn: "existing.sales.revenue_metrics",
      deployedFqn: "existing.sales.revenue_metrics",
      deploymentState: "deployed",
      validationState: "valid",
    });
  });

  it("deduplicates governed assets by stable ID while retaining Genie fallbacks", () => {
    const manifest = build({
      proposals: [proposal(), proposal()],
      genieMeasures: [
        {
          name: "Total Revenue",
          sql: "SUM(amount)",
          synonyms: [],
          instructions: "Fallback",
        },
        {
          name: " total-revenue ",
          sql: "SUM(amount)",
          synonyms: ["sales"],
          instructions: "Duplicate fallback",
        },
      ],
    });

    expect(new Set(manifest.measures.map((measure) => measure.id)).size).toBe(
      manifest.measures.length,
    );
    expect(manifest.measures.filter((measure) => measure.source === "metric_view")).toHaveLength(
      1,
    );
    expect(
      manifest.measures.filter((measure) => measure.source === "genie_expression"),
    ).toHaveLength(1);
    expect(manifest.measures.find((measure) => measure.source === "genie_expression")).toMatchObject(
      { fallback: true, sql: "SUM(amount)" },
    );
  });

  it("retains canonical fields, source tables, and representative metric queries", () => {
    const manifest = build();
    const [asset] = manifest.metricViews;

    expect(asset.sourceTables).toEqual(["main.sales.customers", "main.sales.orders"]);
    expect(asset.measures[0]).toMatchObject({
      name: "total_revenue",
      source: "metric_view",
      definition: definition.measures[0],
    });
    expect(asset.dimensions[0]).toMatchObject({
      name: "order_month",
      source: "metric_view",
      definition: definition.dimensions[0],
    });
    expect(asset.representativeQueries).toEqual([
      "SELECT MEASURE(total_revenue) FROM published.sales.revenue_metrics",
    ]);
  });

  it("does not import filters from an invalid proposal sharing a verified FQN", () => {
    const manifest = build({
      proposals: [
        proposal(),
        proposal({
          definition: { ...definition, filter: "aaa_invalid_segment = true" },
          validationStatus: "error",
        }),
      ],
    });

    expect(manifest.filters.filter((filter) => filter.source === "metric_view")).toHaveLength(1);
    expect(manifest.filters).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sql: "aaa_invalid_segment = true" })]),
    );
  });

  it("selects one valid proposal per FQN before deriving every governed asset", () => {
    const alphaDefinition: MetricViewDefinition = {
      ...definition,
      source: { kind: "table", table: "main.sales.alpha_orders" },
      dimensions: [{ kind: "local", name: "alpha_dimension", expr: "alpha_key" }],
      measures: [{ kind: "expression", name: "alpha_measure", expr: "SUM(alpha_amount)" }],
      filter: "alpha_filter = true",
    };
    const betaDefinition: MetricViewDefinition = {
      ...definition,
      source: { kind: "table", table: "main.sales.beta_orders" },
      dimensions: [{ kind: "local", name: "beta_dimension", expr: "beta_key" }],
      measures: [{ kind: "expression", name: "beta_measure", expr: "SUM(beta_amount)" }],
      filter: "aaa_beta_filter = true",
    };
    const alpha = proposal({
      definition: alphaDefinition,
      sourceTables: ["main.sales.alpha_orders"],
    });
    const beta = proposal({
      definition: betaDefinition,
      sourceTables: ["main.sales.beta_orders"],
    });

    const forward = build({ proposals: [alpha, beta] });
    const reverse = build({ proposals: [beta, alpha] });

    expect(reverse).toEqual(forward);
    expect(forward.metricViews).toHaveLength(1);
    const selectedPrefix = forward.metricViews[0].measures[0].name.split("_")[0];
    expect(forward.metricViews[0].dimensions[0].name).toBe(`${selectedPrefix}_dimension`);
    expect(
      forward.filters.find((filter) => filter.source === "metric_view")?.sql,
    ).toBe(`${selectedPrefix}_filter = true`);
    expect(forward.metricViews[0].sourceTables).toEqual([
      `main.sales.${selectedPrefix}_orders`,
    ]);
  });

  it("trims whitespace before deduplicating canonical string collections", () => {
    const whitespaceDefinition: MetricViewDefinition = {
      ...definition,
      dimensions: [
        {
          ...definition.dimensions[0],
          synonyms: [" month ", "month", " fiscal month "],
        },
      ],
      measures: [
        {
          ...definition.measures[0],
          synonyms: [" revenue ", "revenue", " net revenue "],
        },
      ],
    };
    const manifest = build({
      subdomains: [" Revenue ", "Revenue", " Orders ", "Orders"],
      proposals: [
        proposal({
          definition: whitespaceDefinition,
          sourceTables: [" main.sales.orders ", "main.sales.orders", " main.sales.customers "],
        }),
      ],
    });

    expect(manifest.subdomains).toEqual(["Orders", "Revenue"]);
    expect(
      manifest.measures.find((measure) => measure.source === "metric_view")?.synonyms,
    ).toEqual(["net revenue", "revenue"]);
    expect(
      manifest.dimensions.find((dimension) => dimension.source === "metric_view")?.synonyms,
    ).toEqual(["fiscal month", "month"]);
    expect(manifest.metricViews[0].sourceTables).toEqual([
      "main.sales.customers",
      "main.sales.orders",
    ]);
  });

  it("produces deterministic IDs and order for equivalent unordered input", () => {
    const first = build();
    const second = build({
      subdomains: ["Orders", "Revenue", "Orders"],
      proposals: [...first.metricViews].length ? [proposal()] : [],
      now: new Date("2026-07-24T05:00:00.000Z"),
    });

    expect(second).toEqual(first);
    expect(first.subdomains).toEqual(["Orders", "Revenue"]);
    expect(first.generatedAt).toBe("2026-07-24T05:00:00.000Z");
  });
});
