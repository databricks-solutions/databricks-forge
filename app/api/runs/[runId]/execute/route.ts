/**
 * API: /api/runs/[runId]/execute
 *
 * POST -- start pipeline execution asynchronously
 */

import { NextRequest, NextResponse } from "next/server";
import { apiLogger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { failOrphanedRunningRun } from "@/lib/lakebase/runs";
import { startPipeline, resumePipeline, getActivePipelineRunIds } from "@/lib/pipeline/engine";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { isValidUUID } from "@/lib/validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { checkQuota } from "@/lib/quotas";
import { recordUsage } from "@/lib/lakebase/usage";
import { updateRunStatus } from "@/lib/lakebase/runs";
import { logActivity } from "@/lib/lakebase/activity-log";
import { notifyScheduler, getQueuePosition } from "@/lib/pipeline/scheduler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]/execute", "POST", { runId });
  try {
    await ensureMigrated();

    if (!isValidUUID(runId)) {
      log.warn("Invalid run ID format", { errorCategory: "validation_failed" });
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    await failOrphanedRunningRun(runId, getActivePipelineRunIds());

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const { value, user } = guard;
    const runRow = value.run;

    if (runRow.status === "running") {
      log.warn("Pipeline is already running", { errorCategory: "conflict" });
      return NextResponse.json({ error: "Pipeline is already running" }, { status: 409 });
    }

    const { searchParams } = new URL(request.url);
    const isResume = searchParams.get("resume") === "true";
    const oboToken = user.oboToken;

    const quota = await checkQuota("pipeline", user.email, "queue");

    if (isResume && runRow.status === "failed") {
      if (!quota.allowed) {
        await updateRunStatus(
          runId,
          "queued",
          null,
          0,
          undefined,
          `Queued (cap ${quota.cap}). Will resume when capacity is available.`,
        );
        await logActivity("pipeline_queued", {
          userId: user.email,
          resourceId: runId,
          metadata: { cap: quota.cap, active: quota.active, resume: true },
        });
        notifyScheduler();
        const position = await getQueuePosition(runId);
        return NextResponse.json({
          status: "queued",
          runId,
          resumed: true,
          queuePosition: position,
          cap: quota.cap,
          active: quota.active,
        });
      }
      resumePipeline(runId, { ownerEmail: user.email, oboToken }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("Resume pipeline crashed", { error: msg, errorCategory: "pipeline_crashed" });
      });
      return NextResponse.json({ status: "running", runId, resumed: true });
    }

    if (!quota.allowed) {
      await updateRunStatus(
        runId,
        "queued",
        null,
        0,
        undefined,
        `Queued (cap ${quota.cap}). Will start when a slot is available.`,
      );
      await logActivity("pipeline_queued", {
        userId: user.email,
        resourceId: runId,
        metadata: { cap: quota.cap, active: quota.active },
      });
      notifyScheduler();
      const position = await getQueuePosition(runId);
      return NextResponse.json({
        status: "queued",
        runId,
        queuePosition: position,
        cap: quota.cap,
        active: quota.active,
      });
    }

    startPipeline(runId, { ownerEmail: user.email, oboToken }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Pipeline crashed", { error: msg, errorCategory: "pipeline_crashed" });
    });
    recordUsage.pipelineRun(user.email).catch(() => {});

    return NextResponse.json({ status: "running", runId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("Failed to start pipeline", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
