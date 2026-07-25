/**
 * Pass 3: Trusted Asset Authoring (LLM, grounded)
 *
 * Converts top SQL examples into parameterized queries (trusted assets).
 * All SQL is validated against the schema allowlist.
 */

import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import type { UseCase, MetadataSnapshot } from "@/lib/domain/types";
import type {
  TrustedAssetQuery,
  EntityMatchingCandidate,
  QuestionComplexity,
  JoinSpecInput,
  ReferenceSqlExample,
} from "../types";
import {
  buildSchemaContextBlock,
  validateSqlExpression,
  type SchemaAllowlist,
} from "../schema-allowlist";
import { reviewBatch } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled } from "@/lib/dbx/client";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { resolveForGeniePass, formatSystemOverlay } from "@/lib/skills";
import {
  isSqlRepairEnabled,
  validateAndRepairBatch,
  type ValidateAndRepairItem,
} from "@/lib/genie/sql-validator";
import {
  buildProfileGroundingBlock,
  snapshotsFromEntityCandidates,
} from "../profile-grounding";

const TEMPERATURE = 0.2;
const BATCH_SIZE = 2;
const BATCH_CONCURRENCY = 10;

export interface TrustedAssetsInput {
  tableFqns: string[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  useCases: UseCase[];
  entityCandidates: EntityMatchingCandidate[];
  joinSpecs: JoinSpecInput[];
  endpoint: string;
  questionComplexity?: QuestionComplexity;
  /** Validated SQL from the existing space, used when useCases is empty. */
  referenceSql?: ReferenceSqlExample[];
  signal?: AbortSignal;
  /** Max use cases to feed into trusted asset authoring (budget-driven). */
  useCaseCap?: number;
  /** Max tokens for the LLM call (budget-driven). */
  maxTokens?: number;
}

export interface TrustedAssetsOutput {
  queries: TrustedAssetQuery[];
}

export async function runTrustedAssetAuthoring(
  input: TrustedAssetsInput,
): Promise<TrustedAssetsOutput> {
  const {
    tableFqns,
    metadata,
    allowlist,
    useCases,
    entityCandidates,
    joinSpecs,
    endpoint,
    questionComplexity,
    referenceSql,
    signal,
    useCaseCap,
    maxTokens: maxTokensOverride,
  } = input;

  const cap = useCaseCap ?? 12;
  const topUseCases = useCases
    .filter((uc) => uc.sqlCode && uc.sqlStatus === "generated")
    .slice(0, cap);

  const hasReferenceSql = referenceSql && referenceSql.length > 0;

  if (topUseCases.length === 0 && !hasReferenceSql) {
    return { queries: [] };
  }

  const schemaBlock = buildSchemaContextBlock(metadata, tableFqns);
  const entityBlock = buildEntityBlock(entityCandidates);
  const joinBlock = buildJoinBlock(joinSpecs);
  const profileBlock =
    entityCandidates.length > 0
      ? buildProfileGroundingBlock(snapshotsFromEntityCandidates(entityCandidates))
      : "";
  const groundedSchemaBlock = profileBlock ? `${schemaBlock}\n\n${profileBlock}` : schemaBlock;

  if (topUseCases.length > 0) {
    const batches: UseCase[][] = [];
    for (let i = 0; i < topUseCases.length; i += BATCH_SIZE) {
      batches.push(topUseCases.slice(i, i + BATCH_SIZE));
    }

    logger.info("Trusted asset authoring: batching use cases", {
      endpoint,
      totalUseCases: topUseCases.length,
      batchCount: batches.length,
      batchSize: BATCH_SIZE,
    });

    const batchResults = await mapWithConcurrency(
      batches.map((batch) => async () => {
        try {
          return await processTrustedAssetBatch(
            batch,
            groundedSchemaBlock,
            entityBlock,
            joinBlock,
            allowlist,
            endpoint,
            questionComplexity,
            signal,
            maxTokensOverride,
          );
        } catch (err) {
          logger.warn("Trusted asset batch failed, continuing with remaining batches", {
            batchSize: batch.length,
            batchUseCases: batch.map((uc) => uc.name),
            error: err instanceof Error ? err.message : String(err),
          });
          return { queries: [] as TrustedAssetQuery[] };
        }
      }),
      BATCH_CONCURRENCY,
    );

    const allQueries: TrustedAssetQuery[] = [];
    for (const result of batchResults) {
      allQueries.push(...result.queries);
    }
    return { queries: allQueries };
  }

  logger.info("Trusted asset authoring: using reference SQL from existing space", {
    referenceSqlCount: referenceSql!.length,
  });

  return processReferenceSqlBatch(
    referenceSql!,
    groundedSchemaBlock,
    entityBlock,
    joinBlock,
    allowlist,
    endpoint,
    questionComplexity,
    signal,
  );
}

function buildEntityBlock(entityCandidates: EntityMatchingCandidate[]): string {
  if (entityCandidates.length === 0) return "";
  return `### ENTITY MATCHING COLUMNS (use these values in parameter comments)\n${entityCandidates
    .filter((c) => c.sampleValues.length > 0)
    .slice(0, 20)
    .map((c) => `- ${c.tableFqn}.${c.columnName}: [${c.sampleValues.slice(0, 15).join(", ")}]`)
    .join("\n")}`;
}

function buildJoinBlock(joinSpecs: JoinSpecInput[]): string {
  if (joinSpecs.length === 0) return "";
  const lines = joinSpecs.map(
    (j) => `- ${j.leftTable} JOIN ${j.rightTable} ON ${j.sql} (${j.relationshipType})`,
  );
  return `### TABLE RELATIONSHIPS (use these exact join conditions)\n${lines.join("\n")}`;
}

function getQuestionRules(complexity: QuestionComplexity): string {
  switch (complexity) {
    case "simple":
      return "\nQUESTION RULES:\n- Write each question as a short, natural question a business user would ask (under 10 words).\n- Do NOT reference column names, table names, or SQL concepts in the question text.\n- The SQL can be complex; the question must be simple.\n";
    case "medium":
      return "\nQUESTION RULES:\n- Write each question as a clear business question (under 15 words).\n- Reference business concepts, not raw column or table names.\n";
    case "complex":
      return "";
  }
}

async function processTrustedAssetBatch(
  batch: UseCase[],
  schemaBlock: string,
  entityBlock: string,
  joinBlock: string,
  allowlist: SchemaAllowlist,
  endpoint: string,
  questionComplexity?: QuestionComplexity,
  signal?: AbortSignal,
  maxTokensOverride?: number,
): Promise<TrustedAssetsOutput> {
  const MAX_SQL_CHARS = 3000;
  const sqlExamples = batch
    .map((uc) => {
      const sql =
        (uc.sqlCode ?? "").length > MAX_SQL_CHARS
          ? uc.sqlCode!.slice(0, MAX_SQL_CHARS) + "\n-- (truncated)"
          : uc.sqlCode;
      return `Question: ${uc.name}\nSQL:\n${sql}`;
    })
    .join("\n\n---\n\n");

  const systemMessage =
    `You are a SQL expert creating trusted assets for a Databricks Genie space.

You MUST only use table and column identifiers from the SCHEMA CONTEXT below. Do NOT invent identifiers.

From the provided SQL examples, create **parameterized queries**:
- Convert WHERE clause values into named parameters using :param_name syntax
- Type each parameter (String, Date, Numeric) based on the column's data type
- For entity-matching columns, include sample values in the parameter comment
- Include DEFAULT NULL for optional parameters
- PRESERVE identifying columns (e.g. customer_name) in SELECT output
- PRESERVE full CTE structure, business logic, thresholds, and column lists from source SQL
- For top-N queries, use ORDER BY ... LIMIT N (not RANK/DENSE_RANK)

SQL RULES:
- Format SQL across multiple lines with proper indentation
- COLLATE UTF8_LCASE on BOTH sides for case-insensitive comparisons
- Cast DOUBLE monetary columns to DECIMAL(18,2) BEFORE aggregation
- ORDER BY must include LIMIT
- Do NOT create UDFs -- only parameterized queries

OUTPUT: Produce exactly 1 parameterized query per use case.
${getQuestionRules(questionComplexity ?? "simple")}
Return JSON: {
  "queries": [{ "question": "...", "sql": "...", "parameters": [{ "name": "...", "type": "String|Date|Numeric", "comment": "...", "defaultValue": null }] }]
}` + formatSystemOverlay(resolveForGeniePass("trustedAssets").systemOverlay);

  const userMessage = `${schemaBlock}

${entityBlock}

${joinBlock}

### SQL EXAMPLES TO PARAMETERIZE
${sqlExamples}

Create parameterized queries from these examples.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  const result = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: maxTokensOverride ?? 6144,
    responseFormat: "json_object",
    signal,
  });

  const content = result.content ?? "";
  const parsed = parseLLMJson(content, "genie:trusted-assets") as Record<string, unknown>;

  let queries: TrustedAssetQuery[] = parseArray(parsed.queries)
    .map((q) => ({
      question: String(q.question ?? ""),
      sql: String(q.sql ?? ""),
      parameters: parseArray(q.parameters).map((p) => ({
        name: String(p.name ?? ""),
        type: (["String", "Date", "Numeric"].includes(String(p.type))
          ? String(p.type)
          : "String") as "String" | "Date" | "Numeric",
        comment: String(p.comment ?? ""),
        defaultValue: p.defaultValue ? String(p.defaultValue) : null,
      })),
    }))
    .filter((q) => validateSqlExpression(allowlist, q.sql, `trusted_query:${q.question}`, true));

  // LLM review gate: batch review + fix trusted asset SQL
  if (isReviewEnabled("genie-trusted-assets") && queries.length > 0) {
    const items = queries.map((q, i) => ({ id: `q${i}:${q.question}`, sql: q.sql }));
    const results = await reviewBatch(items, "genie-trusted-assets", {
      schemaContext: schemaBlock,
      requestFix: true,
    });
    const reviewed = queries.map((q, i) => {
      const res = results.find((r) => r.id === items[i].id) ?? results[i];
      const review = res.result;
      if (review.fixedSql) {
        if (
          validateSqlExpression(allowlist, review.fixedSql, `trusted_query_fix:${q.question}`, true)
        ) {
          if (review.verdict === "fail" && (review.qualityScore ?? 0) < 60) {
            logger.warn("Trusted asset SQL dropped (fix applied but quality too low)", {
              question: q.question,
              qualityScore: review.qualityScore,
            });
            return null;
          }
          logger.info("Trusted asset SQL fix applied", {
            question: q.question,
            verdict: review.verdict,
            qualityScore: review.qualityScore,
          });
          return { ...q, sql: review.fixedSql };
        }
        logger.warn("Trusted asset review fix failed schema validation, keeping original", {
          question: q.question,
        });
        return q;
      }
      if (review.verdict === "fail") {
        logger.warn("Trusted asset SQL dropped (fail verdict, no usable fix)", {
          question: q.question,
          qualityScore: review.qualityScore,
        });
        return null;
      }
      return q;
    });
    queries = reviewed.filter((q): q is NonNullable<typeof q> => q !== null);
  }

  queries = await applyValidatorIfEnabled(queries, schemaBlock);
  return { queries };
}

/**
 * Generate trusted assets from reference SQL (existing space SQL) when no
 * pipeline use cases are available. Adapts the reference examples into
 * parameterized queries using the same LLM prompt structure.
 */
async function processReferenceSqlBatch(
  referenceSql: ReferenceSqlExample[],
  schemaBlock: string,
  entityBlock: string,
  joinBlock: string,
  allowlist: SchemaAllowlist,
  endpoint: string,
  questionComplexity?: QuestionComplexity,
  signal?: AbortSignal,
): Promise<TrustedAssetsOutput> {
  const MAX_SQL_CHARS = 3000;
  const sqlExamples = referenceSql
    .slice(0, 12)
    .map((r) => {
      const sql =
        r.sql.length > MAX_SQL_CHARS ? r.sql.slice(0, MAX_SQL_CHARS) + "\n-- (truncated)" : r.sql;
      return `Question: ${r.question}\nSQL:\n${sql}`;
    })
    .join("\n\n---\n\n");

  const systemMessage =
    `You are a SQL expert creating trusted assets for a Databricks Genie space.

You MUST only use table and column identifiers from the SCHEMA CONTEXT below. Do NOT invent identifiers.

From the provided REFERENCE SQL, create **new parameterized queries** that cover different analytical angles for the same tables. You may adapt the reference SQL or create new queries that reuse the same tables and columns.

For each query:
- Convert WHERE clause values into named parameters using :param_name syntax
- Type each parameter (String, Date, Numeric) based on the column's data type
- For entity-matching columns, include sample values in the parameter comment
- Include DEFAULT NULL for optional parameters
- ONLY use column names that appear in the SCHEMA CONTEXT

SQL RULES:
- Format SQL across multiple lines with proper indentation
- COLLATE UTF8_LCASE on BOTH sides for case-insensitive comparisons
- ORDER BY must include LIMIT
- Produce 3-5 parameterized queries covering different analytical patterns
${getQuestionRules(questionComplexity ?? "simple")}
Return JSON: {
  "queries": [{ "question": "...", "sql": "...", "parameters": [{ "name": "...", "type": "String|Date|Numeric", "comment": "...", "defaultValue": null }] }]
}` + formatSystemOverlay(resolveForGeniePass("trustedAssets").systemOverlay);

  const userMessage = `${schemaBlock}

${entityBlock}

${joinBlock}

### REFERENCE SQL FROM EXISTING SPACE
${sqlExamples}

Create new parameterized queries based on these reference patterns.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  const result = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: 6144,
    responseFormat: "json_object",
    signal,
  });

  const content = result.content ?? "";
  const parsed = parseLLMJson(content, "genie:trusted-assets-ref") as Record<string, unknown>;

  let queries: TrustedAssetQuery[] = parseArray(parsed.queries)
    .map((q) => ({
      question: String(q.question ?? ""),
      sql: String(q.sql ?? ""),
      parameters: parseArray(q.parameters).map((p) => ({
        name: String(p.name ?? ""),
        type: (["String", "Date", "Numeric"].includes(String(p.type))
          ? String(p.type)
          : "String") as "String" | "Date" | "Numeric",
        comment: String(p.comment ?? ""),
        defaultValue: p.defaultValue ? String(p.defaultValue) : null,
      })),
    }))
    .filter((q) => validateSqlExpression(allowlist, q.sql, `trusted_ref:${q.question}`, true));

  if (isReviewEnabled("genie-trusted-assets") && queries.length > 0) {
    const items = queries.map((q, i) => ({ id: `ref${i}:${q.question}`, sql: q.sql }));
    const results = await reviewBatch(items, "genie-trusted-assets", {
      schemaContext: schemaBlock,
      requestFix: true,
    });
    const reviewed = queries.map((q, i) => {
      const res = results.find((r) => r.id === items[i].id) ?? results[i];
      const review = res.result;
      if (review.fixedSql) {
        if (
          validateSqlExpression(allowlist, review.fixedSql, `trusted_ref_fix:${q.question}`, true)
        ) {
          if (review.verdict === "fail" && (review.qualityScore ?? 0) < 60) {
            logger.warn("Trusted asset SQL dropped (fix applied but quality too low)", {
              question: q.question,
              qualityScore: review.qualityScore,
            });
            return null;
          }
          logger.info("Trusted asset SQL fix applied", {
            question: q.question,
            verdict: review.verdict,
            qualityScore: review.qualityScore,
          });
          return { ...q, sql: review.fixedSql };
        }
        logger.warn("Trusted asset review fix failed schema validation, keeping original", {
          question: q.question,
        });
        return q;
      }
      if (review.verdict === "fail") {
        logger.warn("Trusted asset SQL dropped (fail verdict, no usable fix)", {
          question: q.question,
          qualityScore: review.qualityScore,
        });
        return null;
      }
      return q;
    });
    queries = reviewed.filter((q): q is NonNullable<typeof q> => q !== null);
  }

  queries = await applyValidatorIfEnabled(queries, schemaBlock);
  return { queries };
}

/**
 * Phase 2 SQL validator gate: actually EXPLAIN each trusted-asset SQL on
 * the warehouse and repair on failure. Off by default; flip on via
 * FORGE_SQL_REPAIR_ENABLED once telemetry confirms zero-impact on latency.
 */
async function applyValidatorIfEnabled(
  queries: TrustedAssetQuery[],
  schemaBlock: string,
): Promise<TrustedAssetQuery[]> {
  if (!isSqlRepairEnabled() || queries.length === 0) return queries;

  const items: ValidateAndRepairItem[] = queries.map((q) => ({
    sql: q.sql,
    kind: "trusted_asset",
    schemaContext: schemaBlock,
    surface: "genie-trusted-assets",
  }));
  const validated = await validateAndRepairBatch(items);
  return queries
    .map((q, i) => {
      const v = validated[i];
      if (v.status === "dropped") {
        logger.warn("Trusted asset SQL dropped by validator", {
          question: q.question,
          reason: v.reason,
        });
        return null;
      }
      return v.finalSql && v.finalSql !== q.sql ? { ...q, sql: v.finalSql } : q;
    })
    .filter((q): q is TrustedAssetQuery => q !== null);
}

function parseArray(val: unknown): Record<string, unknown>[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null);
}
