import { describe, expect, it } from "vitest";

import { isDashboardDesignV2, validateDashboardDesignV2 } from "@/lib/dashboard/design-ir";

describe("DashboardDesignV2 runtime validation", () => {
  it("rejects malformed nested datasets, widgets, and filter bindings", () => {
    const malformed = {
      version: "2",
      title: "Malformed",
      description: "Nested fields are untrusted",
      datasets: [
        {
          name: "sales",
          displayName: "Sales",
          purpose: "kpi",
          sourceKind: "metric_view",
          metricIds: [],
          dimensionIds: [],
          sql: "SELECT 1",
          expectedFields: "not-an-array",
        },
      ],
      pages: [
        {
          name: "overview",
          displayName: "Overview",
          widgets: [
            {
              type: "scatter",
              title: "Unsupported",
              datasetName: "sales",
              fields: [],
            },
          ],
          filters: [
            {
              type: "filter-multi-select",
              title: "Region",
              field: "region",
              bindings: [{ datasetName: "sales", fieldName: "region", expression: "" }],
            },
          ],
        },
      ],
      globalFilters: [],
    };

    const validation = validateDashboardDesignV2(malformed);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "V2_METRIC_VIEW_FQN_REQUIRED",
          path: "datasets[0].metricViewFqn",
        }),
        expect.objectContaining({
          code: "V2_EXPECTED_FIELDS_INVALID",
          path: "datasets[0].expectedFields",
        }),
        expect.objectContaining({
          code: "V2_WIDGET_TYPE_UNSUPPORTED",
          path: "pages[0].widgets[0].type",
        }),
        expect.objectContaining({
          code: "V2_FILTER_BINDING_EXPRESSION_INVALID",
          path: "pages[0].filters[0].bindings[0].expression",
        }),
      ]),
    );
    expect(isDashboardDesignV2(malformed)).toBe(false);
  });

  it("rejects metric-view FQNs on non-metric dataset sources", () => {
    const invalidSource = {
      version: "2",
      title: "Invalid source",
      description: "Table source with metric metadata",
      datasets: [
        {
          name: "sales",
          displayName: "Sales",
          purpose: "kpi",
          sourceKind: "table",
          metricViewFqn: "fabricated.metric.view",
          metricIds: [],
          dimensionIds: [],
          sql: "SELECT 1 AS total",
          expectedFields: [{ name: "total", roles: ["value"], compatibleTypes: ["numeric"] }],
        },
      ],
      pages: [{ name: "overview", displayName: "Overview", widgets: [], filters: [] }],
      globalFilters: [],
    };

    expect(validateDashboardDesignV2(invalidSource).issues).toContainEqual(
      expect.objectContaining({
        code: "V2_METRIC_VIEW_FQN_FORBIDDEN",
        path: "datasets[0].metricViewFqn",
      }),
    );
  });
});
