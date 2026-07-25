/**
 * API: /api/environment/comments/[jobId]/progress
 *
 * GET -- returns the current comment generation progress from the
 *        in-memory tracker. Returns 404 if the job is not tracked
 *        (already completed and expired, or never started).
 */

import { NextResponse } from "next/server";
import { loadCommentJobOrRespond } from "@/lib/auth/route-guards";
import { getCommentProgress } from "@/lib/ai/comment-engine/progress";
import { getCommentJob } from "@/lib/lakebase/comment-jobs";
import { isValidUUID } from "@/lib/validation";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  const guard = await loadCommentJobOrRespond(request, jobId, "read");
  if (!guard.ok) return guard.response;

  const progress = getCommentProgress(jobId);
  if (progress) {
    return NextResponse.json(progress);
  }

  // In-memory entry expired or never existed -- check persisted job status
  // so the client can detect completion even after a page refresh.
  const job = await getCommentJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "ready" || job.status === "completed") {
    return NextResponse.json({
      jobId,
      phase: "complete",
      message: `${job.tableCount} table + ${job.columnCount} column descriptions ready`,
      tablesFound: job.tableCount,
      columnsFound: job.columnCount,
      tablesGenerated: job.tableCount,
      columnsGenerated: job.columnCount,
      elapsedMs: 0,
      updatedAt: job.updatedAt.toISOString(),
    });
  }

  if (job.status === "failed") {
    return NextResponse.json({
      jobId,
      phase: "failed",
      message: job.errorMessage ?? "Generation failed",
      elapsedMs: 0,
      updatedAt: job.updatedAt.toISOString(),
    });
  }

  // Job exists but in-memory progress expired (server restart during gen)
  return NextResponse.json({
    jobId,
    phase: job.status === "generating" ? "generating-tables" : "starting",
    message: "Generation in progress (progress data unavailable after restart)",
    elapsedMs: 0,
    updatedAt: job.updatedAt.toISOString(),
  });
}
