/**
 * Edge proxy: enforces user authentication and per-route rate limiting on
 * `/api/**` routes.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`. This file
 * is the single edge entry point for the app; do NOT add a `middleware.ts`
 * alongside it (the build will fail).
 *
 * Responsibilities, in order:
 *
 * 1. Pass through public endpoints (health, industries, outcome-maps registry).
 * 2. Resolve the caller's email from proxy headers (`x-forwarded-email` /
 *    `x-forwarded-preferred-username`) with dev-only fallbacks
 *    (`?as_user=alice@x.com`, `FORGE_LOCAL_USER_EMAIL`). Reject with 401 when
 *    no identity can be resolved.
 * 3. Apply the in-memory sliding-window rate limit per user (or per IP) using
 *    `lib/rate-limit.ts`.
 * 4. Forward a normalised `x-forge-user` header so route handlers and server
 *    components can read identity cheaply without re-parsing proxy headers.
 *
 * Server Components do NOT pass through this proxy -- they must call
 * `requireUser()` directly. See `lib/auth/route-user.ts`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/industries",
  "/api/outcome-maps/registry",
  // Static catalog and registry endpoints stay open. Anything that lists or
  // mutates user data must NOT be added here.
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function readEmailFromHeaders(req: NextRequest): string | null {
  const proxy =
    req.headers.get("x-forwarded-email") ??
    req.headers.get("x-forwarded-preferred-username");
  if (proxy) return proxy.toLowerCase().trim();

  if (process.env.NODE_ENV !== "production") {
    const asUser = req.nextUrl.searchParams.get("as_user");
    if (asUser && asUser.includes("@")) return asUser.toLowerCase().trim();
    const fallback = process.env.FORGE_LOCAL_USER_EMAIL;
    if (fallback) return fallback.toLowerCase().trim();
  }

  // Production fallback: still honour the env var if explicitly set (rare,
  // intentional admin scenarios). Production deploys without the proxy
  // header should fail 401.
  if (process.env.FORGE_LOCAL_USER_EMAIL) {
    return process.env.FORGE_LOCAL_USER_EMAIL.toLowerCase().trim();
  }

  return null;
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const email = readEmailFromHeaders(req);
  if (!email) {
    return NextResponse.json(
      {
        error:
          "Unauthorised. No user identity found in request. " +
          "Configure the Databricks Apps proxy or set FORGE_LOCAL_USER_EMAIL for local dev.",
      },
      { status: 401 },
    );
  }

  const clientKey = email ?? req.headers.get("x-forwarded-for") ?? "unknown";
  const rateLimitResult = checkRateLimit(pathname, clientKey);
  if (rateLimitResult) {
    const retryAfterSec = Math.ceil(rateLimitResult.retryAfterMs / 1000);
    return NextResponse.json(
      { error: rateLimitResult.error },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-forge-user", JSON.stringify({ email }));

  return NextResponse.next({
    request: {
      headers: forwardedHeaders,
    },
  });
}

export const config = {
  // Run on /api/** only. Static pages and Server Components are handled
  // independently via requireUser() at the page level.
  matcher: ["/api/:path*"],
};
