import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import {
  buildSchemaContextBlock,
  validateSqlExpression,
  type SchemaAllowlist,
} from "../schema-allowlist";
import type { MetadataSnapshot } from "@/lib/domain/types";
import type { TrustedAssetQuery, QuestionComplexity, JoinSpecInput } from "../types";
import { reviewBatch } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled } from "@/lib/dbx/client";
import { logger } from "@/lib/logger";
import { sanitizeUserContext } from "./title-generation";
import "@/lib/skills/content";
import {
  resolveForGeniePass,
  formatContextSections,
  formatSystemOverlay,
} from "@/lib/skills/resolver";

const TEMPERATURE = 0.2;
const MAX_QUERIES = 6;

/** @deprecated Use shared `isPiiColumn` from `lib/toolkit/pii-patterns.ts`. */
const PII_COLUMN_PATTERN = /(email|phone|ssn|social_security|tax_id|dob|birth|address)/i;
const NUMERIC_TYPE_PATTERN = /^(int|bigint|smallint|tinyint|float|double|decimal|numeric|real)/i;
const DATE_TYPE_PATTERN = /(date|timestamp|time)/i;

export interface ExampleQueryGenerationInput {
  domain: string;
  tableFqns: string[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  joinSpecs: JoinSpecInput[];
  endpoint: string;
  fallbackEndpoint?: string;
  sensitiveColumns?: Set<string>;
  questionComplexity?: QuestionComplexity;
  signal?: AbortSignal;
}

export interface ExampleQueryGenerationOutput {
  queries: TrustedAssetQuery[];
  source: "llm" | "fallback";
}

function isSafeColumnName(column: string, sensitiveColumns?: Set<string>): boolean {
  if (sensitiveColumns?.has(column.toLowerCase())) return false;
  return !PII_COLUMN_PATTERN.test(column);
}

function humanize(columnName: string): string {
  return columnName.replace(/_/g, " ");
}

function buildGroupQuestion(
  groupCol: string,
  domain: string,
  complexity: QuestionComplexity,
): string {
  const col = humanize(groupCol);
  switch (complexity) {
    case "simple":
      return `What are the top ${col}s?`;
    case "medium":
      return `Which ${col}s have the highest totals in ${domain}?`;
    case "complex":
      return `Top ${col} trends in ${domain}`;
  }
}

function buildJoinQuestion(
  leftName: string,
  rightName: string,
  complexity: QuestionComplexity,
): string {
  switch (complexity) {
    case "simple":
      return `How are ${humanize(leftName)} and ${humanize(rightName)} related?`;
    case "medium":
      return `How many ${humanize(leftName)} are linked to ${humanize(rightName)}?`;
    case "complex":
      return `How strongly are ${leftName} linked to ${rightName}?`;
  }
}

export function buildDeterministicExampleQueries(
  domain: string,
  tableFqns: string[],
  metadata: MetadataSnapshot,
  allowlist: SchemaAllowlist,
  joinSpecs: JoinSpecInput[],
  sensitiveColumns?: Set<string>,
  questionComplexity?: QuestionComplexity,
): TrustedAssetQuery[] {
  const complexity = questionComplexity ?? "simple";
  const queries: TrustedAssetQuery[] = [];
  const colsByTable = new Map<string, typeof metadata.columns>();
  for (const col of metadata.columns) {
    const key = col.tableFqn.toLowerCase();
    const arr = colsByTable.get(key) ?? [];
    arr.push(col);
    colsByTable.set(key, arr);
  }

  for (const table of tableFqns.slice(0, 3)) {
    const cols = colsByTable.get(table.toLowerCase()) ?? [];
    const timeCol = cols.find(
      (c) => DATE_TYPE_PATTERN.test(c.dataType) && isSafeColumnName(c.columnName, sensitiveColumns),
    );
    const numericCol = cols.find(
      (c) =>
        NUMERIC_TYPE_PATTERN.test(c.dataType) && isSafeColumnName(c.columnName, sensitiveColumns),
    );
    const groupCol = cols.find(
      (c) =>
        !DATE_TYPE_PATTERN.test(c.dataType) &&
        !NUMERIC_TYPE_PATTERN.test(c.dataType) &&
        isSafeColumnName(c.columnName, sensitiveColumns),
    );
    if (!groupCol) continue;

    const tableName = table.split(".").pop() ?? table;
    const selectMetric = numericCol
      ? `SUM(${table}.${numericCol.columnName}) AS total_value`
      : "COUNT(*) AS total_value";
    const whereTime = timeCol
      ? `WHERE ${table}.${timeCol.columnName} >= DATEADD(day, -90, CURRENT_DATE())`
      : "";

    const sql = [
      `SELECT ${table}.${groupCol.columnName} AS category, ${selectMetric}`,
      `FROM ${table}`,
      whereTime,
      `GROUP BY ${table}.${groupCol.columnName}`,
      "ORDER BY total_value DESC",
      "LIMIT 10",
    ]
      .filter(Boolean)
      .join("\n");

    if (validateSqlExpression(allowlist, sql, `example_query:${tableName}`, true)) {
      queries.push({
        question: buildGroupQuestion(groupCol.columnName, domain, complexity),
        sql,
        parameters: [],
      });
    }
  }

  if (joinSpecs.length > 0) {
    const join = joinSpecs[0];
    const leftName = join.leftTable.split(".").pop() ?? join.leftTable;
    const rightName = join.rightTable.split(".").pop() ?? join.rightTable;
    const joinSql = [
      "SELECT COUNT(*) AS linked_records",
      `FROM ${join.leftTable}`,
      `JOIN ${join.rightTable} ON ${join.sql}`,
    ].join("\n");
    if (validateSqlExpression(allowlist, joinSql, "example_query:join_coverage", true)) {
      queries.unshift({
        question: buildJoinQuestion(leftName, rightName, complexity),
        sql: joinSql,
        parameters: [],
      });
    }
  }

  return queries.slice(0, MAX_QUERIES);
}

function getQuestionStyleDirective(complexity: QuestionComplexity): string {
  switch (complexity) {
    case "simple":
      return "Write short, plain-English questions a business user would naturally ask. Keep each under 10 words. No column names, no SQL jargon, no analytical terms like 'trends' or 'anomaly detection'.";
    case "medium":
      return "Write clear business questions. Reference business concepts and time ranges where relevant. Keep each under 15 words. Avoid raw column names.";
    case "complex":
      return "Generate concise analytical example queries. Prioritize grouped trends, time windows, and one join-based query when joins exist.";
  }
}

async function generateWithEndpoint(
  input: ExampleQueryGenerationInput,
  endpoint: string,
): Promise<TrustedAssetQuery[]> {
  const complexity = input.questionComplexity ?? "simple";
  const schemaBlock = buildSchemaContextBlock(input.metadata, input.tableFqns);
  const joinBlock = input.joinSpecs
    .slice(0, 8)
    .map((j) => `- ${j.leftTable} JOIN ${j.rightTable} ON ${j.sql}`)
    .join("\n");

  const exqSkills = resolveForGeniePass("exampleQueries");
  const exqSkillContext = formatContextSections(exqSkills.contextSections);
  const exqSystemOverlay = formatSystemOverlay(exqSkills.systemOverlay);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You generate Databricks SQL example questions for a Genie data space.\n" +
        'Output strict JSON: {"queries":[{"question":"...","sql":"..."}]}\n' +
        "Rules: only use schema identifiers provided, avoid sensitive columns (email/phone/ssn/address/dob and classified sensitive columns), max 6 queries.\n" +
        `Question style: ${getQuestionStyleDirective(complexity)}` +
        exqSystemOverlay,
    },
    {
      role: "user",
      content: [
        `Domain: ${sanitizeUserContext(input.domain)}`,
        schemaBlock,
        joinBlock ? `Known joins:\n${joinBlock}` : "Known joins: none",
        exqSkillContext ? `### Databricks SQL Patterns\n${exqSkillContext}` : "",
        `Generate 3-6 example queries. ${getQuestionStyleDirective(complexity)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  const response = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: 6144,
    responseFormat: "json_object",
    signal: input.signal,
  });
  const parsed = parseLLMJson(response.content ?? "", "genie:example-queries") as Record<
    string,
    unknown
  >;
  const rawQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
  let queries = (rawQueries as Record<string, unknown>[])
    .map((q) => ({
      question: String(q.question ?? "").trim(),
      sql: String(q.sql ?? "").trim(),
      parameters: [],
    }))
    .filter((q) => q.question.length > 0 && q.sql.length > 0)
    .filter((q) =>
      validateSqlExpression(input.allowlist, q.sql, `example_query:${q.question}`, true),
    )
    .slice(0, MAX_QUERIES);

  if (isReviewEnabled("genie-example-queries") && queries.length > 0) {
    const schemaBlock = buildSchemaContextBlock(input.metadata, input.tableFqns);
    const items = queries.map((q, i) => ({ id: `eq${i}:${q.question}`, sql: q.sql }));
    const results = await reviewBatch(items, "genie-example-queries", {
      schemaContext: schemaBlock,
      requestFix: true,
    });
    const reviewed = queries.map((q, i) => {
      const res = results.find((r) => r.id === items[i].id) ?? results[i];
      const review = res.result;
      if (review.fixedSql) {
        if (
          validateSqlExpression(
            input.allowlist,
            review.fixedSql,
            `example_query_fix:${q.question}`,
            true,
          )
        ) {
          logger.info("Example query SQL fix applied", {
            question: q.question,
            verdict: review.verdict,
            qualityScore: review.qualityScore,
          });
          return { ...q, sql: review.fixedSql };
        }
      }
      if (review.verdict === "fail") {
        logger.warn("Example query SQL dropped (fail verdict, no usable fix)", {
          question: q.question,
          qualityScore: review.qualityScore,
        });
        return null;
      }
      return q;
    });
    queries = reviewed.filter((q): q is NonNullable<typeof q> => q !== null);
  }

  return queries;
}

export async function runExampleQueryGeneration(
  input: ExampleQueryGenerationInput,
): Promise<ExampleQueryGenerationOutput> {
  try {
    const llmQueries = await generateWithEndpoint(input, input.endpoint);
    if (llmQueries.length > 0) {
      return { queries: llmQueries, source: "llm" };
    }
  } catch (error) {
    logger.warn("Fast example query generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (input.fallbackEndpoint && input.fallbackEndpoint !== input.endpoint) {
    try {
      const fallbackQueries = await generateWithEndpoint(input, input.fallbackEndpoint);
      if (fallbackQueries.length > 0) {
        return { queries: fallbackQueries, source: "llm" };
      }
    } catch (error) {
      logger.warn("Fallback example query generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    queries: buildDeterministicExampleQueries(
      input.domain,
      input.tableFqns,
      input.metadata,
      input.allowlist,
      input.joinSpecs,
      input.sensitiveColumns,
      input.questionComplexity,
    ),
    source: "fallback",
  };
}
