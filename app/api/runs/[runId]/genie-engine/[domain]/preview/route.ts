/**
 * API: /api/runs/[runId]/genie-recommendations
 *
 * GET -- Return Genie Space recommendations for a completed pipeline run.
 *        Reads from Lakebase (persisted during pipeline step 8).
 *        Falls back to on-demand generation for runs that pre-date the
 *        pipeline step (backward compatibility).
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import { listTrackedGenieSpaces } from "@/lib/lakebase/genie-spaces";
import { getGenieRecommendationsByRunId } from "@/lib/lakebase/genie-recommendations";
import { generateGenieRecommendations } from "@/lib/genie/recommend";
import { getGenieEngineConfig } from "@/lib/lakebase/genie-engine-config";
import { getConfig } from "@/lib/dbx/client";
import type { GenieSpaceRecommendation } from "@/lib/genie/types";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

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
    const run = guard.value.run;
    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Run is not completed. Genie recommendations require a completed pipeline run." },
        { status: 400 },
      );
    }

    // Try to load persisted recommendations (generated in pipeline step 8)
    let recommendations: GenieSpaceRecommendation[] = await getGenieRecommendationsByRunId(runId);

    // Fallback: on-demand generation for runs that pre-date the pipeline step
    if (recommendations.length === 0) {
      const useCases = await getUseCasesByRunId(runId);
      if (useCases.length === 0) {
        return NextResponse.json({ error: "No use cases found for this run." }, { status: 404 });
      }

      const metadata = await loadMetadataForRun(runId);
      if (!metadata) {
        return NextResponse.json(
          {
            error:
              "Metadata snapshot not found for this run. " +
              "This may be a run from before metadata caching was enabled.",
          },
          { status: 404 },
        );
      }

      const { config } = await getGenieEngineConfig(runId);
      recommendations = generateGenieRecommendations(
        run,
        useCases,
        metadata,
        config.questionComplexity,
      );
    }

    // Load tracking status for this run
    const tracked = await listTrackedGenieSpaces({ runId });

    let databricksHost: string | null = null;
    try {
      databricksHost = getConfig().host;
    } catch {
      /* host unavailable in some dev environments */
    }

    return NextResponse.json({
      runId,
      businessName: run.config.businessName,
      recommendations,
      tracked,
      databricksHost,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
