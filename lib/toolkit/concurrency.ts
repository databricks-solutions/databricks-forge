/**
 * Bounded-concurrency execution utility.
 *
 * Provides a simple concurrency limiter (similar to p-limit) to run
 * async tasks with a maximum number of concurrent executions, plus a
 * convenience helper for running an array of tasks with that limit.
 *
 * @module toolkit/concurrency
 */

type AsyncFn<T> = () => Promise<T>;

/**
 * Returns a limiter function that enforces a maximum concurrency for
 * async tasks. Tasks beyond the limit are queued and started as earlier
 * tasks complete.
 */
export function createConcurrencyLimiter(concurrency: number) {
  if (concurrency < 1) {
    throw new Error(`concurrency must be >= 1, got ${concurrency}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  return async function limit<T>(fn: AsyncFn<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      active--;
      next();
    }
  };
}

/**
 * Run an array of async task factories with bounded concurrency.
 * Results are returned in the same order as the input tasks.
 */
export function mapWithConcurrency<T>(tasks: Array<AsyncFn<T>>, concurrency: number): Promise<T[]> {
  const limit = createConcurrencyLimiter(concurrency);
  return Promise.all(tasks.map((fn) => limit(fn)));
}
