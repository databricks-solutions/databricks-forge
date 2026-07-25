import { beforeEach, describe, expect, it, vi } from "vitest";

type UseCaseRow = { id: string; runId: string; sqlCode: string | null; sqlStatus: string | null };

const store = new Map<string, UseCaseRow>();

const prismaMock = {
  forgeUseCase: {
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<UseCaseRow> }) => {
        const existing = store.get(where.id);
        if (!existing) throw new Error(`row not found: ${where.id}`);
        const updated = { ...existing, ...data };
        store.set(where.id, updated);
        return updated;
      },
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { runId: string };
        data: Partial<UseCaseRow>;
      }) => {
        let count = 0;
        for (const [id, row] of store) {
          if (row.runId === where.runId) {
            store.set(id, { ...row, ...data });
            count += 1;
          }
        }
        return { count };
      },
    ),
    groupBy: vi.fn(
      async ({
        where,
      }: {
        by: ["sqlStatus"];
        where: { runId: string };
        _count: { _all: true };
      }) => {
        const buckets = new Map<string | null, number>();
        for (const row of store.values()) {
          if (row.runId === where.runId) {
            buckets.set(row.sqlStatus, (buckets.get(row.sqlStatus) ?? 0) + 1);
          }
        }
        return Array.from(buckets.entries()).map(([sqlStatus, n]) => ({
          sqlStatus,
          _count: { _all: n },
        }));
      },
    ),
  },
};

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(fn: (p: typeof prismaMock) => Promise<T>) => fn(prismaMock),
}));

import {
  updateUseCaseSql,
  markUseCasesSqlPending,
  getSqlStatusCounts,
} from "@/lib/lakebase/usecases";

function seed(runId: string, ids: string[]) {
  store.clear();
  for (const id of ids) {
    store.set(id, { id, runId, sqlCode: null, sqlStatus: null });
  }
}

describe("usecases SQL status helpers", () => {
  beforeEach(() => {
    prismaMock.forgeUseCase.update.mockClear();
    prismaMock.forgeUseCase.updateMany.mockClear();
    prismaMock.forgeUseCase.groupBy.mockClear();
  });

  it("markUseCasesSqlPending flips every row for the run to pending and clears sqlCode", async () => {
    seed("run-1", ["uc-a", "uc-b", "uc-c"]);
    store.set("uc-a", { id: "uc-a", runId: "run-1", sqlCode: "stale", sqlStatus: "generated" });

    await markUseCasesSqlPending("run-1");

    for (const id of ["uc-a", "uc-b", "uc-c"]) {
      expect(store.get(id)).toMatchObject({ sqlStatus: "pending", sqlCode: null });
    }
    expect(prismaMock.forgeUseCase.updateMany).toHaveBeenCalledOnce();
  });

  it("updateUseCaseSql writes per-row sqlCode + sqlStatus transitions", async () => {
    seed("run-1", ["uc-a"]);

    await updateUseCaseSql("uc-a", null, "generating");
    expect(store.get("uc-a")).toMatchObject({ sqlCode: null, sqlStatus: "generating" });

    await updateUseCaseSql("uc-a", "SELECT 1", "generated");
    expect(store.get("uc-a")).toMatchObject({ sqlCode: "SELECT 1", sqlStatus: "generated" });

    await updateUseCaseSql("uc-a", null, "failed");
    expect(store.get("uc-a")).toMatchObject({ sqlCode: null, sqlStatus: "failed" });
  });

  it("getSqlStatusCounts aggregates the four status buckets and the total", async () => {
    seed("run-2", ["a", "b", "c", "d", "e", "f"]);
    store.set("a", { id: "a", runId: "run-2", sqlCode: null, sqlStatus: "pending" });
    store.set("b", { id: "b", runId: "run-2", sqlCode: null, sqlStatus: "generating" });
    store.set("c", { id: "c", runId: "run-2", sqlCode: "SELECT *", sqlStatus: "generated" });
    store.set("d", { id: "d", runId: "run-2", sqlCode: "SELECT *", sqlStatus: "generated" });
    store.set("e", { id: "e", runId: "run-2", sqlCode: null, sqlStatus: "failed" });
    // f is left with sqlStatus null to mirror a legacy use case.
    store.set("f", { id: "f", runId: "run-2", sqlCode: null, sqlStatus: null });

    const counts = await getSqlStatusCounts("run-2");
    expect(counts).toEqual({
      pending: 1,
      generating: 1,
      generated: 2,
      failed: 1,
      total: 6,
    });
  });

  it("getSqlStatusCounts returns zeros for an unknown run", async () => {
    seed("run-3", []);
    const counts = await getSqlStatusCounts("run-does-not-exist");
    expect(counts).toEqual({
      pending: 0,
      generating: 0,
      generated: 0,
      failed: 0,
      total: 0,
    });
  });

  it("end-to-end round trip: mark pending → per-row updates → counts reflect terminal state", async () => {
    seed("run-rt", ["uc-1", "uc-2", "uc-3"]);

    await markUseCasesSqlPending("run-rt");
    let counts = await getSqlStatusCounts("run-rt");
    expect(counts).toEqual({ pending: 3, generating: 0, generated: 0, failed: 0, total: 3 });

    await updateUseCaseSql("uc-1", null, "generating");
    counts = await getSqlStatusCounts("run-rt");
    expect(counts).toEqual({ pending: 2, generating: 1, generated: 0, failed: 0, total: 3 });

    await updateUseCaseSql("uc-1", "SELECT 1", "generated");
    await updateUseCaseSql("uc-2", "SELECT 2", "generated");
    await updateUseCaseSql("uc-3", null, "failed");

    counts = await getSqlStatusCounts("run-rt");
    expect(counts).toEqual({ pending: 0, generating: 0, generated: 2, failed: 1, total: 3 });
  });
});
