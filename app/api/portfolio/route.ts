/**
 * API: /api/portfolio (V2 — org-admin cross-owner roll-up)
 *
 * GET -- the Portfolio overview (estates, enterprise inventory, totals).
 *        Gated by `requirePortfolioAccess` (FORGE_PORTFOLIO_ENABLED +
 *        org-admin allowlist) and activity-logged as `portfolio_viewed`.
 *
 * ⚠️ This is the audited isolation exception. See lib/config/portfolio-flag.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";
import { requirePortfolioAccess } from "@/lib/auth/portfolio-guard";
import { getPortfolioOverview } from "@/lib/lakebase/portfolio-estate";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/portfolio", "GET");
  try {
    const guard = await requirePortfolioAccess(request);
    if (!guard.ok) return guard.response;

    await ensureMigrated();
    const overview = await getPortfolioOverview();

    logActivity("portfolio_viewed", {
      userId: guard.user.email,
      resourceId: null,
      metadata: { estates: overview.totals.estates, scans: overview.totals.scans },
    });

    return NextResponse.json(
      { overview: toJsonSafe(overview) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
