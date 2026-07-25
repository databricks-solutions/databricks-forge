/**
 * Client-side fetch wrapper with transparent retry for transient errors.
 *
 * Retries server errors (5xx) and network failures up to `retries` times
 * with a fixed delay between attempts. Client errors (4xx) and abort
 * signals are never retried.
 */
export async function resilientFetch(
  url: string,
  init?: RequestInit,
  options?: { retries?: number; delayMs?: number },
): Promise<Response> {
  const { retries = 2, delayMs = 1000 } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err;
    }

    if (attempt < retries) {
      if (init?.signal?.aborted) break;
      await new Promise((r) => setTimeout(r, delayMs));
      if (init?.signal?.aborted) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Fetch failed after retries");
}
