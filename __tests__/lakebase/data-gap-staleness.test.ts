/**
 * Tests for `isDataGapCacheStale`, the freshness gate the Data Gap GET
 * handler runs before serving a cached `ForgeDataGapAnalysis` row.
 *
 * Two stale signals, plus the fresh-cache happy path:
 *
 *   (1) Pre-P3.3 schema       -- `resolvedSourceSystems` absent from coverage
 *   (2) Rerun-BV              -- newest estimate timestamp > cache timestamp
 *   (happy) Fresh cache       -- modern schema, no newer estimates (incl. $0)
 *
 * Prisma is mocked because the helper does one `forgeValueEstimate.aggregate`
 * roundtrip; the schema-drift check is pure and short-circuits before any DB
 * call.
 *
 * NOTE: an earlier version of the helper also flagged
 * `valueAtRiskMid === 0 && estimateCount > 0` as stale. That was removed
 * because `$0 mid` is a legitimate steady-state outcome (every reference
 * asset covered) and the clause caused every poll on such a run to
 * recompute. Freshness is captured by the timestamp comparison alone.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CachedDataGap } from "@/lib/lakebase/data-gap-analyses";

// Prisma mock — `forgeValueEstimate.aggregate` for BV signals and
// `forgeUseCase.findFirst` for the reference-link backfill signal.
const aggregate = vi.fn<
  (arg: unknown) => Promise<{
    _count: { _all: number };
    _max: { generatedAt: Date | null };
  }>
>(async () => ({ _count: { _all: 0 }, _max: { generatedAt: null } }));

const findFirstUseCase = vi.fn<
  (arg: unknown) => Promise<{ referenceUseCaseResolvedAt: Date | null } | null>
>(async () => null);

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) => {
    const prisma = {
      forgeValueEstimate: { aggregate },
      forgeUseCase: { findFirst: findFirstUseCase },
    };
    return cb(prisma);
  },
}));

// Import AFTER the mock so the helper picks up our stub.
import { isDataGapCacheStale } from "@/lib/lakebase/data-gap-analyses";

const RUN_ID = "11111111-2222-3333-4444-555555555555";

/**
 * Build a coverage entry. By default it has the modern P3.3 schema
 * (`resolvedSourceSystems` is an array, possibly empty). Pass `missingResolved:
 * true` to simulate a pre-P3.3 persisted row.
 */
function coverageEntry(opts?: { missingResolved?: boolean }) {
  const base = {
    assetId: "asset-1",
    assetName: "Orders",
    assetFamily: "Sales",
    systemLocation: "Salesforce",
    present: false,
    matchedTables: [] as string[],
    mcUseCaseCount: 1,
    vaUseCaseCount: 0,
    mcUseCaseNames: ["Pipeline Forecast"],
    recommendations: [],
  };
  if (opts?.missingResolved) {
    // Intentionally omit `resolvedSourceSystems` to simulate the pre-P3.3
    // persisted JSON shape.
    return base as unknown as CachedDataGap["result"]["coverage"][number];
  }
  return {
    ...base,
    resolvedSourceSystems: [],
  } as unknown as CachedDataGap["result"]["coverage"][number];
}

function buildCachedResult(opts: {
  valueAtRiskMid: number;
  missingResolved?: boolean;
}): CachedDataGap["result"] {
  return {
    industryId: "financial-services",
    industryName: "Financial Services",
    generatedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    summary: {
      industryId: "financial-services",
      industryName: "Financial Services",
      totalAssets: 10,
      presentAssets: 6,
      missingAssets: 4,
      mcCovered: 3,
      mcMissing: 2,
      vaCovered: 5,
      vaMissing: 1,
      mcCoveragePct: 0.6,
      valueAtRiskLow: opts.valueAtRiskMid * 0.5,
      valueAtRiskMid: opts.valueAtRiskMid,
      valueAtRiskHigh: opts.valueAtRiskMid * 1.5,
    },
    coverage: [coverageEntry({ missingResolved: opts.missingResolved })],
    valueAtRisk: [],
  };
}

describe("isDataGapCacheStale", () => {
  beforeEach(() => {
    aggregate.mockClear();
    aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { generatedAt: null } });
    findFirstUseCase.mockClear();
    findFirstUseCase.mockResolvedValue(null);
  });

  it("flags pre-P3.3 schema as stale (missing resolvedSourceSystems) without hitting DB", async () => {
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 1_000_000, missingResolved: true }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/resolvedSourceSystems/);
    // Schema check short-circuits — no DB call expected.
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("returns fresh on $0 + estimates exist when estimates predate the cache (poll-storm regression)", async () => {
    // Earlier behaviour invalidated the cache on `valueAtRiskMid === 0 &&
    // estimateCount > 0`, but $0 mid is a valid steady-state outcome (full
    // coverage). When BV estimates already existed at cache write time,
    // every subsequent poll recomputed forever. The current policy hinges
    // on freshness only: estimates older-or-equal to the cache are not a
    // stale signal regardless of the cached value.
    aggregate.mockResolvedValue({
      _count: { _all: 7 },
      _max: { generatedAt: new Date("2026-05-09T00:00:00Z") },
    });
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 0 }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("flags rerun-BV: newest generatedAt > cache createdAt", async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _max: { generatedAt: new Date("2026-05-20T00:00:00Z") },
    });
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 1_500_000 }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/BV estimate generated after cache/);
  });

  it("returns fresh when schema is modern, value is non-zero, and no newer estimates exist", async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _max: { generatedAt: new Date("2026-05-09T00:00:00Z") },
    });
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 2_000_000 }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("returns fresh when there are no BV estimates at all (run never ran BV)", async () => {
    aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { generatedAt: null } });
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 0 }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(false);
  });

  it("flags reference-link backfill: newest referenceUseCaseResolvedAt > cache createdAt", async () => {
    // Cache was written before the legacy run's reference link backfill
    // landed. Even though the cache looks fine (modern schema, non-zero
    // value, no newer BV estimates), the FK column is now populated and
    // attribution should rerun against it.
    findFirstUseCase.mockResolvedValue({
      referenceUseCaseResolvedAt: new Date("2026-05-21T00:00:00Z"),
    });
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 1_500_000 }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/reference link backfilled after cache/);
    // BV aggregate should not even be queried — backfill signal trumps it.
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("returns fresh when referenceUseCaseResolvedAt predates the cache", async () => {
    // Generation populated the FK column when the use case was first
    // written; the Data Gap cache wrote AFTER that. No reason to invalidate.
    findFirstUseCase.mockResolvedValue({
      referenceUseCaseResolvedAt: new Date("2026-05-05T00:00:00Z"),
    });
    aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { generatedAt: null } });
    const cached: CachedDataGap = {
      result: buildCachedResult({ valueAtRiskMid: 1_500_000 }),
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const result = await isDataGapCacheStale(cached, RUN_ID);
    expect(result.stale).toBe(false);
  });
});
