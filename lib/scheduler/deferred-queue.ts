/**
 * Generic in-memory deferred-job queue.
 *
 * Used by short-lived fire-and-forget kickoffs (estate scans, demo
 * engines, Genie deploys) where the per-user cap would otherwise reject
 * the request. Instead of rejecting, the kickoff route enqueues a
 * closure here; the queue tick promotes the closure as soon as the
 * user's active count drops below the cap.
 *
 * Pipeline runs use a different (DB-backed) scheduler in
 * `lib/pipeline/scheduler.ts` because they are long-running and must
 * survive process restarts. Scans / demo / Genie deploys are short
 * enough that an in-memory queue with the same atomic tick pattern is
 * adequate -- if the process dies, the user simply re-issues the
 * request.
 *
 * The queue is process-local. With multiple App instances, each
 * instance runs its own queue; capacity counters read from Lakebase, so
 * cross-instance fairness is approximate but capacity is never
 * exceeded.
 */

import { logger } from "@/lib/logger";
import { countActive, getCap, type QuotaKind } from "@/lib/quotas";

const log = logger;

interface DeferredJob {
  jobId: string;
  ownerEmail: string;
  kind: QuotaKind;
  enqueuedAt: number;
  /** Best-effort lease refresh while this job remains in the local queue. */
  onHeartbeat?: () => Promise<void>;
  /**
   * Async closure that does the actual work. The closure must capture
   * the OBO token + any other request-scoped context at enqueue time --
   * it will run in a background context with no `headers()` available.
   */
  run: () => Promise<void>;
}

const queues = new Map<QuotaKind, DeferredJob[]>();
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 5000;

function getQueue(kind: QuotaKind): DeferredJob[] {
  let q = queues.get(kind);
  if (!q) {
    q = [];
    queues.set(kind, q);
  }
  return q;
}

export interface EnqueueResult {
  jobId: string;
  position: number;
}

/** Generate the queue identity before the caller persists its durable claim. */
export function createDeferredJobId(kind: QuotaKind, ownerEmail: string): string {
  return `${kind}-${ownerEmail.toLowerCase().trim()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Enqueue a deferred job. Returns the queue position (1-based among
 * jobs of the same kind for this user). Triggers an immediate tick so
 * the job runs right away if capacity is already free.
 */
export function enqueueDeferredJob(args: {
  kind: QuotaKind;
  ownerEmail: string;
  run: () => Promise<void>;
  jobId?: string;
  onHeartbeat?: () => Promise<void>;
}): EnqueueResult {
  const jobId = args.jobId ?? createDeferredJobId(args.kind, args.ownerEmail);
  const job: DeferredJob = {
    jobId,
    ownerEmail: args.ownerEmail.toLowerCase().trim(),
    kind: args.kind,
    enqueuedAt: Date.now(),
    onHeartbeat: args.onHeartbeat,
    run: args.run,
  };
  const q = getQueue(args.kind);
  q.push(job);
  const ahead = q.filter((j) => j.ownerEmail === job.ownerEmail).length;
  log.info("[deferred-queue] Enqueued job", {
    jobId,
    kind: args.kind,
    ownerEmail: job.ownerEmail,
    queueLengthGlobal: q.length,
    queueLengthForUser: ahead,
  });
  notifyDeferredQueue();
  return { jobId, position: ahead };
}

export function startDeferredQueue(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => {
      log.warn("[deferred-queue] tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, TICK_MS);
  log.info("[deferred-queue] started", { tickMs: TICK_MS });
}

export function stopDeferredQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Trigger an immediate tick. Safe to call from anywhere. */
export function notifyDeferredQueue(): void {
  setTimeout(() => {
    tick().catch(() => {});
  }, 0);
}

async function tick(): Promise<void> {
  for (const [kind, queue] of queues) {
    if (queue.length === 0) continue;

    // Refresh durable queue leases before checking capacity. A job may wait
    // much longer than the stale-running threshold under legitimate load; its
    // fresh lease distinguishes that delay from a process-restart orphan.
    await Promise.allSettled(
      queue.map((job) => (job.onHeartbeat ? job.onHeartbeat() : Promise.resolve())),
    );

    const cap = getCap(kind);
    if (cap <= 0) continue;

    // Group by owner so we can pull at most `cap - active` per user.
    const byOwner = new Map<string, DeferredJob[]>();
    for (const job of queue) {
      const arr = byOwner.get(job.ownerEmail) ?? [];
      arr.push(job);
      byOwner.set(job.ownerEmail, arr);
    }

    for (const [owner, jobs] of byOwner) {
      let active = 0;
      try {
        active = await countActive(kind, owner);
      } catch (err) {
        log.warn("[deferred-queue] countActive failed", {
          kind,
          owner,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const free = Math.max(0, cap - active);
      if (free === 0) continue;

      const toRun = jobs.slice(0, free);
      for (const job of toRun) {
        // Remove from the queue atomically (idempotent: we use the same
        // reference, so removeOnce is enough).
        const idx = queue.indexOf(job);
        if (idx === -1) continue; // someone else dequeued
        queue.splice(idx, 1);

        log.info("[deferred-queue] Running deferred job", {
          jobId: job.jobId,
          kind,
          owner,
          waitedMs: Date.now() - job.enqueuedAt,
        });
        // Fire and forget. The closure is responsible for its own
        // error reporting; we just log a top-level failure.
        void (async () => {
          try {
            await job.run();
          } catch (err) {
            log.error("[deferred-queue] Deferred job crashed", {
              jobId: job.jobId,
              kind,
              owner,
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            // Capacity may have freed up for the next waiter.
            notifyDeferredQueue();
          }
        })();
      }
    }
  }
}

/**
 * Inspect: how many jobs are queued for this user across all kinds.
 * Useful for the system-load endpoint and debug surfaces.
 */
export function inspectQueueDepth(): {
  total: number;
  byKind: Record<QuotaKind, number>;
} {
  const byKind: Record<QuotaKind, number> = {
    pipeline: 0,
    scan: 0,
    genie_deploy: 0,
    demo_engine: 0,
  };
  let total = 0;
  for (const [kind, q] of queues) {
    byKind[kind] = q.length;
    total += q.length;
  }
  return { total, byKind };
}

/** For tests: drain everything synchronously. */
export function _resetForTests(): void {
  queues.clear();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
