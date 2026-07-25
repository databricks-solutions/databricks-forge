import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 4 invariant: program roll-ups (relationships, overrides) only ever read
 * from COMPLETED member scans. In-progress / failed checkpoints are excluded.
 */

const mocks = vi.hoisted(() => ({
  scanFindMany: vi.fn(),
  lineageFindMany: vi.fn(),
  detailFindMany: vi.fn(),
  insightFindMany: vi.fn(),
  overrideFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (p: unknown) => Promise<T>) =>
    cb({
      forgeEnvironmentScan: { findMany: mocks.scanFindMany },
      forgeTableLineage: { findMany: mocks.lineageFindMany },
      forgeTableDetail: { findMany: mocks.detailFindMany },
      forgeTableInsight: { findMany: mocks.insightFindMany },
      forgeDomainOverride: { findMany: mocks.overrideFindMany },
    }),
}));

import { getProgramRelationshipInputs } from "@/lib/lakebase/environment-scans";
import { listProgramDomainOverrides } from "@/lib/lakebase/domain-overrides";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProgramRelationshipInputs", () => {
  it("scopes member scans to scanStatus=complete", async () => {
    mocks.scanFindMany.mockResolvedValue([
      { scanId: "s1", createdAt: new Date("2026-01-01") },
    ]);
    mocks.lineageFindMany.mockResolvedValue([]);
    mocks.detailFindMany.mockResolvedValue([]);
    mocks.insightFindMany.mockResolvedValue([]);

    await getProgramRelationshipInputs("p1");

    expect(mocks.scanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { programId: "p1", scanStatus: "complete" } }),
    );
  });

  it("returns identical latest domains/entities when DB row order reverses", async () => {
    mocks.scanFindMany.mockResolvedValue([
      { scanId: "s-old", createdAt: new Date("2026-01-01") },
      { scanId: "s-new", createdAt: new Date("2026-02-01") },
    ]);
    mocks.lineageFindMany.mockResolvedValue([]);
    const details = [
      {
        id: "d-old",
        scanId: "s-old",
        tableFqn: "c.s.orders",
        dataDomain: "Old",
      },
      {
        id: "d-new",
        scanId: "s-new",
        tableFqn: "c.s.orders",
        dataDomain: "Revenue",
      },
    ];
    const entities = [
      {
        id: "e-old",
        scanId: "s-old",
        payloadJson: JSON.stringify({ name: "Order", tables: ["c.s.stale"] }),
      },
      {
        id: "e-new",
        scanId: "s-new",
        payloadJson: JSON.stringify({ name: "Order", tables: ["c.s.orders"] }),
      },
    ];
    mocks.detailFindMany.mockResolvedValueOnce(details).mockResolvedValueOnce([...details].reverse());
    mocks.insightFindMany
      .mockResolvedValueOnce(entities)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([...entities].reverse())
      .mockResolvedValueOnce([]);

    const forward = await getProgramRelationshipInputs("p1");
    const reversed = await getProgramRelationshipInputs("p1");

    expect(reversed).toEqual(forward);
    expect(forward.details).toEqual([{ tableFqn: "c.s.orders", dataDomain: "Revenue" }]);
    expect(forward.canonicalEntities).toEqual([
      {
        payloadJson: JSON.stringify({ name: "Order", tables: ["c.s.orders"] }),
      },
    ]);
  });

  it("short-circuits with empty inputs when no completed scans exist", async () => {
    mocks.scanFindMany.mockResolvedValue([]);
    const out = await getProgramRelationshipInputs("p1");
    expect(out).toEqual({ lineage: [], details: [], canonicalEntities: [], entityRelationships: [] });
    expect(mocks.lineageFindMany).not.toHaveBeenCalled();
  });
});

describe("listProgramDomainOverrides", () => {
  it("only reads overrides from completed member scans", async () => {
    mocks.scanFindMany.mockResolvedValue([
      { scanId: "s1", createdAt: new Date("2026-01-01") },
      { scanId: "s2", createdAt: new Date("2026-02-01") },
    ]);
    mocks.overrideFindMany.mockResolvedValue([
      {
        id: "o1",
        scope: "table",
        target: "c.s.t",
        action: "remap",
        newDomain: "X",
        newSubdomain: null,
        createdByEmail: "u@x.com",
        createdAt: new Date("2026-02-02"),
        scanId: "s2",
      },
    ]);

    const out = await listProgramDomainOverrides("p1");

    expect(mocks.scanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { programId: "p1", scanStatus: "complete" } }),
    );
    // scanRank reflects the owning scan's recency (later scan → higher rank).
    expect(out[0].scanId).toBe("s2");
    expect(out[0].scanRank).toBe(new Date("2026-02-01").getTime());
  });

  it("returns empty when the program has no completed scans", async () => {
    mocks.scanFindMany.mockResolvedValue([]);
    const out = await listProgramDomainOverrides("p1");
    expect(out).toEqual([]);
    expect(mocks.overrideFindMany).not.toHaveBeenCalled();
  });
});
