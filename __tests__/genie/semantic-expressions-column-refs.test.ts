import { describe, it, expect } from "vitest";
import { extractColumnRefs } from "@/lib/genie/passes/semantic-expressions";

describe("extractColumnRefs", () => {
  it("returns empty arrays for empty input", () => {
    expect(extractColumnRefs("")).toEqual({ qualified: [], bare: [] });
    expect(extractColumnRefs("   ")).toEqual({ qualified: [], bare: [] });
  });

  it("extracts qualified table references", () => {
    const refs = extractColumnRefs("orders.amount + customers.tax");
    expect(refs.qualified.sort()).toEqual(["customers", "orders"]);
  });

  it("extracts bare identifiers (column candidates)", () => {
    const refs = extractColumnRefs("SUM(amount) + try_divide(revenue, units)");
    expect(refs.bare.sort()).toEqual(["amount", "revenue", "units"]);
  });

  it("filters out SQL keywords", () => {
    const refs = extractColumnRefs(
      "CASE WHEN status = 'paid' THEN amount ELSE 0 END",
    );
    expect(refs.bare).toEqual(expect.arrayContaining(["status", "amount"]));
    expect(refs.bare).not.toContain("case");
    expect(refs.bare).not.toContain("when");
    expect(refs.bare).not.toContain("then");
    expect(refs.bare).not.toContain("else");
    expect(refs.bare).not.toContain("end");
  });

  it("ignores identifiers inside string literals", () => {
    const refs = extractColumnRefs("status = 'completed_orders'");
    expect(refs.bare).toEqual(["status"]);
  });

  it("does not double-count the table portion of a qualified reference as a column", () => {
    const refs = extractColumnRefs("orders.amount");
    expect(refs.qualified).toEqual(["orders"]);
    expect(refs.bare).toEqual(["amount"]);
  });

  it("handles SUM(table.col) patterns", () => {
    const refs = extractColumnRefs("SUM(orders.line_total)");
    expect(refs.qualified).toEqual(["orders"]);
    expect(refs.bare).toEqual(["line_total"]);
  });
});
