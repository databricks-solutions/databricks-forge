/**
 * API: /api/portfolio/access (V2)
 *
 * GET -- whether the caller can see the Portfolio tier. Returns booleans only
 *        (never the allowlist), so the nav + landing can gate themselves
 *        without a heavy aggregation fetch. Always 200 for an authenticated
 *        user; `allowed:false` when the tier is disabled or they're not an
 *        org admin. `canManage` mirrors `allowed` (any admin can manage the
 *        allowlist from the UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { apiLogger } from "@/lib/logger";
import { getUserOrNull } from "@/lib/auth/route-user";
import { isPortfolioEnabled } from "@/lib/config/portfolio-flag";
import { isPortfolioAdmin } from "@/lib/lakebase/portfolio-admins";

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/portfolio/access", "GET");
  try {
    const user = await getUserOrNull(request);
    const enabled = isPortfolioEnabled();
    const allowed = enabled && (await isPortfolioAdmin(user?.email));
    return NextResponse.json(
      { enabled, allowed, canManage: allowed },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
