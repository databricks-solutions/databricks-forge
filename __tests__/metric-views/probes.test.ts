import { describe, expect, it } from "vitest";
import {
  buildMetricViewProbes,
  extractMetricViewProbeInputs,
} from "@/lib/metric-views/probes";

describe("buildMetricViewProbes", () => {
  it("builds atomic, categorical, temporal, complex, and joined probes", () => {
    const probes = buildMetricViewProbes({
      tempFqn: "catalog.schema.__forge_validate_test",
      dimensions: [
        { name: "region", kind: "categorical" },
        { name: "order_month", kind: "temporal" },
        { name: "customer_segment", kind: "categorical", joined: true },
      ],
      measures: [
        { name: "total_revenue" },
        { name: "revenue_per_customer", complex: true },
      ],
      hasJoins: true,
    });

    expect(probes.map((probe) => probe.kind)).toEqual([
      "atomic_measure",
      "categorical_group",
      "temporal_group",
      "complex_measure",
      "joined_dimension",
    ]);
    expect(probes[0]).toEqual({
      kind: "atomic_measure",
      sql: [
        "SELECT MEASURE(`total_revenue`) AS total_revenue",
        "FROM catalog.schema.__forge_validate_test",
      ].join("\n"),
      expectedColumns: ["total_revenue"],
    });
    expect(probes[1].sql).toBe(
      [
        "SELECT `region`, MEASURE(`total_revenue`) AS total_revenue",
        "FROM catalog.schema.__forge_validate_test",
        "GROUP BY ALL",
        "LIMIT 10",
      ].join("\n"),
    );
    expect(probes[1].expectedDimensionClass).toBe("categorical");
    expect(probes[2].expectedDimensionClass).toBe("date_like");
    expect(probes[2].sql).toContain(
      "SELECT `order_month`, MEASURE(`total_revenue`) AS total_revenue",
    );
    expect(probes[3].sql).toContain(
      "SELECT MEASURE(`revenue_per_customer`) AS revenue_per_customer",
    );
    expect(probes[4].sql).toContain(
      "SELECT `customer_segment`, MEASURE(`total_revenue`) AS total_revenue",
    );
    expect(probes.every((probe) => !probe.sql.includes("SELECT *"))).toBe(true);
    expect(
      probes
        .filter((probe) => probe.expectedColumns.length > 1)
        .every((probe) => probe.sql.includes("GROUP BY ALL") && probe.sql.includes("LIMIT 10")),
    ).toBe(true);
  });

  it("backtick-quotes metric identifiers and joined dimensions explicitly", () => {
    const probes = buildMetricViewProbes({
      tempFqn: "`catalog`.`schema`.`__forge_validate_test`",
      dimensions: [{ name: "Sales Region", kind: "categorical", joined: true }],
      measures: [{ name: "Total Revenue" }],
      hasJoins: true,
    });

    expect(probes[0].sql).toContain(
      "MEASURE(`Total Revenue`) AS `Total Revenue`\nFROM catalog.schema.__forge_validate_test",
    );
    expect(probes.find((probe) => probe.kind === "joined_dimension")?.sql).toContain(
      "SELECT `Sales Region`, MEASURE(`Total Revenue`) AS `Total Revenue`",
    );
  });

  it("rejects unsafe metric identifiers", () => {
    expect(() =>
      buildMetricViewProbes({
        tempFqn: "catalog.schema.__forge_validate_test",
        dimensions: [],
        measures: [{ name: "revenue`); DROP VIEW x; --" }],
        hasJoins: false,
      }),
    ).toThrow(/identifier/i);
  });
});

describe("extractMetricViewProbeInputs", () => {
  it("derives representative probe metadata from current YAML structures", () => {
    const yaml = `version: "1.1"
source: catalog.schema.sales
joins:
  - name: customer
    source: catalog.schema.customers
    on: source.customer_id = customer.customer_id
dimensions:
  - name: region
    expr: region
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
  - name: customer_segment
    expr: customer.segment
measures:
  - name: total_revenue
    expr: SUM(revenue)
  - name: revenue_per_customer
    expr: SUM(revenue) / COUNT(DISTINCT customer_id)`;

    expect(extractMetricViewProbeInputs(yaml)).toEqual({
      dimensions: [
        { name: "region", kind: "categorical", joined: false },
        {
          name: "order_month",
          kind: "temporal",
          joined: false,
          temporalType: "date_like",
        },
        { name: "customer_segment", kind: "categorical", joined: true },
      ],
      measures: [
        { name: "total_revenue", complex: false },
        { name: "revenue_per_customer", complex: true },
      ],
      hasJoins: true,
    });
  });

  it.each([
    ["CAST AS DATE", "CAST(order_ts AS DATE)"],
    ["CAST AS TIMESTAMP", "CAST(order_text AS TIMESTAMP)"],
    ["TO_DATE", "TO_DATE(order_text, 'yyyy-MM-dd')"],
  ])("classifies %s expressions as temporal", (_label, expression) => {
    const yaml = `dimensions:
  - name: converted_period
    expr: ${expression}
measures:
  - name: row_count
    expr: COUNT(1)`;

    expect(extractMetricViewProbeInputs(yaml).dimensions[0]).toEqual({
      name: "converted_period",
      kind: "temporal",
      joined: false,
      temporalType: "date_like",
    });
  });

  it.each(["YEAR", "QUARTER", "MONTH", "WEEK", "DAY"])(
    "classifies %s extraction as integer-compatible temporal grouping",
    (functionName) => {
      const yaml = `dimensions:
  - name: calendar_bucket
    expr: ${functionName}(order_date)
measures:
  - name: row_count
    expr: COUNT(1)`;

      const inputs = extractMetricViewProbeInputs(yaml);
      const probes = buildMetricViewProbes({
        tempFqn: "catalog.schema.__forge_validate_test",
        ...inputs,
      });

      expect(inputs.dimensions[0]).toEqual({
        name: "calendar_bucket",
        kind: "temporal",
        joined: false,
        temporalType: "calendar_integer",
      });
      expect(probes.find((probe) => probe.kind === "temporal_group")).toMatchObject({
        expectedDimensionClass: "calendar_integer",
      });
    },
  );

  it("classifies folded multiline temporal expressions", () => {
    const yaml = `dimensions:
  - name: reporting_period
    expr: >-
      CAST(
        order_text
        AS TIMESTAMP
      )
measures:
  - name: row_count
    expr: COUNT(1)`;

    expect(extractMetricViewProbeInputs(yaml).dimensions[0]).toEqual({
      name: "reporting_period",
      kind: "temporal",
      joined: false,
      temporalType: "date_like",
    });
  });

  it("classifies dimensions using backtick-quoted join aliases as joined", () => {
    const yaml = `joins:
  - name: customer-dim
    source: catalog.schema.customers
    on: source.customer_id = \`customer-dim\`.customer_id
dimensions:
  - name: customer_segment
    expr: '\`customer-dim\`.\`segment name\`'
measures:
  - name: row_count
    expr: COUNT(1)`;

    expect(extractMetricViewProbeInputs(yaml).dimensions[0]).toEqual({
      name: "customer_segment",
      kind: "categorical",
      joined: true,
    });
  });
});
