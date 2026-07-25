import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHeaders: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock("@/lib/dbx/client", () => ({
  getConfig: () => ({ host: "https://example.databricks.com", warehouseId: "warehouse-1" }),
  getHeaders: mocks.getHeaders,
}));

vi.mock("@/lib/dbx/fetch-with-timeout", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  TIMEOUTS: {
    SQL_SUBMIT: 60_000,
    SQL_POLL: 30_000,
    SQL_CHUNK: 30_000,
  },
}));

import { cancelStatement, executeSQL } from "@/lib/dbx/sql";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SQL Statement Execution authentication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getHeaders.mockReset();
    mocks.fetchWithTimeout.mockReset();
    mocks.getHeaders.mockResolvedValue({
      Authorization: "Bearer obo-context",
      "Content-Type": "application/json",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves headers independently for submit, poll, and each result chunk", async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(
        jsonResponse({
          statement_id: "statement-1",
          status: { state: "RUNNING" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          statement_id: "statement-1",
          status: { state: "SUCCEEDED" },
          manifest: { schema: { columns: [] }, total_chunk_count: 2, total_row_count: 2 },
          result: {
            chunk_index: 0,
            row_offset: 0,
            row_count: 1,
            data_array: [["first"]],
            next_chunk_internal_link: "/api/2.0/sql/statements/statement-1/result/chunks/1",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data_array: [["second"]] }));

    const resultPromise = executeSQL("SELECT 1");
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result.rows).toEqual([["first"], ["second"]]);
    expect(mocks.getHeaders).toHaveBeenCalledTimes(3);
    for (const [, init] of mocks.fetchWithTimeout.mock.calls) {
      expect(init.headers.Authorization).toBe("Bearer obo-context");
    }
  });

  it("resolves headers when cancelling a statement", async () => {
    mocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse({}));

    await cancelStatement("statement-1");

    expect(mocks.getHeaders).toHaveBeenCalledOnce();
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "https://example.databricks.com/api/2.0/sql/statements/statement-1/cancel",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer obo-context" }),
      }),
      30_000,
    );
  });
});
