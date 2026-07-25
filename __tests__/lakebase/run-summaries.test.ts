/**
 * Tests for `listRunSummaries`.
 *
 * `listRunSummaries` is the lean view used by the `/runs` list page. The
 * critical contract is:
 *
 *   1. It MUST use Prisma's `select` (not pull all columns).
 *   2. The `select` MUST NOT include any of the heavy JSON columns
 *      (`businessContext`, `synthesisJson`, `schemaSnapshotJson`,
 *      `contextSourcesJson`, `filteredTablesJson`, `degradedStepsJson`,
 *      `generationOptions`). Their presence is what triggered the
 *      "Maximum call stack size exceeded" symptom on the RSC boundary.
 *   3. Visibility scoping (owner / shared / all) matches `listRuns`.
 *
 * The Prisma client is mocked so we can introspect the `findMany`
 * argument directly without a database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type FindManyArg = {
  where: Record<string, unknown>;
  select?: Record<string, true>;
  take?: number;
  skip?: number;
};

const findMany = vi.fn<(arg: FindManyArg) => Promise<unknown[]>>(async () => []);

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) => {
    const prisma = {
      forgeRun: { findMany },
    };
    return cb(prisma);
  },
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
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

// Columns the list UI is allowed to ask for.
const ALLOWED_SUMMARY_COLUMNS = new Set([
  "runId",
  "businessName",
  "ucMetadata",
  "status",
  "currentStep",
  "progressPct",
  "statusMessage",
  "ownerEmail",
  "createdBy",
  "createdAt",
  "completedAt",
]);

// Heavy columns that MUST NOT be selected by the summary query. These
// are the LLM-generated JSON blobs whose deeply nested structures
// caused V8's recursive `JSON.stringify` to overflow when 200 rows
// were shipped across the RSC boundary.
const FORBIDDEN_HEAVY_COLUMNS = [
  "businessContext",
  "synthesisJson",
  "schemaSnapshotJson",
  "contextSourcesJson",
  "filteredTablesJson",
  "degradedStepsJson",
  "generationOptions",
];

describe("listRunSummaries", () => {
  it("uses a Prisma select clause (not a full row fetch)", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries(50, 0);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    expect(arg.select).toBeDefined();
    expect(typeof arg.select).toBe("object");
  });

  it("does not select any heavy JSON columns", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries();

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    const selected = Object.keys(arg.select ?? {});
    for (const forbidden of FORBIDDEN_HEAVY_COLUMNS) {
      expect(
        selected,
        `summary select must not include heavy column "${forbidden}"`,
      ).not.toContain(forbidden);
    }
  });

  it("only selects columns the list UI actually renders", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries();

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    const selected = Object.keys(arg.select ?? {});
    for (const col of selected) {
      expect(
        ALLOWED_SUMMARY_COLUMNS.has(col),
        `unexpected column "${col}" in summary select`,
      ).toBe(true);
    }
  });

  it("applies the configured limit and offset", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries(25, 50);

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    expect(arg.take).toBe(25);
    expect(arg.skip).toBe(50);
  });

  it("scopes to the user's runs OR shared runs when viewMode is 'all'", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries(50, 0, "User@Example.com", "all", ["run-shared-1"]);

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    expect(arg.where).toEqual({
      OR: [
        { ownerEmail: "user@example.com" },
        { runId: { in: ["run-shared-1"] } },
      ],
    });
  });

  it("scopes to owned runs only when viewMode is 'owned'", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries(50, 0, "user@example.com", "owned", []);

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    expect(arg.where).toEqual({ ownerEmail: "user@example.com" });
  });

  it("scopes to shared runs only when viewMode is 'shared'", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries(50, 0, "user@example.com", "shared", ["a", "b"]);

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    expect(arg.where).toEqual({ runId: { in: ["a", "b"] } });
  });

  it("returns no `where` filter when no user email is provided", async () => {
    const { listRunSummaries } = await import("@/lib/lakebase/runs");

    await listRunSummaries();

    const arg = findMany.mock.calls[0]?.[0] as FindManyArg;
    expect(arg.where).toEqual({});
  });

  it("maps DB rows into the lean PipelineRunSummary shape", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const completed = new Date("2026-01-01T01:00:00Z");
    findMany.mockResolvedValueOnce([
      {
        runId: "r-1",
        businessName: "Acme",
        ucMetadata: "acme.gold",
        status: "completed",
        currentStep: null,
        progressPct: 100,
        statusMessage: "All done",
        ownerEmail: "user@example.com",
        createdBy: "user@example.com",
        createdAt: created,
        completedAt: completed,
      },
    ]);

    const { listRunSummaries } = await import("@/lib/lakebase/runs");
    const summaries = await listRunSummaries();

    expect(summaries).toEqual([
      {
        runId: "r-1",
        status: "completed",
        currentStep: null,
        progressPct: 100,
        statusMessage: "All done",
        ownerEmail: "user@example.com",
        createdBy: "user@example.com",
        createdAt: created.toISOString(),
        completedAt: completed.toISOString(),
        config: {
          businessName: "Acme",
          ucMetadata: "acme.gold",
        },
      },
    ]);
  });
});
