/**
 * Authorization guard for the V2 cross-owner Portfolio (CDO) tier.
 *
 * Returns a tagged union mirroring `lib/auth/route-guards.ts`:
 *   - `{ ok: true, user }` when the caller is authenticated AND the portfolio
 *     tier is both enabled (`FORGE_PORTFOLIO_ENABLED`) and the caller is on the
 *     org-admin allowlist (`FORGE_ORG_ADMIN_EMAILS`).
 *   - `{ ok: false, response }` carrying a 401 (no identity) or 403 (tier
 *     disabled / not allowlisted) to return immediately.
 *
 * This is the ONLY place that crosses Forge's per-owner isolation boundary, so
 * the gate is intentionally strict and never honours an ambient isolation
 * bypass. The 403 reason is coarse (it never enumerates the allowlist).
 */

import { NextResponse } from "next/server";
import { requireUser, ForgeAuthError, type ForgeUser } from "@/lib/auth/route-user";
import { isPortfolioEnabled } from "@/lib/config/portfolio-flag";
import { isPortfolioAdmin } from "@/lib/lakebase/portfolio-admins";

export type PortfolioGuardResult =
  | { ok: true; user: ForgeUser }
  | { ok: false; response: NextResponse };

export async function requirePortfolioAccess(request: Request): Promise<PortfolioGuardResult> {
  let user: ForgeUser;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return { ok: false, response: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    throw e;
  }

  if (!isPortfolioEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The portfolio tier is not enabled on this deployment.", reason: "disabled" },
        { status: 403 },
      ),
    };
  }

  if (!(await isPortfolioAdmin(user.email))) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "You do not have organisation-admin access to the portfolio tier.",
          reason: "not_allowlisted",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user };
}
