import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ColumnRankingCache,
  rankColumnsViaLLM,
  type LLMColumnRankingInput,
} from "@/lib/toolkit/column-ranker";
import type { Logger } from "@/lib/ports/logger";

// Silent logger for the tests.
const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Mock the agent module so we never hit Databricks Model Serving.
vi.mock("@/lib/ai/agent", () => ({
  executeAIQuery: vi.fn(),
}));

import { executeAIQuery } from "@/lib/ai/agent";

const mockExecute = executeAIQuery as unknown as ReturnType<typeof vi.fn>;

function makeInput(fqn: string, keepCount: number, colCount = 5): LLMColumnRankingInput {
  return {
    fqn,
    tableComment: null,
    columns: Array.from({ length: colCount }, (_, i) => ({
      name: `c${i}`,
      dataType: "STRING",
      comment: null,
    })),
    keepCount,
  };
}

describe("ColumnRankingCache", () => {
  it("returns undefined for a miss and increments miss counter", () => {
    const cache = new ColumnRankingCache();
    expect(cache.get("cat.s.t", 10)).toBeUndefined();
    expect(cache.stats()).toEqual({ hits: 0, misses: 1, size: 0 });
  });

  it("stores and retrieves values keyed by (fqn, keepCount)", () => {
    const cache = new ColumnRankingCache();
    cache.set("cat.s.t", 10, ["a", "b"]);
    expect(cache.get("cat.s.t", 10)).toEqual(["a", "b"]);
    // Different keepCount -> different key -> miss.
    expect(cache.get("cat.s.t", 11)).toBeUndefined();
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });
});

describe("rankColumnsViaLLM", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("no LLM call when input is empty", async () => {
    const result = await rankColumnsViaLLM([], "ctx", "ep", silentLog);
    expect(result.callMade).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("no LLM call when every table is cached (run-scoped cache)", async () => {
    const cache = new ColumnRankingCache();
    cache.set("cat.s.t", 3, ["c0", "c1", "c2"]);

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.t", 3)],
      "ctx",
      "ep",
      silentLog,
      cache,
    );
    expect(result.callMade).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.llmTables.has("cat.s.t")).toBe(true);
    expect(result.rankings.get("cat.s.t")).toEqual(["c0", "c1", "c2"]);
  });

  it("only sends uncached tables to the LLM", async () => {
    const cache = new ColumnRankingCache();
    cache.set("cat.s.cached", 3, ["c0", "c1", "c2"]);

    mockExecute.mockResolvedValueOnce({
      rawResponse: JSON.stringify({
        rankings: { "cat.s.fresh": ["c0", "c1"] },
      }),
      durationMs: 10,
    });

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.cached", 3), makeInput("cat.s.fresh", 2)],
      "ctx",
      "ep",
      silentLog,
      cache,
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0] as { variables: Record<string, string> };
    // The outgoing tables_json should only mention the fresh table.
    expect(call.variables.tables_json).toContain("cat.s.fresh");
    expect(call.variables.tables_json).not.toContain("cat.s.cached");

    expect(result.callMade).toBe(true);
    expect(result.llmTables.has("cat.s.cached")).toBe(true);
    expect(result.llmTables.has("cat.s.fresh")).toBe(true);
    expect(result.rankings.get("cat.s.fresh")).toEqual(["c0", "c1"]);
  });

  it("matches LLM response keys with backticks / different casing (C3)", async () => {
    mockExecute.mockResolvedValueOnce({
      rawResponse: JSON.stringify({
        rankings: { "`Cat`.`S`.`T`": ["c0", "c1"] },
      }),
      durationMs: 5,
    });

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.t", 2)],
      "ctx",
      "ep",
      silentLog,
    );

    expect(result.callMade).toBe(true);
    expect(result.llmTables.has("cat.s.t")).toBe(true);
    expect(result.rankings.get("cat.s.t")).toEqual(["c0", "c1"]);
  });

  it("buckets tables the LLM skipped into heuristicTables (B2)", async () => {
    mockExecute.mockResolvedValueOnce({
      rawResponse: JSON.stringify({
        rankings: { "cat.s.covered": ["c0", "c1"] },
      }),
      durationMs: 5,
    });

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.covered", 2), makeInput("cat.s.missed", 2)],
      "ctx",
      "ep",
      silentLog,
    );

    expect(result.llmTables.has("cat.s.covered")).toBe(true);
    expect(result.heuristicTables.has("cat.s.missed")).toBe(true);
    expect(result.rankings.has("cat.s.missed")).toBe(false);
  });

  it("falls back to heuristic for every requested table when the LLM response shape is wrong", async () => {
    mockExecute.mockResolvedValueOnce({
      rawResponse: JSON.stringify({ notRankings: {} }),
      durationMs: 5,
    });

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.a", 2), makeInput("cat.s.b", 2)],
      "ctx",
      "ep",
      silentLog,
    );
    expect(result.callMade).toBe(true);
    expect(result.heuristicTables.size).toBe(2);
    expect(result.llmTables.size).toBe(0);
  });

  it("falls back to heuristic for every requested table when the LLM call throws", async () => {
    mockExecute.mockRejectedValueOnce(new Error("boom"));

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.a", 2)],
      "ctx",
      "ep",
      silentLog,
    );
    expect(result.callMade).toBe(true);
    expect(result.heuristicTables.has("cat.s.a")).toBe(true);
  });

  it("skips malformed per-table entries (non-string cols) and reports them as heuristic", async () => {
    mockExecute.mockResolvedValueOnce({
      rawResponse: JSON.stringify({
        rankings: {
          "cat.s.good": ["c0"],
          "cat.s.bad": ["c0", 42],
        },
      }),
      durationMs: 5,
    });

    const result = await rankColumnsViaLLM(
      [makeInput("cat.s.good", 1), makeInput("cat.s.bad", 2)],
      "ctx",
      "ep",
      silentLog,
    );
    expect(result.llmTables.has("cat.s.good")).toBe(true);
    expect(result.heuristicTables.has("cat.s.bad")).toBe(true);
    expect(result.rankings.has("cat.s.bad")).toBe(false);
  });

  it("populates cache for successful LLM responses", async () => {
    const cache = new ColumnRankingCache();
    mockExecute.mockResolvedValueOnce({
      rawResponse: JSON.stringify({
        rankings: { "cat.s.t": ["c0", "c1"] },
      }),
      durationMs: 5,
    });

    await rankColumnsViaLLM([makeInput("cat.s.t", 2)], "ctx", "ep", silentLog, cache);

    // A second invocation with the same input should now hit the cache.
    const second = await rankColumnsViaLLM(
      [makeInput("cat.s.t", 2)],
      "ctx",
      "ep",
      silentLog,
      cache,
    );
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(second.callMade).toBe(false);
    expect(second.rankings.get("cat.s.t")).toEqual(["c0", "c1"]);
  });
});
