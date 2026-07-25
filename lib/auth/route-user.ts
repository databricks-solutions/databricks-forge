/**
 * Single source of truth for "who is the current user?" inside API routes,
 * server components, and engine entry points.
 *
 * Identity resolution order:
 *   1. Databricks Apps proxy headers (`x-forwarded-email` /
 *      `x-forwarded-preferred-username`) -- set when the app is deployed
 *      behind the Databricks Apps proxy.
 *   2. **Dev-only** `?as_user=alice@x.com` query param -- gated behind
 *      `NODE_ENV !== "production"`. Lets a dev tab swap identities for
 *      end-to-end isolation testing without restarting the server.
 *   3. `FORGE_LOCAL_USER_EMAIL` env var -- the local-dev fallback.
 *
 * OBO token capture: `x-forwarded-access-token` from the Databricks Apps
 * proxy in prod, otherwise `getBearerToken()` (which itself prefers the OBO
 * header, then PAT/CLI/SP). The captured token is the one that should be
 * threaded into every fire-and-forget engine call so background work runs
 * as the logged-in user (especially for the Genie Conversation API).
 */

import { headers as nextHeaders } from "next/headers";
import { getBearerToken } from "@/lib/dbx/client";

export type ForgeUser = {
  email: string;
  oboToken: string | null;
};

export class ForgeAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "ForgeAuthError";
    this.status = status;
  }
}

const X_FORWARDED_EMAIL = "x-forwarded-email";
const X_FORWARDED_PREFERRED_USERNAME = "x-forwarded-preferred-username";
const X_FORWARDED_ACCESS_TOKEN = "x-forwarded-access-token";

/**
 * Forward header set by `proxy.ts` (Next.js 16's renamed middleware
 * convention) so handlers can read identity cheaply without re-resolving
 * from the Databricks Apps proxy headers on every call.
 */
export const X_FORGE_USER_HEADER = "x-forge-user";

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Try to extract an `?as_user=` override. Only honoured outside production.
 * Returns null when the header bag is unavailable or the param is missing.
 */
function readAsUserOverride(req: Request | null): string | null {
  if (!isDev() || !req) return null;
  try {
    const url = new URL(req.url);
    const v = url.searchParams.get("as_user");
    return v && v.includes("@") ? v.toLowerCase().trim() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current user's email from request context.
 *
 * Throws `ForgeAuthError(401)` when nothing resolves.
 */
export async function requireUser(req?: Request): Promise<ForgeUser> {
  const user = await getUserOrNull(req);
  if (!user) {
    throw new ForgeAuthError(
      "No user identity found. Set FORGE_LOCAL_USER_EMAIL for local dev, " +
        "or ensure the Databricks Apps proxy is forwarding x-forwarded-email.",
    );
  }
  return user;
}

/**
 * Like `requireUser` but returns null instead of throwing.
 *
 * Use only for endpoints that legitimately serve unauthenticated callers
 * (`/api/health`, static catalog reads). Most route handlers should use
 * `requireUser()`.
 */
export async function getUserOrNull(req?: Request): Promise<ForgeUser | null> {
  let email: string | null = null;
  let oboToken: string | null = null;

  try {
    const hdrs = await nextHeaders();

    const forgeHeader = hdrs.get(X_FORGE_USER_HEADER);
    if (forgeHeader) {
      try {
        const parsed = JSON.parse(forgeHeader) as { email?: string };
        if (parsed.email) email = parsed.email;
      } catch {
        // ignore malformed forge user header
      }
    }

    if (!email) {
      const proxyEmail =
        hdrs.get(X_FORWARDED_EMAIL) ?? hdrs.get(X_FORWARDED_PREFERRED_USERNAME);
      if (proxyEmail) email = proxyEmail;
    }

    const proxyToken = hdrs.get(X_FORWARDED_ACCESS_TOKEN);
    if (proxyToken) oboToken = proxyToken;
  } catch {
    // outside request context (background job, build time, tests)
  }

  // Dev-only request-scoped override.
  const asUser = readAsUserOverride(req ?? null);
  if (asUser) email = asUser;

  if (!email) {
    email = process.env.FORGE_LOCAL_USER_EMAIL ?? null;
  }

  if (!email) return null;

  // If we don't have an OBO token from the proxy yet, attempt to capture
  // whatever the bearer-token chain produces (PAT/CLI/SP in dev, the OBO
  // token in prod via the same x-forwarded-access-token header).
  if (!oboToken) {
    try {
      oboToken = await getBearerToken();
    } catch {
      oboToken = null;
    }
  }

  return { email: email.toLowerCase().trim(), oboToken };
}

/**
 * Convenience: read the email only. Throws when missing.
 */
export async function requireUserEmail(req?: Request): Promise<string> {
  const user = await requireUser(req);
  return user.email;
}
