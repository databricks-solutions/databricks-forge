/**
 * Typed client-side fetch utility.
 *
 * Wraps `fetch`, parses JSON, and throws a descriptive `FetchError` on
 * non-2xx responses. Centralizes the `if (!res.ok)` boilerplate repeated
 * across ~35 components.
 *
 * For resilient (retrying) fetches, use `resilientFetchJson` which
 * delegates to `resilientFetch` under the hood.
 */

import { resilientFetch } from "./resilient-fetch";

export class FetchError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    this.code = code;
  }
}

async function parseErrorBody(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = await res.json();
    return {
      message: body.error ?? body.message ?? `Request failed (${res.status})`,
      code: body.code,
    };
  } catch {
    return { message: `Request failed (${res.status})` };
  }
}

/**
 * Fetch JSON from `url`. Throws `FetchError` on non-2xx responses.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    throw new FetchError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

/**
 * Resilient version with automatic retry on 5xx / network errors.
 */
export async function resilientFetchJson<T>(
  url: string,
  init?: RequestInit,
  options?: { retries?: number; delayMs?: number },
): Promise<T> {
  const res = await resilientFetch(url, init, options);
  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    throw new FetchError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}
