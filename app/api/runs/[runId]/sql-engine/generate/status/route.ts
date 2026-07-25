/**
 * API: /api/runs/[runId]/sql-engine/generate/status
 *
 * GET -- Poll the status of an async SQL generation job. Returns the
 *        in-memory job state (with Lakebase fallback) joined to the
 *        per-use-case `sqlStatus` counts so the UI can render row
 *        badges + a top-level progress bar in one round trip.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { getSqlJobStatus } from "@/lib/pipeline/sql-engine-status";
import { getSqlStatusCounts } from "@/lib/lakebase/usecases";

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

    const [job, counts] = await Promise.all([
      getSqlJobStatus(runId),
      getSqlStatusCounts(runId),
    ]);

    if (!job) {
      // No job has been started yet. The counts table still tells us
      // whether SQL has already been generated for this run (e.g. legacy
      // runs that completed before the background-job split).
      return NextResponse.json({
        runId,
        status: "idle",
        message: "No active SQL generation job",
        percent: 0,
        total: counts.total,
        counts,
        error: null,
        elapsedMs: 0,
      });
    }

    return NextResponse.json({
      runId,
      status: job.status,
      message: job.message,
      percent: job.percent,
      total: job.total || counts.total,
      counts,
      error: job.error,
      elapsedMs: job.completedAt
        ? job.completedAt - job.startedAt
        : Date.now() - job.startedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
