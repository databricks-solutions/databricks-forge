/**
 * Per-(run, step) instrumentation for rate-limit waits and throttle events.
 *
 * The pipeline acquires LLM slots from `lib/dbx/rate-limiter.ts` for every
 * call. Two separate signals matter:
 *
 *   - waiting       -- time spent inside `Semaphore.acquire()` because all
 *                      slots are in use (queue contention, no 429)
 *   - throttled     -- time spent inside the 429 circuit-breaker backoff
 *                      (the endpoint returned 429 recently)
 *
 * This module exposes:
 *
 *   - `instrumentedAcquire(limiter, endpoint, userKey, runId, step)` --
 *     drop-in replacement for `limiter.acquire(...)` that records the
 *     wait + throttle ms into per-step counters.
 *   - `recordThrottleMs(runId, step, ms)` -- write helper used by the
 *     rate limiter when the circuit breaker fires.
 *   - `getStepCounters(runId)` -- read snapshot for the run-detail UI.
 *
 * The store is process-local. With multiple App instances, each instance
 * tracks its own counters; the run-detail page polls one instance at a
 * time so the values reflect what that instance saw. Counters reset on
 * process restart.
 *
 * No DB writes -- this is hot-path instrumentation.
 */

interface StepCounter {
  waitingMs: number;
  throttledMs: number;
  acquires: number;
  throttleEvents: number;
  lastUpdatedAt: number;
}

type RunCounters = Map<string /* step */, StepCounter>;

const counters = new Map<string /* runId */, RunCounters>();

const MAX_RUNS = 200;

function ensure(runId: string, step: string): StepCounter {
  if (counters.size > MAX_RUNS) {
    // Evict the oldest entry (insertion-order preserved by Map).
    const firstKey = counters.keys().next().value;
    if (firstKey) counters.delete(firstKey);
  }
  let runMap = counters.get(runId);
  if (!runMap) {
    runMap = new Map();
    counters.set(runId, runMap);
  }
  let stepCounter = runMap.get(step);
  if (!stepCounter) {
    stepCounter = {
      waitingMs: 0,
      throttledMs: 0,
      acquires: 0,
      throttleEvents: 0,
      lastUpdatedAt: 0,
    };
    runMap.set(step, stepCounter);
  }
  return stepCounter;
}

interface MinimalLimiter {
  acquire(endpoint: string, userKey?: string): Promise<void>;
}

/**
 * Wrap a single limiter acquire with timing. The function returns
 * (resolves) once the slot has been acquired, mirroring the underlying
 * limiter API.
 *
 * The split between `waiting` and `throttled` is approximate: we treat
 * the entire `acquire()` call as `waiting` and let the limiter publish
 * `throttled` separately via `recordThrottleMs`. This keeps the hot
 * path simple.
 */
export async function instrumentedAcquire(
  limiter: MinimalLimiter,
  endpoint: string,
  userKey: string,
  runId: string | null | undefined,
  step: string | null | undefined,
): Promise<void> {
  if (!runId || !step) {
    return limiter.acquire(endpoint, userKey);
  }
  const c = ensure(runId, step);
  const start = Date.now();
  try {
    await limiter.acquire(endpoint, userKey);
  } finally {
    const dur = Date.now() - start;
    c.waitingMs += dur;
    c.acquires += 1;
    c.lastUpdatedAt = Date.now();
  }
}

/**
 * Record a throttle (429 backoff) event for a (run, step). Called by
 * the rate limiter when its circuit breaker fires AND a runId/step is
 * known for the in-flight request.
 */
export function recordThrottleMs(
  runId: string | null | undefined,
  step: string | null | undefined,
  ms: number,
): void {
  if (!runId || !step) return;
  const c = ensure(runId, step);
  c.throttledMs += ms;
  c.throttleEvents += 1;
  c.lastUpdatedAt = Date.now();
}

/**
 * Internal: increment the waiting counter directly. Used by the rate
 * limiter to attribute semaphore-wait time without forcing every LLM
 * caller to switch to `instrumentedAcquire`. Prefixed with `_` to mark
 * it as not-for-public-use.
 */
export function _addWaitingMs(
  runId: string | null | undefined,
  step: string | null | undefined,
  ms: number,
): void {
  if (!runId || !step) return;
  if (ms <= 0) return;
  const c = ensure(runId, step);
  c.waitingMs += ms;
  c.lastUpdatedAt = Date.now();
}

export interface StepCounterSnapshot {
  step: string;
  waitingMs: number;
  throttledMs: number;
  acquires: number;
  throttleEvents: number;
}

/**
 * Read the current per-step counters for a run. Returns an empty array
 * if the run has not contributed any LLM activity in this process.
 */
export function getStepCounters(runId: string): StepCounterSnapshot[] {
  const runMap = counters.get(runId);
  if (!runMap) return [];
  return Array.from(runMap.entries())
    .map(([step, c]) => ({
      step,
      waitingMs: c.waitingMs,
      throttledMs: c.throttledMs,
      acquires: c.acquires,
      throttleEvents: c.throttleEvents,
    }))
    .sort((a, b) => b.waitingMs + b.throttledMs - (a.waitingMs + a.throttledMs));
}

/**
 * Drop counters for a run. Called when the run completes or is deleted
 * so the in-memory map doesn't grow without bound.
 */
export function clearRunCounters(runId: string): void {
  counters.delete(runId);
}

/** For tests: drop everything. */
export function _resetForTests(): void {
  counters.clear();
}
