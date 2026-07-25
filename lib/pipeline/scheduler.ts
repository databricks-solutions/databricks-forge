/**
 * Pipeline run scheduler.
 *
 * When a user is at their per-user pipeline cap (`FORGE_MAX_ACTIVE_PIPELINE_RUNS_PER_USER`),
 * the execute route can persist the run with `status='queued'` and call
 * `notifyScheduler()`. The scheduler periodically (every 5s, plus on-demand)
 * scans for `queued` runs whose owners now have free capacity and promotes
 * the oldest one via an atomic update (claim-on-promotion to prevent races).
 *
 * The scheduler is process-local. With multiple App instances, each instance
 * runs its own tick; the atomic claim ensures at most one wins per run.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/lakebase/activity-log";
import { getCap } from "@/lib/quotas";

const log = logger;

let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 5000;

interface PipelineStarter {
  start(runId: string, opts: { ownerEmail: string; oboToken: string | null }): Promise<void>;
}

let starter: PipelineStarter | null = null;

/**
 * Wire the pipeline starter. Called once at module init from
 * `lib/pipeline/engine.ts` so the scheduler can promote queued runs.
 */
export function registerPipelineStarter(s: PipelineStarter): void {
  starter = s;
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => {
      log.warn("Pipeline scheduler tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, TICK_MS);
  log.info("Pipeline scheduler started", { tickMs: TICK_MS });
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Trigger an immediate tick (e.g. after a run completes, or after enqueue). */
export function notifyScheduler(): void {
  setTimeout(() => {
    tick().catch(() => {});
  }, 0);
}

async function tick(): Promise<void> {
  if (!starter) return;
  const cap = getCap("pipeline");
  if (cap <= 0) return;

  const queuedByOwner = await withPrisma(async (prisma) => {
    return prisma.forgeRun.findMany({
      where: { status: "queued", ownerEmail: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { runId: true, ownerEmail: true },
    });
  });
  if (queuedByOwner.length === 0) return;

  const grouped = new Map<string, string[]>();
  for (const row of queuedByOwner) {
    if (!row.ownerEmail) continue;
    const arr = grouped.get(row.ownerEmail) ?? [];
    arr.push(row.runId);
    grouped.set(row.ownerEmail, arr);
  }

  for (const [owner, runIds] of grouped) {
    const active = await withPrisma(async (prisma) =>
      prisma.forgeRun.count({
        where: {
          ownerEmail: owner,
          status: { in: ["pending", "running"] },
        },
      }),
    );
    const free = Math.max(0, cap - active);
    if (free === 0) continue;

    const toPromote = runIds.slice(0, free);
    for (const runId of toPromote) {
      const claimed = await claimQueuedRun(runId);
      if (!claimed) continue;
      try {
        log.info("Promoting queued pipeline run", { runId, owner });
        await logActivity("pipeline_promoted", {
          userId: owner,
          resourceId: runId,
        });
        starter
          .start(runId, { ownerEmail: owner, oboToken: null })
          .catch((err) => {
            log.error("Promoted pipeline crashed", {
              runId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } catch (err) {
        log.error("Pipeline promotion failed", {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * Atomically transition a `queued` run into `pending`. Only one caller wins
 * per run -- duplicate ticks no-op.
 */
async function claimQueuedRun(runId: string): Promise<boolean> {
  const result = await withPrisma(async (prisma) => {
    const updated = await prisma.forgeRun.updateMany({
      where: { runId, status: "queued" },
      data: { status: "pending" },
    });
    return updated.count;
  });
  return result === 1;
}

/**
 * Compute a queued run's position in the user's queue (1-based).
 */
export async function getQueuePosition(runId: string): Promise<number | null> {
  return withPrisma(async (prisma) => {
    const me = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { ownerEmail: true, status: true, createdAt: true },
    });
    if (!me || me.status !== "queued" || !me.ownerEmail) return null;
    const ahead = await prisma.forgeRun.count({
      where: {
        ownerEmail: me.ownerEmail,
        status: "queued",
        createdAt: { lt: me.createdAt },
      },
    });
    return ahead + 1;
  });
}
