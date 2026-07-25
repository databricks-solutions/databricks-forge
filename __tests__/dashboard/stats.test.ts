/**
 * Tests for `getDashboardStats` and `listDashboardRunOptions`.
 *
 * The dashboard helper is the single source of truth for both the SSR landing
 * page (`app/page.tsx`) and the `/api/stats` route. The contract under test:
 *
 *   1. When `runId` is provided, every use-case-related query is narrowed to
 *      that run (via `runId` on the where clause OR via `run.runId` on the
 *      use-case scope).
 *   2. Cross-run queries (`recentRuns`, run status totals) stay global so the
 *      bottom-of-page "Recent Runs" section keeps working with any selection.
 *   3. When `runId` is provided but the caller has no read access (owner ∪
 *      shared), the helper returns `null` -- the API route then 404s.
 *   4. Run-scoped extras (`runStatus`, `runProgressPct`, `businessValueMid`)
 *      are populated from the gated row, not from cross-run aggregates.
 *
 * Prisma is mocked so we can introspect the `where` clauses directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type FindFirstArg = {
  where: Record<string, unknown>;
  select?: Record<string, unknown>;
};
type FindManyArg = {
  where: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  select?: Record<string, unknown>;
};
type GroupByArg = {
  by: string[];
  where: Record<string, unknown>;
  _count?: unknown;
  orderBy?: unknown;
};
type AggregateArg = {
  where: Record<string, unknown>;
  _sum?: Record<string, true>;
};

// Prisma mocks -- one per call site.
const findFirstRun = vi.fn<(arg: FindFirstArg) => Promise<unknown>>();
const findManyRun = vi.fn<(arg: FindManyArg) => Promise<unknown[]>>();
const groupByRun = vi.fn<(arg: GroupByArg) => Promise<unknown[]>>();
const groupByUseCase = vi.fn<(arg: GroupByArg) => Promise<unknown[]>>();
const findManyUseCase = vi.fn<(arg: FindManyArg) => Promise<unknown[]>>();
const findManyQuality = vi.fn<(arg: FindManyArg) => Promise<unknown[]>>();
const findManyBenchmark = vi.fn<(arg: FindManyArg) => Promise<unknown[]>>();
const aggregateValue = vi.fn<(arg: AggregateArg) => Promise<unknown>>();

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) => {
    const prisma = {
      forgeRun: {
        findFirst: findFirstRun,
        findMany: findManyRun,
        groupBy: groupByRun,
      },
      forgeUseCase: {
        groupBy: groupByUseCase,
        findMany: findManyUseCase,
      },
      forgeQualityMetric: {
        findMany: findManyQuality,
      },
      forgeBenchmarkRecord: {
        findMany: findManyBenchmark,
      },
      forgeValueEstimate: {
        aggregate: aggregateValue,
      },
    };
    return cb(prisma);
  },
}));

vi.mock("@/lib/benchmarks/config", () => ({
  isBenchmarksEnabled: () => false,
}));

vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  return {
    logger: { info: fn, warn: fn, debug: fn, error: fn },
    createScopedLogger: () => ({
      info: fn,
      warn: fn,
      debug: fn,
      error: fn,
      child: () => ({}),
      timed: fn,
      context: {},
    }),
    apiLogger: () => ({}),
  };
});

beforeEach(() => {
  findFirstRun.mockReset();
  findManyRun.mockReset();
  groupByRun.mockReset();
  groupByUseCase.mockReset();
  findManyUseCase.mockReset();
  findManyQuality.mockReset();
  findManyBenchmark.mockReset();
  aggregateValue.mockReset();

  // Default empty results -- individual tests override what they care about.
  findFirstRun.mockResolvedValue({
    runId: "r-1",
    status: "completed",
    progressPct: 100,
  });
  findManyRun.mockResolvedValue([]);
  groupByRun.mockResolvedValue([]);
  groupByUseCase.mockResolvedValue([]);
  findManyUseCase.mockResolvedValue([]);
  findManyQuality.mockResolvedValue([]);
  findManyBenchmark.mockResolvedValue([]);
  aggregateValue.mockResolvedValue({ _sum: { valueMid: null } });
});

describe("getDashboardStats", () => {
  it("returns null when runId is provided but the caller has no read access", async () => {
    findFirstRun.mockResolvedValueOnce(null);

    const { getDashboardStats } = await import("@/lib/dashboard/stats");
    const result = await getDashboardStats({
      userEmail: "user@example.com",
      sharedRunIds: [],
      runId: "missing-run",
    });

    expect(result).toBeNull();
    // The downstream queries must NOT run when access is denied.
    expect(groupByUseCase).not.toHaveBeenCalled();
    expect(aggregateValue).not.toHaveBeenCalled();
  });

  it("scopes use-case queries to the runId when provided", async () => {
    groupByUseCase.mockResolvedValueOnce([
      { type: "AI", _count: { _all: 3 } },
      { type: "Statistical", _count: { _all: 2 } },
    ]);
    groupByUseCase.mockResolvedValueOnce([
      { domain: "Sales", _count: { _all: 5 } },
    ]);
    findManyUseCase.mockResolvedValueOnce([
      { overallScore: 0.75 },
      { overallScore: 0.85 },
    ]);
    aggregateValue.mockResolvedValueOnce({ _sum: { valueMid: 12345 } });

    const { getDashboardStats } = await import("@/lib/dashboard/stats");
    const result = await getDashboardStats({
      userEmail: "user@example.com",
      sharedRunIds: ["shared-1"],
      runId: "r-1",
    });

    expect(result).not.toBeNull();
    // `groupBy(forgeUseCase, by: type)` -- where MUST nest the runId on `run`.
    const typeGroupArg = groupByUseCase.mock.calls[0]?.[0];
    expect(typeGroupArg?.where).toEqual({
      run: {
        runId: "r-1",
        OR: [
          { ownerEmail: "user@example.com" },
          { runId: { in: ["shared-1"] } },
        ],
      },
    });
    // Aggregate on value estimates is keyed strictly by runId.
    expect(aggregateValue).toHaveBeenCalledWith({
      where: { runId: "r-1" },
      _sum: { valueMid: true },
    });
    expect(result!.scopedRunId).toBe("r-1");
    expect(result!.runStatus).toBe("completed");
    expect(result!.runProgressPct).toBe(100);
    expect(result!.businessValueMid).toBe(12345);
    // Types and domains carry through correctly.
    expect(result!.aiCount).toBe(3);
    expect(result!.statisticalCount).toBe(2);
    expect(result!.totalUseCases).toBe(5);
    expect(result!.avgScore).toBe(80); // round(((.75 + .85) / 2) * 100)
  });

  it("falls back to global use-case visibility when no runId is provided", async () => {
    const { getDashboardStats } = await import("@/lib/dashboard/stats");
    await getDashboardStats({
      userEmail: "user@example.com",
      sharedRunIds: ["shared-1"],
    });

    const typeGroupArg = groupByUseCase.mock.calls[0]?.[0];
    expect(typeGroupArg?.where).toEqual({
      run: {
        OR: [
          { ownerEmail: "user@example.com" },
          { runId: { in: ["shared-1"] } },
        ],
      },
    });
    expect(aggregateValue).not.toHaveBeenCalled();
  });

  it("keeps the recentRuns query global regardless of runId scoping", async () => {
    // Both modes -- with and without runId -- should query the same global
    // visibility for recentRuns. The "scope to a single run" only affects the
    // use-case-related fields and the `runStatus`/`businessValueMid` extras.
    findFirstRun.mockResolvedValueOnce({
      runId: "r-1",
      status: "running",
      progressPct: 60,
    });

    const { getDashboardStats } = await import("@/lib/dashboard/stats");
    await getDashboardStats({
      userEmail: "user@example.com",
      sharedRunIds: ["shared-1"],
      runId: "r-1",
    });

    const recentRunsArg = findManyRun.mock.calls[0]?.[0];
    expect(recentRunsArg?.where).toEqual({
      OR: [
        { ownerEmail: "user@example.com" },
        { runId: { in: ["shared-1"] } },
      ],
    });
    expect(recentRunsArg?.take).toBe(5);
  });

  it("populates run status and progress from the scoped row, not aggregates", async () => {
    findFirstRun.mockResolvedValueOnce({
      runId: "r-1",
      status: "running",
      progressPct: 42,
    });

    const { getDashboardStats } = await import("@/lib/dashboard/stats");
    const result = await getDashboardStats({
      userEmail: "user@example.com",
      sharedRunIds: [],
      runId: "r-1",
    });

    expect(result!.runStatus).toBe("running");
    expect(result!.runProgressPct).toBe(42);
  });

  it("returns null businessValueMid when the run has no value estimates yet", async () => {
    aggregateValue.mockResolvedValueOnce({ _sum: { valueMid: null } });

    const { getDashboardStats } = await import("@/lib/dashboard/stats");
    const result = await getDashboardStats({
      userEmail: "user@example.com",
      sharedRunIds: [],
      runId: "r-1",
    });

    expect(result!.businessValueMid).toBeNull();
  });
});

describe("listDashboardRunOptions", () => {
  it("orders runs newest-first and applies the configured limit", async () => {
    const created = new Date("2026-05-22T12:00:00Z");
    findManyRun.mockResolvedValueOnce([
      {
        runId: "r-1",
        businessName: "Acme",
        status: "completed",
        createdAt: created,
      },
    ]);

    const { listDashboardRunOptions } = await import("@/lib/dashboard/stats");
    const opts = await listDashboardRunOptions(
      "user@example.com",
      ["shared-1"],
      10,
    );

    const findManyArg = findManyRun.mock.calls[0]?.[0];
    expect(findManyArg?.where).toEqual({
      OR: [
        { ownerEmail: "user@example.com" },
        { runId: { in: ["shared-1"] } },
      ],
    });
    expect(findManyArg?.orderBy).toEqual({ createdAt: "desc" });
    expect(findManyArg?.take).toBe(10);
    expect(opts).toEqual([
      {
        runId: "r-1",
        businessName: "Acme",
        status: "completed",
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("only selects the lean columns needed for the dropdown", async () => {
    const { listDashboardRunOptions } = await import("@/lib/dashboard/stats");
    await listDashboardRunOptions("user@example.com", []);

    const findManyArg = findManyRun.mock.calls[0]?.[0];
    expect(findManyArg?.select).toEqual({
      runId: true,
      businessName: true,
      status: true,
      createdAt: true,
    });
    // None of the heavy LLM JSON columns end up in the dropdown query.
    const selectKeys = Object.keys(findManyArg?.select ?? {});
    for (const heavy of [
      "businessContext",
      "synthesisJson",
      "schemaSnapshotJson",
      "filteredTablesJson",
      "stepLog",
    ]) {
      expect(selectKeys).not.toContain(heavy);
    }
  });
});
