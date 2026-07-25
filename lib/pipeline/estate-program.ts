/**
 * Estate Program orchestration.
 *
 * Drives a program's planned scan sequence: picks the next `planned` scope,
 * runs it as a standalone estate scan through the shared deferred queue (so
 * per-user scan quota / throttling applies), attaches the resulting scan to
 * the program, and chains to the next scope. One scope is in flight per
 * program at a time; failures are recorded and the sequence continues.
 */

import { v4 as uuidv4 } from "uuid";
import { createScopedLogger } from "@/lib/logger";
import { createDeferredJobId, enqueueDeferredJob } from "@/lib/scheduler/deferred-queue";
import {
  claimNextPlannedScope,
  promoteQueuedToRunning,
  heartbeatQueuedScope,
  heartbeatScope,
  completeScopeAndFinalizeScan,
  failScope,
  getEstateProgramContext,
} from "@/lib/lakebase/estate-programs";
import { clearAggregateEstateCache } from "@/lib/lakebase/environment-scans";
import { runWithDatabricksAuthContext } from "@/lib/dbx/auth-context";

export interface ProgramRunResult {
  status: "started" | "idle";
  scopeId?: string;
  scanId?: string;
  label?: string;
}

/** How often a running scope's heartbeat is refreshed during its scan. Must be
 *  comfortably below `STALE_SCOPE_MS` so a live worker is never reclaimed. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Advance a program's scan sequence by one scope. Enqueues the next planned
 * scope's scan on the deferred queue and, when it completes, attaches it to
 * the program and recursively advances. Returns immediately after enqueuing
 * (fire-and-forget); returns `idle` when there is nothing left to run.
 */
export async function runProgramSequence(
  programId: string,
  ownerEmail: string,
  oboToken: string | null = null,
): Promise<ProgramRunResult> {
  const log = createScopedLogger({
    origin: "EstateProgram",
    module: "pipeline/estate-program",
    programId,
  });

  // Atomically claim the next claimable scope so two concurrent run requests
  // can't enqueue the same scope twice. The scanId is stamped on the scope now
  // (plain column, no FK) so the UI can poll live scan progress immediately.
  const scanId = uuidv4();
  const queueJobId = createDeferredJobId("scan", ownerEmail);
  const scope = await claimNextPlannedScope(programId, scanId, queueJobId);
  if (!scope) {
    log.info("No planned scope claimed; sequence idle or already in flight", { programId });
    return { status: "idle" };
  }

  // Load the estate-level context (industry grounding + org context) once,
  // before enqueue, so every scan in the sequence is grounded consistently.
  // Best-effort: a missing program context still runs the scan ungrounded.
  const programContext = await getEstateProgramContext(programId).catch(() => null);

  const runScopeScan = () =>
    runWithDatabricksAuthContext({ oboToken }, async () => {
      const { runStandaloneEnrichment } = await import("@/lib/pipeline/standalone-scan");

      // Deferred promotion is a CONDITIONAL queued -> running transition. If
      // pause/cancel/retry/stale-reclaim changed the status (or a newer attempt
      // replaced the scanId) while this job sat in the deferred queue, the
      // promotion no-ops and we exit WITHOUT scanning or chaining — the closure
      // no longer owns this scope.
      const promoted = await promoteQueuedToRunning(scope.id, scanId, queueJobId);
      if (!promoted) {
        log.info("Scope no longer claimable at promotion; closure exiting without scanning", {
          programId,
          scopeId: scope.id,
          scanId,
        });
        return;
      }

      // Keep the scope's heartbeat fresh while the (potentially long) scan runs
      // so the stale-reclaim watchdog doesn't mistake a live worker for a dead
      // one. Guarded on scanId + running, so it self-cancels if superseded.
      const heartbeat = setInterval(() => {
        void heartbeatScope(scope.id, scanId).catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
      if (typeof heartbeat.unref === "function") heartbeat.unref();

      try {
        await runStandaloneEnrichment(
          scanId,
          scope.ucMetadata,
          scope.lineageDepth ?? 5,
          scope.assetDiscoveryEnabled,
          scope.excludedScope ?? undefined,
          scope.exclusionPatterns ?? undefined,
          ownerEmail,
          oboToken,
          {
            // Estate-level grounding (industry / sub-vertical / org context)
            // resolved from the owning program.
            industryId: programContext?.industryId ?? undefined,
            subVertical: programContext?.subVertical ?? undefined,
            orgContext: programContext?.orgContext ?? undefined,
            // Scope-level scope refinement + portfolio provenance.
            inclusionPatterns: scope.inclusionPatterns ?? undefined,
            workspaceId: scope.workspaceId ?? null,
            teamLabel: scope.teamLabel ?? null,
            lineageEnabled: scope.lineageEnabled ?? true,
            lineageDirection:
              (scope.lineageDirection as "upstream" | "both" | "downstream" | undefined) ??
              "upstream",
            // Keep the final scan hidden (`running`) until the state-machine
            // transaction below both completes the scope and attaches it.
            deferCompletion: true,
          },
        );
        // One transaction conditionally completes the scope, attaches the scan,
        // and flips scanStatus to complete. If a newer attempt owns the scope,
        // it marks this old scan failed so even owner-wide aggregates exclude it.
        const completed = await completeScopeAndFinalizeScan(scope.id, scanId, programId);
        if (completed) {
          clearAggregateEstateCache(programId);
          log.info("Scope scan complete; advancing sequence", {
            programId,
            scopeId: scope.id,
            scanId,
            label: scope.label,
          });
        } else {
          clearAggregateEstateCache();
          log.warn("Scope completion superseded (stale/reclaimed attempt); skipping attach", {
            programId,
            scopeId: scope.id,
            scanId,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Fail CONDITIONALLY too, for the same anti-clobber reason.
        await failScope(scope.id, scanId, message);
        log.warn("Scope scan failed; advancing to next scope", {
          programId,
          scopeId: scope.id,
          scanId,
          error: message,
        });
      } finally {
        clearInterval(heartbeat);
      }

      // Chain to the next planned scope. Because claiming is blocked while any
      // scope is queued/running, this is a no-op idle when a newer attempt is
      // still in flight — it never double-advances.
      void runProgramSequence(programId, ownerEmail, oboToken).catch((e) => {
        log.warn("Failed to advance program sequence", {
          programId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    });

  enqueueDeferredJob({
    jobId: queueJobId,
    kind: "scan",
    ownerEmail,
    onHeartbeat: () => heartbeatQueuedScope(scope.id, scanId, queueJobId).then(() => undefined),
    run: runScopeScan,
  });
  log.info("Enqueued scope scan", {
    programId,
    scopeId: scope.id,
    scanId,
    label: scope.label,
  });
  return { status: "started", scopeId: scope.id, scanId, label: scope.label };
}
