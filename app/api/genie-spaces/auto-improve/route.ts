import { NextRequest, NextResponse } from "next/server";
import {
  runAutoImproveLoop,
  type AutoImproveConfig,
  type AutoImproveResult,
} from "@/lib/genie/auto-improve";
import { runFixes } from "@/lib/genie/space-fixer";
import { getGenieSpace, updateGenieSpace } from "@/lib/dbx/genie";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";

const activeJobs = new Map<
  string,
  {
    status: "running" | "completed" | "failed";
    result?: AutoImproveResult;
    error?: string;
    progress?: { phase: string; iteration: number; passRate: number; message: string };
  }
>();

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      spaceId: string;
      questionIds?: string[];
      targetScore?: number;
      maxIterations?: number;
    };
    const { spaceId, questionIds, targetScore, maxIterations } = body;

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
    }

    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
    if (!guard.ok) return guard.response;

    const oboToken = request.headers.get("x-forwarded-access-token") ?? undefined;

    const jobId = `auto-${spaceId}-${Date.now()}`;

    activeJobs.set(jobId, { status: "running" });

    const config: AutoImproveConfig = {
      spaceId,
      targetScore: targetScore ?? 80,
      maxIterations: maxIterations ?? 5,
      evalOptions: {
        oboToken,
        questionIds,
      },
      oboToken,
      sessionId: jobId,
      ownerEmail: guard.user.email ?? null,
    };

    logActivity("started_auto_improve", {
      resourceId: spaceId,
      metadata: {
        targetScore: config.targetScore,
        maxIterations: config.maxIterations,
      },
    });

    (async () => {
      try {
        const result = await runAutoImproveLoop(
          config,
          async (checkIds) => {
            const space = await getGenieSpace(spaceId);
            if (!space?.serialized_space) return [];
            const fixResult = await runFixes({
              checkIds,
              serializedSpace: space.serialized_space,
              spaceId,
            });
            if (fixResult.changes.length > 0) {
              await updateGenieSpace(spaceId, {
                serializedSpace: JSON.stringify(fixResult.updatedSpace),
                oboToken,
              });
            }
            return fixResult.strategiesRun;
          },
          (event) => {
            const job = activeJobs.get(jobId);
            if (job) {
              job.progress = {
                phase: event.phase,
                iteration: event.iteration,
                passRate: event.passRate,
                message: event.message,
              };
            }
          },
        );
        activeJobs.set(jobId, { status: "completed", result });
        logActivity("completed_auto_improve", {
          resourceId: spaceId,
          metadata: {
            finalScore: result.finalScore,
            targetReached: result.targetReached,
            iterations: result.iterations.length,
            stoppedReason: result.stoppedReason,
          },
        });
      } catch (err) {
        logger.error("Auto-improve job failed", {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
        activeJobs.set(jobId, {
          status: "failed",
          error: err instanceof Error ? err.message : "Auto-improve failed",
        });
      }
    })();

    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start auto-improve" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = activeJobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}
