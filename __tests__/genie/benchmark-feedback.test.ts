import { describe, it, expect } from "vitest";
import {
  analyzeFeedbackForFixes,
  computePassRateDelta,
  summarizeScoreReasons,
  type FeedbackEntry,
} from "@/lib/genie/benchmark-feedback";
import type { ScoreReason } from "@/lib/genie/eval-types";

describe("analyzeFeedbackForFixes", () => {
  it("returns empty for all-GOOD feedback", () => {
    const feedback: FeedbackEntry[] = [
      { question: "Q1", assessment: "GOOD", assessmentReasons: [] },
      { question: "Q2", assessment: "GOOD", assessmentReasons: [] },
    ];
    expect(analyzeFeedbackForFixes(feedback)).toHaveLength(0);
  });

  it("maps LLM_JUDGE_MISSING_JOIN to join-specs-for-multi-table", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_MISSING_JOIN"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("join-specs-for-multi-table");
  });

  it("maps LLM_JUDGE_MISSING_OR_INCORRECT_JOIN to join-specs-for-multi-table", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_MISSING_OR_INCORRECT_JOIN"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("join-specs-for-multi-table");
  });

  it("maps LLM_JUDGE_MISSING_OR_INCORRECT_FILTER to filters-defined and text-instruction-exists", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_MISSING_OR_INCORRECT_FILTER"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("filters-defined");
    expect(fixes).toContain("text-instruction-exists");
  });

  it("maps LLM_JUDGE_WRONG_AGGREGATION to measures-defined", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_WRONG_AGGREGATION"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("measures-defined");
  });

  it("maps LLM_JUDGE_WRONG_COLUMNS to columns-have-descriptions and text-instruction-exists", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_WRONG_COLUMNS"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("columns-have-descriptions");
    expect(fixes).toContain("text-instruction-exists");
  });

  it("maps LLM_JUDGE_INCORRECT_TABLE_OR_FIELD_USAGE to columns-have-descriptions", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_INCORRECT_TABLE_OR_FIELD_USAGE"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("columns-have-descriptions");
  });

  it("maps LLM_JUDGE_INCORRECT_METRIC_CALCULATION to measures-defined", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_INCORRECT_METRIC_CALCULATION"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("measures-defined");
  });

  it("maps LLM_JUDGE_INCORRECT_FUNCTION_USAGE to example-sqls-minimum", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_INCORRECT_FUNCTION_USAGE"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("example-sqls-minimum");
  });

  it("maps LLM_JUDGE_INSTRUCTION_COMPLIANCE_OR_MISSING_BUSINESS_LOGIC to text-instruction-exists", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_INSTRUCTION_COMPLIANCE_OR_MISSING_BUSINESS_LOGIC"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("text-instruction-exists");
  });

  it("maps LLM_JUDGE_MISINTERPRETATION_OF_USER_REQUEST to text-instruction-exists and example-sqls-minimum", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_MISINTERPRETATION_OF_USER_REQUEST"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("text-instruction-exists");
    expect(fixes).toContain("example-sqls-minimum");
  });

  it("maps LLM_JUDGE_SYNTAX_ERROR to example-sqls-minimum", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_SYNTAX_ERROR"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("example-sqls-minimum");
  });

  it("maps RESULT_MISSING_ROWS to filters-defined and example-sqls-minimum", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["RESULT_MISSING_ROWS"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("filters-defined");
    expect(fixes).toContain("example-sqls-minimum");
  });

  it("maps RESULT_MISSING_COLUMNS to columns-have-descriptions", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["RESULT_MISSING_COLUMNS"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("columns-have-descriptions");
  });

  it("maps EMPTY_GOOD_SQL to benchmarks-exist", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "NEEDS_REVIEW",
        assessmentReasons: ["EMPTY_GOOD_SQL"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("benchmarks-exist");
  });

  it("maps SINGLE_CELL_DIFFERENCE to measures-defined", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["SINGLE_CELL_DIFFERENCE"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("measures-defined");
  });

  it("falls back to general checks for BAD feedback with no reasons", () => {
    const feedback: FeedbackEntry[] = [
      { question: "Q1", assessment: "BAD", assessmentReasons: [] },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes).toContain("text-instruction-exists");
    expect(fixes).toContain("example-sqls-minimum");
  });

  it("adds text-instruction-exists when 3+ failures", () => {
    const feedback: FeedbackEntry[] = [
      { question: "Q1", assessment: "BAD", assessmentReasons: ["LLM_JUDGE_MISSING_JOIN"] },
      { question: "Q2", assessment: "BAD", assessmentReasons: ["LLM_JUDGE_WRONG_AGGREGATION"] },
      { question: "Q3", assessment: "BAD", assessmentReasons: ["RESULT_EXTRA_ROWS"] },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("text-instruction-exists");
  });

  it("adds benchmarks-exist when 5+ failures", () => {
    const feedback: FeedbackEntry[] = Array.from({ length: 5 }, (_, i) => ({
      question: `Q${i}`,
      assessment: "BAD" as const,
      assessmentReasons: ["LLM_JUDGE_MISSING_JOIN" as ScoreReason],
    }));
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("benchmarks-exist");
  });

  it("deduplicates check IDs", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_MISSING_OR_INCORRECT_FILTER", "LLM_JUDGE_WRONG_FILTER"],
      },
      {
        question: "Q2",
        assessment: "BAD",
        assessmentReasons: ["LLM_JUDGE_MISSING_OR_INCORRECT_FILTER"],
      },
      {
        question: "Q3",
        assessment: "BAD",
        assessmentReasons: ["RESULT_EXTRA_ROWS"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    const unique = new Set(fixes);
    expect(fixes.length).toBe(unique.size);
  });

  it("handles multiple ScoreReasons per result", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "BAD",
        assessmentReasons: [
          "LLM_JUDGE_MISSING_JOIN",
          "LLM_JUDGE_WRONG_FILTER",
          "RESULT_MISSING_ROWS",
        ],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("join-specs-for-multi-table");
    expect(fixes).toContain("filters-defined");
    expect(fixes).toContain("example-sqls-minimum");
  });

  it("includes NEEDS_REVIEW results in failure analysis", () => {
    const feedback: FeedbackEntry[] = [
      {
        question: "Q1",
        assessment: "NEEDS_REVIEW",
        assessmentReasons: ["LLM_JUDGE_WRONG_COLUMNS"],
      },
    ];
    const fixes = analyzeFeedbackForFixes(feedback);
    expect(fixes).toContain("columns-have-descriptions");
  });
});

describe("computePassRateDelta", () => {
  it("computes positive improvement", () => {
    const delta = computePassRateDelta(
      { numCorrect: 8, numQuestions: 10 },
      { numCorrect: 5, numQuestions: 10 },
    );
    expect(delta).toBe(30);
  });

  it("computes negative decline", () => {
    const delta = computePassRateDelta(
      { numCorrect: 3, numQuestions: 10 },
      { numCorrect: 7, numQuestions: 10 },
    );
    expect(delta).toBe(-40);
  });

  it("handles zero total", () => {
    const delta = computePassRateDelta(
      { numCorrect: 0, numQuestions: 0 },
      { numCorrect: 5, numQuestions: 10 },
    );
    expect(delta).toBe(-50);
  });

  it("returns 0 for identical runs", () => {
    const delta = computePassRateDelta(
      { numCorrect: 5, numQuestions: 10 },
      { numCorrect: 5, numQuestions: 10 },
    );
    expect(delta).toBe(0);
  });
});

describe("summarizeScoreReasons", () => {
  it("returns empty array for undefined input", () => {
    expect(summarizeScoreReasons(undefined)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(summarizeScoreReasons([])).toEqual([]);
  });

  it("formats score reasons into readable strings with counts", () => {
    const reasons: ScoreReason[] = [
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_WRONG_FILTER",
    ];
    const summary = summarizeScoreReasons(reasons);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toContain("Missing join");
    expect(summary[0]).toContain("3");
    expect(summary[1]).toContain("Wrong filter logic");
    expect(summary[1]).toContain("1");
  });

  it("sorts by count descending", () => {
    const reasons: ScoreReason[] = [
      "LLM_JUDGE_WRONG_FILTER",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_MISSING_JOIN",
      "LLM_JUDGE_WRONG_AGGREGATION",
      "LLM_JUDGE_WRONG_AGGREGATION",
      "LLM_JUDGE_WRONG_AGGREGATION",
    ];
    const summary = summarizeScoreReasons(reasons);
    expect(summary[0]).toContain("5");
    expect(summary[1]).toContain("3");
    expect(summary[2]).toContain("1");
  });
});
