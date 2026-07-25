/**
 * LLM-as-reviewer for SQL quality.
 *
 * Uses the dedicated review endpoint (serving-endpoint-review, default
 * databricks-gpt-5-4) to perform multi-dimensional quality assessment
 * on generated SQL, returning structured verdicts and optional auto-fixes.
 *
 * Three entry points:
 *   - reviewSql()        -- single SQL review (read-only verdict)
 *   - reviewAndFixSql()  -- review + auto-fix on failure
 *   - reviewBatch()      -- batch review for short expressions
 */

import { resolveEndpoint, isReviewEnabled } from "@/lib/dbx/client";
import {
  ModelServingError,
  type ChatCompletionOptions,
  type ChatCompletionResponse,
} from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { createScopedLogger } from "@/lib/logger";

const log = createScopedLogger({ origin: "Infra", module: "ai/sql-reviewer" });
import { DATABRICKS_SQL_RULES, DATABRICKS_SQL_REVIEW_CHECKLIST } from "@/lib/toolkit/sql-rules";
import { createConcurrencyLimiter } from "@/lib/toolkit/concurrency";
import "@/lib/skills/content";
import { resolveForPipelineStep, formatContextSections } from "@/lib/skills/resolver";

// ---------------------------------------------------------------------------
// Global review concurrency limiter -- prevents bursting the review endpoint
// when many domains run SQL reviews in parallel (429 pressure reduction).
// ---------------------------------------------------------------------------

const SQL_REVIEW_CONCURRENCY = 6;
const reviewLimiter = createConcurrencyLimiter(SQL_REVIEW_CONCURRENCY);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewIssue {
  category: "correctness" | "performance" | "readability" | "security" | "databricks_idiom";
  severity: "error" | "warning" | "info";
  message: string;
  lineRef?: string;
}

export interface ReviewResult {
  verdict: "pass" | "warn" | "fail";
  qualityScore: number;
  issues: ReviewIssue[];
  fixedSql?: string;
  suggestions: string[];
}

export interface ReviewOptions {
  /** Schema context (CREATE TABLE DDL or markdown) injected into the prompt. */
  schemaContext?: string;
  /** Surface name for logging and feature-gating. */
  surface?: string;
  /** Whether to request a fixed SQL on failure. */
  requestFix?: boolean;
  /** Maximum tokens for the reviewer response. */
  maxTokens?: number;
  /** Runtime error from SQL execution -- injected into the prompt so the reviewer can target the fix. */
  runtimeError?: string;
}

export interface BatchReviewItem {
  id: string;
  sql: string;
  context?: string;
}

export interface BatchReviewResult {
  id: string;
  result: ReviewResult;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildReviewPrompt(sql: string, opts: ReviewOptions): string {
  const runtimeErrorBlock = opts.runtimeError
    ? `\n## Runtime Error (MUST FIX)\nThe SQL above was executed and failed with this error:\n\`\`\`\n${opts.runtimeError}\n\`\`\`\nYour fix MUST resolve this specific error. This takes priority over all other review checks.\n`
    : "";

  const schemaBlock = opts.schemaContext
    ? `\n## Available Schema\n\`\`\`\n${opts.schemaContext}\n\`\`\`\n`
    : "";

  const fixInstruction = opts.requestFix
    ? opts.schemaContext
      ? `If the verdict is "fail", include a "fixed_sql" field with the corrected SQL. Do NOT generate fixed_sql for "warn" or "pass" verdicts -- the SQL is functional and should not be rewritten for style. CRITICAL CONSTRAINT: The fix must ONLY use columns that appear in the "Available Schema" section above. Do NOT invent, guess, or rename any column -- if a column does not exist in the schema, remove the expression rather than substituting. Do NOT introduce new table aliases or column names that are not in the original SQL or schema.`
      : `If the verdict is "fail", include a "fixed_sql" field with the corrected SQL. Do NOT generate fixed_sql for "warn" or "pass" verdicts -- the SQL is functional. Preserve the original table/column references since no schema is available for validation.`
    : `Do NOT include a "fixed_sql" field.`;

  const skillContext = resolveForPipelineStep("sql-generation", { contextBudget: 3000 });
  const skillBlock = formatContextSections(skillContext.contextSections);
  const skillSection = skillBlock ? `\n## SQL Craft Reference\n${skillBlock}\n` : "";

  return `You are a senior Databricks SQL reviewer. Evaluate the SQL below against the quality rules and checklist.

IMPORTANT DIALECT CONTEXT: This is Databricks SQL (based on Spark SQL / ANSI SQL). The following standard SQL features are NOT available or behave differently:
- No STRING_AGG() — use array_join(collect_list(col), ',')
- No MEDIAN() — use PERCENTILE_APPROX(col, 0.5)
- No ISNULL() as a function — use IS NULL predicate or COALESCE
- No TOP N — use ORDER BY ... LIMIT N
- No DATEADD(datepart, n, date) — use DATE_ADD(date, n) or date + INTERVAL 'n' DAY
- QUALIFY clause IS supported for per-group deduplication
- QUALIFY runs before GROUP BY -- NEVER combine aggregates (SUM/AVG/COUNT) with QUALIFY in the same SELECT block
- Pipe syntax (|>) IS supported for chaining transformations
- TIMESTAMP_NTZ IS supported for timezone-independent timestamps
- MERGE INTO IS supported with WHEN MATCHED AND / WHEN NOT MATCHED
- CREATE OR REPLACE TABLE/VIEW IS supported
- Named WINDOW clause IS supported, but you CANNOT extend a named window with a frame spec — OVER (win_name ROWS BETWEEN ...) is a syntax error; inline the full PARTITION BY / ORDER BY / frame in every OVER clause, or define separate named windows for each distinct frame

## SQL to Review
\`\`\`sql
${sql}
\`\`\`
${runtimeErrorBlock}${schemaBlock}${skillSection}
## Quality Rules
${DATABRICKS_SQL_RULES}

${DATABRICKS_SQL_REVIEW_CHECKLIST}

## Severity Classification (mandatory)
- "error": Will cause RUNTIME FAILURE or INCORRECT RESULTS -- syntax errors, wrong JOIN keys, hallucinated columns, missing GROUP BY, alias reuse in same SELECT, aggregate inside window function, unsupported functions (MEDIAN, STRING_AGG)
- "warning": Functional but suboptimal -- missing DECIMAL cast, no explicit window frame, column order, missing COLLATE, defensive DISTINCT, missing LIMIT on ORDER BY
- "info": Stylistic preference -- pipe syntax suggestion, named windows, readability tweaks, formatting
CRITICAL: Only classify as "error" if the query would FAIL or return WRONG DATA at runtime. Style and idiom improvements are "warning" or "info".

## Instructions
1. Evaluate each checklist dimension and identify concrete issues using the severity classification above.
2. Assign a quality score from 0 to 100.
3. Set verdict: "pass" (score >= 80, no errors), "warn" (score 50-79 or warnings only), "fail" (score < 50 or any error-severity issue -- remember only runtime failures qualify as "error").
4. ${fixInstruction}
5. Provide actionable improvement suggestions even when the SQL passes.

Output ONLY valid JSON with this structure (no markdown fences, no explanation):
{
  "verdict": "pass" | "warn" | "fail",
  "quality_score": <number 0-100>,
  "issues": [
    {
      "category": "correctness" | "performance" | "readability" | "security" | "databricks_idiom",
      "severity": "error" | "warning" | "info",
      "message": "<description>",
      "line_ref": "<optional line reference>"
    }
  ],
  "suggestions": ["<improvement suggestion>"],
  ${opts.requestFix ? '"fixed_sql": "<corrected SQL or null if pass>"' : '"fixed_sql": null'}
}`;
}

function buildBatchReviewPrompt(
  items: BatchReviewItem[],
  schemaContext?: string,
  requestFix?: boolean,
): string {
  const sqlBlocks = items
    .map(
      (item, i) =>
        `### Item ${i + 1} (id: ${item.id})\n\`\`\`sql\n${item.sql}\n\`\`\`${item.context ? `\nContext: ${item.context}` : ""}`,
    )
    .join("\n\n");

  const schemaBlock = schemaContext
    ? `\n## Available Schema\n\`\`\`\n${schemaContext}\n\`\`\`\n`
    : "";

  const skillContext = resolveForPipelineStep("sql-generation", { contextBudget: 2000 });
  const skillBlock = formatContextSections(skillContext.contextSections);
  const batchSkillSection = skillBlock ? `\n## SQL Craft Reference\n${skillBlock}\n` : "";

  const fixInstruction = requestFix
    ? schemaContext
      ? ` If the verdict is "fail", include a "fixed_sql" field with the corrected SQL. Do NOT generate fixed_sql for "warn" or "pass" -- the SQL is functional. CRITICAL: The fix must ONLY use columns that appear in the "Available Schema" section above. Do NOT invent, guess, or rename any column.`
      : ` If the verdict is "fail", include a "fixed_sql" field with the corrected SQL. Do NOT generate fixed_sql for "warn" or "pass" -- the SQL is functional. Preserve the original table/column references since no schema is available.`
    : "";

  const fixedSqlField = requestFix ? ', "fixed_sql": "<corrected SQL or null if pass>"' : "";

  return `You are a senior Databricks SQL reviewer. Evaluate each SQL expression below against the quality rules and checklist.

${sqlBlocks}
${schemaBlock}${batchSkillSection}
## Quality Rules
${DATABRICKS_SQL_RULES}

${DATABRICKS_SQL_REVIEW_CHECKLIST}

## Severity Classification (mandatory)
- "error": Will cause RUNTIME FAILURE or INCORRECT RESULTS -- syntax errors, wrong JOIN keys, hallucinated columns, missing GROUP BY, alias reuse in same SELECT, unsupported functions (MEDIAN, STRING_AGG)
- "warning": Functional but suboptimal -- missing DECIMAL cast, no explicit window frame, column order, missing COLLATE, defensive DISTINCT
- "info": Stylistic preference -- pipe syntax suggestion, named windows, readability tweaks
CRITICAL: Only classify as "error" if the expression would FAIL or return WRONG DATA at runtime.

## Instructions
Review each item independently. For short expressions, focus on correctness, Databricks idiom adherence, and potential runtime errors.${schemaContext ? " Verify all table/column references exist in the provided schema." : ""}${fixInstruction}

Output ONLY valid JSON with this structure (no markdown fences):
{
  "reviews": [
    {
      "id": "<item id>",
      "verdict": "pass" | "warn" | "fail",
      "quality_score": <number 0-100>,
      "issues": [
        {
          "category": "correctness" | "performance" | "readability" | "security" | "databricks_idiom",
          "severity": "error" | "warning" | "info",
          "message": "<description>"
        }
      ],
      "suggestions": ["<improvement suggestion>"]${fixedSqlField}
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseReviewResponse(raw: string, requestedFix: boolean): ReviewResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    log.warn("Failed to parse review response as JSON, treating as warn", {
      rawLength: raw.length,
      errorCategory: "parse_error",
    });
    return {
      verdict: "warn",
      qualityScore: 50,
      issues: [
        {
          category: "correctness" as const,
          severity: "warning" as const,
          message: "SQL review response could not be parsed — review was inconclusive",
        },
      ],
      suggestions: ["Review response could not be parsed; manual review recommended"],
    };
  }

  const verdict = (["pass", "warn", "fail"] as const).includes(parsed.verdict)
    ? parsed.verdict
    : "warn";

  const qualityScore =
    typeof parsed.quality_score === "number"
      ? Math.max(0, Math.min(100, parsed.quality_score))
      : 50;

  const issues: ReviewIssue[] = (parsed.issues ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((i: any) => i && i.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((i: any) => ({
      category: i.category ?? "correctness",
      severity: i.severity ?? "warning",
      message: String(i.message),
      lineRef: i.line_ref ?? undefined,
    }));

  const suggestions: string[] = (parsed.suggestions ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => typeof s === "string" && s.length > 0);

  const fixedSql =
    requestedFix && typeof parsed.fixed_sql === "string" && parsed.fixed_sql.length > 10
      ? parsed.fixed_sql
      : undefined;

  return { verdict, qualityScore, issues, fixedSql, suggestions };
}

function parseBatchReviewResponse(
  raw: string,
  items: BatchReviewItem[],
  requestFix?: boolean,
): BatchReviewResult[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = parseLLMJson(raw, "sql-reviewer:batch");
  } catch {
    log.warn("Failed to parse batch review response, treating all as warn", {
      errorCategory: "parse_error",
    });
    return items.map((item) => ({
      id: item.id,
      result: {
        verdict: "warn" as const,
        qualityScore: 50,
        issues: [
          {
            category: "correctness" as const,
            severity: "warning" as const,
            message: "Batch review response could not be parsed — review was inconclusive",
          },
        ],
        suggestions: ["Batch review response could not be parsed; manual review recommended"],
      },
    }));
  }

  const reviews = parsed.reviews ?? [];
  return items.map((item) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = reviews.find((r: any) => r.id === item.id);
    if (!match) {
      return {
        id: item.id,
        result: {
          verdict: "pass" as const,
          qualityScore: 50,
          issues: [],
          suggestions: [],
        },
      };
    }

    const fixedSql =
      requestFix && typeof match.fixed_sql === "string" && match.fixed_sql.length > 10
        ? match.fixed_sql
        : undefined;

    return {
      id: item.id,
      result: {
        verdict: (["pass", "warn", "fail"] as const).includes(match.verdict)
          ? match.verdict
          : "warn",
        qualityScore:
          typeof match.quality_score === "number"
            ? Math.max(0, Math.min(100, match.quality_score))
            : 50,
        issues: (match.issues ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((i: any) => i && i.message)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((i: any) => ({
            category: i.category ?? "correctness",
            severity: i.severity ?? "warning",
            message: String(i.message),
            lineRef: i.line_ref ?? undefined,
          })),
        suggestions: (match.suggestions ?? []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s: any) => typeof s === "string",
        ),
        fixedSql,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const PASS_THROUGH_RESULT: ReviewResult = {
  verdict: "pass",
  qualityScore: 100,
  issues: [],
  suggestions: [],
};

function isRateLimitError(err: unknown): boolean {
  return err instanceof ModelServingError && err.statusCode === 429;
}

function getRateLimitRetryMs(err: unknown): number | undefined {
  return err instanceof ModelServingError ? err.retryAfterMs : undefined;
}

function reviewChatCompletion(
  opts: ChatCompletionOptions,
  _surface?: string,
): Promise<ChatCompletionResponse> {
  return reviewLimiter(() => cachedChatCompletion(opts));
}

function summariseIssues(issues: ReviewIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    counts[i.category] = (counts[i.category] ?? 0) + 1;
  }
  return counts;
}

function topIssueMessages(issues: ReviewIssue[], n = 3): string[] {
  const byPriority = [...issues].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
  });
  return byPriority.slice(0, n).map((i) => `[${i.severity}/${i.category}] ${i.message}`);
}

/**
 * Review a single SQL statement. Returns a structured verdict without fixing.
 * If the review endpoint is not configured or disabled for this surface,
 * returns a pass-through result.
 */
export async function reviewSql(sql: string, opts: ReviewOptions = {}): Promise<ReviewResult> {
  if (!isReviewEnabled(opts.surface)) return PASS_THROUGH_RESULT;
  if (!sql || sql.trim().length < 10) return PASS_THROUGH_RESULT;

  const endpoint = resolveEndpoint("sql");
  const prompt = buildReviewPrompt(sql, { ...opts, requestFix: false });

  const callReview = async (ep: string): Promise<ReviewResult> => {
    const response = await reviewChatCompletion(
      {
        endpoint: ep,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        maxTokens: opts.maxTokens ?? 4096,
        responseFormat: "json_object",
      },
      opts.surface,
    );
    return parseReviewResponse(response.content, false);
  };

  try {
    const result = await callReview(endpoint);

    log.info("SQL review complete", {
      surface: opts.surface,
      verdict: result.verdict,
      qualityScore: result.qualityScore,
      issueCount: result.issues.length,
      endpoint,
    });
    log.debug("SQL review detail", {
      surface: opts.surface,
      issueCategories: summariseIssues(result.issues),
      topIssues: topIssueMessages(result.issues),
    });

    return result;
  } catch (err) {
    if (isRateLimitError(err)) {
      const fallback = resolveEndpoint("sql");
      if (fallback !== endpoint) {
        log.warn("SQL review hit 429, retrying with fast model", {
          surface: opts.surface,
          originalEndpoint: endpoint,
          fallbackEndpoint: fallback,
          retryAfterMs: getRateLimitRetryMs(err),
          errorCategory: "rate_limit",
        });
        try {
          const result = await callReview(fallback);
          log.info("SQL review complete (fallback)", {
            surface: opts.surface,
            verdict: result.verdict,
            qualityScore: result.qualityScore,
            issueCount: result.issues.length,
            endpoint: fallback,
          });
          log.debug("SQL review detail (fallback)", {
            surface: opts.surface,
            issueCategories: summariseIssues(result.issues),
            topIssues: topIssueMessages(result.issues),
          });
          return result;
        } catch (fallbackErr) {
          log.warn("SQL review fallback also failed, passing through", {
            surface: opts.surface,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            errorCategory: "fallback_failed",
          });
          return PASS_THROUGH_RESULT;
        }
      }
    }
    log.warn("SQL review failed, passing through", {
      surface: opts.surface,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
    return PASS_THROUGH_RESULT;
  }
}

/**
 * Review a single SQL statement and auto-fix if the verdict is warn or fail.
 * Returns the original or fixed SQL alongside the review result.
 */
export async function reviewAndFixSql(
  sql: string,
  opts: ReviewOptions = {},
): Promise<ReviewResult> {
  if (!isReviewEnabled(opts.surface)) return PASS_THROUGH_RESULT;
  if (!sql || sql.trim().length < 10) return PASS_THROUGH_RESULT;

  const endpoint = resolveEndpoint("sql");
  const prompt = buildReviewPrompt(sql, { ...opts, requestFix: true });

  const callReviewFix = async (ep: string): Promise<ReviewResult> => {
    const response = await reviewChatCompletion(
      {
        endpoint: ep,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        maxTokens: opts.maxTokens ?? 8192,
        responseFormat: "json_object",
      },
      opts.surface,
    );
    return parseReviewResponse(response.content, true);
  };

  try {
    const result = await callReviewFix(endpoint);

    log.info("SQL review+fix complete", {
      surface: opts.surface,
      verdict: result.verdict,
      qualityScore: result.qualityScore,
      issueCount: result.issues.length,
      hasFix: !!result.fixedSql,
      endpoint,
    });
    log.debug("SQL review+fix detail", {
      surface: opts.surface,
      issueCategories: summariseIssues(result.issues),
      topIssues: topIssueMessages(result.issues),
      sqlPreview: sql.substring(0, 120),
    });

    return result;
  } catch (err) {
    if (isRateLimitError(err)) {
      const fallback = resolveEndpoint("sql");
      if (fallback !== endpoint) {
        log.warn("SQL review+fix hit 429, retrying with fast model", {
          surface: opts.surface,
          originalEndpoint: endpoint,
          fallbackEndpoint: fallback,
          retryAfterMs: getRateLimitRetryMs(err),
          errorCategory: "rate_limit",
        });
        try {
          const result = await callReviewFix(fallback);
          log.info("SQL review+fix complete (fallback)", {
            surface: opts.surface,
            verdict: result.verdict,
            qualityScore: result.qualityScore,
            issueCount: result.issues.length,
            hasFix: !!result.fixedSql,
            endpoint: fallback,
          });
          log.debug("SQL review+fix detail (fallback)", {
            surface: opts.surface,
            issueCategories: summariseIssues(result.issues),
            topIssues: topIssueMessages(result.issues),
            sqlPreview: sql.substring(0, 120),
          });
          return result;
        } catch (fallbackErr) {
          log.warn("SQL review+fix fallback also failed, passing through", {
            surface: opts.surface,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            errorCategory: "fallback_failed",
          });
          return PASS_THROUGH_RESULT;
        }
      }
    }
    log.warn("SQL review+fix failed, passing through", {
      surface: opts.surface,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
    return PASS_THROUGH_RESULT;
  }
}

export interface ReviewBatchOptions {
  /** Schema context injected into the prompt. */
  schemaContext?: string;
  /** Whether to request fixed SQL on warn/fail verdicts. */
  requestFix?: boolean;
}

/**
 * Batch-review multiple short SQL expressions in a single LLM call.
 * Best for semantic expressions, filters, measures, and join conditions.
 * Falls back to per-item pass-through if the endpoint is disabled.
 */
export async function reviewBatch(
  items: BatchReviewItem[],
  surface?: string,
  options?: ReviewBatchOptions | string,
): Promise<BatchReviewResult[]> {
  const schemaContext = typeof options === "string" ? options : options?.schemaContext;
  const requestFix = typeof options === "object" && options?.requestFix === true;

  if (!isReviewEnabled(surface) || items.length === 0) {
    return items.map((item) => ({
      id: item.id,
      result: PASS_THROUGH_RESULT,
    }));
  }

  const endpoint = resolveEndpoint("sql");
  const prompt = buildBatchReviewPrompt(items, schemaContext, requestFix);

  const perItemBudget = requestFix ? 4096 : 2048;
  const callBatchReview = async (ep: string): Promise<BatchReviewResult[]> => {
    const response = await reviewChatCompletion(
      {
        endpoint: ep,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        maxTokens: Math.max(Math.min(items.length * perItemBudget, 32768), 16384),
        responseFormat: "json_object",
      },
      surface,
    );
    if (!response.content) {
      log.warn("Empty batch review response from LLM, returning default warn verdicts", {
        surface,
        endpoint: ep,
        finishReason: response.finishReason,
        model: response.model,
        rawLength: 0,
      });
    }
    return parseBatchReviewResponse(response.content, items, requestFix);
  };

  const logBatchResults = (results: BatchReviewResult[], ep: string, label = ""): void => {
    const failCount = results.filter((r) => r.result.verdict === "fail").length;
    const warnCount = results.filter((r) => r.result.verdict === "warn").length;
    const scores = results.map((r) => r.result.qualityScore);
    const avgScore =
      scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    log.info(`SQL batch review complete${label}`, {
      surface,
      totalItems: items.length,
      failCount,
      warnCount,
      avgQualityScore: avgScore,
      endpoint: ep,
    });
  };

  try {
    const results = await callBatchReview(endpoint);
    logBatchResults(results, endpoint);
    return results;
  } catch (err) {
    if (isRateLimitError(err)) {
      const fallback = resolveEndpoint("sql");
      if (fallback !== endpoint) {
        log.warn("SQL batch review hit 429, retrying with fast model", {
          surface,
          originalEndpoint: endpoint,
          fallbackEndpoint: fallback,
          itemCount: items.length,
          retryAfterMs: getRateLimitRetryMs(err),
          errorCategory: "rate_limit",
        });
        try {
          const results = await callBatchReview(fallback);
          logBatchResults(results, fallback, " (fallback)");
          return results;
        } catch (fallbackErr) {
          log.warn("SQL batch review fallback also failed, passing through", {
            surface,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            errorCategory: "fallback_failed",
          });
          return items.map((item) => ({
            id: item.id,
            result: PASS_THROUGH_RESULT,
          }));
        }
      }
    }
    log.warn("SQL batch review failed, passing through", {
      surface,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: "non_fatal",
    });
    return items.map((item) => ({
      id: item.id,
      result: PASS_THROUGH_RESULT,
    }));
  }
}
