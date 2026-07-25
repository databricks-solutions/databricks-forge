/**
 * Fetch wrapper with AbortController-based timeout and optional external
 * cancellation signal.
 *
 * Prevents indefinite hangs when Databricks APIs are unresponsive.
 */

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${new URL(url).pathname} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export class FetchCancelledError extends Error {
  constructor(url: string) {
    super(`Request to ${new URL(url).pathname} was cancelled`);
    this.name = "FetchCancelledError";
  }
}

/**
 * Fetch with an automatic timeout. If the request doesn't complete within
 * `timeoutMs`, the request is aborted and a FetchTimeoutError is thrown.
 *
 * An optional `externalSignal` can be passed to allow the caller to cancel
 * the request independently of the timeout (e.g. user-initiated cancellation).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new FetchCancelledError(url);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

// Default timeouts by operation type
export const TIMEOUTS = {
  /** OAuth token exchange */
  AUTH: 15_000,
  /** SQL statement submission (must exceed server-side wait_timeout of 50s) */
  SQL_SUBMIT: 60_000,
  /** SQL statement polling */
  SQL_POLL: 15_000,
  /** SQL chunk fetching */
  SQL_CHUNK: 30_000,
  /** Workspace API calls */
  WORKSPACE: 30_000,
  /** Model Serving inference (LLM calls can take 1-3+ min) */
  MODEL_SERVING: 300_000,
  /** Model Serving streaming inference (longer for incremental delivery) */
  MODEL_SERVING_STREAM: 600_000,
} as const;
