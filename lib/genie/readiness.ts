/**
 * Pre-flight Readiness Assessment.
 *
 * Given a scope (catalog.schema), a proposed table list, and a set of
 * candidate example questions, decide whether each question is plausibly
 * answerable from the schema *as it stands today*. Returns one of three
 * verdicts per question:
 *
 *   - `answerable`     -- the schema obviously supports this question
 *   - `partial`        -- the schema supports it with caveats (missing
 *                          columns / FK ambiguity / data freshness)
 *   - `not_answerable` -- the schema cannot answer it without new tables
 *
 * Intended call sites:
 *   - Schema Scan flow (`app/genie/create/schema/`)
 *   - Requirements flow (`app/genie/create/requirements/`)
 *
 * Always called BEFORE the (multi-minute) engine run so the user can
 * adjust scope or rephrase before they pay for generation.
 *
 * Mirrors upstream `databricks-genie-workbench` Create Agent's readiness
 * preflight.
 */

import { resolveEndpoint } from "@/lib/dbx/client";
import { chatCompletion, type ChatMessage } from "@/lib/dbx/model-serving";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadinessVerdict = "answerable" | "partial" | "not_answerable";

export interface ReadinessQuestion {
  question: string;
  /** Optional caller-supplied id; passed through to the result. */
  id?: string;
}

export interface ReadinessTableSummary {
  /** Three-part FQN (catalog.schema.table). */
  fqn: string;
  description?: string | null;
  /** Subset of column names; the prompt is more accurate with column hints. */
  columnNames?: string[];
  /** Optional column descriptions keyed by column name. */
  columnDescriptions?: Record<string, string>;
}

export interface ReadinessInput {
  catalog: string;
  schema?: string;
  tables: ReadyTable[];
  questions: ReadinessQuestion[];
  /** Allow callers to override the LLM endpoint (defaults to classification). */
  endpoint?: string;
  signal?: AbortSignal;
}

type ReadyTable = ReadinessTableSummary;

export interface ReadinessQuestionResult {
  id?: string;
  question: string;
  verdict: ReadinessVerdict;
  rationale: string;
  /**
   * Tables the LLM thinks would be needed to fully answer the question.
   * Empty when `verdict === "answerable"` or the LLM didn't volunteer them.
   */
  requiredTables?: string[];
}

export interface ReadinessReport {
  scope: string;
  results: ReadinessQuestionResult[];
  summary: {
    answerable: number;
    partial: number;
    notAnswerable: number;
  };
  /** True when every question is at least `partial`. */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_TABLES_IN_PROMPT = 30;
const MAX_COLUMNS_PER_TABLE = 25;
const MAX_QUESTIONS_PER_BATCH = 12;

/**
 * Run the readiness assessment. Returns a structured per-question verdict
 * plus an overall `ready` flag the UI can use to decide whether to enable
 * "Generate Space".
 */
export async function assessReadiness(input: ReadinessInput): Promise<ReadinessReport> {
  if (input.tables.length === 0 || input.questions.length === 0) {
    return {
      scope: scopeOf(input),
      results: input.questions.map((q) => ({
        id: q.id,
        question: q.question,
        verdict: "not_answerable" as const,
        rationale: "No tables in scope.",
      })),
      summary: { answerable: 0, partial: 0, notAnswerable: input.questions.length },
      ready: false,
    };
  }

  const endpoint = input.endpoint ?? resolveEndpoint("classification");
  const tableBlock = buildTableBlock(input.tables);
  const results: ReadinessQuestionResult[] = [];

  for (let i = 0; i < input.questions.length; i += MAX_QUESTIONS_PER_BATCH) {
    const batch = input.questions.slice(i, i + MAX_QUESTIONS_PER_BATCH);
    const batchResults = await assessBatch(endpoint, scopeOf(input), tableBlock, batch, input.signal);
    results.push(...batchResults);
  }

  const summary = {
    answerable: results.filter((r) => r.verdict === "answerable").length,
    partial: results.filter((r) => r.verdict === "partial").length,
    notAnswerable: results.filter((r) => r.verdict === "not_answerable").length,
  };
  return {
    scope: scopeOf(input),
    results,
    summary,
    ready: summary.notAnswerable === 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopeOf(input: ReadinessInput): string {
  return input.schema ? `${input.catalog}.${input.schema}` : input.catalog;
}

function buildTableBlock(tables: ReadinessTableSummary[]): string {
  const truncated = tables.slice(0, MAX_TABLES_IN_PROMPT);
  return truncated
    .map((t) => {
      const cols = (t.columnNames ?? []).slice(0, MAX_COLUMNS_PER_TABLE);
      const colWithDesc = cols.map((c) => {
        const desc = t.columnDescriptions?.[c];
        return desc ? `${c} -- ${desc.slice(0, 80)}` : c;
      });
      const desc = t.description ? ` -- ${t.description.slice(0, 200)}` : "";
      return `- ${t.fqn}${desc}\n  columns: ${colWithDesc.join(", ")}`;
    })
    .join("\n");
}

async function assessBatch(
  endpoint: string,
  scope: string,
  tableBlock: string,
  questions: ReadinessQuestion[],
  signal?: AbortSignal,
): Promise<ReadinessQuestionResult[]> {
  const numbered = questions
    .map((q, i) => `${i + 1}. ${q.question.replace(/\s+/g, " ")}`)
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You audit whether a Unity Catalog schema can answer a list of business questions.",
        "Return JSON only -- a top-level array, one object per question, in the SAME order.",
        "Each object: { \"verdict\": \"answerable\"|\"partial\"|\"not_answerable\", \"rationale\": string, \"requiredTables\": string[] }.",
        "rationale must be one short sentence.",
        "verdict 'answerable' means every required table+column exists, 'partial' means missing columns or ambiguous joins, 'not_answerable' means the schema would need new tables.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Scope: ${scope}`,
        "",
        "Available tables (FQN -- description, columns):",
        tableBlock,
        "",
        "Questions:",
        numbered,
        "",
        `Reply with a JSON array of length ${questions.length}.`,
      ].join("\n"),
    },
  ];

  let raw: string;
  try {
    const response = await chatCompletion({
      endpoint,
      messages,
      temperature: 0,
      maxTokens: 1200,
      responseFormat: "json_object",
      signal,
    });
    raw = response.content ?? "";
  } catch (err) {
    logger.warn("[readiness] LLM call failed, marking batch as partial", {
      error: err instanceof Error ? err.message : String(err),
    });
    return questions.map((q) => ({
      id: q.id,
      question: q.question,
      verdict: "partial" as const,
      rationale: "Readiness LLM call failed; falling back to 'partial'.",
    }));
  }

  let parsed: unknown;
  try {
    parsed = parseLLMJson(raw, "readiness");
  } catch (err) {
    logger.warn("[readiness] failed to parse LLM JSON, marking batch as partial", {
      error: err instanceof Error ? err.message : String(err),
    });
    return questions.map((q) => ({
      id: q.id,
      question: q.question,
      verdict: "partial" as const,
      rationale: "Readiness output was not valid JSON; treating as 'partial'.",
    }));
  }

  // Accept either a top-level array or an object with a `results`/`questions` field.
  let arr: unknown[] = [];
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.results)) arr = obj.results;
    else if (Array.isArray(obj.questions)) arr = obj.questions;
  }

  return questions.map((q, i) => {
    const item = arr[i] as Record<string, unknown> | undefined;
    const verdictRaw = String(item?.verdict ?? "").toLowerCase();
    const verdict: ReadinessVerdict =
      verdictRaw === "answerable"
        ? "answerable"
        : verdictRaw === "not_answerable" || verdictRaw === "unanswerable"
          ? "not_answerable"
          : "partial";
    const rationale = String(item?.rationale ?? "").slice(0, 240);
    const required =
      Array.isArray(item?.requiredTables) && item.requiredTables.every((x) => typeof x === "string")
        ? (item.requiredTables as string[])
        : undefined;
    return {
      id: q.id,
      question: q.question,
      verdict,
      rationale: rationale || "(no rationale)",
      requiredTables: required,
    };
  });
}
