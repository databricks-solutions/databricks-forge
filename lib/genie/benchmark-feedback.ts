/**
 * Benchmark Feedback Analysis -- maps ScoreReason values from the Genie Eval
 * API to health check IDs for targeted improvement via the fix router.
 */

import type { ScoreReason, GenieEvalAssessment } from "./eval-types";
import { SCORE_REASON_LABELS } from "./eval-types";

export interface FeedbackEntry {
  question: string;
  assessment: GenieEvalAssessment;
  assessmentReasons: ScoreReason[];
  feedbackText?: string;
}

/**
 * Maps each ScoreReason to the health check IDs that trigger the relevant
 * Genie Engine fix strategies.
 */
const SCORE_REASON_TO_CHECK_IDS: Record<ScoreReason, string[]> = {
  LLM_JUDGE_MISSING_JOIN: ["join-specs-for-multi-table"],
  LLM_JUDGE_MISSING_OR_INCORRECT_JOIN: ["join-specs-for-multi-table"],
  LLM_JUDGE_MISSING_OR_INCORRECT_FILTER: ["filters-defined", "text-instruction-exists"],
  LLM_JUDGE_WRONG_FILTER: ["filters-defined", "text-instruction-exists"],
  LLM_JUDGE_MISSING_OR_INCORRECT_AGGREGATION: ["measures-defined"],
  LLM_JUDGE_WRONG_AGGREGATION: ["measures-defined"],
  LLM_JUDGE_WRONG_COLUMNS: ["columns-have-descriptions", "text-instruction-exists"],
  LLM_JUDGE_INCORRECT_TABLE_OR_FIELD_USAGE: ["columns-have-descriptions"],
  LLM_JUDGE_INCORRECT_METRIC_CALCULATION: ["measures-defined"],
  LLM_JUDGE_INCORRECT_FUNCTION_USAGE: ["example-sqls-minimum"],
  LLM_JUDGE_INSTRUCTION_COMPLIANCE_OR_MISSING_BUSINESS_LOGIC: ["text-instruction-exists"],
  LLM_JUDGE_MISINTERPRETATION_OF_USER_REQUEST: [
    "text-instruction-exists",
    "example-sqls-minimum",
  ],
  LLM_JUDGE_SYNTAX_ERROR: ["example-sqls-minimum"],
  LLM_JUDGE_SEMANTIC_ERROR: ["text-instruction-exists"],
  LLM_JUDGE_FORMATTING_ERROR: ["text-instruction-exists"],
  LLM_JUDGE_INCOMPLETE_OR_PARTIAL_OUTPUT: ["text-instruction-exists"],
  LLM_JUDGE_OTHER: ["text-instruction-exists", "example-sqls-minimum"],
  RESULT_MISSING_ROWS: ["filters-defined", "example-sqls-minimum"],
  RESULT_EXTRA_ROWS: ["filters-defined"],
  RESULT_MISSING_COLUMNS: ["columns-have-descriptions"],
  RESULT_EXTRA_COLUMNS: ["columns-have-descriptions"],
  COLUMN_TYPE_DIFFERENCE: ["columns-have-descriptions"],
  SINGLE_CELL_DIFFERENCE: ["measures-defined"],
  EMPTY_RESULT: ["filters-defined", "example-sqls-minimum"],
  EMPTY_GOOD_SQL: ["benchmarks-exist"],
};

/**
 * Analyze benchmark feedback to determine which fix strategies to run.
 *
 * Iterates the `assessmentReasons` from each BAD or NEEDS_REVIEW result
 * and maps them directly to fix check IDs.
 */
export function analyzeFeedbackForFixes(feedback: FeedbackEntry[]): string[] {
  const failures = feedback.filter((f) => f.assessment !== "GOOD");
  if (failures.length === 0) return [];

  const checkIds = new Set<string>();

  for (const f of failures) {
    if (f.assessmentReasons.length > 0) {
      for (const reason of f.assessmentReasons) {
        const ids = SCORE_REASON_TO_CHECK_IDS[reason] ?? [];
        for (const id of ids) checkIds.add(id);
      }
    } else {
      checkIds.add("text-instruction-exists");
      checkIds.add("example-sqls-minimum");
    }
  }

  if (failures.length >= 3) checkIds.add("text-instruction-exists");
  if (failures.length >= 5) checkIds.add("benchmarks-exist");

  return [...checkIds];
}

/**
 * Summarize score reasons from a set of eval results into human-readable
 * descriptions for display in the UI.
 */
export function summarizeScoreReasons(
  reasons: ScoreReason[] | undefined,
): string[] {
  if (!reasons || reasons.length === 0) return [];

  const counts = new Map<ScoreReason, number>();
  for (const r of reasons) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => `${SCORE_REASON_LABELS[reason]}: ${count}`);
}

/**
 * Compute pass rate delta between two eval runs.
 */
export function computePassRateDelta(
  current: { numCorrect: number; numQuestions: number },
  previous: { numCorrect: number; numQuestions: number },
): number {
  const currentRate =
    current.numQuestions > 0 ? (current.numCorrect / current.numQuestions) * 100 : 0;
  const previousRate =
    previous.numQuestions > 0 ? (previous.numCorrect / previous.numQuestions) * 100 : 0;
  return Math.round(currentRate - previousRate);
}
