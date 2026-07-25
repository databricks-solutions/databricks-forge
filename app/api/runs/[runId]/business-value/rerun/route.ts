/**
 * API: /api/runs/[runId]/business-value/rerun
 *
 * POST -- rerun the Business Value Analysis step on a completed run
 * without re-executing the entire pipeline. Clears existing BV data,
 * rebuilds from persisted use cases, and re-embeds for RAG.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { getRunById, updateRunMessage } from "@/lib/lakebase/runs";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import {
  deleteValueEstimatesForRun,
  getValueEstimatesForRun,
} from "@/lib/lakebase/value-estimates";
import { deleteRoadmapPhasesForRun, getRoadmapPhasesForRun } from "@/lib/lakebase/roadmap-phases";
import {
  deleteStakeholderProfilesForRun,
  getStakeholderProfilesForRun,
} from "@/lib/lakebase/stakeholder-profiles";
import { runBusinessValueAnalysis } from "@/lib/pipeline/steps/business-value-analysis";
import { isPipelineActive } from "@/lib/pipeline/engine";
import { startBvJob, updateBvJob, completeBvJob, failBvJob } from "@/lib/pipeline/bv-engine-status";
import { isValidUUID } from "@/lib/validation";
import { withPrisma } from "@/lib/prisma";
import { logActivity } from "@/lib/lakebase/activity-log";
import { ensureMigrated } from "@/lib/lakebase/schema";
import type { PipelineContext, ExecutiveSynthesis } from "@/lib/domain/types";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";

const activeRerunIds = new Set<string>();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    await ensureMigrated();
    const { runId } = await params;

    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;

    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Business value rerun is only available for completed runs" },
        { status: 409 },
      );
    }

    if (isPipelineActive(runId)) {
      return NextResponse.json(
        { error: "Pipeline is currently running for this run" },
        { status: 409 },
      );
    }

    if (activeRerunIds.has(runId)) {
      return NextResponse.json(
        { error: "Business value refresh is already in progress" },
        { status: 409 },
      );
    }

    const useCases = await getUseCasesByRunId(runId);
    if (useCases.length === 0) {
      return NextResponse.json({ error: "No use cases found for this run" }, { status: 400 });
    }

    if (!run.businessContext) {
      return NextResponse.json(
        { error: "No business context found for this run" },
        { status: 400 },
      );
    }

    activeRerunIds.add(runId);

    const userEmail = guard.user.email;
    const oboToken = guard.user.oboToken;

    // Fire-and-forget: run BV analysis, embed, log activity. Mirror the
    // pipeline's background-job status tracker so the BV status endpoint
    // can surface rerun progress to the UI in real time.
    (async () => {
      await startBvJob(runId);
      try {
        await updateRunMessage(runId, "Refreshing business value analysis...");

        await Promise.all([
          deleteValueEstimatesForRun(runId),
          deleteRoadmapPhasesForRun(runId),
          deleteStakeholderProfilesForRun(runId),
          withPrisma(async (prisma) => {
            await prisma.forgeRun.update({
              where: { runId },
              data: { synthesisJson: null },
            });
          }),
        ]);

        const ctx: PipelineContext = {
          run,
          metadata: null,
          filteredTables: [],
          useCases,
          lineageGraph: null,
          sampleData: null,
          discoveryResult: null,
          ownerEmail: userEmail,
          oboToken,
        };

        await runBusinessValueAnalysis(ctx);

        // Re-embed BV data for Strategic Advisor RAG
        updateBvJob(runId, "Embedding business value outputs for Strategic Advisor...", 95);
        try {
          const { embedBusinessValueResults } = await import("@/lib/embeddings/embed-pipeline");
          const [estimates, roadmapPhases, stakeholders, synthesisRow] = await Promise.all([
            getValueEstimatesForRun(runId),
            getRoadmapPhasesForRun(runId),
            getStakeholderProfilesForRun(runId),
            withPrisma(async (prisma) => {
              const row = await prisma.forgeRun.findUnique({
                where: { runId },
                select: { synthesisJson: true },
              });
              return row?.synthesisJson ?? null;
            }),
          ]);

          let synthesis: ExecutiveSynthesis | null = null;
          if (synthesisRow) {
            try {
              synthesis = JSON.parse(synthesisRow) as ExecutiveSynthesis;
            } catch {
              /* ignore */
            }
          }

          await embedBusinessValueResults(runId, estimates, roadmapPhases, stakeholders, synthesis);
        } catch (embedErr) {
          logger.warn("[bv-rerun] Embedding failed (non-fatal)", {
            runId,
            error: embedErr instanceof Error ? embedErr.message : String(embedErr),
          });
        }

        await updateRunMessage(runId, "Business value analysis refreshed");
        await completeBvJob(runId);

        logActivity("rerun_business_value", {
          userId: userEmail,
          resourceId: runId,
          metadata: { useCaseCount: useCases.length },
        });

        logger.info("[bv-rerun] Business value rerun complete", { runId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("[bv-rerun] Business value rerun failed", { runId, error: msg });
        await failBvJob(runId, msg).catch(() => {});
        await updateRunMessage(runId, "Business value refresh failed").catch(() => {});
      } finally {
        activeRerunIds.delete(runId);
      }
    })();

    return NextResponse.json({ status: "refreshing", runId });
  } catch (error) {
    logger.error("[bv-rerun] Failed to start BV rerun", { error: safeErrorMessage(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
