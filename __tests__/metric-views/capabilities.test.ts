import { describe, expect, it } from "vitest";
import {
  METRIC_VIEW_CAPABILITIES,
  assertMetricViewCapabilities,
  supportsMetricViewFeature,
} from "@/lib/metric-views/capabilities";
import type { MetricViewDefinition } from "@/lib/metric-views/definition";

function makeDefinition(overrides: Partial<MetricViewDefinition> = {}): MetricViewDefinition {
  return {
    version: "1.1",
    name: "sales_metrics",
    source: { kind: "table", table: "catalog.schema.sales" },
    joins: [],
    dimensions: [],
    measures: [],
    requiredFeatures: [],
    ...overrides,
  };
}

describe("metric-view capabilities", () => {
  it("supports joins in version 1.0", () => {
    expect(supportsMetricViewFeature("1.0", "joins")).toBe(true);
  });

  it("rejects unsupported features with structured issues", () => {
    expect(
      assertMetricViewCapabilities(
        makeDefinition({
          version: "1.0",
          requiredFeatures: ["window_measures"],
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "FEATURE_UNSUPPORTED",
        path: "requiredFeatures.0",
      }),
    ]);
  });

  it("reports every unsupported requirement at its stable index path", () => {
    expect(
      assertMetricViewCapabilities(
        makeDefinition({
          version: "1.0",
          requiredFeatures: ["joins", "nested_joins", "materialization"],
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "FEATURE_UNSUPPORTED",
        path: "requiredFeatures.1",
      }),
      expect.objectContaining({
        code: "FEATURE_UNSUPPORTED",
        path: "requiredFeatures.2",
      }),
    ]);
  });

  it("exposes one deeply immutable version capability matrix", () => {
    expect(Object.isFrozen(METRIC_VIEW_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(METRIC_VIEW_CAPABILITIES["1.0"])).toBe(true);
    expect(Object.isFrozen(METRIC_VIEW_CAPABILITIES["1.1"])).toBe(true);
  });
});
