import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Lakebase persistence so the test stays in-memory and deterministic.
vi.mock("@/lib/lakebase/background-jobs", () => {
  return {
    upsertJobStatus: vi.fn(async () => undefined),
    getPersistedJobStatus: vi.fn(async () => null),
  };
});

import {
  startSqlJob,
  getSqlJobController,
  getSqlJobStatus,
  setSqlJobTotal,
  incrementSqlGenerated,
  incrementSqlFailed,
  updateSqlJob,
  completeSqlJob,
  failSqlJob,
  cancelSqlJob,
} from "@/lib/pipeline/sql-engine-status";

import { upsertJobStatus } from "@/lib/lakebase/background-jobs";

const mockedUpsert = upsertJobStatus as unknown as ReturnType<typeof vi.fn>;

describe("sql-engine-status lifecycle", () => {
  beforeEach(() => {
    mockedUpsert.mockClear();
  });

  afterEach(async () => {
    // Drain any leftover controllers between tests.
    await cancelSqlJob("run-A").catch(() => undefined);
    await cancelSqlJob("run-B").catch(() => undefined);
    await cancelSqlJob("run-C").catch(() => undefined);
    await cancelSqlJob("run-D").catch(() => undefined);
  });

  it("start → update → complete persists terminal transitions and bumps percent to 100", async () => {
    await startSqlJob("run-A");

    expect(mockedUpsert).toHaveBeenCalledWith(
      "run-A",
      "sql",
      "generating",
      expect.any(String),
      0,
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );

    setSqlJobTotal("run-A", 5);
    updateSqlJob("run-A", "Processing wave 1", 25);
    incrementSqlGenerated("run-A");
    incrementSqlGenerated("run-A");
    incrementSqlFailed("run-A");

    const midStatus = await getSqlJobStatus("run-A");
    expect(midStatus).not.toBeNull();
    expect(midStatus?.status).toBe("generating");
    expect(midStatus?.percent).toBe(25);
    expect(midStatus?.total).toBe(5);
    expect(midStatus?.generated).toBe(2);
    expect(midStatus?.failed).toBe(1);
    expect(midStatus?.message).toBe("Processing wave 1");

    await completeSqlJob("run-A", 4, 1);

    const finalStatus = await getSqlJobStatus("run-A");
    expect(finalStatus?.status).toBe("completed");
    expect(finalStatus?.percent).toBe(100);
    expect(finalStatus?.generated).toBe(4);
    expect(finalStatus?.failed).toBe(1);
    expect(finalStatus?.completedAt).not.toBeNull();
    expect(finalStatus?.message).toMatch(/complete/i);

    // After completion the controller is cleared so a fresh job can take over.
    expect(getSqlJobController("run-A")).toBeNull();

    const completeCall = mockedUpsert.mock.calls.find((call) => call[2] === "completed");
    expect(completeCall).toBeDefined();
    expect(completeCall?.[3]).toMatch(/complete/i);
    expect(completeCall?.[4]).toBe(100);
  });

  it("failSqlJob records the error and clears the controller", async () => {
    await startSqlJob("run-B");
    expect(getSqlJobController("run-B")).not.toBeNull();

    await failSqlJob("run-B", "model serving 503");

    const status = await getSqlJobStatus("run-B");
    expect(status?.status).toBe("failed");
    expect(status?.error).toBe("model serving 503");
    expect(status?.completedAt).not.toBeNull();
    expect(getSqlJobController("run-B")).toBeNull();

    const failCall = mockedUpsert.mock.calls.find((call) => call[2] === "failed");
    expect(failCall).toBeDefined();
    expect(failCall?.[5]).toMatchObject({ error: "model serving 503" });
  });

  it("cancelSqlJob aborts the controller and flips status", async () => {
    await startSqlJob("run-C");

    const controllerBefore = getSqlJobController("run-C");
    expect(controllerBefore).not.toBeNull();
    expect(controllerBefore!.signal.aborted).toBe(false);

    const cancelled = await cancelSqlJob("run-C");
    expect(cancelled).toBe(true);
    expect(controllerBefore!.signal.aborted).toBe(true);

    const status = await getSqlJobStatus("run-C");
    expect(status?.status).toBe("cancelled");
    expect(status?.message).toMatch(/cancel/i);

    // Subsequent cancellations against the same finished job are no-ops.
    const cancelledAgain = await cancelSqlJob("run-C");
    expect(cancelledAgain).toBe(false);
  });

  it("starting a fresh job aborts any in-flight controller for the same run", async () => {
    await startSqlJob("run-D");
    const firstController = getSqlJobController("run-D");
    expect(firstController?.signal.aborted).toBe(false);

    await startSqlJob("run-D");
    const secondController = getSqlJobController("run-D");

    expect(firstController?.signal.aborted).toBe(true);
    expect(secondController).not.toBe(firstController);
    expect(secondController?.signal.aborted).toBe(false);
  });

  it("getSqlJobStatus returns null for an unknown run when no persisted record exists", async () => {
    const status = await getSqlJobStatus("run-does-not-exist");
    expect(status).toBeNull();
  });
});
