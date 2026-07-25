/**
 * Dead-On-Arrival (DOA) patch buffer for the auto-improve loop.
 *
 * Stores per-`autoImproveSessionId` patch signatures that previously
 * regressed the eval score. Subsequent iterations skip any candidate patch
 * whose signature already lives in the DOA set, preventing the loop from
 * thrashing on the same broken fix forever.
 *
 * Two-tier storage:
 *   - L1 (in-memory `Map<sessionId, Set<sig>>`)  -- fast, per-process.
 *   - L2 (`ForgeAutoImproveDoaSignature` table)  -- survives restarts.
 *
 * Both layers are written/read through this module's public API. Lakebase
 * is best-effort: load/save errors are logged and the in-memory layer
 * keeps working.
 *
 * Mirrors upstream `databricks-genie-workbench` Fix Agent's DOA buffer.
 */

import { createHash } from "crypto";
import { logger } from "@/lib/logger";
import {
  loadDoaSignatures,
  recordDoaSignature as persistDoaSignature,
} from "@/lib/lakebase/auto-improve";

// ---------------------------------------------------------------------------
// In-memory layer
// ---------------------------------------------------------------------------

const _bufferBySession = new Map<string, Set<string>>();

function getBuffer(sessionId: string): Set<string> {
  let buf = _bufferBySession.get(sessionId);
  if (!buf) {
    buf = new Set<string>();
    _bufferBySession.set(sessionId, buf);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Signature computation
// ---------------------------------------------------------------------------

export interface PatchSignatureInput {
  /** Fix strategy that produced the patch (e.g. `instruction_generation`). */
  strategy: string;
  /** Dotted field path the patch targeted (e.g. `instructions.text_instructions[0].content`). */
  targetFieldPath: string;
  /** The actual JSON payload of the patch. Order-independent. */
  delta: unknown;
}

/**
 * Compute a stable, deterministic SHA-256 signature for a candidate patch.
 *
 * The hash is order-independent: object keys are sorted before stringifying
 * so two patches with the same logical effect collide correctly.
 */
export function computePatchSignature(input: PatchSignatureInput): string {
  const stable = JSON.stringify({
    strategy: input.strategy,
    targetFieldPath: input.targetFieldPath,
    delta: stableJson(input.delta),
  });
  return createHash("sha256").update(stable).digest("hex");
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = stableJson(obj[k]);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hydrate the in-memory DOA buffer for a session from Lakebase. Call once
 * at the start of an auto-improve session (idempotent).
 */
export async function loadDoaBuffer(sessionId: string): Promise<Set<string>> {
  const fromDb = await loadDoaSignatures(sessionId);
  const buf = getBuffer(sessionId);
  for (const sig of fromDb) buf.add(sig);
  return buf;
}

/** Returns true if this candidate patch was previously DOA. */
export function isDoa(sessionId: string, signature: string): boolean {
  return getBuffer(sessionId).has(signature);
}

/** Add a signature to both the in-memory and Lakebase DOA stores. */
export async function recordDoa(opts: {
  sessionId: string;
  signature: string;
  strategy?: string;
  reason?: string;
  ownerEmail?: string | null;
}): Promise<void> {
  getBuffer(opts.sessionId).add(opts.signature);
  await persistDoaSignature(opts);
}

/**
 * Filter a candidate patch list down to those whose signatures are not
 * already DOA. Returns both the survivors and the dropped signatures so
 * the caller can log/persist what was skipped.
 */
export function filterCandidatesByDoa<T extends { signature: string }>(
  sessionId: string,
  candidates: ReadonlyArray<T>,
): { kept: T[]; dropped: T[] } {
  const buf = getBuffer(sessionId);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const c of candidates) {
    if (buf.has(c.signature)) {
      dropped.push(c);
    } else {
      kept.push(c);
    }
  }
  if (dropped.length > 0) {
    logger.info("[doa-buffer] dropped previously-failed patches", {
      sessionId,
      dropped: dropped.length,
      kept: kept.length,
    });
  }
  return { kept, dropped };
}

/** Test helper -- clears the in-memory buffer for a session. */
export function clearDoaBufferForSession(sessionId: string): void {
  _bufferBySession.delete(sessionId);
}

/** Test helper -- clears every in-memory buffer. */
export function clearAllDoaBuffers(): void {
  _bufferBySession.clear();
}
