/**
 * API: /api/runs/[runId]/business-value/status
 *
 * GET -- Poll the status of the async Business Value Analysis background job.
 *
 * Modelled on /api/runs/[runId]/genie-engine/generate/status. Returns an
 * `idle` shape when no BV job has been started (e.g. the run completed
 * before the background-job split landed, or BV was disabled for this run).
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { getBvJobStatus } from "@/lib/pipeline/bv-engine-status";
import { isValidUUID } from "@/lib/validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";

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

    const job = await getBvJobStatus(runId);

    if (!job) {
      return NextResponse.json({
        runId,
        status: "idle",
        message: "No business value job has run for this run",
        percent: 0,
        completedPasses: 0,
        totalPasses: 4,
        completedPassNames: [],
        degradedPassNames: [],
        error: null,
        elapsedMs: 0,
      });
    }

    return NextResponse.json({
      runId,
      status: job.status,
      message: job.message,
      percent: job.percent,
      completedPasses: job.completedPasses,
      totalPasses: job.totalPasses,
      completedPassNames: job.completedPassNames,
      degradedPassNames: job.degradedPassNames,
      error: job.error,
      elapsedMs: job.completedAt
        ? job.completedAt - job.startedAt
        : Date.now() - job.startedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
