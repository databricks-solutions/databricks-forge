/**
 * API: /api/runs/[runId]/genie-engine/generate/cancel
 *
 * POST -- Cancel a running Genie Engine generation job.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { cancelJob } from "@/lib/genie/engine-status";
import { logger } from "@/lib/logger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    const cancelled = await cancelJob(runId);

    if (!cancelled) {
      return NextResponse.json({ error: "No active generation job to cancel" }, { status: 404 });
    }

    logger.info("Genie Engine generation cancelled by user", { runId });

    return NextResponse.json({ runId, status: "cancelled" });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
