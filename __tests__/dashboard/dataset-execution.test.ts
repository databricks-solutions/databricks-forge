import { describe, expect, it, vi } from "vitest";
import { executeAndValidateDataset, maybeApplyBoundLimit } from "@/lib/dashboard/dataset-execution";
import type { DatasetResultExpectation } from "@/lib/dashboard/result-contract";
import type { SqlExecutor, SqlResult } from "@/lib/ports/sql-executor";

const detailExpectation: DatasetResultExpectation = {
  datasetName: "order_detail",
  purpose: "detail",
  expectedColumns: [{ name: "order_id", role: "column", compatibleTypes: ["numeric"] }],
  maxRowCount: 1000,
};

const matchingResult: SqlResult = {
  columns: [{ name: "order_id", typeName: "BIGINT", position: 0 }],
  rows: [["42"]],
  totalRowCount: 1,
};

function executorWith(result: SqlResult): SqlExecutor {
  return {
    execute: vi.fn().mockResolvedValue(result),
    executeMapped: vi.fn(),
    executeScalar: vi.fn(),
  };
}

describe("maybeApplyBoundLimit", () => {
  it("adds a top-level bound to an unbounded detail query", () => {
    expect(maybeApplyBoundLimit("SELECT * FROM orders", "detail", 1000)).toBe(
      "SELECT * FROM orders\nLIMIT 1000",
    );
  });

  it("preserves an existing top-level LIMIT exactly", () => {
    const sql = "SELECT * FROM orders ORDER BY created_at DESC LIMIT 25";

    expect(maybeApplyBoundLimit(sql, "detail", 1000)).toBe(sql);
  });

  it("does not rewrite a KPI aggregate", () => {
    const sql = "SELECT COUNT(*) AS total FROM orders";

    expect(maybeApplyBoundLimit(sql, "kpi", 1000)).toBe(sql);
  });

  it("inserts the bound before a trailing statement terminator", () => {
    expect(maybeApplyBoundLimit("SELECT * FROM orders;", "detail", 1000)).toBe(
      "SELECT * FROM orders\nLIMIT 1000;",
    );
  });

  it("does not append LIMIT after a top-level OFFSET", () => {
    const sql = "SELECT * FROM orders ORDER BY created_at OFFSET 10 ROWS";

    expect(maybeApplyBoundLimit(sql, "detail", 1000)).toBe(sql);
  });

  it("does not append LIMIT after a Databricks pipe operation", () => {
    const sql = "SELECT * FROM orders |> WHERE status = 'open' |> SELECT order_id";

    expect(maybeApplyBoundLimit(sql, "detail", 1000)).toBe(sql);
  });

  it("ignores OFFSET and pipe text inside comments and strings", () => {
    const sql = "SELECT 'OFFSET |> ignored' AS note FROM orders -- OFFSET |> ignored";

    expect(maybeApplyBoundLimit(sql, "detail", 1000)).toBe(`${sql}\nLIMIT 1000`);
  });
});

describe("executeAndValidateDataset", () => {
  it("executes the bounded SQL and validates the exact executor result", async () => {
    const sqlExecutor = executorWith(matchingResult);

    const contract = await executeAndValidateDataset({
      sql: "SELECT order_id FROM orders",
      datasetName: "order_detail",
      purpose: "detail",
      expectation: detailExpectation,
      sqlExecutor,
    });

    expect(sqlExecutor.execute).toHaveBeenCalledWith("SELECT order_id FROM orders\nLIMIT 1000");
    expect(contract.ok).toBe(true);
    expect(contract.observedSchema).toEqual([{ name: "order_id", dataType: "BIGINT" }]);
    expect(contract.observedRowCount).toBe(1);
    expect(contract.evidence[0].durationMs).toEqual(expect.any(Number));
  });

  it("turns SQL execution errors into failed evidence without result rows", async () => {
    const sqlExecutor = executorWith(matchingResult);
    vi.mocked(sqlExecutor.execute).mockRejectedValue(new Error("warehouse unavailable"));

    const contract = await executeAndValidateDataset({
      sql: "SELECT order_id FROM orders",
      datasetName: "order_detail",
      purpose: "detail",
      expectation: detailExpectation,
      sqlExecutor,
    });

    expect(contract).toMatchObject({
      datasetName: "order_detail",
      ok: false,
      observedSchema: [],
      observedRowCount: 0,
    });
    expect(contract.evidence).toEqual([
      expect.objectContaining({
        stage: "dataset_execution",
        status: "failed",
        code: "SQL_EXECUTION_FAILED",
        message: expect.stringContaining("warehouse unavailable"),
        durationMs: expect.any(Number),
      }),
    ]);
    expect(contract).not.toHaveProperty("rows");
    expect(contract.evidence.every((item) => !("rows" in item))).toBe(true);
  });

  it("redacts adversarial executor errors while retaining safe category and code", async () => {
    const sqlExecutor = executorWith(matchingResult);
    const failure = new Error(
      "EXECUTION_ERROR: SELECT 'private-literal'; Authorization: Basic basic-secret; " +
        "access_token=access-secret; client_secret=client-secret; prompt=private plan",
    ) as Error & { code: string };
    failure.code = "ETIMEDOUT";
    vi.mocked(sqlExecutor.execute).mockRejectedValue(failure);

    const contract = await executeAndValidateDataset({
      sql: "SELECT order_id FROM orders",
      datasetName: "order_detail",
      purpose: "detail",
      expectation: detailExpectation,
      sqlExecutor,
    });

    expect(contract.evidence).toContainEqual(
      expect.objectContaining({
        code: "SQL_EXECUTION_FAILED",
        message: expect.stringMatching(/runtime\/ETIMEDOUT/),
      }),
    );
    const evidence = JSON.stringify(contract.evidence);
    for (const secret of [
      "private-literal",
      "Basic",
      "basic-secret",
      "access-secret",
      "client-secret",
      "private plan",
    ]) {
      expect(evidence).not.toContain(secret);
    }
  });

  it("fails closed when the executed result violates the expectation", async () => {
    const sqlExecutor = executorWith({
      columns: [{ name: "unexpected", typeName: "STRING", position: 0 }],
      rows: [["private returned value"]],
      totalRowCount: 1,
    });

    const contract = await executeAndValidateDataset({
      sql: "SELECT unexpected FROM orders",
      datasetName: "order_detail",
      purpose: "detail",
      expectation: detailExpectation,
      sqlExecutor,
    });

    expect(contract.ok).toBe(false);
    expect(contract.evidence.map((item) => item.code)).toContain("ALIAS_MISSING");
    expect(JSON.stringify(contract)).not.toContain("private returned value");
  });

  it("fails closed before execution when options and expectation disagree", async () => {
    const sqlExecutor = executorWith(matchingResult);

    const contract = await executeAndValidateDataset({
      sql: "SELECT order_id FROM orders",
      datasetName: "different_dataset",
      purpose: "detail",
      expectation: detailExpectation,
      sqlExecutor,
    });

    expect(contract.ok).toBe(false);
    expect(contract.evidence.map((item) => item.code)).toContain("EXPECTATION_MISMATCH");
    expect(sqlExecutor.execute).not.toHaveBeenCalled();
  });
});
