import { describe, expect, it } from "vitest";

import {
  LegacyDashboardDesignAdapterError,
  adaptLegacyDashboardDesign,
} from "@/lib/dashboard/legacy-design-adapter";
import type { DashboardDesign } from "@/lib/dashboard/types";

const legacyDesign: DashboardDesign = {
  title: "Sales",
  description: "Sales performance",
  datasets: [
    {
      name: "sales",
      displayName: "Sales dataset",
      purpose: "trend",
      sql: "SELECT order_date, region, revenue FROM main.sales.orders",
      measureIds: ["measure:sales:revenue"],
      dimensionIds: ["dimension:sales:order_date", "dimension:sales:region"],
    },
  ],
  widgets: [
    {
      type: "line",
      title: "Revenue trend",
      datasetName: "sales",
      fields: [
        { name: "order_date", expression: "`order_date`", role: "x" },
        { name: "revenue", expression: "`revenue`", role: "y" },
      ],
    },
    {
      type: "table",
      title: "Regional detail",
      datasetName: "sales",
      fields: [
        { name: "region", expression: "`region`", role: "column" },
        { name: "revenue", expression: "`revenue`", role: "column" },
      ],
    },
    {
      type: "filter-multi-select",
      title: "Region",
      datasetName: "sales",
      fields: [{ name: "region", expression: "`region`", role: "filter" }],
      filterField: "region",
    },
  ],
};

describe("adaptLegacyDashboardDesign", () => {
  it("preserves legacy dataset, widget, page, and filter intent", () => {
    const adapted = adaptLegacyDashboardDesign(legacyDesign);

    expect(adapted).toMatchObject({
      version: "2",
      title: "Sales",
      description: "Sales performance",
      pages: [
        {
          name: "overview",
          displayName: "Sales",
          widgets: [
            {
              type: "line",
              title: "Revenue trend",
              datasetName: "sales",
              fields: legacyDesign.widgets[0].fields,
            },
            {
              type: "table",
              title: "Regional detail",
              datasetName: "sales",
              fields: legacyDesign.widgets[1].fields,
            },
          ],
          filters: [],
        },
      ],
      globalFilters: [
        {
          type: "filter-multi-select",
          title: "Region",
          field: "region",
          bindings: [
            {
              datasetName: "sales",
              fieldName: "region",
              expression: "`region`",
            },
          ],
        },
      ],
      datasets: [
        {
          name: "sales",
          displayName: "Sales dataset",
          purpose: "trend",
          sourceKind: "table",
          metricIds: ["measure:sales:revenue"],
          dimensionIds: ["dimension:sales:order_date", "dimension:sales:region"],
          sql: "SELECT order_date, region, revenue FROM main.sales.orders",
          expectedFields: [
            expect.objectContaining({ name: "order_date", roles: ["x"] }),
            expect.objectContaining({ name: "revenue", roles: ["y", "column"] }),
            expect.objectContaining({ name: "region", roles: ["column", "filter"] }),
          ],
        },
      ],
    });
  });

  it("fails explicitly when a legacy widget type is unknown", () => {
    const unsupported = {
      ...legacyDesign,
      widgets: [
        ...legacyDesign.widgets,
        {
          type: "scatter",
          title: "Unsupported",
          datasetName: "sales",
          fields: [],
        },
      ],
    } as unknown as DashboardDesign;

    expect(() => adaptLegacyDashboardDesign(unsupported)).toThrow(
      LegacyDashboardDesignAdapterError,
    );
    expect(() => adaptLegacyDashboardDesign(unsupported)).toThrow(
      'Unsupported legacy widget type "scatter" at widgets[3]',
    );
  });

  it("fails when filterField does not match a declared widget field", () => {
    const mismatched: DashboardDesign = {
      ...legacyDesign,
      widgets: [
        {
          type: "filter-multi-select",
          title: "Region",
          datasetName: "sales",
          fields: [{ name: "country", expression: "`country`", role: "filter" }],
          filterField: "region",
        },
      ],
    };

    expect(() => adaptLegacyDashboardDesign(mismatched)).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "LEGACY_FILTER_FIELD_MISMATCH",
            path: "widgets[0].filterField",
          }),
        ],
      }),
    );
  });

  it("fails when the resolved legacy filter field has an empty expression", () => {
    const emptyExpression: DashboardDesign = {
      ...legacyDesign,
      widgets: [
        {
          type: "filter-single-select",
          title: "Region",
          datasetName: "sales",
          fields: [{ name: "region", expression: "  ", role: "filter" }],
          filterField: "region",
        },
      ],
    };

    expect(() => adaptLegacyDashboardDesign(emptyExpression)).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "LEGACY_FILTER_EXPRESSION_EMPTY",
            path: "widgets[0].fields[0].expression",
          }),
        ],
      }),
    );
  });

  it("fails when an unspecified legacy filter has ambiguous filter-role fields", () => {
    const ambiguous: DashboardDesign = {
      ...legacyDesign,
      widgets: [
        {
          type: "filter-multi-select",
          title: "Location",
          datasetName: "sales",
          fields: [
            { name: "region", expression: "`region`", role: "filter" },
            { name: "country", expression: "`country`", role: "filter" },
          ],
        },
      ],
    };

    expect(() => adaptLegacyDashboardDesign(ambiguous)).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "LEGACY_FILTER_FIELD_AMBIGUOUS",
            path: "widgets[0].fields",
          }),
        ],
      }),
    );
  });
});
