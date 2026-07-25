import { describe, it, expect } from "vitest";
import { buildAdaptiveSchemaMarkdown } from "@/lib/queries/metadata";
import type { ColumnInfo, TableInfo } from "@/lib/domain/types";

function col(
  tableFqn: string,
  columnName: string,
  dataType = "STRING",
  ordinal = 0,
  comment: string | null = null,
): ColumnInfo {
  return {
    tableFqn,
    columnName,
    dataType,
    ordinalPosition: ordinal,
    isNullable: true,
    comment,
  };
}

function table(fqn: string, comment: string | null = null): TableInfo {
  const [catalog, schema, name] = fqn.split(".");
  return {
    fqn,
    catalog,
    schema,
    tableName: name,
    tableType: "TABLE",
    comment,
    dataSourceFormat: null,
    discoveredVia: "selected",
  };
}

describe("buildAdaptiveSchemaMarkdown", () => {
  it("emits all columns when the limit is >= column count", () => {
    const t = table("cat.s.t");
    const cols = [col(t.fqn, "a"), col(t.fqn, "b"), col(t.fqn, "c")];
    const out = buildAdaptiveSchemaMarkdown([t], cols, new Map([[t.fqn, 10]]));
    expect(out).toContain("cat.s.t");
    expect(out).toContain("- a (STRING)");
    expect(out).toContain("- b (STRING)");
    expect(out).toContain("- c (STRING)");
    expect(out).not.toContain("... and");
  });

  it("honours the limit and surfaces an omitted-count suffix", () => {
    const t = table("cat.s.t");
    const cols = Array.from({ length: 30 }, (_, i) => col(t.fqn, `c${i}`, "STRING", i));
    const out = buildAdaptiveSchemaMarkdown([t], cols, new Map([[t.fqn, 5]]));
    expect(out).toContain("... and 25 more columns");
  });

  it("deduplicates repeated column names in the LLM ranking (C4)", () => {
    const t = table("cat.s.t");
    const cols = [
      col(t.fqn, "id"),
      col(t.fqn, "amount"),
      col(t.fqn, "ts"),
      col(t.fqn, "status"),
    ];
    // Limit: 3 columns. LLM hallucinated "id" three times -- the builder
    // must dedupe and still fill to the limit from the remaining columns.
    const llm = new Map([[t.fqn, ["id", "id", "id", "amount"]]]);
    const out = buildAdaptiveSchemaMarkdown([t], cols, new Map([[t.fqn, 3]]), llm);

    // Count how many times the "id" column line appears.
    const idMatches = out.match(/- id \(STRING\)/g) ?? [];
    expect(idMatches.length).toBe(1);

    // amount should be present (the LLM mentioned it after the duplicates).
    expect(out).toContain("- amount (STRING)");

    // One more column should be filled in from the remaining set (either
    // ts or status) so that exactly 3 columns are emitted.
    const columnLines = (out.match(/\n  - /g) ?? []).length;
    expect(columnLines).toBe(3);
  });

  it("fills remaining LLM slots using heuristic scoring (C5)", () => {
    const t = table("cat.s.t");
    const cols = [
      col(t.fqn, "audit_log_seq", "STRING", 0),
      col(t.fqn, "payload_raw", "STRING", 1),
      col(t.fqn, "id", "INT", 2),
      col(t.fqn, "customer_id", "INT", 3),
      col(t.fqn, "total_amount", "DECIMAL", 4),
    ];
    // LLM only named one column; builder must fill to the limit of 3.
    const llm = new Map([[t.fqn, ["id"]]]);
    const out = buildAdaptiveSchemaMarkdown(
      [t],
      cols,
      new Map([[t.fqn, 3]]),
      llm,
      80,
      { fkColumnNames: new Set<string>() },
    );

    // id was explicitly requested by the LLM.
    expect(out).toContain("- id (INT)");
    // The heuristic filler should prefer business-relevant columns over
    // the earlier audit columns.
    expect(out).toContain("- customer_id (INT)");
    expect(out).toContain("- total_amount (DECIMAL)");
    expect(out).not.toContain("- audit_log_seq");
    expect(out).not.toContain("- payload_raw");
  });

  it("falls back to heuristic selection when llmRankings is empty", () => {
    const t = table("cat.s.t");
    const cols = [
      col(t.fqn, "payload_raw", "STRING", 0),
      col(t.fqn, "total_amount", "DECIMAL", 1),
      col(t.fqn, "customer_id", "INT", 2),
    ];
    const out = buildAdaptiveSchemaMarkdown(
      [t],
      cols,
      new Map([[t.fqn, 2]]),
      undefined,
      80,
      { fkColumnNames: new Set<string>() },
    );
    expect(out).toContain("- total_amount (DECIMAL)");
    expect(out).toContain("- customer_id (INT)");
    expect(out).not.toContain("- payload_raw");
  });
});
