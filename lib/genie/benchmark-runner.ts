/**
 * Benchmark Runner -- creates evaluation runs against a deployed Genie Space
 * via the official Genie Eval API (Beta), polls for completion, and fetches
 * detailed results with assessments and score reasons.
 */

import {
  createEvalRun,
  pollEvalRunUntilDone,
  listEvalResults,
  getEvalResultDetails,
} from "@/lib/dbx/genie";
import { reviewBatch, type BatchReviewItem, type BatchReviewResult } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled } from "@/lib/dbx/client";
import { createConcurrencyLimiter } from "@/lib/toolkit/concurrency";
import { logger } from "@/lib/logger";
import type {
  GenieEvalRunResponse,
  GenieEvalAssessment,
  ScoreReason,
  EvaluationStatusType,
  GenieEvalResponse,
  SqlExecutionResult,
} from "./eval-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalRunResult {
  evalRunId: string;
  spaceId: string;
  status: EvaluationStatusType;
  numQuestions: number;
  numDone: number;
  numCorrect: number;
  numNeedsReview: number;
  accuracy: number;
  results: EvalResultDetail[];
  expectedSqlReview?: BatchReviewResult[];
}

export interface EvalResultDetail {
  resultId: string;
  benchmarkQuestionId: string;
  question: string;
  assessment: GenieEvalAssessment;
  assessmentReasons: ScoreReason[];
  manualAssessment: boolean;
  expectedSql?: string;
  actualSql?: string;
  expectedText?: string;
  actualText?: string;
  actualExecutionResult?: SqlExecutionResult;
  expectedExecutionResult?: SqlExecutionResult;
}

export interface RunEvalOptions {
  oboToken?: string;
  questionIds?: string[];
  timeoutMs?: number;
  onProgress?: (run: GenieEvalRunResponse) => void;
}

// ---------------------------------------------------------------------------
// Pre-run SQL review (kept from previous implementation)
// ---------------------------------------------------------------------------

/**
 * Pre-run review of benchmark expectedSql to ensure the benchmark suite
 * itself is high quality. Only runs when the review endpoint is configured.
 */
export async function reviewBenchmarkExpectedSql(
  benchmarks: Array<{ question: string; expectedSql?: string }>,
): Promise<BatchReviewResult[]> {
  if (!isReviewEnabled("benchmark-review")) return [];

  const items: BatchReviewItem[] = benchmarks
    .filter((b) => b.expectedSql && b.expectedSql.trim().length > 10)
    .map((b, i) => ({
      id: `bench-${i}`,
      sql: b.expectedSql!,
      context: `Expected answer for: ${b.question}`,
    }));

  if (items.length === 0) return [];

  const results = await reviewBatch(items, "benchmark-review");
  const failCount = results.filter((r) => r.result.verdict === "fail").length;

  logger.info("Benchmark expectedSql review complete", {
    reviewed: items.length,
    failCount,
    avgScore: Math.round(results.reduce((s, r) => s + r.result.qualityScore, 0) / results.length),
  });

  return results;
}

// ---------------------------------------------------------------------------
// Response extraction helpers
// ---------------------------------------------------------------------------

function extractSql(responses?: GenieEvalResponse[]): string | undefined {
  if (!responses) return undefined;
  const sqlResponse = responses.find((r) => r.response_type === "SQL");
  return sqlResponse?.response ?? undefined;
}

function extractText(responses?: GenieEvalResponse[]): string | undefined {
  if (!responses) return undefined;
  const textResponse = responses.find((r) => r.response_type === "TEXT");
  return textResponse?.response ?? undefined;
}

function extractExecutionResult(
  responses?: GenieEvalResponse[],
): SqlExecutionResult | undefined {
  if (!responses) return undefined;
  const sqlResponse = responses.find((r) => r.response_type === "SQL");
  return sqlResponse?.sql_execution_result ?? undefined;
}

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

/**
 * Run an evaluation against a Genie Space using the official Eval API.
 *
 * 1. Creates an eval run via the API
 * 2. Polls until the run reaches a terminal status
 * 3. Fetches all results with full details (paginated)
 * 4. Returns structured results with assessment and score reasons
 */
export async function runEval(
  spaceId: string,
  options?: RunEvalOptions,
): Promise<EvalRunResult> {
  const oboToken = options?.oboToken;
  const questionIds = options?.questionIds;
  const timeoutMs = options?.timeoutMs;

  logger.info("Starting eval run", {
    spaceId,
    questionCount: questionIds?.length ?? "all",
  });

  const evalRun = await createEvalRun(spaceId, questionIds, oboToken);
  const evalRunId = evalRun.eval_run_id;

  logger.info("Eval run created", { evalRunId, spaceId });

  const finalRun = await pollEvalRunUntilDone(spaceId, evalRunId, oboToken, {
    timeoutMs,
    onProgress: options?.onProgress,
  });

  logger.info("Eval run finished", {
    evalRunId,
    status: finalRun.eval_run_status,
    numQuestions: finalRun.num_questions,
    numCorrect: finalRun.num_correct,
    numNeedsReview: finalRun.num_needs_review,
  });

  const allResults = await fetchAllEvalResults(spaceId, evalRunId, oboToken);

  const limit = createConcurrencyLimiter(5);
  const details = await Promise.all(
    allResults.map((r) =>
      limit(async () => {
        const detail = await getEvalResultDetails(spaceId, evalRunId, r.result_id, oboToken);
        return {
          resultId: detail.result_id,
          benchmarkQuestionId: detail.benchmark_question_id,
          question: r.question ?? "",
          assessment: detail.assessment ?? "NEEDS_REVIEW",
          assessmentReasons: detail.assessment_reasons ?? [],
          manualAssessment: detail.manual_assessment ?? false,
          expectedSql: extractSql(detail.expected_response),
          actualSql: extractSql(detail.actual_response),
          expectedText: extractText(detail.expected_response),
          actualText: extractText(detail.actual_response),
          actualExecutionResult: extractExecutionResult(detail.actual_response),
          expectedExecutionResult: extractExecutionResult(detail.expected_response),
        } satisfies EvalResultDetail;
      }),
    ),
  );

  const numQuestions = finalRun.num_questions ?? details.length;
  const numCorrect = finalRun.num_correct ?? details.filter((d) => d.assessment === "GOOD").length;

  const result: EvalRunResult = {
    evalRunId,
    spaceId,
    status: finalRun.eval_run_status ?? "DONE",
    numQuestions,
    numDone: finalRun.num_done ?? numQuestions,
    numCorrect,
    numNeedsReview:
      finalRun.num_needs_review ??
      details.filter((d) => d.assessment === "NEEDS_REVIEW").length,
    accuracy: numQuestions > 0 ? Math.round((numCorrect / numQuestions) * 100) : 0,
    results: details,
  };

  logger.info("Eval run complete", {
    evalRunId,
    spaceId,
    accuracy: result.accuracy,
    numQuestions: result.numQuestions,
    numCorrect: result.numCorrect,
    numNeedsReview: result.numNeedsReview,
  });

  return result;
}

/**
 * Paginate through all eval results for a run.
 */
async function fetchAllEvalResults(
  spaceId: string,
  evalRunId: string,
  oboToken?: string,
) {
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

  return allResults;
}
