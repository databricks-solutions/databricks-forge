import { describe, it, expect } from "vitest";
import {
  findInvalidIdentifiers,
  quoteIdent,
  buildCompactColumnsBlock,
  buildSchemaContextBlock,
  type SchemaAllowlist,
} from "@/lib/genie/schema-allowlist";
import type { MetadataSnapshot } from "@/lib/domain/types";

function makeAllowlist(tables: Record<string, string[]>): SchemaAllowlist {
  const tableSet = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const columnTypes = new Map<string, string>();

  for (const [fqn, cols] of Object.entries(tables)) {
    const key = fqn.toLowerCase();
    tableSet.add(key);
    columns.set(key, new Set(cols.map((c) => c.toLowerCase())));
    for (const c of cols) {
      columnTypes.set(`${key}.${c.toLowerCase()}`, "string");
    }
  }

  return { tables: tableSet, columns, columnTypes, metricViews: new Set() };
}

describe("quoteIdent", () => {
  it("returns bare name for simple identifiers", () => {
    expect(quoteIdent("order_date")).toBe("order_date");
    expect(quoteIdent("customerID")).toBe("customerID");
  });

  it("backtick-quotes names with spaces", () => {
    expect(quoteIdent("Origination Quarter")).toBe("`Origination Quarter`");
    expect(quoteIdent("Loan Status Description")).toBe("`Loan Status Description`");
  });

  it("backtick-quotes names with special characters", () => {
    expect(quoteIdent("Duration (Months)")).toBe("`Duration (Months)`");
    expect(quoteIdent("cost-center")).toBe("`cost-center`");
  });
});

describe("findInvalidIdentifiers", () => {
  const allowlist = makeAllowlist({
    "retail.demo.loans": ["District", "Origination Quarter", "Loan Status", "amount"],
    "retail.demo.customers": ["customer_id", "name", "Account Open Month"],
  });

  describe("unquoted 4-part FQN", () => {
    it("passes valid column references", () => {
      const sql = "retail.demo.loans.amount >= 100";
      expect(findInvalidIdentifiers(allowlist, sql)).toEqual([]);
    });

    it("flags invalid unquoted column", () => {
      const sql = "retail.demo.loans.bogus >= 100";
      const invalid = findInvalidIdentifiers(allowlist, sql);
      expect(invalid).toContain("retail.demo.loans.bogus");
    });
  });

  describe("backtick-quoted 4-part FQN", () => {
    it("passes valid backtick-quoted column", () => {
      const sql = "retail.demo.loans.`Origination Quarter` >= CURRENT_DATE()";
      expect(findInvalidIdentifiers(allowlist, sql)).toEqual([]);
    });

    it("flags invalid backtick-quoted column", () => {
      const sql = "retail.demo.loans.`Nonexistent Column` >= 0";
      const invalid = findInvalidIdentifiers(allowlist, sql);
      expect(invalid).toContain("retail.demo.loans.`Nonexistent Column`");
    });

    it("passes backtick-quoted column from another table", () => {
      const sql = "retail.demo.customers.`Account Open Month` >= CURRENT_DATE()";
      expect(findInvalidIdentifiers(allowlist, sql)).toEqual([]);
    });
  });

  describe("strict mode — backtick-quoted 2-part", () => {
    it("passes valid alias.`spaced column`", () => {
      const sql = "SUM(source.`Origination Quarter`)";
      const invalid = findInvalidIdentifiers(allowlist, sql, true);
      expect(invalid).toEqual([]);
    });

    it("flags hallucinated alias.`spaced column`", () => {
      const sql = "SUM(lending.`Defaulted Loans`)";
      const invalid = findInvalidIdentifiers(allowlist, sql, true);
      expect(invalid.length).toBeGreaterThan(0);
      expect(invalid[0]).toContain("Defaulted Loans");
    });

    it("passes valid unquoted alias.column in strict mode", () => {
      const sql = "SUM(source.amount)";
      const invalid = findInvalidIdentifiers(allowlist, sql, true);
      expect(invalid).toEqual([]);
    });
  });
});

describe("buildCompactColumnsBlock", () => {
  const metadata: MetadataSnapshot = {
    cacheKey: "test",
    ucPath: "retail.demo",
    tables: [
      {
        fqn: "retail.demo.loans",
        catalog: "retail",
        schema: "demo",
        tableName: "loans",
        comment: null,
        tableType: "MANAGED",
        dataSourceFormat: "DELTA",
      },
    ],
    columns: [
      {
        tableFqn: "retail.demo.loans",
        columnName: "amount",
        dataType: "double",
        ordinalPosition: 1,
        isNullable: true,
        comment: null,
      },
      {
        tableFqn: "retail.demo.loans",
        columnName: "Origination Quarter",
        dataType: "date",
        ordinalPosition: 2,
        isNullable: true,
        comment: null,
      },
    ],
    foreignKeys: [],
    metricViews: [],

    tableCount: 1,
    columnCount: 2,
    cachedAt: "",
    lineageDiscoveredFqns: [],
  };

  it("backtick-quotes column names with spaces", () => {
    const block = buildCompactColumnsBlock(metadata);
    expect(block).toContain("`Origination Quarter`");
    expect(block).toContain("amount");
    expect(block).not.toContain("`amount`");
  });
});

describe("buildSchemaContextBlock", () => {
  const metadata: MetadataSnapshot = {
    cacheKey: "test",
    ucPath: "retail.demo",
    tables: [
      {
        fqn: "retail.demo.loans",
        catalog: "retail",
        schema: "demo",
        tableName: "loans",
        comment: null,
        tableType: "MANAGED",
        dataSourceFormat: "DELTA",
      },
    ],
    columns: [
      {
        tableFqn: "retail.demo.loans",
        columnName: "amount",
        dataType: "double",
        ordinalPosition: 1,
        isNullable: true,
        comment: null,
      },
      {
        tableFqn: "retail.demo.loans",
        columnName: "Loan Duration (Months)",
        dataType: "int",
        ordinalPosition: 2,
        isNullable: true,
        comment: null,
      },
    ],
    foreignKeys: [],
    metricViews: [],

    tableCount: 1,
    columnCount: 2,
    cachedAt: "",
    lineageDiscoveredFqns: [],
  };

  it("backtick-quotes column names with spaces and parens", () => {
    const block = buildSchemaContextBlock(metadata);
    expect(block).toContain("`Loan Duration (Months)`");
    expect(block).toContain("amount");
    expect(block).not.toContain("`amount`");
  });
});
