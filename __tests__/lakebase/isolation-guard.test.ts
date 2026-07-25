/**
 * Tests for the isolation guard's auto-backfill behaviour.
 *
 * Before this change the guard threw a hard error whenever any root table
 * had a row with NULL `owner_email`. That meant any orphan row left over
 * from a pre-isolation deploy would block every subsequent startup. The
 * new behaviour auto-backfills with a sentinel email so the app can boot
 * and the orphan event is logged for admin follow-up.
 *
 * These tests mock the Prisma wrapper so the relevant per-table count /
 * updateMany interactions can be driven deterministically without a real
 * database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type NullCountMap = Record<string, number>;

let nullCounts: NullCountMap = {};
let backfillCalls: Array<{ table: string; owner: string }> = [];

function makeTableStub(label: string) {
  return {
    count: vi.fn(async () => nullCounts[label] ?? 0),
    updateMany: vi.fn(async ({ data }: { data: { ownerEmail: string } }) => {
      const before = nullCounts[label] ?? 0;
      backfillCalls.push({ table: label, owner: data.ownerEmail });
      nullCounts[label] = 0;
      return { count: before };
    }),
  };
}

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) => {
    const prisma = {
      forgeRun: makeTableStub("ForgeRun"),
      forgeEnvironmentScan: makeTableStub("ForgeEnvironmentScan"),
      forgeGenieSpace: makeTableStub("ForgeGenieSpace"),
      forgeMetadataGenieSpace: makeTableStub("ForgeMetadataGenieSpace"),
      forgeSpaceBenchmarkRun: makeTableStub("ForgeSpaceBenchmarkRun"),
      forgeSpaceHealthScore: makeTableStub("ForgeSpaceHealthScore"),
      forgeDemoSession: makeTableStub("ForgeDemoSession"),
      forgeCommentJob: makeTableStub("ForgeCommentJob"),
      forgeConnection: makeTableStub("ForgeConnection"),
      forgeFabricScan: makeTableStub("ForgeFabricScan"),
      forgeFabricMigration: makeTableStub("ForgeFabricMigration"),
      forgeStrategyDocument: makeTableStub("ForgeStrategyDocument"),
      forgeDocument: makeTableStub("ForgeDocument"),
    };
    return cb(prisma);
  },
}));

vi.mock("@/lib/config/isolation-flag", () => ({
  isUserIsolationEnabled: () => true,
}));

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

beforeEach(() => {
  nullCounts = {};
  backfillCalls = [];
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
  delete process.env.FORGE_ORPHAN_OWNER_EMAIL;
});

describe("assertOwnerEmailIntegrity", () => {
  it("returns cleanly when all tables have ownerEmail populated", async () => {
    const { assertOwnerEmailIntegrity } = await import(
      "@/lib/lakebase/isolation-guard"
    );

    await expect(assertOwnerEmailIntegrity()).resolves.toBeUndefined();

    expect(loggerMock.info).toHaveBeenCalledWith(
      "[isolation-guard] All root tables have ownerEmail populated.",
    );
    expect(backfillCalls).toHaveLength(0);
  });

  it("auto-backfills orphans with the default sentinel and does not throw", async () => {
    nullCounts.ForgeCommentJob = 1;

    const { assertOwnerEmailIntegrity } = await import(
      "@/lib/lakebase/isolation-guard"
    );

    await expect(assertOwnerEmailIntegrity()).resolves.toBeUndefined();

    expect(backfillCalls).toEqual([
      { table: "ForgeCommentJob", owner: "orphan@forge.local" },
    ]);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const warning = loggerMock.warn.mock.calls[0]?.[0] as string;
    expect(warning).toContain("Auto-backfilled NULL owner_email orphans");
    expect(warning).toContain("orphan@forge.local");
    expect(warning).toContain("ForgeCommentJob: 1 rows");
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("honors FORGE_ORPHAN_OWNER_EMAIL override", async () => {
    process.env.FORGE_ORPHAN_OWNER_EMAIL = "Forge-Admin@example.com";
    nullCounts.ForgeRun = 2;
    nullCounts.ForgeCommentJob = 3;

    const { assertOwnerEmailIntegrity } = await import(
      "@/lib/lakebase/isolation-guard"
    );

    await expect(assertOwnerEmailIntegrity()).resolves.toBeUndefined();

    // Override is normalized to lower-case and applied to every orphan
    // table -- avoiding a NULL row in any of them.
    const owners = new Set(backfillCalls.map((c) => c.owner));
    expect(owners).toEqual(new Set(["forge-admin@example.com"]));
    expect(backfillCalls.find((c) => c.table === "ForgeRun")).toBeTruthy();
    expect(backfillCalls.find((c) => c.table === "ForgeCommentJob")).toBeTruthy();
  });

  it("backfills across multiple tables in a single pass", async () => {
    nullCounts.ForgeRun = 4;
    nullCounts.ForgeCommentJob = 1;
    nullCounts.ForgeEnvironmentScan = 2;

    const { assertOwnerEmailIntegrity } = await import(
      "@/lib/lakebase/isolation-guard"
    );

    await expect(assertOwnerEmailIntegrity()).resolves.toBeUndefined();

    expect(backfillCalls.map((c) => c.table).sort()).toEqual([
      "ForgeCommentJob",
      "ForgeEnvironmentScan",
      "ForgeRun",
    ]);
    // Every backfill received the same sentinel.
    expect(new Set(backfillCalls.map((c) => c.owner))).toEqual(
      new Set(["orphan@forge.local"]),
    );
  });
});
