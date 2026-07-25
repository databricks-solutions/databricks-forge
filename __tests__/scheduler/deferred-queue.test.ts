import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// We mock the quotas module because the deferred queue calls
// `countActive` and `getCap` inside its tick to decide which jobs to
// promote. Mocking these lets us simulate "user at cap" -> "user under
// cap" transitions deterministically.
vi.mock("@/lib/quotas", () => {
  const state = {
    cap: 1,
    active: 0,
  };
  return {
    __state: state,
    getCap: () => state.cap,
    countActive: async () => state.active,
  };
});

// Loaded after the mock is in place.
type DeferredQueue = typeof import("@/lib/scheduler/deferred-queue");

describe("deferred-queue", () => {
  let mod: DeferredQueue;
  let state: { cap: number; active: number };

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/quotas", () => {
      const s = { cap: 1, active: 0 };
      // expose for test reads
      (globalThis as Record<string, unknown>).__quotaState = s;
      return {
        getCap: () => s.cap,
        countActive: async () => s.active,
      };
    });
    mod = (await import("@/lib/scheduler/deferred-queue")) as DeferredQueue;
    state = (globalThis as Record<string, unknown>).__quotaState as {
      cap: number;
      active: number;
    };
    mod._resetForTests();
  });

  afterEach(() => {
    mod._resetForTests();
    vi.doUnmock("@/lib/quotas");
  });

  it("runs the job immediately when capacity is free", async () => {
    let ran = false;
    mod.enqueueDeferredJob({
      kind: "scan",
      ownerEmail: "alice@example.com",
      run: async () => {
        ran = true;
      },
    });
    // notifyDeferredQueue inside enqueue triggers a tick on next tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toBe(true);
  });

  it("holds the job when the user is at cap and runs it once active drops", async () => {
    state.active = 1; // user is already at cap
    let ran = false;
    mod.enqueueDeferredJob({
      kind: "scan",
      ownerEmail: "alice@example.com",
      run: async () => {
        ran = true;
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toBe(false);
    expect(mod.inspectQueueDepth().total).toBe(1);

    // User finishes their other scan -- promotion should happen on the
    // next notify (or on the next tick, whichever fires first).
    state.active = 0;
    mod.notifyDeferredQueue();
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toBe(true);
    expect(mod.inspectQueueDepth().total).toBe(0);
  });

  it("refreshes the queue lease while a job is legitimately delayed at capacity", async () => {
    state.active = 1;
    const onHeartbeat = vi.fn(async () => {});
    mod.enqueueDeferredJob({
      kind: "scan",
      ownerEmail: "lease@example.com",
      onHeartbeat,
      run: async () => {},
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mod.inspectQueueDepth().total).toBe(1);
    expect(onHeartbeat).toHaveBeenCalled();
  });

  it("does not exceed per-user cap when several jobs are queued", async () => {
    state.active = 0;
    state.cap = 1;
    let ranA = false;
    let ranB = false;

    mod.enqueueDeferredJob({
      kind: "scan",
      ownerEmail: "bob@example.com",
      run: async () => {
        ranA = true;
        // simulate the engine taking a slot
        state.active = 1;
        await new Promise((r) => setTimeout(r, 30));
        state.active = 0;
      },
    });
    mod.enqueueDeferredJob({
      kind: "scan",
      ownerEmail: "bob@example.com",
      run: async () => {
        ranB = true;
      },
    });

    // After ~10ms both are not done -- A is in flight (cap=1) and B is queued.
    await new Promise((r) => setTimeout(r, 10));
    expect(ranA).toBe(true);
    expect(ranB).toBe(false);

    // A completes and notifies; B should run.
    await new Promise((r) => setTimeout(r, 100));
    expect(ranB).toBe(true);
  });
});
