import { describe, expect, it } from "vitest";
import {
  buildMetricViewAlterStatement,
  parseMetricViewShowCreate,
} from "@/lib/metric-views/improve-alter";
import { serializeMetricViewYaml } from "@/lib/metric-views/serializer";
import type { MetricViewDefinition } from "@/lib/metric-views/definition";

const definition: MetricViewDefinition = {
  version: "1.1",
  name: "sales_metrics",
  source: { kind: "table", table: "main.sales.orders" },
  joins: [],
  dimensions: [{ kind: "local", name: "region", expr: "region" }],
  measures: [{ kind: "expression", name: "revenue", expr: "SUM(revenue)" }],
  requiredFeatures: [],
};

describe("metric view ALTER deployment", () => {
  it("builds update-only ALTER against the validated exact quoted FQN", () => {
    const sql = buildMetricViewAlterStatement("main.analytics.sales_metrics", definition);

    expect(sql).toBe(
      `ALTER VIEW \`main\`.\`analytics\`.\`sales_metrics\` AS $$\n${serializeMetricViewYaml(
        definition,
      )}$$`,
    );
    expect(sql).not.toMatch(/CREATE/i);
  });

  it("rejects YAML delimiter breakout", () => {
    expect(() =>
      buildMetricViewAlterStatement("main.analytics.sales_metrics", {
        ...definition,
        comment: "break $$ out",
      }),
    ).toThrow("reserved outer DDL delimiter");
  });

  it("parses canonical live IR from SHOW CREATE and pins its target", () => {
    const yaml = serializeMetricViewYaml(definition);
    const live = parseMetricViewShowCreate(
      {
        columns: [{ name: "createtab_stmt", typeName: "STRING", position: 0 }],
        rows: [
          [
            `CREATE VIEW \`main\`.\`analytics\`.\`sales_metrics\`\nWITH METRICS\nLANGUAGE YAML\nAS $$\n${yaml}$$`,
          ],
        ],
        totalRowCount: 1,
      },
      "main.analytics.sales_metrics",
    );

    expect(live).toEqual(definition);
    expect(() =>
      parseMetricViewShowCreate(
        {
          columns: [],
          rows: [
            [
              `CREATE VIEW main.analytics.other WITH METRICS LANGUAGE YAML AS $$\n${yaml}$$`,
            ],
          ],
          totalRowCount: 1,
        },
        "main.analytics.sales_metrics",
      ),
    ).toThrow("does not match");
  });
});
