import { describe, it, expect } from "vitest";
import { assembleLakeviewDashboard } from "@/lib/dashboard/assembler";
import { validateSerializedDashboard } from "@/lib/dashboard/contract-validator";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";
import { adaptLegacyDashboardDesign } from "@/lib/dashboard/legacy-design-adapter";
import type { DashboardDesign } from "@/lib/dashboard/types";

function makeMinimalDesign(overrides?: Partial<DashboardDesign>): DashboardDesignV2 {
  return adaptLegacyDashboardDesign({
    title: "Test Dashboard",
    description: "Test description",
    datasets: [
      { name: "kpi_ds", displayName: "KPI", sql: "SELECT 1 AS total", purpose: "kpi" },
      { name: "trend_ds", displayName: "Trends", sql: "SELECT date, val FROM t", purpose: "trend" },
    ],
    widgets: [
      {
        type: "counter",
        title: "Total",
        datasetName: "kpi_ds",
        fields: [{ name: "total", expression: "`total`", role: "value" }],
      },
    ],
    ...overrides,
  });
}

describe("assembleLakeviewDashboard", () => {
  it("assembles V2 pages, datasets, and global filters without losing source metadata", () => {
    const design: DashboardDesignV2 = {
      version: "2",
      title: "Governed Sales",
      description: "Sales performance",
      datasets: [
        {
          name: "sales",
          displayName: "Sales",
          purpose: "trend",
          sourceKind: "metric_view",
          metricViewFqn: "main.sales.sales_metrics",
          metricIds: ["measure:sales:revenue"],
          dimensionIds: ["dimension:sales:order_date", "dimension:sales:region"],
          sql: "SELECT order_date, region, MEASURE(revenue) AS revenue FROM main.sales.sales_metrics",
          expectedFields: [
            { name: "order_date", roles: ["x"], compatibleTypes: ["temporal"] },
            { name: "region", roles: ["filter"], compatibleTypes: ["categorical"] },
            { name: "revenue", roles: ["y"], compatibleTypes: ["numeric"] },
          ],
        },
      ],
      pages: [
        {
          name: "overview",
          displayName: "Overview",
          filters: [],
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
          ],
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
    };

    const result = assembleLakeviewDashboard(design);

    expect(result.datasets[0].queryLines.join("")).toContain("MEASURE(revenue)");
    expect(result.pages.map((page) => page.displayName)).toEqual(["Overview", "Filters"]);
    expect(result.pages.every((page) => page.layoutVersion === "GRID_V1")).toBe(true);
    expect(design.datasets[0]).toMatchObject({
      sourceKind: "metric_view",
      metricViewFqn: "main.sales.sales_metrics",
      expectedFields: expect.any(Array),
    });
    expect(validateSerializedDashboard(result).valid).toBe(true);
  });

  it("produces a single PAGE_TYPE_CANVAS page when no filters", () => {
    const result = assembleLakeviewDashboard(makeMinimalDesign());
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageType).toBe("PAGE_TYPE_CANVAS");
  });

  it("produces a PAGE_TYPE_GLOBAL_FILTERS page when filter widgets are present", () => {
    const design = makeMinimalDesign({
      widgets: [
        {
          type: "counter",
          title: "Total",
          datasetName: "kpi_ds",
          fields: [{ name: "total", expression: "`total`", role: "value" }],
        },
        {
          type: "filter-multi-select",
          title: "Region Filter",
          datasetName: "trend_ds",
          fields: [{ name: "region", expression: "`region`", role: "filter" }],
        },
      ],
    });

    const result = assembleLakeviewDashboard(design);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].pageType).toBe("PAGE_TYPE_CANVAS");
    expect(result.pages[1].pageType).toBe("PAGE_TYPE_GLOBAL_FILTERS");
    expect(result.pages[1].name).toBe("filters");
  });

  it("filter widgets use spec version 2 and disaggregated: false", () => {
    const design = makeMinimalDesign({
      widgets: [
        {
          type: "filter-date-range-picker",
          title: "Date Range",
          datasetName: "trend_ds",
          fields: [{ name: "date", expression: "`date`", role: "filter" }],
        },
      ],
    });

    const result = assembleLakeviewDashboard(design);
    const filterPage = result.pages.find((p) => p.pageType === "PAGE_TYPE_GLOBAL_FILTERS");
    expect(filterPage).toBeDefined();

    const filterWidget = filterPage!.layout[0];
    expect(filterWidget.widget.spec?.version).toBe(2);
    expect(filterWidget.widget.spec?.widgetType).toBe("filter-date-range-picker");
    expect(filterWidget.widget.queries?.[0].query.disaggregated).toBe(false);
  });

  it("filter widgets are NOT placed on the canvas page", () => {
    const design = makeMinimalDesign({
      widgets: [
        {
          type: "counter",
          title: "Total",
          datasetName: "kpi_ds",
          fields: [{ name: "total", expression: "`total`", role: "value" }],
        },
        {
          type: "filter-multi-select",
          title: "Status Filter",
          datasetName: "kpi_ds",
          fields: [{ name: "status", expression: "`status`", role: "filter" }],
        },
      ],
    });

    const result = assembleLakeviewDashboard(design);
    const canvasPage = result.pages[0];

    const filterWidgetsOnCanvas = canvasPage.layout.filter((w) =>
      w.widget.spec?.widgetType?.startsWith("filter-"),
    );
    expect(filterWidgetsOnCanvas).toHaveLength(0);
  });

  it("counters use disaggregated: false when filters reference their dataset", () => {
    const design = makeMinimalDesign({
      widgets: [
        {
          type: "counter",
          title: "Total Sales",
          datasetName: "trend_ds",
          fields: [{ name: "sum(val)", expression: "SUM(`val`)", role: "value" }],
        },
        {
          type: "filter-multi-select",
          title: "Date Filter",
          datasetName: "trend_ds",
          fields: [{ name: "date", expression: "`date`", role: "filter" }],
        },
      ],
    });

    const result = assembleLakeviewDashboard(design);
    const canvasPage = result.pages[0];
    const counterWidget = canvasPage.layout.find((w) => w.widget.spec?.widgetType === "counter");
    expect(counterWidget).toBeDefined();
    expect(counterWidget!.widget.queries?.[0].query.disaggregated).toBe(false);
  });

  it("counters use disaggregated: true when no filters reference their dataset", () => {
    const result = assembleLakeviewDashboard(makeMinimalDesign());
    const canvasPage = result.pages[0];
    const counterWidget = canvasPage.layout.find((w) => w.widget.spec?.widgetType === "counter");
    expect(counterWidget).toBeDefined();
    expect(counterWidget!.widget.queries?.[0].query.disaggregated).toBe(true);
  });

  it("uses the full 12-column GRID_V1 width for counter rows", () => {
    const design = makeMinimalDesign({
      widgets: [
        {
          type: "counter",
          title: "A",
          datasetName: "kpi_ds",
          fields: [{ name: "a", expression: "`a`", role: "value" }],
        },
        {
          type: "counter",
          title: "B",
          datasetName: "kpi_ds",
          fields: [{ name: "b", expression: "`b`", role: "value" }],
        },
        {
          type: "counter",
          title: "C",
          datasetName: "kpi_ds",
          fields: [{ name: "c", expression: "`c`", role: "value" }],
        },
      ],
    });

    const result = assembleLakeviewDashboard(design);
    const canvasPage = result.pages[0];
    const counterWidgets = canvasPage.layout.filter((w) => w.widget.spec?.widgetType === "counter");

    expect(counterWidgets).toHaveLength(3);
    const totalWidth = counterWidgets.reduce((sum, w) => sum + w.position.width, 0);
    expect(totalWidth).toBe(12);
    expect(counterWidgets.map((widget) => widget.position.x)).toEqual([0, 4, 8]);
  });

  it("uses deterministic 12-column geometry for canvas widgets", () => {
    const result = assembleLakeviewDashboard(
      makeMinimalDesign({
        widgets: [
          {
            type: "bar",
            title: "By Region",
            datasetName: "trend_ds",
            fields: [
              { name: "region", expression: "`region`", role: "x" },
              { name: "total", expression: "SUM(`total`)", role: "y" },
            ],
          },
          {
            type: "line",
            title: "By Month",
            datasetName: "trend_ds",
            fields: [
              { name: "month", expression: "`month`", role: "x" },
              { name: "total", expression: "SUM(`total`)", role: "y" },
            ],
          },
          {
            type: "table",
            title: "Details",
            datasetName: "trend_ds",
            fields: [{ name: "region", expression: "`region`", role: "column" }],
          },
        ],
      }),
    );
    const widgets = result.pages[0].layout;

    expect(widgets[0].position.width).toBe(12);
    expect(
      widgets.filter((widget) => widget.widget.spec?.widgetType === "bar")[0].position,
    ).toMatchObject({
      x: 0,
      width: 6,
    });
    expect(
      widgets.filter((widget) => widget.widget.spec?.widgetType === "line")[0].position,
    ).toMatchObject({
      x: 6,
      width: 6,
    });
    expect(
      widgets.filter((widget) => widget.widget.spec?.widgetType === "table")[0].position.width,
    ).toBe(12);
  });

  it("emits contract-valid GRID_V1 pages on a 12-column grid", () => {
    const result = assembleLakeviewDashboard(makeMinimalDesign());

    expect(result.pages.every((page) => page.layoutVersion === "GRID_V1")).toBe(true);
    expect(
      result.pages
        .flatMap((page) => page.layout)
        .every(({ position }) => position.x >= 0 && position.x + position.width <= 12),
    ).toBe(true);
    expect(validateSerializedDashboard(result).valid).toBe(true);
  });

  it("trims descriptions and skips whitespace-only subtitle widgets", () => {
    const trimmed = assembleLakeviewDashboard(
      makeMinimalDesign({ description: "  Useful summary  " }),
    );
    expect(trimmed.pages[0].layout[1].widget.multilineTextboxSpec?.lines).toEqual([
      "Useful summary",
    ]);

    const whitespaceOnly = assembleLakeviewDashboard(makeMinimalDesign({ description: " \n\t " }));
    expect(
      whitespaceOnly.pages[0].layout.some(
        ({ widget }) => widget.multilineTextboxSpec?.lines[0] === " \n\t ",
      ),
    ).toBe(false);
    expect(validateSerializedDashboard(whitespaceOnly).valid).toBe(true);
  });

  it.each(["date_trunc", "DaTe_TrUnC"])(
    "uses a temporal x-axis for %s expressions",
    (functionName) => {
      const result = assembleLakeviewDashboard(
        makeMinimalDesign({
          widgets: [
            {
              type: "line",
              title: "Monthly Trend",
              datasetName: "trend_ds",
              fields: [
                {
                  name: "month",
                  expression: `${functionName}("MONTH", \`date\`)`,
                  role: "x",
                },
                { name: "value", expression: "`val`", role: "y" },
              ],
            },
          ],
        }),
      );
      const line = result.pages[0].layout.find((item) => item.widget.spec?.widgetType === "line")!;
      const encodings = line.widget.spec!.encodings as {
        x: { scale: { type: string } };
      };

      expect(encodings.x.scale.type).toBe("temporal");
      expect(validateSerializedDashboard(result).valid).toBe(true);
    },
  );

  it("lays out global filters in deterministic rows of three", () => {
    const result = assembleLakeviewDashboard(
      makeMinimalDesign({
        widgets: ["Region", "Category", "Owner"].map((title) => ({
          type: "filter-multi-select" as const,
          title,
          datasetName: "trend_ds",
          fields: [
            { name: title.toLowerCase(), expression: `\`${title.toLowerCase()}\``, role: "filter" },
          ],
        })),
      }),
    );
    const filters = result.pages.find((page) => page.pageType === "PAGE_TYPE_GLOBAL_FILTERS")!;

    expect(filters.layout.map(({ position }) => position)).toEqual([
      { x: 0, y: 0, width: 4, height: 2 },
      { x: 4, y: 0, width: 4, height: 2 },
      { x: 8, y: 0, width: 4, height: 2 },
    ]);
    expect(validateSerializedDashboard(result).valid).toBe(true);
  });

  it("filter encoding has correct structure with queryName", () => {
    const design = makeMinimalDesign({
      widgets: [
        {
          type: "filter-single-select",
          title: "Category",
          datasetName: "trend_ds",
          fields: [{ name: "category", expression: "`category`", role: "filter" }],
        },
      ],
    });

    const result = assembleLakeviewDashboard(design);
    const filterPage = result.pages.find((p) => p.pageType === "PAGE_TYPE_GLOBAL_FILTERS");
    const filterWidget = filterPage!.layout[0];
    const encodings = filterWidget.widget.spec?.encodings as {
      fields: Array<{ fieldName: string; displayName: string; queryName: string }>;
    };

    expect(encodings.fields).toHaveLength(1);
    expect(encodings.fields[0].fieldName).toBe("category");
    expect(encodings.fields[0].queryName).toMatch(/^ds_trend_ds_/);
  });
});
