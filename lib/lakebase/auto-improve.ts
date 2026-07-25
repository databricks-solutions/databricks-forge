/**
 * Lakebase persistence for the auto-improve loop.
 *
 * Two tables:
 *   - `ForgeAutoImproveIteration`     -- one row per iteration with the
 *                                        three-gate eval scores, judge
 *                                        scores, and patches applied/dropped.
 *   - `ForgeAutoImproveDoaSignature`  -- per-session "Dead-On-Arrival"
 *                                        patch signatures so a fix that
 *                                        regressed a session is never
 *                                        reattempted.
 *
 * Both are best-effort: failures are logged and swallowed so the loop can
 * continue running even if Lakebase is unreachable.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Iteration history
// ---------------------------------------------------------------------------

export interface AutoImproveIterationRecord {
  sessionId: string;
  iteration: number;
  ownerEmail?: string | null;
  workingSpaceId: string;
  bestSpaceId?: string | null;
  sliceScore?: number | null;
  p0Score?: number | null;
  fullScore?: number | null;
  judgeScores?: Record<string, number> | null;
  patchesApplied?: ReadonlyArray<unknown> | null;
  patchesDropped?: ReadonlyArray<unknown> | null;
  reasonStopped?: string | null;
}

export async function recordAutoImproveIteration(
  rec: AutoImproveIterationRecord,
): Promise<string | null> {
  try {
    return await withPrisma(async (prisma) => {
      const row = await prisma.forgeAutoImproveIteration.create({
        data: {
          sessionId: rec.sessionId,
          iteration: rec.iteration,
          ownerEmail: rec.ownerEmail ?? null,
          workingSpaceId: rec.workingSpaceId,
          bestSpaceId: rec.bestSpaceId ?? null,
          sliceScore: rec.sliceScore ?? null,
          p0Score: rec.p0Score ?? null,
          fullScore: rec.fullScore ?? null,
          judgeScores: rec.judgeScores ? JSON.stringify(rec.judgeScores) : null,
          patchesApplied: rec.patchesApplied ? JSON.stringify(rec.patchesApplied) : null,
          patchesDropped: rec.patchesDropped ? JSON.stringify(rec.patchesDropped) : null,
          reasonStopped: rec.reasonStopped ?? null,
        },
        select: { id: true },
      });
      return row.id;
    });
  } catch (err) {
    logger.warn("[auto-improve] failed to persist iteration, continuing", {
      sessionId: rec.sessionId,
      iteration: rec.iteration,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function listAutoImproveIterations(
  sessionId: string,
): Promise<
  Array<{
    iteration: number;
    sliceScore: number | null;
    p0Score: number | null;
    fullScore: number | null;
    judgeScores: Record<string, number> | null;
    patchesApplied: unknown;
    patchesDropped: unknown;
    reasonStopped: string | null;
    createdAt: Date;
  }>
> {
  try {
    return await withPrisma(async (prisma) => {
      const rows = await prisma.forgeAutoImproveIteration.findMany({
        where: { sessionId },
        orderBy: { iteration: "asc" },
      });
      return rows.map((r) => ({
        iteration: r.iteration,
        sliceScore: r.sliceScore,
        p0Score: r.p0Score,
        fullScore: r.fullScore,
        judgeScores: r.judgeScores
          ? (safeParse(r.judgeScores) as Record<string, number> | null)
          : null,
        patchesApplied: r.patchesApplied ? safeParse(r.patchesApplied) : null,
        patchesDropped: r.patchesDropped ? safeParse(r.patchesDropped) : null,
        reasonStopped: r.reasonStopped,
        createdAt: r.createdAt,
      }));
    });
  } catch (err) {
    logger.warn("[auto-improve] failed to list iterations", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// DOA signatures
// ---------------------------------------------------------------------------

export async function loadDoaSignatures(sessionId: string): Promise<Set<string>> {
  try {
    return await withPrisma(async (prisma) => {
      const rows = await prisma.forgeAutoImproveDoaSignature.findMany({
        where: { sessionId },
        select: { signature: true },
      });
      return new Set(rows.map((r) => r.signature));
    });
  } catch (err) {
    logger.warn("[auto-improve] failed to load DOA signatures", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

export async function recordDoaSignature(opts: {
  sessionId: string;
  signature: string;
  strategy?: string;
  reason?: string;
  ownerEmail?: string | null;
}): Promise<void> {
  try {
    await withPrisma(async (prisma) => {
      await prisma.forgeAutoImproveDoaSignature.upsert({
        where: {
          sessionId_signature: {
            sessionId: opts.sessionId,
            signature: opts.signature,
          },
        },
        update: { reason: opts.reason ?? null, strategy: opts.strategy ?? null },
        create: {
          sessionId: opts.sessionId,
          signature: opts.signature,
          strategy: opts.strategy ?? null,
          reason: opts.reason ?? null,
          ownerEmail: opts.ownerEmail ?? null,
        },
      });
    });
  } catch (err) {
    logger.warn("[auto-improve] failed to record DOA signature", {
      sessionId: opts.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
