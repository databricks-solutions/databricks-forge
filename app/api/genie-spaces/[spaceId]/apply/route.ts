/**
 * API: /api/genie-spaces/[spaceId]/apply
 *
 * POST -- Apply a fixed serialized_space to the Genie Space,
 *         invalidate cache, re-run health check, and persist score.
 */

import { NextRequest, NextResponse } from "next/server";
import { updateGenieSpace } from "@/lib/dbx/genie";
import { runHealthCheck, enrichReportWithSqlQuality } from "@/lib/genie/space-health-check";
import { isReviewEnabled } from "@/lib/dbx/client";
import { getHealthCheckConfig, saveHealthScore } from "@/lib/lakebase/space-health";
import { getSpaceAuthMode } from "@/lib/lakebase/genie-spaces";
import { invalidateSpaceCache } from "@/lib/genie/space-cache";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }

    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { serializedSpace } = body as { serializedSpace: string };

    if (!serializedSpace) {
      return NextResponse.json({ error: "serializedSpace is required" }, { status: 400 });
    }

    const authMode = await getSpaceAuthMode(spaceId);
    await updateGenieSpace(spaceId, { serializedSpace, authMode });

    invalidateSpaceCache(spaceId);

    const space = JSON.parse(serializedSpace);
    const config = await getHealthCheckConfig().catch(() => ({
      overrides: [],
      customChecks: [],
      categoryWeights: null,
    }));

    let report = runHealthCheck(
      space,
      config.overrides.length > 0 ? config.overrides : undefined,
      config.customChecks.length > 0 ? config.customChecks : undefined,
      config.categoryWeights ?? undefined,
    );

    if (isReviewEnabled("health-check-sql-quality")) {
      report = await enrichReportWithSqlQuality(space, report);
    }

    // Persist health score for trending
    saveHealthScore(spaceId, report, "post_fix").catch((err) => {
      logger.warn("Failed to persist post-fix health score", { spaceId, error: String(err) });
    });

    logger.info("Fix applied and re-scored", {
      spaceId,
      score: report.overallScore,
      grade: report.grade,
    });

    return NextResponse.json({
      success: true,
      healthReport: report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Apply fix failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
