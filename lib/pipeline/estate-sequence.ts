/**
 * Estate sequence orchestration (estate-facing facade over the proven program
 * sequence mechanics). Adds pause / cancel / resume controls and a stuck-queued
 * reclaim so a sequence can recover after a process restart.
 *
 * "Estate" is the product noun; the underlying persistence is still
 * ForgeEstateProgram / ForgeEstateProgramScope (see
 * docs/ESTATE_INTELLIGENCE_DESIGN.md §2.2).
 */

import { runProgramSequence, type ProgramRunResult } from "@/lib/pipeline/estate-program";
import {
  pauseScopes,
  resumeScopes,
  cancelScopes,
  reclaimStaleScopes,
  retryFailedScope,
  type RetryScopeResult,
} from "@/lib/lakebase/estate-programs";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";

export type EstateSequenceResult = ProgramRunResult;

/**
 * Start (or advance) an estate's scan sequence. Reclaims any stuck `queued`
 * scopes first (crash recovery), then claims + enqueues the next runnable
 * scope. Fire-and-forget; respects per-user scan quota via the deferred queue.
 */
export async function runEstateSequence(
  estateId: string,
  ownerEmail: string,
  oboToken: string | null = null,
): Promise<EstateSequenceResult> {
  // Crash recovery: reclaim scopes whose worker has vanished (queued that never
  // started, or running with a dead heartbeat) before claiming the next one.
  const reclaimed = await reclaimStaleScopes(estateId).catch(() => ({ reclaimed: 0, failed: 0 }));
  if (reclaimed.reclaimed > 0 || reclaimed.failed > 0) {
    logger.info("[estate-sequence] Reclaimed stale scopes", {
      estateId,
      reclaimed: reclaimed.reclaimed,
      failed: reclaimed.failed,
    });
  }
  return runProgramSequence(estateId, ownerEmail, oboToken);
}

/**
 * Explicitly retry one failed scope (owner/edit-guarded upstream). Moves a
 * single `failed` scope back to `planned` — but only when nothing is queued or
 * running for the estate and the scope still has attempts left — then advances
 * the sequence so the reset scope gets picked up.
 */
export async function retryEstateFailedScope(
  estateId: string,
  ownerEmail: string,
  oboToken: string | null = null,
  scopeId?: string,
): Promise<{ retry: RetryScopeResult; run?: EstateSequenceResult }> {
  const retry = await retryFailedScope(estateId, scopeId);
  if (!retry.ok) {
    return { retry };
  }
  logActivity("estate_sequence_scope_retried", {
    userId: ownerEmail,
    resourceId: estateId,
    metadata: { scopeId: retry.scopeId },
  }).catch(() => {});
  const run = await runEstateSequence(estateId, ownerEmail, oboToken);
  return { retry, run };
}

export async function pauseEstateSequence(
  estateId: string,
  ownerEmail: string,
): Promise<{ paused: number }> {
  const paused = await pauseScopes(estateId);
  logActivity("estate_sequence_paused", {
    userId: ownerEmail,
    resourceId: estateId,
    metadata: { paused },
  }).catch(() => {});
  return { paused };
}

export async function cancelEstateSequence(
  estateId: string,
  ownerEmail: string,
): Promise<{ cancelled: number }> {
  const cancelled = await cancelScopes(estateId);
  logActivity("estate_sequence_cancelled", {
    userId: ownerEmail,
    resourceId: estateId,
    metadata: { cancelled },
  }).catch(() => {});
  return { cancelled };
}

export async function resumeEstateSequence(
  estateId: string,
  ownerEmail: string,
  oboToken: string | null = null,
): Promise<EstateSequenceResult & { resumed: number }> {
  const resumed = await resumeScopes(estateId);
  logActivity("estate_sequence_resumed", {
    userId: ownerEmail,
    resourceId: estateId,
    metadata: { resumed },
  }).catch(() => {});
  const result = await runEstateSequence(estateId, ownerEmail, oboToken);
  return { ...result, resumed };
}
