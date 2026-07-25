import { describe, it, expect, vi, beforeEach } from "vitest";

const runProgramSequence = vi.fn();
const pauseScopes = vi.fn();
const resumeScopes = vi.fn();
const cancelScopes = vi.fn();
const reclaimStaleScopes = vi.fn();
const retryFailedScope = vi.fn();
const logActivity = vi.fn(async (_a: unknown, _b: unknown) => {});

vi.mock("@/lib/pipeline/estate-program", () => ({
  runProgramSequence: (a: unknown, b: unknown, c?: unknown) => runProgramSequence(a, b, c),
}));
vi.mock("@/lib/lakebase/estate-programs", () => ({
  pauseScopes: (a: unknown) => pauseScopes(a),
  resumeScopes: (a: unknown) => resumeScopes(a),
  cancelScopes: (a: unknown) => cancelScopes(a),
  reclaimStaleScopes: (a: unknown) => reclaimStaleScopes(a),
  retryFailedScope: (a: unknown, b?: unknown) => retryFailedScope(a, b),
}));
vi.mock("@/lib/lakebase/activity-log", () => ({
  logActivity: (a: unknown, b: unknown) => logActivity(a, b),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runEstateSequence,
  pauseEstateSequence,
  cancelEstateSequence,
  resumeEstateSequence,
  retryEstateFailedScope,
} from "@/lib/pipeline/estate-sequence";

describe("estate-sequence facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runProgramSequence.mockResolvedValue({ status: "started", scopeId: "s1", scanId: "scan-1" });
    reclaimStaleScopes.mockResolvedValue({ reclaimed: 0, failed: 0 });
    retryFailedScope.mockResolvedValue({ ok: true, scopeId: "f1" });
    pauseScopes.mockResolvedValue(2);
    resumeScopes.mockResolvedValue(2);
    cancelScopes.mockResolvedValue(3);
  });

  it("reclaims stale scopes before advancing the sequence", async () => {
    reclaimStaleScopes.mockResolvedValueOnce({ reclaimed: 1, failed: 0 });
    const r = await runEstateSequence("e1", "u@x.com", "obo");
    expect(reclaimStaleScopes).toHaveBeenCalledWith("e1");
    expect(runProgramSequence).toHaveBeenCalledWith("e1", "u@x.com", "obo");
    expect(r.status).toBe("started");
  });

  it("tolerates a reclaim failure (crash recovery is best-effort)", async () => {
    reclaimStaleScopes.mockRejectedValueOnce(new Error("db blip"));
    const r = await runEstateSequence("e1", "u@x.com");
    expect(runProgramSequence).toHaveBeenCalled();
    expect(r.status).toBe("started");
  });

  it("retryEstateFailedScope advances the sequence after a successful retry", async () => {
    const r = await retryEstateFailedScope("e1", "u@x.com", "obo", "f1");
    expect(retryFailedScope).toHaveBeenCalledWith("e1", "f1");
    expect(runProgramSequence).toHaveBeenCalledWith("e1", "u@x.com", "obo");
    expect(r.retry).toEqual({ ok: true, scopeId: "f1" });
    expect(r.run?.status).toBe("started");
    expect(logActivity).toHaveBeenCalledWith(
      "estate_sequence_scope_retried",
      expect.objectContaining({ resourceId: "e1" }),
    );
  });

  it("retryEstateFailedScope does NOT advance when the retry is rejected", async () => {
    retryFailedScope.mockResolvedValueOnce({ ok: false, reason: "max_attempts" });
    const r = await retryEstateFailedScope("e1", "u@x.com");
    expect(runProgramSequence).not.toHaveBeenCalled();
    expect(r.run).toBeUndefined();
    expect(r.retry).toEqual({ ok: false, reason: "max_attempts" });
  });

  it("pause logs activity and returns the paused count", async () => {
    const r = await pauseEstateSequence("e1", "u@x.com");
    expect(r).toEqual({ paused: 2 });
    expect(logActivity).toHaveBeenCalledWith(
      "estate_sequence_paused",
      expect.objectContaining({ resourceId: "e1", userId: "u@x.com" }),
    );
  });

  it("cancel logs activity and returns the cancelled count", async () => {
    const r = await cancelEstateSequence("e1", "u@x.com");
    expect(r).toEqual({ cancelled: 3 });
    expect(logActivity).toHaveBeenCalledWith(
      "estate_sequence_cancelled",
      expect.objectContaining({ resourceId: "e1" }),
    );
  });

  it("resume flips paused scopes then advances, returning resumed count + run result", async () => {
    const r = await resumeEstateSequence("e1", "u@x.com", "obo");
    expect(resumeScopes).toHaveBeenCalledWith("e1");
    expect(runProgramSequence).toHaveBeenCalledWith("e1", "u@x.com", "obo");
    expect(r.resumed).toBe(2);
    expect(r.status).toBe("started");
  });
});
