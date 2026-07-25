/**
 * API: /api/genie-spaces/[spaceId]/benchmarks/run
 *
 * POST -- Start an eval run (returns evalRunId).
 * GET  -- Poll eval run status by evalRunId; once DONE, fetches and returns full results.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createEvalRun,
  getEvalRun,
  listEvalResults,
  getEvalResultDetails,
  pollEvalRunUntilDone,
} from "@/lib/dbx/genie";
import { saveBenchmarkRun } from "@/lib/lakebase/space-health";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { createConcurrencyLimiter } from "@/lib/toolkit/concurrency";
import { TERMINAL_EVAL_STATUSES } from "@/lib/genie/eval-types";
import type { EvalRunResult, EvalResultDetail } from "@/lib/genie/benchmark-runner";
import type { GenieEvalAssessment, ScoreReason, SqlExecutionResult } from "@/lib/genie/eval-types";

// ---------------------------------------------------------------------------
// GET handler (poll)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  if (!isSafeId(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "read");
  if (!guard.ok) return guard.response;

  const evalRunId = request.nextUrl.searchParams.get("evalRunId");
  if (!evalRunId) {
    return NextResponse.json({ error: "evalRunId query parameter required" }, { status: 400 });
  }

  const oboToken = request.headers.get("x-forwarded-access-token") ?? undefined;

  try {
    const run = await getEvalRun(spaceId, evalRunId, oboToken);

    if (!run.eval_run_status || !TERMINAL_EVAL_STATUSES.has(run.eval_run_status)) {
      return NextResponse.json({
        evalRunId: run.eval_run_id,
        status: run.eval_run_status ?? "RUNNING",
        numQuestions: run.num_questions ?? 0,
        numDone: run.num_done ?? 0,
        numCorrect: run.num_correct ?? 0,
        numNeedsReview: run.num_needs_review ?? 0,
      });
    }

    const details = await fetchFullResults(spaceId, evalRunId, oboToken);

    const numQuestions = run.num_questions ?? details.length;
    const numCorrect = run.num_correct ?? details.filter((d) => d.assessment === "GOOD").length;

    const result: EvalRunResult = {
      evalRunId,
      spaceId,
      status: run.eval_run_status,
      numQuestions,
      numDone: run.num_done ?? numQuestions,
      numCorrect,
      numNeedsReview:
        run.num_needs_review ?? details.filter((d) => d.assessment === "NEEDS_REVIEW").length,
      accuracy: numQuestions > 0 ? Math.round((numCorrect / numQuestions) * 100) : 0,
      results: details,
    };

    try {
      const runId = await saveBenchmarkRun({
        spaceId,
        evalRunId,
        status: result.status,
        numQuestions: result.numQuestions,
        numCorrect: result.numCorrect,
        numNeedsReview: result.numNeedsReview,
        accuracy: result.accuracy,
        resultsJson: JSON.stringify(result.results),
      });
      return NextResponse.json({ ...result, runId });
    } catch (err) {
      logger.warn("Failed to persist eval run", { error: String(err) });
      return NextResponse.json(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Eval run poll failed", { evalRunId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST handler (create eval run)
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  if (!isSafeId(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
  if (!guard.ok) return guard.response;

  const oboToken = request.headers.get("x-forwarded-access-token") ?? undefined;

  try {
    const body = await request.json().catch(() => ({}));
    const questionIds = body.questionIds as string[] | undefined;

    const evalRun = await createEvalRun(spaceId, questionIds, oboToken);

    logger.info("Eval run created via API", {
      spaceId,
      evalRunId: evalRun.eval_run_id,
      questionCount: questionIds?.length ?? "all",
    });

    return NextResponse.json({
      evalRunId: evalRun.eval_run_id,
      status: evalRun.eval_run_status ?? "RUNNING",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Create eval run failed", { spaceId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFromResponses(
  responses: Array<{ response?: string; response_type?: string; sql_execution_result?: SqlExecutionResult }> | undefined,
  type: "SQL" | "TEXT",
): string | undefined {
  if (!responses) return undefined;
  const match = responses.find((r) => r.response_type === type);
  return match?.response ?? undefined;
}

function extractExecutionResult(
  responses: Array<{ response?: string; response_type?: string; sql_execution_result?: SqlExecutionResult }> | undefined,
): SqlExecutionResult | undefined {
  if (!responses) return undefined;
  const match = responses.find((r) => r.response_type === "SQL");
  return match?.sql_execution_result ?? undefined;
}

async function fetchFullResults(
  spaceId: string,
  evalRunId: string,
  oboToken?: string,
): Promise<EvalResultDetail[]> {
  const allResults: Array<{
    result_id: string;
    question?: string;
    benchmark_question_id: string;
  }> = [];
  let pageToken: string | undefined;

  do {
    const page = await listEvalResults(spaceId, evalRunId, 100, pageToken, oboToken);
    if (page.eval_results) {
      allResults.push(...page.eval_results);
    }
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);

  const limit = createConcurrencyLimiter(5);
  return Promise.all(
    allResults.map((r) =>
      limit(async () => {
        const detail = await getEvalResultDetails(spaceId, evalRunId, r.result_id, oboToken);
        return {
          resultId: detail.result_id,
          benchmarkQuestionId: detail.benchmark_question_id,
          question: r.question ?? "",
          assessment: (detail.assessment ?? "NEEDS_REVIEW") as GenieEvalAssessment,
          assessmentReasons: (detail.assessment_reasons ?? []) as ScoreReason[],
          manualAssessment: detail.manual_assessment ?? false,
          expectedSql: extractFromResponses(detail.expected_response, "SQL"),
          actualSql: extractFromResponses(detail.actual_response, "SQL"),
          expectedText: extractFromResponses(detail.expected_response, "TEXT"),
          actualText: extractFromResponses(detail.actual_response, "TEXT"),
          actualExecutionResult: extractExecutionResult(detail.actual_response),
          expectedExecutionResult: extractExecutionResult(detail.expected_response),
        } satisfies EvalResultDetail;
      }),
    ),
  );
}
