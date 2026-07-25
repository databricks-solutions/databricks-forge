/**
 * API: /api/genie-spaces/[spaceId]/benchmarks/history
 *
 * GET -- List past eval runs for a space. Primary source: Genie Eval API
 * (listEvalRuns), enriched with Lakebase data (feedback, improvements).
 */

import { NextRequest, NextResponse } from "next/server";
import { listEvalRuns } from "@/lib/dbx/genie";
import { getBenchmarkHistory } from "@/lib/lakebase/space-health";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/error-utils";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }

    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "read");
    if (!guard.ok) return guard.response;

    const oboToken = request.headers.get("x-forwarded-access-token") ?? undefined;

    // Fetch from both sources in parallel
    const [apiRunsResponse, lakebaseRuns] = await Promise.allSettled([
      listEvalRuns(spaceId, 50, undefined, oboToken),
      getBenchmarkHistory(spaceId),
    ]);

    const apiRuns =
      apiRunsResponse.status === "fulfilled" ? apiRunsResponse.value.eval_runs ?? [] : [];
    const lakebaseData =
      lakebaseRuns.status === "fulfilled" ? lakebaseRuns.value : [];

    if (apiRunsResponse.status === "rejected") {
      logger.warn("Failed to fetch eval runs from API, falling back to Lakebase", {
        error: String(apiRunsResponse.reason),
      });
    }

    // Build enrichment map from Lakebase (keyed by evalRunId)
    const lakebaseMap = new Map(
      lakebaseData
        .filter((r) => r.evalRunId)
        .map((r) => [
          r.evalRunId,
          {
            id: r.id,
            feedbackJson: r.feedbackJson,
            improvementsApplied: r.improvementsApplied,
            improvementSummary: r.improvementSummary,
          },
        ]),
    );

    // If we have API runs, use them as primary; otherwise fall back to Lakebase
    if (apiRuns.length > 0) {
      const history = apiRuns.map((run) => {
        const enrichment = lakebaseMap.get(run.eval_run_id);
        const numQuestions = run.num_questions ?? 0;
        const numCorrect = run.num_correct ?? 0;
        return {
          evalRunId: run.eval_run_id,
          id: enrichment?.id ?? run.eval_run_id,
          runAt: run.created_timestamp
            ? new Date(run.created_timestamp).toISOString()
            : new Date().toISOString(),
          status: run.eval_run_status ?? "DONE",
          numQuestions,
          numCorrect,
          numNeedsReview: run.num_needs_review ?? 0,
          accuracy: numQuestions > 0 ? Math.round((numCorrect / numQuestions) * 100) : 0,
          improvementsApplied: enrichment?.improvementsApplied ?? false,
          hasFeedback: !!enrichment?.feedbackJson,
        };
      });

      return NextResponse.json({ history });
    }

    // Fallback: Lakebase-only history
    const history = lakebaseData.map((run) => ({
      evalRunId: run.evalRunId,
      id: run.id,
      runAt: run.runAt,
      status: run.status,
      numQuestions: run.numQuestions,
      numCorrect: run.numCorrect,
      numNeedsReview: run.numNeedsReview,
      accuracy: run.accuracy,
      improvementsApplied: run.improvementsApplied,
      hasFeedback: !!run.feedbackJson,
    }));

    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
