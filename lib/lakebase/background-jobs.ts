/**
 * Lakebase persistence for background engine job status.
 *
 * Provides write-through persistence so job status survives server
 * restarts. The in-memory Maps in engine-status modules remain the
 * primary store for fast polling; this module is the durable fallback.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface PersistedJobStatus {
  runId: string;
  engine: string;
  status: string;
  message: string;
  percent: number;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  detailsJson: string | null;
  domainCount: number;
}

/**
 * Upsert a job status row. Fire-and-forget safe -- callers can
 * `void upsertJobStatus(...)` to avoid blocking the hot path.
 */
export async function upsertJobStatus(
  runId: string,
  engine: string,
  status: string,
  message: string,
  percent: number,
  opts?: {
    startedAt?: Date;
    completedAt?: Date | null;
    error?: string | null;
    detailsJson?: string | null;
    domainCount?: number;
  },
): Promise<void> {
  try {
    const id = `${runId}_${engine}`;
    await withPrisma(async (prisma) => {
      await prisma.forgeBackgroundJob.upsert({
        where: { id },
        create: {
          id,
          runId,
          engine,
          status,
          message,
          percent,
          startedAt: opts?.startedAt ?? new Date(),
          completedAt: opts?.completedAt ?? null,
          error: opts?.error ?? null,
          detailsJson: opts?.detailsJson ?? null,
          domainCount: opts?.domainCount ?? 0,
        },
        update: {
          status,
          message,
          percent,
          ...(opts?.completedAt !== undefined && { completedAt: opts.completedAt }),
          ...(opts?.error !== undefined && { error: opts.error }),
          ...(opts?.detailsJson !== undefined && { detailsJson: opts.detailsJson }),
          ...(opts?.domainCount !== undefined && { domainCount: opts.domainCount }),
        },
      });
    });
  } catch (err) {
    logger.warn("Failed to persist background job status", {
      runId,
      engine,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Replace a job row with a fresh attempt. Unlike transition upserts, every
 * terminal/detail field is reset explicitly so no prior attempt can leak into
 * restart recovery.
 */
export async function replaceJobStatus(
  runId: string,
  engine: string,
  status: string,
  message: string,
  percent: number,
  startedAt: Date,
): Promise<void> {
  try {
    const id = `${runId}_${engine}`;
    await withPrisma(async (prisma) => {
      await prisma.forgeBackgroundJob.upsert({
        where: { id },
        create: {
          id,
          runId,
          engine,
          status,
          message,
          percent,
          startedAt,
          completedAt: null,
          error: null,
          detailsJson: null,
          domainCount: 0,
        },
        update: {
          status,
          message,
          percent,
          startedAt,
          completedAt: null,
          error: null,
          detailsJson: null,
          domainCount: 0,
        },
      });
    });
  } catch (err) {
    logger.warn("Failed to replace background job status", {
      runId,
      engine,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Startup orphan recovery
//
// Only marks jobs as orphaned if they started BEFORE the current process.
// This prevents the sweep from killing jobs started in the current process.
// ---------------------------------------------------------------------------

const PROCESS_START = new Date();
let _orphanCheckDone = false;

async function ensureOrphanCheck(): Promise<void> {
  if (_orphanCheckDone) return;
  _orphanCheckDone = true;
  await markOrphanedJobsFailed();
}

/**
 * Mark the orphan check as complete. Call this from instrumentation.ts
 * after the eager check so the lazy check in getPersistedJobStatus
 * does not run a second time.
 */
export function markOrphanCheckComplete(): void {
  _orphanCheckDone = true;
}

/**
 * Read a single job status from Lakebase. Returns null if no row exists.
 * On first call, also marks any orphaned "generating" jobs as failed.
 */
export async function getPersistedJobStatus(
  runId: string,
  engine: string,
): Promise<PersistedJobStatus | null> {
  try {
    await ensureOrphanCheck();
    return await withPrisma(async (prisma) => {
      const row = await prisma.forgeBackgroundJob.findUnique({
        where: { runId_engine: { runId, engine } },
      });
      if (!row) return null;
      return {
        runId: row.runId,
        engine: row.engine,
        status: row.status,
        message: row.message,
        percent: row.percent,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        error: row.error,
        detailsJson: row.detailsJson,
        domainCount: row.domainCount,
      };
    });
  } catch (err) {
    logger.warn("Failed to read persisted job status", {
      runId,
      engine,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Mark jobs stuck in "generating" as "failed", but only if they
 * started before the current server process. This prevents sweeping
 * jobs that were legitimately started in this process.
 */
export async function markOrphanedJobsFailed(): Promise<number> {
  try {
    return await withPrisma(async (prisma) => {
      const result = await prisma.forgeBackgroundJob.updateMany({
        where: {
          status: "generating",
          startedAt: { lt: PROCESS_START },
        },
        data: {
          status: "failed",
          error: "Server restarted during generation",
          completedAt: new Date(),
        },
      });
      if (result.count > 0) {
        logger.info("Marked orphaned background jobs as failed", {
          count: result.count,
        });
      }
      return result.count;
    });
  } catch (err) {
    logger.warn("Failed to mark orphaned jobs", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
