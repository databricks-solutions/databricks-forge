/**
 * Multi-Axis Judge Scoring for the Auto-Improve Loop.
 *
 * Replaces the single-pass GenieEval verdict for *scoring* purposes with a
 * panel of nine specialized LLM-as-judge scorers. Genie Eval still runs as
 * ground truth (its assessments drive `analyzeFeedbackForFixes`); the
 * multi-axis score guides the iteration's `promote` vs. `refine` decision.
 *
 * Each judge is a single review-endpoint call returning a 0–100 score plus
 * a one-line rationale. The aggregate is a weighted mean.
 *
 * Mirrors upstream `databricks-genie-workbench` GSO multi-judge scoring.
 */

import { getReviewEndpoint, isReviewEnabled } from "@/lib/dbx/client";
import { chatCompletion, ModelServingError } from "@/lib/dbx/model-serving";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { createConcurrencyLimiter } from "@/lib/toolkit/concurrency";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Judge catalog
// ---------------------------------------------------------------------------

export type JudgeId =
  | "correctness"
  | "groundedness"
  | "precision"
  | "coverage"
  | "naming"
  | "safety"
  | "disambiguation"
  | "completeness"
  | "formatting";

interface JudgeSpec {
  id: JudgeId;
  question: string;
  weight: number;
}

export const JUDGES: ReadonlyArray<JudgeSpec> = [
  { id: "correctness", question: "Does the answer match the expected SQL semantically?", weight: 3 },
  { id: "groundedness", question: "Does the answer cite tables/columns that actually exist in the schema?", weight: 2 },
  { id: "precision", question: "Is the answer the most direct SQL for the question, with no needless complexity?", weight: 2 },
  { id: "coverage", question: "Does the answer use available trusted_assets, measures, or filters when applicable?", weight: 1 },
  { id: "naming", question: "Are titles and aliases human-readable and consistent with business terminology?", weight: 1 },
  { id: "safety", question: "Does the answer respect filter/PII/governance rules implied by the schema?", weight: 1 },
  { id: "disambiguation", question: "Did the agent ask a clarifying question when the user's intent was ambiguous?", weight: 1 },
  { id: "completeness", question: "Did the answer include every dimension and metric the user asked for?", weight: 1 },
  { id: "formatting", question: "Is the response well-structured (proper SQL formatting, results table)?", weight: 1 },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JudgeInput {
  question: string;
  expectedSql?: string;
  actualSql?: string;
  actualText?: string;
  schemaContext?: string;
}

export interface JudgeScore {
  id: JudgeId;
  score: number;
  rationale: string;
  weight: number;
}

export interface MultiAxisScoreResult {
  /** Weighted-mean overall score in [0, 100]. */
  aggregate: number;
  scores: JudgeScore[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const judgeLimiter = createConcurrencyLimiter(4);

function buildPrompt(judge: JudgeSpec, input: JudgeInput): string {
  const lines: string[] = [
    `You are a strict SQL/quality judge. Evaluate ONLY: ${judge.question}`,
    "Return JSON: {\"score\": <0-100>, \"rationale\": \"one short sentence\"}.",
    "",
    `Question: ${input.question}`,
  ];
  if (input.expectedSql) lines.push("Expected SQL:", input.expectedSql);
  if (input.actualSql) lines.push("Actual SQL:", input.actualSql);
  if (input.actualText) lines.push("Actual text response:", input.actualText);
  if (input.schemaContext) lines.push("Schema context:", input.schemaContext);
  lines.push("", "Reply with the JSON object only.");
  return lines.join("\n");
}

async function runJudge(judge: JudgeSpec, input: JudgeInput): Promise<JudgeScore> {
  const endpoint = getReviewEndpoint();
  try {
    const response = await chatCompletion({
      endpoint,
      messages: [
        { role: "system", content: "Return JSON only. No prose, no code fences." },
        { role: "user", content: buildPrompt(judge, input) },
      ],
      temperature: 0,
      maxTokens: 200,
    });
    const raw = response.content ?? "";
    const parsed = parseLLMJson(raw, `multi-axis-judge:${judge.id}`) as
      | { score?: number; rationale?: string }
      | null
      | undefined;
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed?.score ?? 0))));
    const rationale = String(parsed?.rationale ?? "").slice(0, 240);
    return { id: judge.id, score, rationale, weight: judge.weight };
  } catch (err) {
    if (err instanceof ModelServingError) {
      logger.warn("[multi-axis] judge call failed, scoring 0", {
        judge: judge.id,
        error: err.message,
      });
    } else {
      logger.warn("[multi-axis] judge call failed, scoring 0", {
        judge: judge.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { id: judge.id, score: 0, rationale: "judge call failed", weight: judge.weight };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true if the review endpoint is configured for multi-axis judging. */
export function isMultiAxisJudgingEnabled(surface = "auto-improve-judges"): boolean {
  return isReviewEnabled(surface);
}

/**
 * Score one (question, response) pair with the full nine-judge panel.
 * Returns the weighted aggregate plus per-judge breakdown.
 */
export async function scoreAnswer(input: JudgeInput): Promise<MultiAxisScoreResult> {
  if (!isMultiAxisJudgingEnabled()) {
    return {
      aggregate: 0,
      scores: JUDGES.map((j) => ({ id: j.id, score: 0, rationale: "judging disabled", weight: j.weight })),
    };
  }
  const scores = await Promise.all(
    JUDGES.map((j) => judgeLimiter(() => runJudge(j, input))),
  );
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  const aggregate =
    totalWeight > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight)
      : 0;
  return { aggregate, scores };
}

/**
 * Score a batch of answers and return the weighted mean of the per-answer
 * aggregates plus the average of each judge axis. Useful as the iteration's
 * "promote vs refine" signal in `auto-improve.ts`.
 */
export async function scoreAnswerBatch(inputs: ReadonlyArray<JudgeInput>): Promise<{
  aggregate: number;
  byJudge: Record<JudgeId, number>;
}> {
  if (inputs.length === 0) {
    const empty = Object.fromEntries(JUDGES.map((j) => [j.id, 0])) as Record<JudgeId, number>;
    return { aggregate: 0, byJudge: empty };
  }
  const results = await Promise.all(inputs.map((i) => scoreAnswer(i)));
  const aggregate = Math.round(
    results.reduce((sum, r) => sum + r.aggregate, 0) / results.length,
  );
  const byJudge: Record<JudgeId, number> = Object.fromEntries(
    JUDGES.map((j) => [j.id, 0]),
  ) as Record<JudgeId, number>;
  for (const r of results) {
    for (const s of r.scores) byJudge[s.id] += s.score;
  }
  for (const j of JUDGES) byJudge[j.id] = Math.round(byJudge[j.id] / results.length);
  return { aggregate, byJudge };
}

// Test helpers ---------------------------------------------------------------

/** @internal */
export const __JUDGES_FOR_TEST = JUDGES;
