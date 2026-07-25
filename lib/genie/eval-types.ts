/**
 * Genie Eval API types -- 1:1 match with the Databricks REST API
 * (Beta, /api/2.0/genie/spaces/{id}/eval-runs).
 */

export type EvaluationStatusType =
  | "RUNNING"
  | "DONE"
  | "NOT_STARTED"
  | "EVALUATION_FAILED"
  | "EVALUATION_CANCELLED"
  | "EVALUATION_TIMEOUT";

export type GenieEvalAssessment = "GOOD" | "BAD" | "NEEDS_REVIEW";

export type ScoreReason =
  | "COLUMN_TYPE_DIFFERENCE"
  | "EMPTY_GOOD_SQL"
  | "EMPTY_RESULT"
  | "LLM_JUDGE_FORMATTING_ERROR"
  | "LLM_JUDGE_INCOMPLETE_OR_PARTIAL_OUTPUT"
  | "LLM_JUDGE_INCORRECT_FUNCTION_USAGE"
  | "LLM_JUDGE_INCORRECT_METRIC_CALCULATION"
  | "LLM_JUDGE_INCORRECT_TABLE_OR_FIELD_USAGE"
  | "LLM_JUDGE_INSTRUCTION_COMPLIANCE_OR_MISSING_BUSINESS_LOGIC"
  | "LLM_JUDGE_MISINTERPRETATION_OF_USER_REQUEST"
  | "LLM_JUDGE_MISSING_JOIN"
  | "LLM_JUDGE_MISSING_OR_INCORRECT_AGGREGATION"
  | "LLM_JUDGE_MISSING_OR_INCORRECT_FILTER"
  | "LLM_JUDGE_MISSING_OR_INCORRECT_JOIN"
  | "LLM_JUDGE_OTHER"
  | "LLM_JUDGE_SEMANTIC_ERROR"
  | "LLM_JUDGE_SYNTAX_ERROR"
  | "LLM_JUDGE_WRONG_AGGREGATION"
  | "LLM_JUDGE_WRONG_COLUMNS"
  | "LLM_JUDGE_WRONG_FILTER"
  | "RESULT_EXTRA_COLUMNS"
  | "RESULT_EXTRA_ROWS"
  | "RESULT_MISSING_COLUMNS"
  | "RESULT_MISSING_ROWS"
  | "SINGLE_CELL_DIFFERENCE";

export type GenieEvalResponseType = "SQL" | "TEXT";

// ---------------------------------------------------------------------------
// SQL Execution Result (nested inside actual_response / expected_response)
// ---------------------------------------------------------------------------

export interface SqlExecutionResultColumn {
  name: string;
  position?: number;
  type_interval_type?: string;
  type_name?: string;
  type_precision?: number;
  type_scale?: number;
  type_text?: string;
}

export interface SqlExecutionResultManifest {
  format?: string;
  schema?: {
    column_count?: number;
    columns?: SqlExecutionResultColumn[];
  };
  total_byte_count?: number;
  total_chunk_count?: number;
  total_row_count?: number;
  truncated?: boolean;
}

export interface SqlExecutionResultData {
  byte_count?: number;
  chunk_index?: number;
  data_array?: string[][];
  row_count?: number;
  row_offset?: number;
}

export interface SqlExecutionResultStatus {
  error?: {
    error_code?: string;
    message?: string;
  };
  state?: string;
}

export interface SqlExecutionResult {
  manifest?: SqlExecutionResultManifest;
  result?: SqlExecutionResultData;
  statement_id?: string;
  status?: SqlExecutionResultStatus;
}

// ---------------------------------------------------------------------------
// Eval response envelope
// ---------------------------------------------------------------------------

export interface GenieEvalResponse {
  response?: string;
  response_type?: GenieEvalResponseType;
  sql_execution_result?: SqlExecutionResult;
}

export interface GenieEvalResult {
  result_id: string;
  space_id: string;
  benchmark_question_id: string;
  question?: string;
  benchmark_answer?: string;
  status?: EvaluationStatusType;
  created_by_user?: number;
}

export interface GenieEvalResultDetails {
  result_id: string;
  space_id: string;
  benchmark_question_id: string;
  actual_response?: GenieEvalResponse[];
  expected_response?: GenieEvalResponse[];
  assessment?: GenieEvalAssessment;
  assessment_reasons?: ScoreReason[];
  eval_run_status?: EvaluationStatusType;
  manual_assessment?: boolean;
}

export interface GenieEvalRunResponse {
  eval_run_id: string;
  eval_run_status?: EvaluationStatusType;
  num_questions?: number;
  num_done?: number;
  num_correct?: number;
  num_needs_review?: number;
  run_by_user?: number;
  created_timestamp?: number;
  last_updated_timestamp?: number;
}

export interface GenieListEvalRunsResponse {
  eval_runs?: GenieEvalRunResponse[];
  next_page_token?: string;
}

export interface GenieListEvalResultsResponse {
  eval_results?: GenieEvalResult[];
  next_page_token?: string;
}

/** Terminal statuses that indicate an eval run has finished. */
export const TERMINAL_EVAL_STATUSES: ReadonlySet<EvaluationStatusType> = new Set([
  "DONE",
  "EVALUATION_FAILED",
  "EVALUATION_CANCELLED",
  "EVALUATION_TIMEOUT",
]);

/** Human-readable labels for ScoreReason values. */
export const SCORE_REASON_LABELS: Record<ScoreReason, string> = {
  COLUMN_TYPE_DIFFERENCE: "Column type mismatch",
  EMPTY_GOOD_SQL: "No ground-truth SQL provided",
  EMPTY_RESULT: "Empty result set",
  LLM_JUDGE_FORMATTING_ERROR: "Formatting error",
  LLM_JUDGE_INCOMPLETE_OR_PARTIAL_OUTPUT: "Incomplete output",
  LLM_JUDGE_INCORRECT_FUNCTION_USAGE: "Incorrect function usage",
  LLM_JUDGE_INCORRECT_METRIC_CALCULATION: "Incorrect metric calculation",
  LLM_JUDGE_INCORRECT_TABLE_OR_FIELD_USAGE: "Wrong table or field",
  LLM_JUDGE_INSTRUCTION_COMPLIANCE_OR_MISSING_BUSINESS_LOGIC: "Missing business logic",
  LLM_JUDGE_MISINTERPRETATION_OF_USER_REQUEST: "Misinterpreted question",
  LLM_JUDGE_MISSING_JOIN: "Missing join",
  LLM_JUDGE_MISSING_OR_INCORRECT_AGGREGATION: "Wrong aggregation",
  LLM_JUDGE_MISSING_OR_INCORRECT_FILTER: "Wrong filter",
  LLM_JUDGE_MISSING_OR_INCORRECT_JOIN: "Incorrect join",
  LLM_JUDGE_OTHER: "Other LLM judge issue",
  LLM_JUDGE_SEMANTIC_ERROR: "Semantic error",
  LLM_JUDGE_SYNTAX_ERROR: "SQL syntax error",
  LLM_JUDGE_WRONG_AGGREGATION: "Wrong aggregation function",
  LLM_JUDGE_WRONG_COLUMNS: "Wrong columns selected",
  LLM_JUDGE_WRONG_FILTER: "Wrong filter logic",
  RESULT_EXTRA_COLUMNS: "Extra columns in result",
  RESULT_EXTRA_ROWS: "Extra rows in result",
  RESULT_MISSING_COLUMNS: "Missing columns in result",
  RESULT_MISSING_ROWS: "Missing rows in result",
  SINGLE_CELL_DIFFERENCE: "Single cell value differs",
};
