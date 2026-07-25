/**
 * API: /api/genie-spaces/[spaceId]/benchmarks/improve
 *
 * POST -- Generate targeted improvements from benchmark feedback.
 *         Analyzes labeled failures and runs relevant fix strategies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { getBenchmarkRun } from "@/lib/lakebase/space-health";
import { runFixes } from "@/lib/genie/space-fixer";
import { analyzeFeedbackForFixes, type FeedbackEntry } from "@/lib/genie/benchmark-feedback";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import type { GenieEvalAssessment, ScoreReason } from "@/lib/genie/eval-types";
import type { EvalResultDetail } from "@/lib/genie/benchmark-runner";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }

    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { benchmarkRunId } = body as { benchmarkRunId: string };

    if (!benchmarkRunId) {
      return NextResponse.json({ error: "benchmarkRunId is required" }, { status: 400 });
    }

    const run = await getBenchmarkRun(benchmarkRunId);
    if (!run) {
      return NextResponse.json({ error: "Benchmark run not found" }, { status: 404 });
    }

    // Build feedback from stored results (eval API format)
    let feedback: FeedbackEntry[] = [];

    if (run.feedbackJson) {
      feedback = JSON.parse(run.feedbackJson) as FeedbackEntry[];
    } else if (run.resultsJson) {
      const results = JSON.parse(run.resultsJson) as EvalResultDetail[];
      feedback = results
        .filter((r) => r.assessment !== "GOOD")
        .map((r) => ({
          question: r.question,
          assessment: r.assessment as GenieEvalAssessment,
          assessmentReasons: (r.assessmentReasons ?? []) as ScoreReason[],
        }));
    }

    if (feedback.length === 0) {
      return NextResponse.json(
        { error: "No failures or feedback found for this run" },
        { status: 400 },
      );
    }

    const checkIdsToFix = analyzeFeedbackForFixes(feedback);
    if (checkIdsToFix.length === 0) {
      return NextResponse.json({ message: "No improvements identified from feedback" });
    }

    let serializedSpace = getSpaceCache(spaceId);
    if (!serializedSpace) {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      setSpaceCache(spaceId, serializedSpace);
    }

    const result = await runFixes({ checkIds: checkIdsToFix, serializedSpace, spaceId });

    logger.info("Benchmark improvement generated", {
      spaceId,
      strategies: result.strategiesRun,
      changes: result.changes.length,
    });

    return NextResponse.json({
      updatedSerializedSpace: JSON.stringify(result.updatedSpace),
      changes: result.changes,
      strategiesRun: result.strategiesRun,
      originalSerializedSpace: serializedSpace,
      analyzedFixes: checkIdsToFix,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Benchmark improvement failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
