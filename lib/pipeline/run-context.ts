/**
 * AsyncLocalStorage-based run/step context.
 *
 * The pipeline engine wraps each step in `runWithStep(runId, step, fn)`
 * so any LLM call inside the step (no matter how deeply nested) can
 * read its current `(runId, step)` via `getRunStepContext()`.
 *
 * Used by:
 *
 *   - `lib/pipeline/step-instrumentation.ts` -- attributes wait/throttle
 *     ms back to the right run + step without threading them through
 *     every function signature.
 *   - `lib/dbx/rate-limiter.ts` -- attributes 429 backoff events to the
 *     in-flight (run, step) for the per-step UI line.
 *
 * If a piece of code runs outside any pipeline step (assistant calls,
 * ad-hoc engines, comment engine, etc.), the context returns null and
 * instrumentation silently no-ops.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RunStepContext {
  runId: string;
  step: string;
}

const storage = new AsyncLocalStorage<RunStepContext>();

/**
 * Run a function inside a (runId, step) context. All async work spawned
 * inherits the context via AsyncLocalStorage.
 */
export function runWithStep<T>(runId: string, step: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ runId, step }, fn);
}

/** Read the current (runId, step) context. Returns null when outside any step. */
export function getRunStepContext(): RunStepContext | null {
  return storage.getStore() ?? null;
}
