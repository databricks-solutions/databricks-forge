import { describe, it, expect, beforeEach } from "vitest";
import { resolveFixStrategies, extractTableFqns } from "@/lib/genie/space-fixer";
import { clearRegistryCache } from "@/lib/genie/health-checks/registry";
import { perfectSpace, emptySpace } from "./health-checks/fixtures/spaces";

beforeEach(() => {
  clearRegistryCache();
});

describe("resolveFixStrategies", () => {
  it("maps check IDs to correct fix strategies", () => {
    const strategies = resolveFixStrategies([
      "columns-have-descriptions",
      "measures-defined",
      "join-specs-for-multi-table",
    ]);

    expect(strategies.has("column_intelligence")).toBe(true);
    expect(strategies.has("semantic_expressions")).toBe(true);
    expect(strategies.has("join_inference")).toBe(true);
  });

  it("groups multiple checks into same strategy", () => {
    const strategies = resolveFixStrategies([
      "columns-have-descriptions",
      "column-synonyms-defined",
    ]);

    expect(strategies.has("column_intelligence")).toBe(true);
    const checks = strategies.get("column_intelligence")!;
    expect(checks).toContain("columns-have-descriptions");
    expect(checks).toContain("column-synonyms-defined");
  });

  it("ignores non-fixable checks", () => {
    const strategies = resolveFixStrategies(["tables-configured", "valid-ids", "unique-ids"]);
    expect(strategies.size).toBe(0);
  });

  it("returns empty map for unknown check IDs", () => {
    const strategies = resolveFixStrategies(["nonexistent-check"]);
    expect(strategies.size).toBe(0);
  });

  it("returns all strategy types for comprehensive fix list", () => {
    const strategies = resolveFixStrategies([
      "columns-have-descriptions",
      "measures-defined",
      "join-specs-for-multi-table",
      "example-sqls-minimum",
      "text-instruction-exists",
      "benchmarks-exist",
      "entity-matching-configured",
      "sample-questions-defined",
    ]);

    expect(strategies.has("column_intelligence")).toBe(true);
    expect(strategies.has("semantic_expressions")).toBe(true);
    expect(strategies.has("join_inference")).toBe(true);
    expect(strategies.has("trusted_assets")).toBe(true);
    expect(strategies.has("instruction_generation")).toBe(true);
    expect(strategies.has("benchmark_generation")).toBe(true);
    expect(strategies.has("entity_matching")).toBe(true);
    expect(strategies.has("sample_questions")).toBe(true);
  });
});

describe("extractTableFqns", () => {
  it("extracts FQNs from space data_sources", () => {
    const fqns = extractTableFqns(perfectSpace);
    expect(fqns).toContain("catalog.schema.orders");
    expect(fqns).toContain("catalog.schema.customers");
  });

  it("returns empty for space with no tables", () => {
    const fqns = extractTableFqns(emptySpace);
    expect(fqns).toHaveLength(0);
  });

  it("filters out invalid identifiers", () => {
    const space = {
      data_sources: {
        tables: [
          { identifier: "catalog.schema.table" },
          { identifier: "invalid" },
          { identifier: null },
        ],
      },
    };
    const fqns = extractTableFqns(space);
    expect(fqns).toHaveLength(1);
    expect(fqns[0]).toBe("catalog.schema.table");
  });
});
