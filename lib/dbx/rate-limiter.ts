/**
 * Per-endpoint LLM rate limiter with independent 429 circuit breakers.
 *
 * Each model endpoint gets its own semaphore + circuit breaker so a 429 on
 * one endpoint does not block calls to others. An optional global ceiling
 * (GLOBAL_LLM_MAX_CONCURRENT) caps total inflight calls across all endpoints.
 *
 * The PoolRateLimiter also exposes `bestAvailable(candidates)` so the task
 * router can pick the endpoint with the lowest queue depth.
 */

import { createScopedLogger } from "@/lib/logger";
import { getModelPool } from "./model-registry";

const log = createScopedLogger({ origin: "Infra", module: "dbx/rate-limiter" });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GLOBAL_MAX = Math.max(0, parseInt(process.env.GLOBAL_LLM_MAX_CONCURRENT ?? "0", 10) || 0);

export const DEFAULT_429_BACKOFF_MS = 10_000;

const BACKOFF_ESCALATION = [10_000, 20_000, 30_000] as const;

// ---------------------------------------------------------------------------
// Semaphore (unchanged from original, now used per-endpoint)
// ---------------------------------------------------------------------------

interface QueuedWaiter {
  userKey: string;
  resolve: () => void;
}

/**
 * Per-endpoint slot pool with optional weighted fair-share between users.
 *
 * If a userKey is provided on `acquire`, releasing a slot wakes the waiter
 * belonging to the user with the fewest current inflight calls (max-min).
 * Falls back to FIFO when only one user is waiting.
 */
class Semaphore {
  private current = 0;
  private readonly queue: QueuedWaiter[] = [];
  private readonly perUserInflight = new Map<string, number>();

  constructor(private readonly max: number) {}

  async acquire(userKey = "system"): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      this.perUserInflight.set(userKey, (this.perUserInflight.get(userKey) ?? 0) + 1);
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push({
        userKey,
        resolve: () => {
          this.current++;
          this.perUserInflight.set(userKey, (this.perUserInflight.get(userKey) ?? 0) + 1);
          resolve();
        },
      });
    });
  }

  release(userKey = "system"): void {
    this.current--;
    const cur = this.perUserInflight.get(userKey) ?? 0;
    if (cur > 1) this.perUserInflight.set(userKey, cur - 1);
    else this.perUserInflight.delete(userKey);

    if (this.queue.length === 0) return;

    let nextIdx = 0;
    if (this.queue.length > 1) {
      let bestScore = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const candidate = this.queue[i];
        const score = this.perUserInflight.get(candidate.userKey) ?? 0;
        if (score < bestScore) {
          bestScore = score;
          nextIdx = i;
        }
      }
    }
    const [next] = this.queue.splice(nextIdx, 1);
    next.resolve();
  }

  get inflight(): number {
    return this.current;
  }

  get pending(): number {
    return this.queue.length;
  }

  inflightForUser(userKey: string): number {
    return this.perUserInflight.get(userKey) ?? 0;
  }

  pendingForUser(userKey: string): number {
    return this.queue.filter((q) => q.userKey === userKey).length;
  }
}

// ---------------------------------------------------------------------------
// Per-endpoint limiter
// ---------------------------------------------------------------------------

interface EndpointLimiter {
  semaphore: Semaphore;
  blockedUntil: number;
  /** Consecutive 429 hits (resets on success). Drives progressive backoff. */
  consecutive429s: number;
}

// ---------------------------------------------------------------------------
// Pool Rate Limiter
// ---------------------------------------------------------------------------

class PoolRateLimiter {
  private readonly limiters = new Map<string, EndpointLimiter>();
  private readonly globalSemaphore: Semaphore | null;

  constructor() {
    const pool = getModelPool();
    for (const ep of pool) {
      this.limiters.set(ep.name, {
        semaphore: new Semaphore(ep.maxConcurrent),
        blockedUntil: 0,
        consecutive429s: 0,
      });
    }

    const poolMax = pool.reduce((s, ep) => s + ep.maxConcurrent, 0);
    const effectiveGlobal = GLOBAL_MAX > 0 ? GLOBAL_MAX : poolMax;
    this.globalSemaphore = effectiveGlobal < poolMax ? new Semaphore(effectiveGlobal) : null;

    log.info("Pool rate limiter initialised", {
      endpoints: pool.length,
      perEndpoint: pool.map((ep) => ({ name: ep.name, max: ep.maxConcurrent })),
      globalCeiling: effectiveGlobal,
    });
  }

  private getOrCreate(endpoint: string): EndpointLimiter {
    let lim = this.limiters.get(endpoint);
    if (!lim) {
      lim = { semaphore: new Semaphore(6), blockedUntil: 0, consecutive429s: 0 };
      this.limiters.set(endpoint, lim);
    }
    return lim;
  }

  async acquire(endpoint: string, userKey: string = "system"): Promise<void> {
    const lim = this.getOrCreate(endpoint);

    const acquireStart = Date.now();
    let throttleMs = 0;

    const now = Date.now();
    if (now < lim.blockedUntil) {
      const baseWait = lim.blockedUntil - now;
      const jitteredWait = addJitter(baseWait);
      log.debug("Pool rate limiter: waiting for 429 backoff", {
        endpoint,
        waitMs: Math.round(jitteredWait),
      });
      await new Promise((resolve) => setTimeout(resolve, jitteredWait));
      throttleMs = Math.round(jitteredWait);
    }

    if (this.globalSemaphore) {
      await this.globalSemaphore.acquire(userKey);
    }
    await lim.semaphore.acquire(userKey);

    // Attribute the wait + throttle ms to the in-flight (run, step) if
    // this acquire happened inside a pipeline step. Outside of a step
    // (assistant calls, ad-hoc engines, etc.) this no-ops.
    try {
      const { getRunStepContext } = await import("@/lib/pipeline/run-context");
      const ctx = getRunStepContext();
      if (ctx) {
        const { recordThrottleMs: rec } = await import("@/lib/pipeline/step-instrumentation");
        if (throttleMs > 0) rec(ctx.runId, ctx.step, throttleMs);
        // Waiting time = total elapsed - throttle component (semaphore wait)
        // Per the instrumentation contract, waiting goes through
        // `instrumentedAcquire`. We record the semaphore-only delta here so
        // existing callers (which call `acquire` directly) still produce
        // useful telemetry.
        const totalMs = Date.now() - acquireStart;
        const waitingMs = Math.max(0, totalMs - throttleMs);
        if (waitingMs > 0) {
          // No-op if the (run, step) was already accounted for via
          // instrumentedAcquire -- the dual write is intentional and the
          // counters just sum.
          const { _addWaitingMs } = await import("@/lib/pipeline/step-instrumentation");
          _addWaitingMs(ctx.runId, ctx.step, waitingMs);
        }
      }
    } catch {
      // Pipeline modules may not be loaded in non-pipeline contexts; safe to ignore.
    }
  }

  release(endpoint: string, userKey: string = "system"): void {
    const lim = this.limiters.get(endpoint);
    if (lim) {
      lim.semaphore.release(userKey);
      // Gradual cooldown: decrement rather than reset so the backoff tier
      // decreases smoothly under sustained load instead of oscillating.
      if (lim.consecutive429s > 0) {
        lim.consecutive429s = Math.max(0, lim.consecutive429s - 1);
        if (lim.consecutive429s === 0) {
          lim.blockedUntil = 0;
        }
      }
    }
    if (this.globalSemaphore) this.globalSemaphore.release(userKey);
  }

  backoff(endpoint: string, retryAfterMs: number): void {
    const lim = this.getOrCreate(endpoint);
    lim.consecutive429s++;
    const tier = Math.min(lim.consecutive429s, BACKOFF_ESCALATION.length) - 1;
    const escalatedMs = retryAfterMs > 0 ? retryAfterMs : BACKOFF_ESCALATION[tier];
    const until = Date.now() + escalatedMs;
    if (until > lim.blockedUntil) {
      lim.blockedUntil = until;
      log.warn("Pool rate limiter: 429 circuit breaker activated", {
        endpoint,
        backoffMs: escalatedMs,
        consecutive429s: lim.consecutive429s,
        inflight: lim.semaphore.inflight,
        pending: lim.semaphore.pending,
        errorCategory: "rate_limit",
      });
      // Audit log: best-effort, fire-and-forget so we don't slow down the hot path.
      void recordThrottleActivity(endpoint, escalatedMs).catch(() => {});

      // Per-step counter: when a 429 fires inside a pipeline step, attribute it.
      void (async () => {
        try {
          const { getRunStepContext } = await import("@/lib/pipeline/run-context");
          const ctx = getRunStepContext();
          if (ctx) {
            const { recordThrottleMs } = await import(
              "@/lib/pipeline/step-instrumentation"
            );
            recordThrottleMs(ctx.runId, ctx.step, escalatedMs);
          }
        } catch {
          // outside a pipeline run -- no-op
        }
      })();
    }
  }

  /**
   * Pick the best available endpoint from candidates. Prefers endpoints that
   * are not in 429 backoff, then the one with the lowest queue depth.
   */
  bestAvailable(candidates: string[]): string | null {
    if (candidates.length === 0) return null;

    const now = Date.now();
    let best: string | null = null;
    let bestScore = Infinity;

    for (const ep of candidates) {
      const lim = this.getOrCreate(ep);
      const blocked = now < lim.blockedUntil;
      // blocked endpoints get a large penalty so unblocked ones are preferred
      const score = (blocked ? 10_000 : 0) + lim.semaphore.inflight + lim.semaphore.pending;
      if (score < bestScore) {
        bestScore = score;
        best = ep;
      }
    }

    return best;
  }

  /** Whether a specific endpoint is currently in 429 backoff. */
  isBlocked(endpoint: string): boolean {
    const lim = this.limiters.get(endpoint);
    return lim ? Date.now() < lim.blockedUntil : false;
  }

  /** Current inflight count for an endpoint. */
  inflight(endpoint: string): number {
    return this.limiters.get(endpoint)?.semaphore.inflight ?? 0;
  }

  /** Total inflight across all endpoints. */
  totalInflight(): number {
    let total = 0;
    this.limiters.forEach((lim) => {
      total += lim.semaphore.inflight;
    });
    return total;
  }

  /** Total queued waiters across all endpoints. */
  totalPending(): number {
    let total = 0;
    this.limiters.forEach((lim) => {
      total += lim.semaphore.pending;
    });
    return total;
  }

  /** Snapshot of every endpoint's queue depth + 429 status. */
  snapshot(): Array<{
    name: string;
    inflight: number;
    pending: number;
    blocked: boolean;
    blockedUntil: number;
  }> {
    const now = Date.now();
    const out: Array<{
      name: string;
      inflight: number;
      pending: number;
      blocked: boolean;
      blockedUntil: number;
    }> = [];
    this.limiters.forEach((lim, name) => {
      out.push({
        name,
        inflight: lim.semaphore.inflight,
        pending: lim.semaphore.pending,
        blocked: now < lim.blockedUntil,
        blockedUntil: lim.blockedUntil,
      });
    });
    return out;
  }

  /** Inflight + pending counts for a specific user across all endpoints. */
  perUserSnapshot(userKey: string): { inflight: number; pending: number } {
    let inflight = 0;
    let pending = 0;
    this.limiters.forEach((lim) => {
      inflight += lim.semaphore.inflightForUser(userKey);
      pending += lim.semaphore.pendingForUser(userKey);
    });
    return { inflight, pending };
  }
}

// ---------------------------------------------------------------------------
// Jitter utility
// ---------------------------------------------------------------------------

/**
 * Add +/- 25% random jitter to a delay to spread retries and prevent
 * thundering herd. Returns `delay * (0.75 + Math.random() * 0.5)`.
 */
export function addJitter(delayMs: number): number {
  return delayMs * (0.75 + Math.random() * 0.5);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _poolRateLimiter: PoolRateLimiter | null = null;

export function getPoolRateLimiter(): PoolRateLimiter {
  if (!_poolRateLimiter) {
    _poolRateLimiter = new PoolRateLimiter();
  }
  return _poolRateLimiter;
}

/** Reset (for testing). */
export function resetPoolRateLimiter(): void {
  _poolRateLimiter = null;
}

// ---------------------------------------------------------------------------
// Throttle audit log (best-effort, debounced per-endpoint to avoid noise)
// ---------------------------------------------------------------------------

const THROTTLE_LOG_DEBOUNCE_MS = 30_000;
const lastThrottleLogAt = new Map<string, number>();

async function recordThrottleActivity(endpoint: string, backoffMs: number): Promise<void> {
  const now = Date.now();
  const last = lastThrottleLogAt.get(endpoint) ?? 0;
  if (now - last < THROTTLE_LOG_DEBOUNCE_MS) return;
  lastThrottleLogAt.set(endpoint, now);
  try {
    const { logActivity } = await import("@/lib/lakebase/activity-log");
    await logActivity("endpoint_throttled", {
      metadata: { endpoint, backoffMs },
    });
  } catch {
    // Activity log is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Legacy compat: globalRateLimiter facade
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for the old `globalRateLimiter` export.
 * Routes acquire/release/backoff to the pool rate limiter for the given endpoint.
 * Callers that haven't been migrated yet will call acquire() with no endpoint
 * arg -- this falls back to the primary endpoint.
 */
export const globalRateLimiter = {
  async acquire(endpoint?: string, userKey?: string): Promise<void> {
    const ep = endpoint ?? getModelPool()[0]?.name ?? "default";
    return getPoolRateLimiter().acquire(ep, userKey);
  },
  release(endpoint?: string, userKey?: string): void {
    const ep = endpoint ?? getModelPool()[0]?.name ?? "default";
    getPoolRateLimiter().release(ep, userKey);
  },
  backoff(retryAfterMsOrEndpoint: number | string, retryAfterMs?: number): void {
    if (typeof retryAfterMsOrEndpoint === "string") {
      getPoolRateLimiter().backoff(retryAfterMsOrEndpoint, retryAfterMs ?? DEFAULT_429_BACKOFF_MS);
    } else {
      const ep = getModelPool()[0]?.name ?? "default";
      getPoolRateLimiter().backoff(ep, retryAfterMsOrEndpoint);
    }
  },
};
