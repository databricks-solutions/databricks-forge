/**
 * API: /api/runs/[runId]/cancel
 *
 * POST -- Cancel a running pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import { isValidUUID } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/error-utils";
import { cancelPipeline } from "@/lib/pipeline/engine";
import { logger } from "@/lib/logger";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;

    const wasQueued = guard.value.run.status === "queued";
    const cancelled = await cancelPipeline(runId);

    if (!cancelled) {
      return NextResponse.json(
        { error: "Run is not active or queued; nothing to cancel" },
        { status: 404 },
      );
    }

    logger.info("Pipeline cancelled by user", {
      runId,
      userEmail: guard.user.email,
      fromQueue: wasQueued,
    });

    logActivity("pipeline_cancelled", {
      userId: guard.user.email,
      resourceId: runId,
      metadata: { fromQueue: wasQueued },
    });

    return NextResponse.json({ runId, status: "cancelled" });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
