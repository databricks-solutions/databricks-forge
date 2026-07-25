import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries/metadata", () => ({
  fetchTableInfoBatch: vi.fn(),
  fetchColumnsBatch: vi.fn(),
}));

vi.mock("@/lib/genie/schema-allowlist", () => ({
  buildSchemaAllowlist: vi.fn(() => ({})),
  validateSqlExpression: vi.fn(() => true),
}));

import { revalidateSerializedSpace } from "@/lib/genie/deploy-validation";
import { fetchColumnsBatch, fetchTableInfoBatch } from "@/lib/queries/metadata";
import { validateSqlExpression } from "@/lib/genie/schema-allowlist";

describe("genie deploy validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchTableInfoBatch).mockResolvedValue([]);
    vi.mocked(fetchColumnsBatch).mockResolvedValue([]);
    vi.mocked(validateSqlExpression).mockReturnValue(true);
  });

  it("fails with structured no-table error", async () => {
    const result = await revalidateSerializedSpace(
      JSON.stringify({
        data_sources: { tables: [] },
        instructions: { join_specs: [], example_question_sqls: [] },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no_tables");
    }
  });

  it("fails multi-table payloads without joins", async () => {
    const result = await revalidateSerializedSpace(
      JSON.stringify({
        data_sources: {
          tables: [{ identifier: "main.sales.orders" }, { identifier: "main.sales.customers" }],
        },
        instructions: { join_specs: [], example_question_sqls: [] },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_multitable_joins");
      expect(result.diagnostics).toMatchObject({ tableCount: 2 });
    }
  });

  it("returns join-level diagnostics when join SQL is invalid", async () => {
    vi.mocked(validateSqlExpression).mockReturnValue(false);
    const result = await revalidateSerializedSpace(
      JSON.stringify({
        data_sources: { tables: [{ identifier: "main.sales.orders" }] },
        instructions: {
          join_specs: [
            {
              id: "join-1",
              left: { identifier: "main.sales.orders" },
              right: { identifier: "main.sales.customers" },
              sql: ["main.sales.orders.customer_id = main.sales.customers.customer_id"],
            },
          ],
          example_question_sqls: [],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_join_sql");
      expect(result.diagnostics).toMatchObject({ joinId: "join-1" });
    }
  });
});
