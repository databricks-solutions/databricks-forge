import { describe, it, expect } from "vitest";
import { parseCSVResponse, parseJSONResponse } from "@/lib/ai/agent";

describe("parseCSVResponse", () => {
  it("parses well-formed CSV", () => {
    const csv = `1, "Customer Churn", AI, ai_forecast, "Predict churn", "Use AI", "Save money", Sales, CRO, "cat.schema.table", "CTE approach"`;
    const rows = parseCSVResponse(csv, 11);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("1");
    expect(rows[0][1]).toBe("Customer Churn");
  });

  it("handles markdown code fences", () => {
    const csv = "```csv\n1, Test, AI\n```";
    const rows = parseCSVResponse(csv, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("1");
  });

  it("pads short rows to expected columns", () => {
    const csv = "1, Test";
    const rows = parseCSVResponse(csv, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(3);
    expect(rows[0][2]).toBe("");
  });

  it("trims long rows to expected columns when within tolerance", () => {
    // parseCSVResponse accepts rows within ±2 of expected columns
    const csv = "1, a, b, c, d";
    const rows = parseCSVResponse(csv, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(3);
  });

  it("rejects rows far beyond expected columns", () => {
    // 6 columns when expecting 3 is beyond ±2 tolerance
    const csv = "1, a, b, c, d, e";
    const rows = parseCSVResponse(csv, 3);
    expect(rows).toHaveLength(0);
  });

  it("rejects rows with wildly wrong column counts", () => {
    const csv = "1, a\n1, a, b, c, d, e, f, g, h, i, j";
    const rows = parseCSVResponse(csv, 3);
    // First row: 2 cols, accepted (within ±2 of 3)
    // Second row: 11 cols, rejected (>5)
    expect(rows).toHaveLength(1);
  });

  it("handles quoted fields with commas", () => {
    const csv = `1, "Hello, World", AI`;
    const rows = parseCSVResponse(csv, 3);
    expect(rows[0][1]).toBe("Hello, World");
  });

  it("handles escaped quotes in fields", () => {
    const csv = `1, "She said ""hi""", AI`;
    const rows = parseCSVResponse(csv, 3);
    expect(rows[0][1]).toBe('She said "hi"');
  });

  it("returns empty array for empty input", () => {
    expect(parseCSVResponse("", 3)).toEqual([]);
    expect(parseCSVResponse("   ", 3)).toEqual([]);
  });

  it("strips header rows", () => {
    const csv = "No, Name, Type\n1, Test, AI";
    const rows = parseCSVResponse(csv, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("1");
  });
});

describe("parseJSONResponse", () => {
  it("parses valid JSON object", () => {
    const result = parseJSONResponse<{ key: string }>('{"key": "value"}');
    expect(result.key).toBe("value");
  });

  it("parses valid JSON array", () => {
    const result = parseJSONResponse<number[]>("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });

  it("strips markdown code fences", () => {
    const result = parseJSONResponse<{ a: number }>('```json\n{"a": 1}\n```');
    expect(result.a).toBe(1);
  });

  it("strips preamble text before JSON", () => {
    const result = parseJSONResponse<{ a: number }>('Here is the result:\n{"a": 42}');
    expect(result.a).toBe(42);
  });

  it("handles trailing text after JSON", () => {
    const result = parseJSONResponse<{ x: string }>('{"x": "y"}\nHope this helps!');
    expect(result.x).toBe("y");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJSONResponse("not json")).toThrow();
  });
});
