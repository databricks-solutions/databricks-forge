/**
 * GET /api/business-value/portfolio
 *
 * Returns aggregated portfolio data across all runs for the Business Value dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getPortfolioData } from "@/lib/lakebase/portfolio";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const accessibleRunIds = await listAccessibleIds(user.email, "run");
    const portfolio = await getPortfolioData(user.email, accessibleRunIds);
    return NextResponse.json(portfolio, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    logger.error("[api/business-value/portfolio] Failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to load portfolio data" }, { status: 500 });
  }
}
