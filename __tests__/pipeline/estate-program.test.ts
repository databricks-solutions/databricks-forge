import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks for the orchestrator's collaborators -------------------------
const claimNextPlannedScope = vi.fn();
const promoteQueuedToRunning = vi.fn(async (..._a: unknown[]) => true);
const heartbeatQueuedScope = vi.fn(async (..._a: unknown[]) => true);
const heartbeatScope = vi.fn(async (..._a: unknown[]) => true);
const completeScopeAndFinalizeScan = vi.fn(async (..._a: unknown[]) => true);
const failScope = vi.fn(async (..._a: unknown[]) => true);
const getEstateProgramContext = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock("@/lib/lakebase/estate-programs", () => ({
  claimNextPlannedScope: (a: unknown, b: unknown, c: unknown) => claimNextPlannedScope(a, b, c),
  promoteQueuedToRunning: (a: unknown, b: unknown, c: unknown) => promoteQueuedToRunning(a, b, c),
  heartbeatQueuedScope: (a: unknown, b: unknown, c: unknown) => heartbeatQueuedScope(a, b, c),
  heartbeatScope: (a: unknown, b: unknown) => heartbeatScope(a, b),
  completeScopeAndFinalizeScan: (a: unknown, b: unknown, c: unknown) =>
    completeScopeAndFinalizeScan(a, b, c),
  failScope: (a: unknown, b: unknown, c: unknown) => failScope(a, b, c),
  getEstateProgramContext: (a: unknown) => getEstateProgramContext(a),
}));

const clearAggregateEstateCache = vi.fn();
vi.mock("@/lib/lakebase/environment-scans", () => ({
  clearAggregateEstateCache: (a: unknown) => clearAggregateEstateCache(a),
}));

// Capture deferred jobs instead of running them through the real queue.
let lastJob: (() => Promise<void>) | null = null;
let lastQueueHeartbeat: (() => Promise<void>) | null = null;
const createDeferredJobId = vi.fn((..._args: unknown[]) => "job-1");
const enqueueDeferredJob = vi.fn(
  (args: { run: () => Promise<void>; onHeartbeat?: () => Promise<void> }) => {
    lastJob = args.run;
    lastQueueHeartbeat = args.onHeartbeat ?? null;
    return { jobId: "job-1", position: 0 };
  },
);
vi.mock("@/lib/scheduler/deferred-queue", () => ({
  enqueueDeferredJob: (args: { run: () => Promise<void> }) => enqueueDeferredJob(args),
  createDeferredJobId: (kind: unknown, ownerEmail: unknown) =>
    createDeferredJobId(kind, ownerEmail),
}));

// Stub the scan runner (dynamic-imported inside the job).
const runStandaloneEnrichment = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/pipeline/standalone-scan", () => ({
  runStandaloneEnrichment: (...args: unknown[]) => runStandaloneEnrichment(...args),
}));

import { runProgramSequence } from "@/lib/pipeline/estate-program";
import { getDatabricksAuthContext } from "@/lib/dbx/auth-context";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runProgramSequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastJob = null;
    lastQueueHeartbeat = null;
  });

  // Helper: claimNextPlannedScope echoes the scanId the orchestrator passes
  // (scanId is a plain column, stamped at claim time).
  const scopeReturning = (scope: Record<string, unknown>) => (_programId: string, scanId: string) =>
    Promise.resolve({ ...scope, status: "queued", scanId });

  it("returns idle when there is no claimable scope", async () => {
    claimNextPlannedScope.mockResolvedValue(null);
    const result = await runProgramSequence("p1", "user@x.com");
    expect(result.status).toBe("idle");
    expect(enqueueDeferredJob).not.toHaveBeenCalled();
  });

  it("atomically claims the next scope and enqueues it", async () => {
    claimNextPlannedScope.mockImplementationOnce(
      scopeReturning({
        id: "scope-1",
        label: "Upstream",
        ucMetadata: "cat.upstream",
        lineageDepth: 4,
        assetDiscoveryEnabled: true,
        excludedScope: null,
        exclusionPatterns: null,
      }),
    );
    const result = await runProgramSequence("p1", "user@x.com");
    expect(result.status).toBe("started");
    expect(result.scopeId).toBe("scope-1");
    expect(result.scanId).toBeDefined();
    // The claim performs the claimable -> queued transition atomically and
    // stamps the scanId used for live progress.
    expect(claimNextPlannedScope).toHaveBeenCalledWith("p1", result.scanId, "job-1");
    expect(enqueueDeferredJob).toHaveBeenCalledTimes(1);
    expect(lastQueueHeartbeat).toBeTypeOf("function");
    await lastQueueHeartbeat!();
    expect(heartbeatQueuedScope).toHaveBeenCalledWith("scope-1", result.scanId, "job-1");
  });

  it("runs the scan, attaches it, marks complete, and chains to the next scope", async () => {
    // First claim returns a scope; the chained claim returns null (sequence done).
    claimNextPlannedScope
      .mockImplementationOnce(
        scopeReturning({
          id: "scope-1",
          label: "Upstream",
          ucMetadata: "cat.upstream",
          lineageDepth: 5,
          assetDiscoveryEnabled: false,
          excludedScope: null,
          exclusionPatterns: null,
        }),
      )
      .mockResolvedValueOnce(null);

    const result = await runProgramSequence("p1", "user@x.com", "obo-token");
    expect(lastJob).toBeTypeOf("function");

    // Execute the captured job (simulates the deferred queue promoting it).
    await lastJob!();
    await flush();

    expect(runStandaloneEnrichment).toHaveBeenCalledOnce();
    // The deferred job first promotes queued -> running conditionally.
    expect(promoteQueuedToRunning).toHaveBeenCalledWith("scope-1", result.scanId, "job-1");
    // Scope completion + scan finalization/attachment are one transaction.
    expect(completeScopeAndFinalizeScan).toHaveBeenCalledWith("scope-1", result.scanId, "p1");
    expect(runStandaloneEnrichment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.any(Boolean),
      undefined,
      undefined,
      expect.any(String),
      "obo-token",
      expect.objectContaining({ deferCompletion: true }),
    );
    expect(clearAggregateEstateCache).toHaveBeenCalledWith("p1");
    // Chained: claimNextPlannedScope queried a second time.
    expect(claimNextPlannedScope).toHaveBeenCalledTimes(2);
  });

  it("loads the program and propagates industry (NOC) + scope provenance into the scan options", async () => {
    getEstateProgramContext.mockResolvedValueOnce({
      industryId: "oil-gas-noc",
      subVertical: "national-oil-company",
      orgContext: "State-owned integrated energy major",
    });
    claimNextPlannedScope
      .mockImplementationOnce(
        scopeReturning({
          id: "scope-noc",
          label: "Upstream",
          ucMetadata: "cat.upstream",
          lineageDepth: 5,
          assetDiscoveryEnabled: false,
          excludedScope: null,
          exclusionPatterns: null,
          inclusionPatterns: "fact_*",
          workspaceId: "ws-noc",
          teamLabel: "Upstream Data",
        }),
      )
      .mockResolvedValueOnce(null);

    await runProgramSequence("p1", "user@x.com");
    await lastJob!();
    await flush();

    expect(getEstateProgramContext).toHaveBeenCalledWith("p1");
    const opts = runStandaloneEnrichment.mock.calls[0][8] as Record<string, unknown>;
    expect(opts).toMatchObject({
      industryId: "oil-gas-noc",
      subVertical: "national-oil-company",
      inclusionPatterns: "fact_*",
      workspaceId: "ws-noc",
      teamLabel: "Upstream Data",
      deferCompletion: true,
    });
  });

  it("wraps the deferred scan in OBO context while forwarding ownerEmail independently", async () => {
    claimNextPlannedScope
      .mockImplementationOnce(
        scopeReturning({
          id: "scope-auth",
          label: "Authenticated",
          ucMetadata: "cat.authenticated",
          lineageDepth: 5,
          assetDiscoveryEnabled: false,
          excludedScope: null,
          exclusionPatterns: null,
        }),
      )
      .mockResolvedValueOnce(null);

    let contextualToken: string | null | undefined;
    runStandaloneEnrichment.mockImplementationOnce(async (...args: unknown[]) => {
      await Promise.resolve();
      contextualToken = getDatabricksAuthContext()?.oboToken;
      expect(args[6]).toBe("owner@example.com");
    });

    await runProgramSequence("p1", "owner@example.com", "obo-user");
    await lastJob!();
    await flush();

    expect(contextualToken).toBe("obo-user");
    expect(getDatabricksAuthContext()).toBeNull();
  });

  it("marks the scope failed and still chains when the scan throws", async () => {
    claimNextPlannedScope
      .mockImplementationOnce(
        scopeReturning({
          id: "scope-2",
          label: "LNG",
          ucMetadata: "cat.lng",
          lineageDepth: 5,
          assetDiscoveryEnabled: false,
          excludedScope: null,
          exclusionPatterns: null,
        }),
      )
      .mockResolvedValueOnce(null);
    runStandaloneEnrichment.mockRejectedValueOnce(new Error("boom"));

    await runProgramSequence("p1", "user@x.com");
    await lastJob!();
    await flush();

    expect(failScope).toHaveBeenCalledWith("scope-2", expect.any(String), "boom");
    expect(completeScopeAndFinalizeScan).not.toHaveBeenCalled();
    expect(claimNextPlannedScope).toHaveBeenCalledTimes(2);
  });

  it("does NOT scan or chain when promotion fails (pause/cancel/reclaim intervened)", async () => {
    claimNextPlannedScope.mockImplementationOnce(
      scopeReturning({
        id: "scope-paused",
        label: "Paused",
        ucMetadata: "cat.paused",
        lineageDepth: 5,
        assetDiscoveryEnabled: false,
        excludedScope: null,
        exclusionPatterns: null,
      }),
    );
    // The scope was paused/cancelled/reclaimed between claim and promotion.
    promoteQueuedToRunning.mockResolvedValueOnce(false);

    await runProgramSequence("p1", "user@x.com");
    await lastJob!();
    await flush();

    expect(runStandaloneEnrichment).not.toHaveBeenCalled();
    expect(completeScopeAndFinalizeScan).not.toHaveBeenCalled();
    expect(failScope).not.toHaveBeenCalled();
    // No chaining: the enqueued closure exits cleanly without re-claiming.
    expect(claimNextPlannedScope).toHaveBeenCalledTimes(1);
  });

  it("does NOT attach a scan when completion is superseded (late completion)", async () => {
    claimNextPlannedScope
      .mockImplementationOnce(
        scopeReturning({
          id: "scope-late",
          label: "Late",
          ucMetadata: "cat.late",
          lineageDepth: 5,
          assetDiscoveryEnabled: false,
          excludedScope: null,
          exclusionPatterns: null,
        }),
      )
      .mockResolvedValueOnce(null);
    // Scan runs, but by the time it completes a newer attempt owns the scope,
    // so the conditional completeScope no-ops.
    completeScopeAndFinalizeScan.mockResolvedValueOnce(false);

    await runProgramSequence("p1", "user@x.com");
    await lastJob!();
    await flush();

    expect(runStandaloneEnrichment).toHaveBeenCalledOnce();
    expect(completeScopeAndFinalizeScan).toHaveBeenCalledWith(
      "scope-late",
      expect.any(String),
      "p1",
    );
    // The atomic completion helper marks the superseded scan failed, so the
    // owner-wide aggregate must be invalidated even though attachment lost.
    expect(clearAggregateEstateCache).toHaveBeenCalledWith(undefined);
    // Still chains so the newer attempt / next scope proceeds.
    expect(claimNextPlannedScope).toHaveBeenCalledTimes(2);
  });
});
