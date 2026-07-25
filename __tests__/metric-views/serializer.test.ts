import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseMetricViewYaml } from "@/lib/metric-views/parser";
import {
  buildMetricViewDdlFromDefinition,
  serializeMetricViewYaml,
} from "@/lib/metric-views/serializer";
import type { MetricViewDefinition } from "@/lib/metric-views/definition";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "__tests__/fixtures/metric-views", name), "utf8");
}

describe("serializeMetricViewYaml", () => {
  it("emits the stable top-level field order", () => {
    const serialized = serializeMetricViewYaml(
      parseMetricViewYaml(fixture("v1-basic.yaml"), "orders_metrics"),
    );
    const keys = ["version:", "source:", "comment:", "filter:", "dimensions:", "measures:"];
    const positions = keys.map((key) => serialized.indexOf(key));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("uses YAML serialization for quoted values and multiline expressions", () => {
    const definition: MetricViewDefinition = {
      version: "1.1",
      name: "special_metrics",
      source: { kind: "table", table: "main.sales.orders" },
      comment: "Revenue: current & forecast # governed",
      joins: [],
      dimensions: [
        {
          kind: "local",
          name: "segment",
          expr: "CASE\n  WHEN amount > 0 THEN 'positive'\n  ELSE 'other'\nEND",
        },
      ],
      measures: [{ kind: "expression", name: "orders", expr: "COUNT(1)" }],
      requiredFeatures: [],
    };

    const serialized = serializeMetricViewYaml(definition);

    expect(parse(serialized)).toMatchObject({
      comment: definition.comment,
      dimensions: [{ expr: definition.dimensions[0].expr }],
    });
    expect(serialized).toContain("expr: |-");
  });

  it("serializes nested joins and materialization in transport field order", () => {
    const definition = parseMetricViewYaml(fixture("v1-materialization.yaml"), "orders_metrics");
    const serialized = serializeMetricViewYaml(definition);
    const materialization = parse(serialized).materialization;

    expect(Object.keys(materialization)).toEqual(["schedule", "mode", "materialized_views"]);
    expect(Object.keys(materialization.materialized_views[1])).toEqual([
      "name",
      "type",
      "dimensions",
      "measures",
    ]);
  });

  it("does not serialize unknown transport fields", () => {
    const definition = parseMetricViewYaml(
      `
version: "1.1"
source: main.sales.orders
vendor_extension: keep-out
dimensions:
  - name: region
    expr: region
    mystery: keep-out
measures:
  - name: orders
    expr: COUNT(1)
`,
      "orders_metrics",
    );

    expect(serializeMetricViewYaml(definition)).not.toContain("keep-out");
  });
});

describe("buildMetricViewDdlFromDefinition", () => {
  it("builds deterministic identifier-safe metric view DDL", () => {
    const definition = parseMetricViewYaml(fixture("v1-basic.yaml"), "orders_metrics");

    const ddl = buildMetricViewDdlFromDefinition({
      catalog: "main",
      schema: "analytics",
      definition,
    });

    expect(ddl).toBe(
      `CREATE OR REPLACE VIEW \`main\`.\`analytics\`.\`orders_metrics\`\n` +
        `WITH METRICS\nLANGUAGE YAML\nAS $$\n${serializeMetricViewYaml(definition)}$$`,
    );
  });

  it("rejects unsafe target identifiers", () => {
    const definition = parseMetricViewYaml(fixture("v1-basic.yaml"), "orders_metrics");

    expect(() =>
      buildMetricViewDdlFromDefinition({
        catalog: "main; DROP SCHEMA x",
        schema: "analytics",
        definition,
      }),
    ).toThrow(/invalid characters/i);
  });

  it.each([
    {
      field: "comment",
      apply: (definition: MetricViewDefinition) => {
        definition.comment = "Close YAML $$; DROP VIEW main.analytics.orders_metrics; --";
      },
    },
    {
      field: "expression",
      apply: (definition: MetricViewDefinition) => {
        definition.measures[0] = {
          kind: "expression",
          name: "total_revenue",
          expr: "SUM(o_totalprice) $$; DROP SCHEMA analytics; --",
        };
      },
    },
  ])("rejects an outer DDL delimiter in a $field without emitting DDL", ({ apply }) => {
    const definition = parseMetricViewYaml(fixture("v1-basic.yaml"), "orders_metrics");
    apply(definition);
    let ddl: string | undefined;

    expect(() => {
      ddl = buildMetricViewDdlFromDefinition({
        catalog: "main",
        schema: "analytics",
        definition,
      });
    }).toThrow(/DDL delimiter/i);
    expect(ddl).toBeUndefined();
  });
});
