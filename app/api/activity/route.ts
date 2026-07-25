/**
 * API: /api/activity
 *
 * GET -- get recent activity feed entries.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { logger } from "@/lib/logger";
import { getRecentActivity } from "@/lib/lakebase/activity-log";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 100);

    const activities = await getRecentActivity(limit, { userEmail: user.email });

    return NextResponse.json(
      { activities },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[activity] Failed to fetch activity", { error: msg });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
