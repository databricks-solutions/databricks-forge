import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeScopeDb } from "../helpers/fake-scope-db";

// A single shared fake DB; the withPrisma mock hands its client to every
// production state-machine function so they run against real query semantics.
const db = new FakeScopeDb();

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(fn: (prisma: unknown) => Promise<T>) => fn(db.client),
}));

import {
  MAX_SCOPE_ATTEMPTS,
  claimNextPlannedScope,
  retryFailedScope,
  promoteQueuedToRunning,
  heartbeatQueuedScope,
  heartbeatScope,
  completeScopeAndFinalizeScan,
  failScope,
  reclaimStaleScopes,
  addProgramScope,
  addProgramScopes,
  DuplicateSequenceError,
} from "@/lib/lakebase/estate-programs";

beforeEach(() => {
  db.scopes = [];
  db.scans = [];
  db.failNextTxWithSerialization = 0;
  db.beforeScopeUpdateMany = null;
});

describe("claimNextPlannedScope", () => {
  it("claims ONLY the lowest-sequence planned scope, never a failed one", async () => {
    db.seedScope({ id: "failed-0", programId: "p1", sequence: 0, status: "failed", attemptCount: 1 });
    db.seedScope({ id: "planned-1", programId: "p1", sequence: 1, status: "planned" });

    const claimed = await claimNextPlannedScope("p1", "scan-1");
    expect(claimed?.id).toBe("planned-1");
    expect(claimed?.status).toBe("queued");
    expect(claimed?.scanId).toBe("scan-1");
    // Failed scope is left untouched (never auto-reclaimed).
    expect(db.get("failed-0")!.status).toBe("failed");
  });

  it("stamps queuedAt/job identity without consuming an attempt before work starts", async () => {
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "planned", attemptCount: 1 });
    const claimed = await claimNextPlannedScope("p1", "scan-1", "job-1");
    expect(claimed?.attemptCount).toBe(1);
    expect(db.get("s")!.queuedAt).toBeInstanceOf(Date);
    expect(db.get("s")!.queueJobId).toBe("job-1");
    expect(db.get("s")!.attemptCount).toBe(1);
  });

  it("does NOT claim when a queued scope already exists for the program", async () => {
    db.seedScope({ id: "q", programId: "p1", sequence: 0, status: "queued", scanId: "old" });
    db.seedScope({ id: "planned", programId: "p1", sequence: 1, status: "planned" });
    expect(await claimNextPlannedScope("p1", "scan-2")).toBeNull();
    expect(db.get("planned")!.status).toBe("planned");
  });

  it("does NOT claim when a running scope already exists for the program", async () => {
    db.seedScope({ id: "r", programId: "p1", sequence: 0, status: "running", scanId: "old" });
    db.seedScope({ id: "planned", programId: "p1", sequence: 1, status: "planned" });
    expect(await claimNextPlannedScope("p1", "scan-2")).toBeNull();
  });

  it("two concurrent Run calls yield exactly one started and one idle", async () => {
    db.seedScope({ id: "a", programId: "p1", sequence: 0, status: "planned" });
    db.seedScope({ id: "b", programId: "p1", sequence: 1, status: "planned" });

    const [r1, r2] = await Promise.all([
      claimNextPlannedScope("p1", "scan-A"),
      claimNextPlannedScope("p1", "scan-B"),
    ]);
    const claimed = [r1, r2].filter(Boolean);
    expect(claimed).toHaveLength(1);
    // Only one scope ever leaves `planned`.
    expect(db.scopes.filter((s) => s.status === "queued")).toHaveLength(1);
    expect(claimed[0]!.id).toBe("a"); // lowest sequence wins
  });

  it("retries on a serialization conflict and still claims", async () => {
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "planned" });
    db.failNextTxWithSerialization = 1; // first transaction throws P2034
    const claimed = await claimNextPlannedScope("p1", "scan-1");
    expect(claimed?.id).toBe("s");
  });
});

describe("retryFailedScope", () => {
  it("moves one failed scope back to planned when no active work conflicts", async () => {
    db.seedScope({ id: "f", programId: "p1", sequence: 0, status: "failed", attemptCount: 1, scanId: "old" });
    const res = await retryFailedScope("p1");
    expect(res).toEqual({ ok: true, scopeId: "f" });
    const row = db.get("f")!;
    expect(row.status).toBe("planned");
    expect(row.scanId).toBeNull();
    expect(row.errorMessage).toBeNull();
    // attemptCount is preserved so the retry budget keeps shrinking.
    expect(row.attemptCount).toBe(1);
  });

  it("refuses to retry while a queued/running scope is in flight", async () => {
    db.seedScope({ id: "run", programId: "p1", sequence: 0, status: "running", scanId: "x" });
    db.seedScope({ id: "f", programId: "p1", sequence: 1, status: "failed", attemptCount: 1 });
    const res = await retryFailedScope("p1");
    expect(res).toEqual({ ok: false, reason: "active_work" });
    expect(db.get("f")!.status).toBe("failed");
  });

  it("rejects a retry once attemptCount has reached MAX_SCOPE_ATTEMPTS", async () => {
    db.seedScope({
      id: "f",
      programId: "p1",
      sequence: 0,
      status: "failed",
      attemptCount: MAX_SCOPE_ATTEMPTS,
    });
    const res = await retryFailedScope("p1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("max_attempts");
    expect(db.get("f")!.status).toBe("failed");
  });

  it("reports no_failed_scope when there is nothing to retry", async () => {
    db.seedScope({ id: "c", programId: "p1", sequence: 0, status: "complete" });
    const res = await retryFailedScope("p1");
    expect(res).toEqual({ ok: false, reason: "no_failed_scope" });
  });

  it("targets a specific failed scope by id when provided", async () => {
    db.seedScope({ id: "f1", programId: "p1", sequence: 0, status: "failed", attemptCount: 1 });
    db.seedScope({ id: "f2", programId: "p1", sequence: 1, status: "failed", attemptCount: 1 });
    const res = await retryFailedScope("p1", "f2");
    expect(res).toEqual({ ok: true, scopeId: "f2" });
    expect(db.get("f1")!.status).toBe("failed");
    expect(db.get("f2")!.status).toBe("planned");
  });
});

describe("conditional transitions", () => {
  it("promoteQueuedToRunning only succeeds for a matching queued scope", async () => {
    db.seedScope({
      id: "s",
      programId: "p1",
      sequence: 0,
      status: "queued",
      scanId: "scan-1",
      queueJobId: "job-1",
      attemptCount: 1,
    });
    expect(await promoteQueuedToRunning("s", "scan-1", "job-1")).toBe(true);
    const row = db.get("s")!;
    expect(row.status).toBe("running");
    expect(row.attemptCount).toBe(2);
    expect(row.queueJobId).toBeNull();
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.heartbeatAt).toBeInstanceOf(Date);
  });

  it("promoteQueuedToRunning is a no-op when the scope was paused/cancelled", async () => {
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "paused", scanId: "scan-1" });
    expect(await promoteQueuedToRunning("s", "scan-1")).toBe(false);
    expect(db.get("s")!.status).toBe("paused");
  });

  it("promoteQueuedToRunning is a no-op when scanId does not match", async () => {
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "queued", scanId: "newer" });
    expect(await promoteQueuedToRunning("s", "stale")).toBe(false);
  });

  it("heartbeatScope updates heartbeatAt only while running with a matching scanId", async () => {
    const staleBeat = new Date(0).getTime();
    db.seedScope({
      id: "s",
      programId: "p1",
      sequence: 0,
      status: "running",
      scanId: "scan-1",
      heartbeatAt: new Date(staleBeat),
    });
    expect(await heartbeatScope("s", "scan-1")).toBe(true);
    expect(db.get("s")!.heartbeatAt!.getTime()).toBeGreaterThan(staleBeat);
    expect(await heartbeatScope("s", "stale")).toBe(false);
  });

  it("atomically completes a running scope and exposes its scan to aggregates", async () => {
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "running", scanId: "scan-1" });
    db.scans.push({ scanId: "scan-1", programId: null, scanStatus: "running" });
    expect(await completeScopeAndFinalizeScan("s", "scan-1", "p1")).toBe(true);
    const row = db.get("s")!;
    expect(row.status).toBe("complete");
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(db.scans[0]).toMatchObject({ programId: "p1", scanStatus: "complete" });
  });

  it("failScope only fails a running scope with the matching scanId", async () => {
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "running", scanId: "scan-1" });
    expect(await failScope("s", "scan-1", "boom")).toBe(true);
    const row = db.get("s")!;
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toBe("boom");
  });

  it("a stale late completion cannot overwrite a newer attempt", async () => {
    // A scope was reclaimed and re-claimed under a NEW scanId, now running.
    db.seedScope({ id: "s", programId: "p1", sequence: 0, status: "running", scanId: "attempt-2" });
    // The zombie worker from attempt-1 finally returns and tries to finish.
    db.scans.push({ scanId: "attempt-1", programId: null, scanStatus: "running" });
    expect(await completeScopeAndFinalizeScan("s", "attempt-1", "p1")).toBe(false);
    expect(await failScope("s", "attempt-1", "late boom")).toBe(false);
    expect(db.scans[0].scanStatus).toBe("failed");
    // The newer attempt is untouched.
    const row = db.get("s")!;
    expect(row.status).toBe("running");
    expect(row.scanId).toBe("attempt-2");
  });
});

describe("reclaimStaleScopes", () => {
  it("does not reclaim when a queued heartbeat refreshes after the stale read", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    db.seedScope({
      id: "q-race",
      programId: "p1",
      sequence: 0,
      status: "queued",
      scanId: "scan-race",
      queueJobId: "job-race",
      attemptCount: 1,
      queuedAt: old,
      heartbeatAt: old,
      updatedAt: old,
    });
    db.beforeScopeUpdateMany = () => {
      // Simulates the deferred queue committing a lease refresh after
      // reclaimStaleScopes read the stale row but before its update executes.
      db.get("q-race")!.heartbeatAt = new Date();
    };

    const res = await reclaimStaleScopes("p1", { olderThanMs: 5 * 60_000 });

    expect(res).toEqual({ reclaimed: 0, failed: 0 });
    expect(db.get("q-race")!).toMatchObject({
      status: "queued",
      scanId: "scan-race",
      queueJobId: "job-race",
      attemptCount: 1,
    });
  });

  it("does not reclaim legitimately delayed queued work with a fresh queue lease", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    db.seedScope({
      id: "q",
      programId: "p1",
      sequence: 0,
      status: "queued",
      scanId: "scan-1",
      queueJobId: "job-1",
      attemptCount: 1,
      queuedAt: old,
      updatedAt: old,
      heartbeatAt: new Date(),
    });
    const res = await reclaimStaleScopes("p1", { olderThanMs: 5 * 60_000 });
    expect(res.reclaimed).toBe(0);
    const row = db.get("q")!;
    expect(row.status).toBe("queued");
    expect(row.attemptCount).toBe(1);
  });

  it("refreshes a queued lease only for its persisted queue job identity", async () => {
    db.seedScope({
      id: "q",
      programId: "p1",
      sequence: 0,
      status: "queued",
      scanId: "scan-1",
      queueJobId: "job-1",
      heartbeatAt: new Date(0),
    });
    expect(await heartbeatQueuedScope("q", "scan-1", "job-1")).toBe(true);
    expect(db.get("q")!.heartbeatAt!.getTime()).toBeGreaterThan(0);
    expect(await heartbeatQueuedScope("q", "scan-1", "different-job")).toBe(false);
  });

  it("recovers a restart-orphaned queued scope without consuming attempt budget", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    db.seedScope({
      id: "q",
      programId: "p1",
      sequence: 0,
      status: "queued",
      scanId: "scan-1",
      queueJobId: "job-from-dead-process",
      attemptCount: 1,
      queuedAt: old,
      heartbeatAt: old,
      updatedAt: old,
    });
    const res = await reclaimStaleScopes("p1", { olderThanMs: 5 * 60_000 });
    expect(res.reclaimed).toBe(1);
    const row = db.get("q")!;
    expect(row.status).toBe("planned");
    expect(row.scanId).toBeNull();
    expect(row.queueJobId).toBeNull();
    expect(row.attemptCount).toBe(1);
  });

  it("reclaims a stale RUNNING scope (dead heartbeat), not just queued", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    db.seedScope({
      id: "r",
      programId: "p1",
      sequence: 0,
      status: "running",
      scanId: "scan-1",
      attemptCount: 1,
      startedAt: old,
      heartbeatAt: old,
      updatedAt: old,
    });
    db.scans.push({ scanId: "scan-1", programId: null, scanStatus: "running" });
    const res = await reclaimStaleScopes("p1", { olderThanMs: 5 * 60_000 });
    expect(res.reclaimed).toBe(1);
    expect(db.get("r")!.status).toBe("planned");
    expect(db.get("r")!.scanId).toBeNull();
    expect(db.scans[0].scanStatus).toBe("failed");
    expect(db.scans[0].finishedAt).toBeInstanceOf(Date);
  });

  it("does NOT reclaim a running scope with a fresh heartbeat", async () => {
    db.seedScope({
      id: "r",
      programId: "p1",
      sequence: 0,
      status: "running",
      scanId: "scan-1",
      attemptCount: 1,
      startedAt: new Date(Date.now() - 10 * 60_000),
      heartbeatAt: new Date(), // fresh
      updatedAt: new Date(),
    });
    const res = await reclaimStaleScopes("p1", { olderThanMs: 5 * 60_000 });
    expect(res.reclaimed).toBe(0);
    expect(db.get("r")!.status).toBe("running");
  });

  it("marks a stale scope FAILED instead of planned once the attempt limit is reached", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    db.seedScope({
      id: "r",
      programId: "p1",
      sequence: 0,
      status: "running",
      scanId: "scan-1",
      attemptCount: MAX_SCOPE_ATTEMPTS,
      heartbeatAt: old,
      updatedAt: old,
    });
    db.scans.push({ scanId: "scan-1", programId: null, scanStatus: "running" });
    const res = await reclaimStaleScopes("p1", { olderThanMs: 5 * 60_000 });
    expect(res.failed).toBe(1);
    expect(db.get("r")!.status).toBe("failed");
    expect(db.scans[0].scanStatus).toBe("failed");
    expect(db.scans[0].finishedAt).toBeInstanceOf(Date);
  });
});

describe("sequence allocation + uniqueness", () => {
  it("auto-appends the next sequence for single inserts", async () => {
    db.seedScope({ id: "a", programId: "p1", sequence: 0 });
    db.seedScope({ id: "b", programId: "p1", sequence: 1 });
    const id = await addProgramScope("p1", { label: "c", ucMetadata: "cat.c" });
    expect(db.get(id)!.sequence).toBe(2);
  });

  it("allocates contiguous sequences for a bulk insert", async () => {
    db.seedScope({ id: "a", programId: "p1", sequence: 0 });
    const count = await addProgramScopes("p1", [
      { label: "b", ucMetadata: "cat.b" },
      { label: "c", ucMetadata: "cat.c" },
    ]);
    expect(count).toBe(2);
    const seqs = db.scopes.filter((s) => s.programId === "p1").map((s) => s.sequence).sort();
    expect(seqs).toEqual([0, 1, 2]);
  });

  it("rejects an explicit duplicate sequence with a clean DuplicateSequenceError", async () => {
    db.seedScope({ id: "a", programId: "p1", sequence: 0 });
    await expect(
      addProgramScope("p1", { label: "dup", ucMetadata: "cat.d", sequence: 0 }),
    ).rejects.toBeInstanceOf(DuplicateSequenceError);
  });

  it("rejects a bulk insert containing an explicit duplicate sequence", async () => {
    db.seedScope({ id: "a", programId: "p1", sequence: 5 });
    await expect(
      addProgramScopes("p1", [{ label: "dup", ucMetadata: "cat.d", sequence: 5 }]),
    ).rejects.toBeInstanceOf(DuplicateSequenceError);
  });
});
