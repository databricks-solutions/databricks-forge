/**
 * Sanitise error messages for HTTP responses.
 *
 * In production, returns a generic message to avoid leaking internal details
 * (stack traces, connection strings, SQL errors) to clients.
 * In development, returns the raw message for easier debugging.
 *
 * Logger calls should continue using the raw error for server-side diagnostics.
 */

const GENERIC = "An internal error occurred.";

export function safeErrorMessage(err: unknown): string {
  if (process.env.NODE_ENV !== "production") {
    return err instanceof Error ? err.message : String(err);
  }
  return GENERIC;
}

/**
 * Safely extract an error message from a non-OK fetch response.
 *
 * Proxies (Vercel, Next.js, load balancers) can return plain-text bodies such
 * as "upstream request timeout" instead of JSON. Calling `res.json()` on those
 * throws `SyntaxError: Unexpected token ...`.  This helper reads the body as
 * text first, then attempts JSON parsing.
 */
export async function parseErrorResponse(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text);
    return data.error ?? data.message ?? (text || fallback);
  } catch {
    return text || fallback;
  }
}

/**
 * Safely parse a JSON response body, returning `null` when the body is not
 * valid JSON (e.g. proxy error strings on an initially-OK response).
 */
export async function safeJsonParse<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
