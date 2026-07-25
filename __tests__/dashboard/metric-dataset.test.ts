import { describe, expect, it } from "vitest";
import { renderMetricViewDatasetSql } from "@/lib/dashboard/metric-dataset";
import type {
  GovernedDimension,
  GovernedMeasure,
  VerifiedMetricViewAsset,
} from "@/lib/semantic-assets/types";

const measure: GovernedMeasure = {
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

const dimension: GovernedDimension = {
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

function asset(overrides: Partial<VerifiedMetricViewAsset> = {}): VerifiedMetricViewAsset {
  return {
    id: "metric_view:sales",
    intendedFqn: "catalog.schema.sales_metrics",
    validationState: "valid",
    measures: [measure],
    dimensions: [dimension],
    representativeQueries: [],
    deploymentState: "proposal",
    sourceTables: ["catalog.schema.sales"],
    ...overrides,
  };
}

describe("renderMetricViewDatasetSql", () => {
  it("renders explicit dimensions and aliased MEASURE calls from stable IDs", () => {
    expect(
      renderMetricViewDatasetSql({
        asset: asset(),
        measures: [measure.id],
        dimensions: [dimension.id],
      }),
    ).toBe(
      [
        "SELECT",
        "  `order_date`,",
        "  MEASURE(`total_revenue`) AS `total_revenue`",
        "FROM `catalog`.`schema`.`sales_metrics`",
        "GROUP BY ALL",
        "LIMIT 1000",
      ].join("\n"),
    );
  });

  it("never renders SELECT star and preserves a bounded custom limit", () => {
    const sql = renderMetricViewDatasetSql({
      asset: asset(),
      measures: [measure.id],
      dimensions: [],
      limit: 25,
    });

    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).toContain("MEASURE(`total_revenue`) AS `total_revenue`");
    expect(sql).not.toContain("GROUP BY");
    expect(sql).toContain("LIMIT 25");
  });

  it("rejects a requested ID that is not governed by the selected asset", () => {
    expect(() =>
      renderMetricViewDatasetSql({
        asset: asset(),
        measures: ["measure:mv:sales:fabricated"],
        dimensions: [],
      }),
    ).toThrow(/requested measure ID/i);
  });

  it("rejects duplicate normalized aliases across dimensions and measures", () => {
    const collidingDimension: GovernedDimension = {
      ...dimension,
      id: "dimension:mv:sales:total_revenue",
      name: "TOTAL_REVENUE",
      definition: {
        ...dimension.definition,
        name: "TOTAL_REVENUE",
      },
    };

    expect(() =>
      renderMetricViewDatasetSql({
        asset: asset({ dimensions: [collidingDimension] }),
        measures: [measure.id],
        dimensions: [collidingDimension.id],
      }),
    ).toThrow(/duplicate normalized dataset alias "total_revenue"/i);
  });

  it("rejects unsafe FQNs and identifiers before rendering SQL", () => {
    expect(() =>
      renderMetricViewDatasetSql({
        asset: asset({ intendedFqn: "catalog.schema.sales_metrics;DROP TABLE x" }),
        measures: [measure.id],
        dimensions: [],
      }),
    ).toThrow(/invalid characters/i);

    expect(() =>
      renderMetricViewDatasetSql({
        asset: asset({
          measures: [{ ...measure, name: "total_revenue`) FROM secrets --" }],
        }),
        measures: [measure.id],
        dimensions: [],
      }),
    ).toThrow(/invalid characters/i);
  });

  it.each([0, -1, 1001, 1.5, Number.NaN])("rejects an unsafe limit of %s", (limit) => {
    expect(() =>
      renderMetricViewDatasetSql({
        asset: asset(),
        measures: [measure.id],
        dimensions: [],
        limit,
      }),
    ).toThrow(/limit/i);
  });
});
