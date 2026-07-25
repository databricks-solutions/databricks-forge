import { describe, expect, it } from "vitest";
import {
  deploymentTargetFromSchemaScope,
  definitionToLegacyText,
  ensureMetricViewDefinition,
  proposalToDefinition,
} from "@/lib/metric-views/legacy-adapter";
import type { MetricViewProposal } from "@/lib/metric-views/types";

const legacyYaml = `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
measures:
  - name: total_revenue
    expr: SUM(amount)
`;

function proposal(overrides: Partial<MetricViewProposal> = {}): MetricViewProposal {
  return {
    name: "sales",
    description: "Sales metrics",
    yaml: legacyYaml,
    ddl:
      "CREATE OR REPLACE VIEW `main`.`sales`.`sales`\n" +
      "WITH METRICS\nLANGUAGE YAML\nAS $$\n" +
      legacyYaml +
      "$$",
    sourceTables: ["main.sales.orders"],
    hasJoins: false,
    hasFilteredMeasures: false,
    hasWindowMeasures: false,
    hasMaterialization: false,
    validationStatus: "valid",
    validationIssues: [],
    ...overrides,
  };
}

describe("legacy metric view adapter", () => {
  it("parses a legacy proposal using its external proposal name", () => {
    expect(proposalToDefinition({ name: "sales", yaml: legacyYaml })).toEqual(
      expect.objectContaining({ name: "sales" }),
    );
  });

  it("round-trips a table-backed definition at an explicit target distinct from its source", () => {
    const definition = proposalToDefinition({ name: "sales", yaml: legacyYaml });
    expect(definition).not.toBeNull();

    const legacy = definitionToLegacyText(definition!, {
      catalog: "governed",
      schema: "metrics",
    });

    expect(legacy.yaml).toContain("measures:");
    expect(legacy.ddl.split("\n")[0]).toBe(
      "CREATE OR REPLACE VIEW `governed`.`metrics`.`sales`",
    );
    expect(legacy.ddl).not.toContain("CREATE OR REPLACE VIEW `main`.`sales`");
    expect(legacy.ddl).toContain(`AS $$\n${legacy.yaml}$$`);
    expect(proposalToDefinition({ name: definition!.name, yaml: legacy.yaml })).toEqual(
      definition,
    );
  });

  it("leaves unparseable persisted proposals readable without a definition", () => {
    const legacy = proposal({ yaml: "version: [" });

    const adapted = ensureMetricViewDefinition(legacy);

    expect(adapted).toEqual(legacy);
    expect(adapted.definition).toBeUndefined();
  });

  it("preserves legacy text while attaching a parsed definition", () => {
    const legacy = proposal();

    const adapted = ensureMetricViewDefinition(legacy);

    expect(adapted.yaml).toBe(legacy.yaml);
    expect(adapted.ddl).toBe(legacy.ddl);
    expect(adapted.definition).toEqual(expect.objectContaining({ name: "sales" }));
  });

  it("round-trips a query-backed definition at an explicit target distinct from query scope", () => {
    const definition = proposalToDefinition({
      name: "query_metrics",
      yaml: `version: "1.1"
source: SELECT order_date, amount FROM main.sales.orders
dimensions:
  - name: order_date
    expr: order_date
measures:
  - name: total_revenue
    expr: SUM(amount)
`,
    });

    expect(definition).not.toBeNull();
    const legacy = definitionToLegacyText(definition!, {
      catalog: "governed",
      schema: "metrics",
    });
    expect(legacy.ddl.split("\n")[0]).toBe(
      "CREATE OR REPLACE VIEW `governed`.`metrics`.`query_metrics`",
    );
    expect(legacy.ddl).not.toContain("CREATE OR REPLACE VIEW `main`.`sales`");
    expect(proposalToDefinition({ name: definition!.name, yaml: legacy.yaml })).toEqual(
      definition,
    );
  });

  it.each(["CREATE VIEW", "CREATE OR REPLACE VIEW"])(
    "preserves a quoted hyphenated target for %s",
    (createForm) => {
      const definition = proposalToDefinition({ name: "sales", yaml: legacyYaml });
      expect(definition).not.toBeNull();
      const originalDdl =
        `${createForm} \`published-cat\`.\`semantic-schema\`.\`stable-name\`\n` +
        "WITH METRICS\nLANGUAGE YAML\nAS $$\nstale: body\n$$";

      const legacy = definitionToLegacyText(definition!, { originalDdl });

      expect(legacy.ddl.split("\n")[0]).toBe(
        `${createForm} \`published-cat\`.\`semantic-schema\`.\`stable-name\``,
      );
      expect(legacy.ddl).toContain(`AS $$\n${legacy.yaml}$$`);
    },
  );

  it("returns no deployment target for catalog-wide or comma-separated scopes", () => {
    expect(deploymentTargetFromSchemaScope("main")).toBeUndefined();
    expect(deploymentTargetFromSchemaScope("main.sales,other.finance")).toBeUndefined();
    expect(deploymentTargetFromSchemaScope("main.sales")).toEqual({
      catalog: "main",
      schema: "sales",
    });
  });

  it("requires an explicit deployment target", () => {
    const definition = proposalToDefinition({ name: "sales", yaml: legacyYaml });
    expect(definition).not.toBeNull();

    // @ts-expect-error deployment identity must never be inferred from the definition.
    expect(() => definitionToLegacyText(definition!)).toThrow(/deployment target/i);
  });
});
