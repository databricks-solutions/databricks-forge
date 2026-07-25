import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MetricViewParseError, parseMetricViewYaml } from "@/lib/metric-views/parser";

function parseForTest(yamlText: string) {
  return parseMetricViewYaml(yamlText, "orders_metrics");
}

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "__tests__/fixtures/metric-views", name), "utf8");
}

describe("parseMetricViewYaml", () => {
  it("normalizes table sources and expression, ratio, and filtered measures", () => {
    const definition = parseMetricViewYaml(fixture("v1-basic.yaml"), "orders_metrics");

    expect(definition).toMatchObject({
      version: "1.1",
      name: "orders_metrics",
      source: { kind: "table", table: "samples.tpch.orders" },
      comment: "Orders metrics: revenue, volume & customer reach",
      filter: "o_orderdate >= DATE '1992-01-01'",
      joins: [],
      dimensions: [
        {
          kind: "local",
          name: "order_month",
          expr: "DATE_TRUNC('MONTH', o_orderdate)",
          displayName: "Order Month",
          synonyms: ["month", "order period"],
        },
      ],
      measures: [
        { kind: "expression", name: "total_revenue", expr: "SUM(o_totalprice)" },
        {
          kind: "ratio",
          name: "revenue_per_customer",
          numerator: "SUM(o_totalprice)",
          denominator: "COUNT(DISTINCT o_custkey)",
        },
        {
          kind: "filtered",
          name: "open_order_revenue",
          expr: "SUM(o_totalprice)",
          filter: "o_orderstatus = 'O'",
        },
      ],
      requiredFeatures: ["filtered_measures"],
    });
  });

  it("rejects an unsafe external metric view name with a structured path", () => {
    expect(() =>
      parseMetricViewYaml(fixture("v1-basic.yaml"), "orders; DROP VIEW main.sales.orders"),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "name", code: "NAME_INVALID" }),
        ]),
      }),
    );
  });

  it("normalizes query sources, nested joins, using joins, and joined dimensions", () => {
    const definition = parseForTest(fixture("v1-nested-joins.yaml"));

    expect(definition.source).toEqual({
      kind: "query",
      query: "SELECT *\nFROM samples.tpch.orders\nWHERE o_totalprice > 0",
    });
    expect(definition.joins[0]).toMatchObject({
      kind: "on",
      name: "customer",
      joins: [
        {
          kind: "on",
          name: "nation",
          joins: [
            {
              kind: "using",
              name: "region",
              using: ["r_regionkey"],
              joins: [],
            },
          ],
        },
      ],
    });
    expect(definition.dimensions).toEqual([
      expect.objectContaining({ kind: "joined", joinPath: ["customer"] }),
      expect.objectContaining({ kind: "joined", joinPath: ["customer", "nation"] }),
      expect.objectContaining({
        kind: "joined",
        joinPath: ["customer", "nation", "region"],
      }),
    ]);
    expect(definition.requiredFeatures).toEqual(["joins", "nested_joins", "source_query"]);
  });

  it("normalizes window measures and validates range values", () => {
    const definition = parseForTest(fixture("v1-window.yaml"));

    expect(definition.measures[1]).toEqual(
      expect.objectContaining({
        kind: "window",
        window: [{ order: "order_date", range: "trailing 7 day", semiadditive: "first" }],
      }),
    );
    expect(definition.requiredFeatures).toEqual(["window_measures"]);

    expect(() =>
      parseForTest(`
version: "1.1"
source: samples.tpch.orders
dimensions: [{ name: day, expr: o_orderdate }]
measures:
  - name: rolling
    expr: COUNT(1)
    window: [{ order: day, range: trailing seven days }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "measures.0.window.0.range", code: "VALUE_INVALID" }),
        ]),
      }),
    );
  });

  it("normalizes materialization schedules and view types", () => {
    const definition = parseForTest(fixture("v1-materialization.yaml"));

    expect(definition.materialization).toEqual({
      schedule: { kind: "interval", interval: "every 6 hours" },
      mode: "relaxed",
      materializedViews: [
        { kind: "unaggregated", name: "full_model" },
        {
          kind: "aggregated",
          name: "monthly_summary",
          dimensions: ["order_month"],
          measures: ["total_revenue", "order_count"],
        },
      ],
    });
    expect(definition.requiredFeatures).toEqual(["materialization"]);
  });

  it("normalizes cron schedules and filtered-ratio variants", () => {
    const definition = parseMetricViewYaml(
      fixture("v1-cron-filtered-ratios.yaml"),
      "orders_metrics",
    );

    expect(definition.materialization?.schedule).toEqual({
      kind: "cron",
      quartzCron: "0 0 6 * * ?",
      timezone: "America/Los_Angeles",
    });
    expect(definition.measures).toEqual([
      expect.objectContaining({ kind: "ratio", name: "open_revenue_per_customer" }),
      expect.objectContaining({
        kind: "ratio",
        name: "open_revenue_per_all_customers",
      }),
      expect.objectContaining({
        kind: "ratio",
        name: "wrapped_open_revenue_ratio",
      }),
    ]);
    expect(definition.requiredFeatures).toEqual(["filtered_measures", "materialization"]);
  });

  it("reports missing materialization schedule at its transport path", () => {
    expect(() =>
      parseForTest(`
version: "1.1"
source: samples.tpch.orders
dimensions: [{ name: month, expr: o_orderdate }]
measures: [{ name: orders, expr: COUNT(1) }]
materialization:
  materialized_views:
    - { name: full_model, type: unaggregated }
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: "materialization.schedule",
            code: "FIELD_REQUIRED",
          }),
        ]),
      }),
    );
  });

  it("rejects missing fields with structured paths", () => {
    expect(() =>
      parseForTest(`
version: "1.1"
source: samples.tpch.orders
dimensions: [{ name: order_date, expr: o_orderdate }]
measures: [{ name: total_revenue }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "measures.0.expr", code: "FIELD_REQUIRED" }),
        ]),
      }),
    );
  });

  it("rejects invalid table and join sources instead of treating them as queries", () => {
    expect(() =>
      parseForTest(`
version: "1.1"
source: catalog.schema
joins:
  - name: customer
    source: catalog.customer
    on: source.customer_id = customer.id
dimensions: [{ name: region, expr: region }]
measures: [{ name: orders, expr: COUNT(1) }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "source", code: "SOURCE_INVALID" }),
          expect.objectContaining({ path: "joins.0.source", code: "SOURCE_INVALID" }),
        ]),
      }),
    );
  });

  it.each([
    ["main.sales.orders", "main.sales.orders"],
    [" main . sales . orders ", "main.sales.orders"],
    ["with.sales.orders", "with.sales.orders"],
    ["select.sales.orders", "select.sales.orders"],
    ["`main`.`sales`.`orders`", "main.sales.orders"],
    ["`main-cat`.`sales-data`.`orders-2026`", "main-cat.sales-data.orders-2026"],
  ])("normalizes valid three-part table source %s", (source, expected) => {
    const definition = parseForTest(`
version: "1.1"
source: ${JSON.stringify(source)}
dimensions: [{ name: region, expr: region }]
measures: [{ name: orders, expr: COUNT(1) }]
`);

    expect(definition.source).toEqual({ kind: "table", table: expected });
  });

  it.each([
    "`main.sales.orders",
    "main`.sales.orders",
    "`main`x.sales.orders",
    "main.sa`les.orders",
    "`main.sales.orders`",
    "main.sales",
    "main.sales.orders.extra",
    "main..orders",
    "`main`.`sales`.`orders`$$",
  ])("rejects malformed table source %s with a structured path", (source) => {
    expect(() =>
      parseForTest(`
version: "1.1"
source: ${JSON.stringify(source)}
dimensions: [{ name: region, expr: region }]
measures: [{ name: orders, expr: COUNT(1) }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "source", code: "SOURCE_INVALID" }),
        ]),
      }),
    );
  });

  it("normalizes quoted join sources and rejects malformed join quoting", () => {
    const definition = parseForTest(`
version: "1.1"
source: main.sales.orders
joins:
  - name: customer
    source: "\`main-cat\`.\`sales-data\`.\`customers-2026\`"
    on: source.customer_id = customer.id
dimensions: [{ name: customer_name, expr: customer.name }]
measures: [{ name: orders, expr: COUNT(1) }]
`);
    expect(definition.joins[0].source).toBe("main-cat.sales-data.customers-2026");

    expect(() =>
      parseForTest(`
version: "1.1"
source: main.sales.orders
joins:
  - name: customer
    source: "\`main-cat.sales-data.customers"
    on: source.customer_id = customer.id
dimensions: [{ name: customer_name, expr: customer.name }]
measures: [{ name: orders, expr: COUNT(1) }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "joins.0.source", code: "SOURCE_INVALID" }),
        ]),
      }),
    );
  });

  it("rejects duplicate semantic names case-insensitively", () => {
    expect(() =>
      parseForTest(`
version: "1.1"
source: samples.tpch.orders
dimensions:
  - { name: Region, expr: o_orderpriority }
  - { name: region, expr: o_orderstatus }
measures:
  - { name: orders, expr: COUNT(1) }
  - { name: Orders, expr: COUNT(1) }
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "dimensions.1.name", code: "NAME_DUPLICATE" }),
          expect.objectContaining({ path: "measures.1.name", code: "NAME_DUPLICATE" }),
        ]),
      }),
    );
  });

  it("rejects empty semantic lists and names shared across dimensions and measures", () => {
    expect(() =>
      parseForTest(`
version: "1.1"
source: samples.tpch.orders
dimensions: []
measures: []
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "dimensions", code: "VALUE_INVALID" }),
          expect.objectContaining({ path: "measures", code: "VALUE_INVALID" }),
        ]),
      }),
    );

    expect(() =>
      parseForTest(`
version: "1.1"
source: samples.tpch.orders
dimensions: [{ name: orders, expr: o_orderstatus }]
measures: [{ name: Orders, expr: COUNT(1) }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "measures.0.name", code: "NAME_DUPLICATE" }),
        ]),
      }),
    );
  });

  it("rejects unsupported versions and inferred features after normalization", () => {
    expect(() =>
      parseForTest(`
version: "1.0"
source: samples.tpch.orders
dimensions: [{ name: day, expr: o_orderdate }]
measures:
  - name: rolling
    expr: COUNT(1)
    window: [{ order: day, range: cumulative }]
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: "requiredFeatures.0",
            code: "FEATURE_UNSUPPORTED",
          }),
        ]),
      }),
    );

    expect(() =>
      parseForTest(`
version: "2.0"
source: samples.tpch.orders
dimensions: []
measures: []
`),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "version", code: "VERSION_UNSUPPORTED" }),
        ]),
      }),
    );
  });

  it("wraps malformed YAML in MetricViewParseError", () => {
    expect(() => parseForTest("version: [")).toThrowError(MetricViewParseError);
    try {
      parseForTest("version: [");
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining({
          issues: [expect.objectContaining({ path: "$", code: "YAML_INVALID" })],
        }),
      );
    }
  });
});
