import { describe, it, expect } from "vitest";
import { generateTimePeriods } from "@/lib/genie/time-periods";
import type { ColumnInfo } from "@/lib/domain/types";

function makeColumn(tableFqn: string, name: string, dataType: string): ColumnInfo {
  return {
    tableFqn,
    columnName: name,
    dataType,
    ordinalPosition: 1,
    isNullable: true,
    comment: null,
  };
}

describe("generateTimePeriods", () => {
  const tables = ["cat.schema.orders"];
  const columns: ColumnInfo[] = [
    makeColumn("cat.schema.orders", "order_date", "date"),
    makeColumn("cat.schema.orders", "amount", "double"),
    makeColumn("cat.schema.orders", "status", "string"),
  ];

  it("generates filters and dimensions for date columns only", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 1 });

    expect(result.filters.length).toBeGreaterThan(0);
    expect(result.dimensions.length).toBeGreaterThan(0);

    for (const f of result.filters) {
      expect(f.sql).toContain("order_date");
      expect(f.isTimePeriod).toBe(true);
    }
    for (const d of result.dimensions) {
      expect(d.sql).toContain("order_date");
      expect(d.isTimePeriod).toBe(true);
    }
  });

  it("generates 7 standard filters per date column", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 1 });
    expect(result.filters).toHaveLength(7);

    const names = result.filters.map((f) => f.name);
    expect(names).toContain("Order Date Last 7 Days");
    expect(names).toContain("Order Date Last 30 Days");
    expect(names).toContain("Order Date Month to Date");
    expect(names).toContain("Order Date Quarter to Date");
    expect(names).toContain("Order Date Year to Date");
    expect(names).toContain("Order Date Last Fiscal Year");
  });

  it("generates 4 standard dimensions per date column", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 1 });
    expect(result.dimensions).toHaveLength(4);

    const names = result.dimensions.map((d) => d.name);
    expect(names).toContain("Order Date Month");
    expect(names).toContain("Order Date Quarter");
    expect(names).toContain("Order Date Year");
    expect(names).toContain("Order Date Day of Week");
  });

  it("uses fiscal SQL when fiscalYearStartMonth != 1", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 4 });

    const qtdFilter = result.filters.find((f) => f.name.includes("Quarter to Date"));
    expect(qtdFilter).toBeDefined();
    expect(qtdFilter!.sql).toContain("MAKE_DATE");
    expect(qtdFilter!.instructions).toContain("April");

    const yearDim = result.dimensions.find((d) => d.name.includes("Year"));
    expect(yearDim).toBeDefined();
    expect(yearDim!.sql).toContain("CASE WHEN");
  });

  it("uses simple DATE_TRUNC for calendar year (fiscalStart=1)", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 1 });

    const qtdFilter = result.filters.find((f) => f.name.includes("Quarter to Date"));
    expect(qtdFilter!.sql).toContain("DATE_TRUNC");
    expect(qtdFilter!.sql).not.toContain("MAKE_DATE");

    const yearDim = result.dimensions.find((d) => d.name.includes("Year"));
    expect(yearDim!.sql).toContain("YEAR(");
    expect(yearDim!.sql).not.toContain("CASE WHEN");
  });

  it("filters to specified target columns only", () => {
    const moreColumns: ColumnInfo[] = [
      ...columns,
      makeColumn("cat.schema.orders", "created_at", "timestamp"),
    ];
    const result = generateTimePeriods(moreColumns, tables, {
      fiscalYearStartMonth: 1,
      targetDateColumns: ["order_date"],
    });

    for (const f of result.filters) {
      expect(f.sql).toContain("order_date");
      expect(f.sql).not.toContain("created_at");
    }
  });

  it("ignores tables not in the tableFqns list", () => {
    const extraColumns: ColumnInfo[] = [
      ...columns,
      makeColumn("cat.schema.other_table", "some_date", "date"),
    ];
    const result = generateTimePeriods(extraColumns, tables, { fiscalYearStartMonth: 1 });

    for (const f of result.filters) {
      expect(f.sql).not.toContain("other_table");
    }
  });

  it("returns empty results when no date columns exist", () => {
    const nonDateColumns: ColumnInfo[] = [
      makeColumn("cat.schema.orders", "id", "int"),
      makeColumn("cat.schema.orders", "name", "string"),
    ];
    const result = generateTimePeriods(nonDateColumns, tables, { fiscalYearStartMonth: 1 });
    expect(result.filters).toHaveLength(0);
    expect(result.dimensions).toHaveLength(0);
  });

  it("handles timestamp columns", () => {
    const tsColumns: ColumnInfo[] = [
      makeColumn("cat.schema.events", "event_timestamp", "timestamp"),
    ];
    const result = generateTimePeriods(tsColumns, ["cat.schema.events"], {
      fiscalYearStartMonth: 1,
    });
    expect(result.filters.length).toBeGreaterThan(0);
  });

  it("generates synonyms for all filters", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 1 });
    for (const f of result.filters) {
      expect(f.synonyms.length).toBeGreaterThan(0);
    }
  });

  it("backtick-quotes column names with spaces", () => {
    const spacedColumns: ColumnInfo[] = [
      makeColumn("cat.schema.loans", "Origination Quarter", "date"),
    ];
    const result = generateTimePeriods(spacedColumns, ["cat.schema.loans"], {
      fiscalYearStartMonth: 1,
    });

    expect(result.filters.length).toBeGreaterThan(0);
    expect(result.dimensions.length).toBeGreaterThan(0);

    for (const f of result.filters) {
      expect(f.sql).toContain("`Origination Quarter`");
      expect(f.sql).not.toMatch(/\.Origination Quarter[^`]/);
    }
    for (const d of result.dimensions) {
      expect(d.sql).toContain("`Origination Quarter`");
    }
  });

  it("does not backtick-quote simple column names", () => {
    const result = generateTimePeriods(columns, tables, { fiscalYearStartMonth: 1 });

    for (const f of result.filters) {
      expect(f.sql).not.toContain("`order_date`");
      expect(f.sql).toContain("order_date");
    }
  });

  it("backtick-quotes columns with parentheses", () => {
    const parenColumns: ColumnInfo[] = [
      makeColumn("cat.schema.loans", "Duration (Months)", "date"),
    ];
    const result = generateTimePeriods(parenColumns, ["cat.schema.loans"], {
      fiscalYearStartMonth: 1,
    });

    for (const f of result.filters) {
      expect(f.sql).toContain("`Duration (Months)`");
    }
  });
});
