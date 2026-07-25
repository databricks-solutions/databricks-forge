import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetForTests,
  _addWaitingMs,
  recordThrottleMs,
  instrumentedAcquire,
  getStepCounters,
  clearRunCounters,
} from "@/lib/pipeline/step-instrumentation";

describe("step-instrumentation", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("no-ops when run/step are missing", () => {
    _addWaitingMs(null, null, 100);
    recordThrottleMs(undefined, undefined, 200);
    expect(getStepCounters("any-run")).toEqual([]);
  });

  it("aggregates waiting and throttle counters per (run, step)", () => {
    _addWaitingMs("run-1", "step-A", 30);
    _addWaitingMs("run-1", "step-A", 70);
    recordThrottleMs("run-1", "step-A", 500);
    recordThrottleMs("run-1", "step-A", 500);

    const c = getStepCounters("run-1");
    expect(c).toHaveLength(1);
    expect(c[0].step).toBe("step-A");
    expect(c[0].waitingMs).toBe(100);
    expect(c[0].throttledMs).toBe(1000);
    expect(c[0].throttleEvents).toBe(2);
  });

  it("instrumentedAcquire records waiting for a successful acquire", async () => {
    const limiter = {
      acquire: async () => {
        await new Promise((r) => setTimeout(r, 25));
      },
    };
    await instrumentedAcquire(limiter, "ep1", "alice", "run-2", "step-X");
    const c = getStepCounters("run-2");
    expect(c).toHaveLength(1);
    expect(c[0].step).toBe("step-X");
    expect(c[0].acquires).toBe(1);
    expect(c[0].waitingMs).toBeGreaterThanOrEqual(20);
  });

  it("clearRunCounters drops all counters for a run", () => {
    _addWaitingMs("run-3", "s1", 10);
    expect(getStepCounters("run-3")).toHaveLength(1);
    clearRunCounters("run-3");
    expect(getStepCounters("run-3")).toEqual([]);
  });

  it("counters sort by total elapsed (waiting + throttled) descending", () => {
    _addWaitingMs("run-4", "small", 10);
    recordThrottleMs("run-4", "small", 0);
    _addWaitingMs("run-4", "medium", 50);
    _addWaitingMs("run-4", "large", 100);
    recordThrottleMs("run-4", "large", 200);

    const c = getStepCounters("run-4");
    expect(c.map((s) => s.step)).toEqual(["large", "medium", "small"]);
  });
});
