/**
 * API: /api/runs/[runId]/genie-engine/generate/status
 *
 * GET -- Poll the status of an async Genie Engine generation job.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { getJobStatus } from "@/lib/genie/engine-status";
import { isValidUUID } from "@/lib/validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    const job = await getJobStatus(runId);

    if (!job) {
      return NextResponse.json({
        runId,
        status: "idle",
        message: "No active generation job",
        percent: 0,
      });
    }

    return NextResponse.json({
      runId,
      status: job.status,
      message: job.message,
      percent: job.percent,
      domainCount: job.domainCount,
      completedDomains: job.completedDomains,
      totalDomains: job.totalDomains,
      completedDomainNames: job.completedDomainNames,
      domainStatuses: job.domainStatuses,
      error: job.error,
      errorType: job.errorType,
      elapsedMs: job.completedAt ? job.completedAt - job.startedAt : Date.now() - job.startedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
