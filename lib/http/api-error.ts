/**
 * Client-side HTTP error classification.
 *
 * A pure, deterministic mapping from an HTTP status to a stable category and a
 * retryability hint, so every client `fetch` can distinguish the failure kinds
 * the UI must react to differently:
 *   - `not_found`   (404) — the resource is gone; surface a real not-found state
 *   - `forbidden`   (403) — the caller lacks permission; surface, do not retry
 *   - `unauthorized`(401) — session/auth problem
 *   - `conflict`    (409) — a user action is required (e.g. cancel first)
 *   - `server`      (5xx) — transient; safe to offer a retry
 *   - `client`      (other 4xx) — a bad request; do not retry
 *
 * `describeHttpError` composes this with a server-supplied message (already
 * sanitised by `parseErrorResponse`) to produce a single user-facing string.
 */

import { parseErrorResponse } from "@/lib/error-utils";

export type HttpErrorCategory =
  | "ok"
  | "not_found"
  | "forbidden"
  | "unauthorized"
  | "conflict"
  | "server"
  | "client"
  | "network";

export interface HttpErrorClass {
  category: HttpErrorCategory;
  /** Whether an automatic/offered retry is sensible for this failure. */
  retryable: boolean;
}

export function classifyHttpStatus(status: number): HttpErrorClass {
  if (status >= 200 && status < 300) return { category: "ok", retryable: false };
  if (status === 401) return { category: "unauthorized", retryable: false };
  if (status === 403) return { category: "forbidden", retryable: false };
  if (status === 404) return { category: "not_found", retryable: false };
  if (status === 409) return { category: "conflict", retryable: false };
  if (status >= 500) return { category: "server", retryable: true };
  if (status >= 400) return { category: "client", retryable: false };
  return { category: "network", retryable: true };
}

const CATEGORY_DEFAULT: Record<HttpErrorCategory, string> = {
  ok: "",
  not_found: "Not found — it may have been deleted.",
  forbidden: "You do not have permission to do that.",
  unauthorized: "Your session has expired. Please sign in again.",
  conflict: "That action conflicts with the current state. Please refresh and try again.",
  server: "Something went wrong on the server. Please try again later.",
  client: "The request was invalid.",
  network: "Network error. Please check your connection and try again.",
};

/**
 * Produce a single user-facing message for a failed response status. Prefers a
 * (already-sanitised) server-supplied message; otherwise falls back to a stable
 * per-category default.
 */
export function describeHttpError(
  status: number,
  serverMessage?: string | null,
): string {
  const trimmed = serverMessage?.trim();
  if (trimmed) return trimmed;
  const { category } = classifyHttpStatus(status);
  return CATEGORY_DEFAULT[category] || CATEGORY_DEFAULT.server;
}

/**
 * Read a non-OK response into a classified error the UI can branch on. Safely
 * parses the (possibly non-JSON) body via `parseErrorResponse` first.
 */
export async function readApiError(
  res: Response,
): Promise<HttpErrorClass & { message: string; status: number }> {
  const cls = classifyHttpStatus(res.status);
  const serverMessage = await parseErrorResponse(res, "").catch(() => "");
  return {
    ...cls,
    status: res.status,
    message: describeHttpError(res.status, serverMessage),
  };
}
