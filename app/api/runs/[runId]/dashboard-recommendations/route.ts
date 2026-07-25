/**
 * API: /api/runs/[runId]/dashboard-recommendations
 *
 * GET -- Return Dashboard recommendations for a completed pipeline run.
 *        Reads from Lakebase (persisted during background engine step).
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getDashboardRecommendationsByRunId } from "@/lib/lakebase/dashboard-recommendations";
import { listTrackedDashboards } from "@/lib/lakebase/dashboards";
import { getConfig } from "@/lib/dbx/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;
    if (run.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "Run is not completed. Dashboard recommendations require a completed pipeline run.",
        },
        { status: 400 },
      );
    }

    const recommendations = await getDashboardRecommendationsByRunId(runId);
    const tracked = await listTrackedDashboards(runId);

    let databricksHost: string | null = null;
    try {
      databricksHost = getConfig().host;
    } catch {
      /* host unavailable in some dev environments */
    }

    return NextResponse.json({
      runId,
      businessName: run.config.businessName,
      recommendations,
      tracked,
      databricksHost,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
