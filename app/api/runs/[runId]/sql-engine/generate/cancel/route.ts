/**
 * API: /api/runs/[runId]/sql-engine/generate/cancel
 *
 * POST -- Cancel an in-flight SQL generation background job. Returns
 *         { cancelled: true } when the job was actively generating, or
 *         { cancelled: false } when there was nothing to cancel.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { cancelSqlJob } from "@/lib/pipeline/sql-engine-status";
import { logActivity } from "@/lib/lakebase/activity-log";
import { apiLogger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]/sql-engine/generate/cancel", "POST", { runId });
  try {
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;

    const cancelled = await cancelSqlJob(runId);
    if (cancelled) {
      void logActivity("sql_engine_cancelled", {
        userId: guard.user.email,
        resourceId: runId,
        metadata: { manual: true },
      });
      log.info("SQL generation cancelled by user");
    }
    return NextResponse.json({ cancelled });
  } catch (error) {
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
