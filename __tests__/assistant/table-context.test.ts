import { describe, expect, it } from "vitest";
import {
  extractTableFqnsFromText,
  mergeTableReferenceLists,
} from "@/lib/assistant/context-builder";
import { inferTablesFromSqlBlocks } from "@/lib/assistant/engine";

describe("assistant table context inference", () => {
  it("extracts three-part table references from free text", () => {
    const text = "Use main.sales.orders joined to main.sales.customers for retention analysis.";
    expect(extractTableFqnsFromText(text)).toEqual(["main.sales.orders", "main.sales.customers"]);
  });

  it("merges table references across sources without duplicates", () => {
    const merged = mergeTableReferenceLists(
      ["main.sales.orders", "main.sales.customers"],
      ["MAIN.SALES.CUSTOMERS", "main.finance.invoices"],
      ["`main.finance.invoices`"],
    );
    expect(merged).toEqual(["main.sales.orders", "main.sales.customers", "main.finance.invoices"]);
  });

  it("infers table references from generated SQL blocks", () => {
    const sqlBlocks = [
      "SELECT * FROM main.sales.orders o JOIN main.sales.customers c ON o.customer_id = c.customer_id",
    ];
    expect(inferTablesFromSqlBlocks(sqlBlocks)).toEqual([
      "main.sales.orders",
      "main.sales.customers",
    ]);
  });
});
