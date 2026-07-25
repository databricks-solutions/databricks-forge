import { describe, expect, it } from "vitest";
import { validateDatasetResult } from "@/lib/dashboard/result-contract";
import type { DatasetResultExpectation } from "@/lib/dashboard/result-contract";
import type { SqlResult } from "@/lib/ports/sql-executor";

function codes(result: ReturnType<typeof validateDatasetResult>): string[] {
  return result.evidence.filter((item) => item.status === "failed").map((item) => item.code);
}

const expectation: DatasetResultExpectation = {
  datasetName: "sales_by_region",
  purpose: "breakdown",
  expectedColumns: [
    { name: "region", role: "x", compatibleTypes: ["categorical"] },
    { name: "revenue", role: "y", compatibleTypes: ["numeric"] },
  ],
  maxRowCount: 1000,
};

const matchingResult: SqlResult = {
  columns: [
    { name: "region", typeName: "STRING", position: 0 },
    { name: "revenue", typeName: "DECIMAL(18,2)", position: 1 },
  ],
  rows: [["EMEA", "125.00"]],
  totalRowCount: 1,
};

describe("validateDatasetResult", () => {
  it("accepts matching aliases, compatibility classes, and row count", () => {
    expect(validateDatasetResult(expectation, matchingResult).ok).toBe(true);
  });

  it("fails when an expected alias is missing", () => {
    const missingAlias: SqlResult = {
      ...matchingResult,
      columns: [{ name: "region", typeName: "STRING", position: 0 }],
    };

    expect(codes(validateDatasetResult(expectation, missingAlias))).toContain("ALIAS_MISSING");
  });

  it("requires a single row for KPI datasets", () => {
    const kpiExpectation: DatasetResultExpectation = {
      datasetName: "total_revenue",
      purpose: "kpi",
      expectedColumns: [{ name: "total", role: "value", compatibleTypes: ["numeric"] }],
      requireSingleRow: true,
    };
    const twoRows: SqlResult = {
      columns: [{ name: "total", typeName: "BIGINT", position: 0 }],
      rows: [["1"], ["2"]],
      totalRowCount: 2,
    };

    expect(codes(validateDatasetResult(kpiExpectation, twoRows))).toContain("ROW_COUNT_INVALID");
  });

  it("rejects string metadata for a temporal field", () => {
    const temporalExpectation: DatasetResultExpectation = {
      datasetName: "daily_sales",
      purpose: "trend",
      expectedColumns: [{ name: "sale_date", role: "x", compatibleTypes: ["temporal"] }],
    };
    const stringDate: SqlResult = {
      columns: [{ name: "sale_date", typeName: "STRING", position: 0 }],
      rows: [["2026-07-24"]],
      totalRowCount: 1,
    };

    expect(codes(validateDatasetResult(temporalExpectation, stringDate))).toContain(
      "TYPE_INCOMPATIBLE",
    );
  });

  it("uses totalRowCount and rejects results above the configured maximum", () => {
    const truncatedResult: SqlResult = {
      ...matchingResult,
      rows: matchingResult.rows,
      totalRowCount: 1001,
    };

    const result = validateDatasetResult(expectation, truncatedResult);

    expect(codes(result)).toContain("ROW_COUNT_INVALID");
    expect(result.observedRowCount).toBe(1001);
  });

  it("fails closed on case-insensitive duplicate result aliases", () => {
    const duplicateAliases: SqlResult = {
      ...matchingResult,
      columns: [
        { name: "Region", typeName: "STRING", position: 0 },
        { name: " region ", typeName: "STRING", position: 1 },
        { name: "revenue", typeName: "DECIMAL(18,2)", position: 2 },
      ],
    };

    const result = validateDatasetResult(expectation, duplicateAliases);

    expect(result.ok).toBe(false);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        status: "failed",
        code: "ALIAS_DUPLICATE",
        message: 'Dataset "sales_by_region" returned duplicate normalized alias "region".',
      }),
    );
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid totalRowCount metadata: %s", (totalRowCount) => {
    const result = validateDatasetResult(expectation, {
      ...matchingResult,
      totalRowCount,
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("ROW_COUNT_INVALID");
  });

  it("accepts a valid zero totalRowCount", () => {
    const result = validateDatasetResult(expectation, {
      ...matchingResult,
      rows: [],
      totalRowCount: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.observedRowCount).toBe(0);
  });
});
