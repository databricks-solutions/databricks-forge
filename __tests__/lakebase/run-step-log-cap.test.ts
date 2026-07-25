/**
 * Tests for the FIFO cap added to `updateRunStepLog`.
 *
 * `stepLog` lives inside the `generationOptions` JSON column on
 * `ForgeRun`. A misbehaving or long-running pipeline can otherwise grow
 * the array unbounded, which (a) bloats the row and (b) compounds the
 * RSC-serialization cost on every list-page poll.
 *
 * Contract under test:
 *   - When the existing log is under the cap, new entries append.
 *   - When the existing log is at the cap and a NEW step arrives, the
 *     oldest entry is dropped (FIFO) so the array length stays bounded.
 *   - Updating an entry for a step that already exists is a merge --
 *     it must not duplicate the entry or violate the cap.
 *
 * Prisma is mocked so we can inspect the encoded JSON written back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type UpdateArg = { data: { generationOptions: string } };

const findUnique = vi.fn<
  (arg: unknown) => Promise<{ generationOptions: string | null }>
>(async () => ({ generationOptions: null }));
const update = vi.fn<(arg: UpdateArg) => Promise<void>>(async () => undefined);

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) => {
    const prisma = {
      forgeRun: { findUnique, update },
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
  findUnique.mockReset();
  update.mockReset();
});

function makeEntries(count: number, prefix = "step") {
  return Array.from({ length: count }, (_, i) => ({
    step: `${prefix}-${i}`,
    startedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }));
}

function writtenStepLog(): Array<{ step: string }> {
  const arg = update.mock.calls[0]?.[0] as UpdateArg;
  const opts = JSON.parse(arg.data.generationOptions) as {
    stepLog: Array<{ step: string }>;
  };
  return opts.stepLog;
}

describe("updateRunStepLog cap", () => {
  it("appends a new entry when under the cap", async () => {
    findUnique.mockResolvedValue({
      generationOptions: JSON.stringify({ stepLog: makeEntries(3) }),
    });

    const { updateRunStepLog } = await import("@/lib/lakebase/runs");
    await updateRunStepLog("run-1", {
      step: "new-step",
      startedAt: "2026-01-02T00:00:00.000Z",
    } as never);

    expect(update).toHaveBeenCalledTimes(1);
    const log = writtenStepLog();
    expect(log).toHaveLength(4);
    expect(log[log.length - 1]?.step).toBe("new-step");
  });

  it("caps the log at 200 entries by dropping the oldest (FIFO) when full", async () => {
    findUnique.mockResolvedValue({
      generationOptions: JSON.stringify({ stepLog: makeEntries(200) }),
    });

    const { updateRunStepLog } = await import("@/lib/lakebase/runs");
    await updateRunStepLog("run-1", {
      step: "overflow-step",
      startedAt: "2026-01-02T00:00:00.000Z",
    } as never);

    const log = writtenStepLog();
    expect(log).toHaveLength(200);
    // Oldest entry has been dropped, newest is at the tail.
    expect(log[0]?.step).toBe("step-1");
    expect(log[log.length - 1]?.step).toBe("overflow-step");
  });

  it("never grows beyond the cap even with a very long existing log", async () => {
    findUnique.mockResolvedValue({
      generationOptions: JSON.stringify({ stepLog: makeEntries(500) }),
    });

    const { updateRunStepLog } = await import("@/lib/lakebase/runs");
    await updateRunStepLog("run-1", {
      step: "another-step",
      startedAt: "2026-01-02T00:00:00.000Z",
    } as never);

    const log = writtenStepLog();
    expect(log).toHaveLength(200);
    expect(log[log.length - 1]?.step).toBe("another-step");
  });

  it("merges an entry for an existing step in place (no duplication, no cap violation)", async () => {
    const existing = makeEntries(200);
    findUnique.mockResolvedValue({
      generationOptions: JSON.stringify({ stepLog: existing }),
    });

    const { updateRunStepLog } = await import("@/lib/lakebase/runs");
    await updateRunStepLog("run-1", {
      step: "step-50",
      startedAt: existing[50]?.startedAt,
      completedAt: "2026-02-01T00:00:00.000Z",
    } as never);

    const log = writtenStepLog();
    expect(log).toHaveLength(200);
    // Order preserved (no shift), entry merged.
    const merged = log.find((e) => e.step === "step-50") as
      | { step: string; completedAt?: string }
      | undefined;
    expect(merged?.completedAt).toBe("2026-02-01T00:00:00.000Z");
    const occurrences = log.filter((e) => e.step === "step-50").length;
    expect(occurrences).toBe(1);
  });
});
