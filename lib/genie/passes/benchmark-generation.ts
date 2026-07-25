/**
 * Pass 5: Benchmark Generation (LLM, grounded)
 *
 * Generates benchmark questions with expected SQL answers for quality
 * assurance of Genie spaces. Includes alternate phrasings, time-period
 * variants, and entity-matching test questions.
 */

import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import type { UseCase, MetadataSnapshot } from "@/lib/domain/types";
import type {
  BenchmarkInput,
  EntityMatchingCandidate,
  JoinSpecInput,
  ReferenceSqlExample,
} from "../types";
import {
  buildSchemaContextBlock,
  validateSqlExpression,
  type SchemaAllowlist,
} from "../schema-allowlist";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/toolkit/sql-rules";
import { reviewBatch } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled } from "@/lib/dbx/client";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import {
  isSqlRepairEnabled,
  validateAndRepairBatch,
  type ValidateAndRepairItem,
} from "@/lib/genie/sql-validator";
import {
  resolveForGeniePass,
  formatContextSections,
  buildDomainQuestionPatterns,
} from "@/lib/skills";
import {
  buildProfileGroundingBlock,
  snapshotsFromEntityCandidates,
} from "../profile-grounding";

const TEMPERATURE = 0.1;
const BENCHMARKS_PER_BATCH = 4;
const BATCH_SIZE = 3;
const BATCH_CONCURRENCY = 10;

export interface BenchmarkGenerationInput {
  tableFqns: string[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  useCases: UseCase[];
  entityCandidates: EntityMatchingCandidate[];
  customerBenchmarks: BenchmarkInput[];
  joinSpecs: JoinSpecInput[];
  endpoint: string;
  /** Validated SQL from the existing space, used when useCases is empty. */
  referenceSql?: ReferenceSqlExample[];
  /** Industry ID for domain-specific question patterns. */
  industryId?: string;
  signal?: AbortSignal;
  /** Max use cases to feed into benchmark generation (budget-driven). */
  useCaseCap?: number;
  /** Benchmarks to request per LLM batch call (budget-driven). */
  benchmarksPerBatch?: number;
  /** Max tokens for the LLM call (budget-driven). */
  maxTokens?: number;
}

export interface BenchmarkGenerationDiagnostics {
  generated: number;
  rejected: number;
  fallbackUsed: boolean;
}

export interface BenchmarkGenerationOutput {
  benchmarks: BenchmarkInput[];
  diagnostics?: BenchmarkGenerationDiagnostics;
}

export async function runBenchmarkGeneration(
  input: BenchmarkGenerationInput,
): Promise<BenchmarkGenerationOutput> {
  const {
    tableFqns,
    metadata,
    allowlist,
    useCases,
    entityCandidates,
    customerBenchmarks,
    joinSpecs,
    referenceSql,
    industryId,
    endpoint,
    signal,
    useCaseCap: useCaseCapOverride,
    benchmarksPerBatch: benchmarksPerBatchOverride,
    maxTokens: maxTokensOverride,
  } = input;

  const effectiveBenchmarksPerBatch = benchmarksPerBatchOverride ?? BENCHMARKS_PER_BATCH;
  const effectiveMaxTokens = maxTokensOverride ?? 6144;

  const baseSchemaBlock = buildSchemaContextBlock(metadata, tableFqns);
  const profileBlock =
    entityCandidates.length > 0
      ? buildProfileGroundingBlock(snapshotsFromEntityCandidates(entityCandidates))
      : "";
  const schemaBlock = profileBlock ? `${baseSchemaBlock}\n\n${profileBlock}` : baseSchemaBlock;

  const joinBlock =
    joinSpecs.length > 0
      ? `### TABLE RELATIONSHIPS (use these exact join conditions in expectedSql)\n${joinSpecs
          .map((j) => `- ${j.leftTable} JOIN ${j.rightTable} ON ${j.sql} (${j.relationshipType})`)
          .join("\n")}`
      : "";

  const entityBlock = entityCandidates
    .filter((c) => c.sampleValues.length > 0)
    .slice(0, 10)
    .map((c) => `${c.tableFqn}.${c.columnName}: [${c.sampleValues.slice(0, 8).join(", ")}]`)
    .join("\n");

  const refSqlBlock = buildReferenceSqlBlock(referenceSql);

  const ucCap = useCaseCapOverride ?? 10;
  const useCasesWithSql = useCases.filter((uc) => uc.sqlCode).slice(0, ucCap);

  const batches: UseCase[][] = [];
  for (let i = 0; i < useCasesWithSql.length; i += BATCH_SIZE) {
    batches.push(useCasesWithSql.slice(i, i + BATCH_SIZE));
  }

  if (batches.length === 0) {
    batches.push([]);
  }

  logger.info("Benchmark generation: batching use cases", {
    endpoint,
    totalUseCases: useCasesWithSql.length,
    referenceSqlCount: referenceSql?.length ?? 0,
    batchCount: batches.length,
    batchSize: BATCH_SIZE,
    benchmarksPerBatch: effectiveBenchmarksPerBatch,
  });

  const batchResults = await mapWithConcurrency(
    batches.map((batch) => async () => {
      try {
        return await processBenchmarkBatch(
          batch,
          schemaBlock,
          entityBlock,
          joinBlock,
          refSqlBlock,
          allowlist,
          endpoint,
          industryId,
          signal,
          effectiveBenchmarksPerBatch,
          effectiveMaxTokens,
        );
      } catch (err) {
        logger.warn("Benchmark batch failed, continuing with remaining batches", {
          batchSize: batch.length,
          error: err instanceof Error ? err.message : String(err),
        });
        return { valid: [] as BenchmarkInput[], rejected: [] as BenchmarkInput[] };
      }
    }),
    BATCH_CONCURRENCY,
  );

  let totalGenerated = 0;
  let totalRejected = 0;
  const allValid: BenchmarkInput[] = [];
  const allRejected: BenchmarkInput[] = [];
  for (const r of batchResults) {
    allValid.push(...r.valid);
    allRejected.push(...r.rejected);
    totalGenerated += r.valid.length + r.rejected.length;
    totalRejected += r.rejected.length;
  }

  let fallbackUsed = false;
  let allBenchmarks = allValid;

  if (allValid.length === 0 && allRejected.length > 0) {
    logger.warn(
      "All generated benchmarks rejected by schema validation -- falling back to question-only",
      { generated: totalGenerated, rejected: totalRejected },
    );
    fallbackUsed = true;
    allBenchmarks = allRejected
      .slice(0, effectiveBenchmarksPerBatch)
      .map((b) => ({ ...b, expectedSql: "" }));
  }

  const customerQuestions = new Set(customerBenchmarks.map((b) => b.question.toLowerCase()));
  const deduped = dedup(allBenchmarks, (b) => b.question.toLowerCase());
  const merged = [
    ...customerBenchmarks,
    ...deduped.filter((b) => !customerQuestions.has(b.question.toLowerCase())),
  ];

  return {
    benchmarks: merged,
    diagnostics: { generated: totalGenerated, rejected: totalRejected, fallbackUsed },
  };
}

function buildReferenceSqlBlock(referenceSql?: ReferenceSqlExample[]): string {
  if (!referenceSql || referenceSql.length === 0) return "";
  const MAX_REF_SQL_CHARS = 2000;
  return `### REFERENCE SQL FROM EXISTING SPACE (use the same tables, columns, and patterns)\n${referenceSql
    .slice(0, 8)
    .map((r) => {
      const sql =
        r.sql.length > MAX_REF_SQL_CHARS
          ? r.sql.slice(0, MAX_REF_SQL_CHARS) + "\n-- (truncated)"
          : r.sql;
      return `Question: ${r.question}\nSQL:\n${sql}`;
    })
    .join("\n\n---\n\n")}`;
}

interface BatchResult {
  valid: BenchmarkInput[];
  rejected: BenchmarkInput[];
}

async function processBenchmarkBatch(
  batch: UseCase[],
  schemaBlock: string,
  entityBlock: string,
  joinBlock: string,
  refSqlBlock: string,
  allowlist: SchemaAllowlist,
  endpoint: string,
  industryId?: string,
  signal?: AbortSignal,
  benchmarksPerBatch: number = BENCHMARKS_PER_BATCH,
  maxTokensLimit: number = 6144,
): Promise<BatchResult> {
  const MAX_SQL_CHARS = 3000;
  const useCaseContext = batch
    .map((uc) => {
      const sql =
        (uc.sqlCode ?? "").length > MAX_SQL_CHARS
          ? uc.sqlCode!.slice(0, MAX_SQL_CHARS) + "\n-- (truncated)"
          : uc.sqlCode;
      return `Use case: ${uc.name}\nQuestion: ${uc.statement}\nGROUND TRUTH SQL (use this as the expectedSql, do NOT simplify):\n${sql}`;
    })
    .join("\n\n---\n\n");

  const sqlContextSection = useCaseContext
    ? `### USE CASES WITH SQL\n${useCaseContext}`
    : refSqlBlock
      ? refSqlBlock
      : "(no use case SQL available)";

  const systemMessage = `You are a QA expert creating benchmark questions for a Databricks Genie space.

You MUST only use table and column identifiers from the SCHEMA CONTEXT below. Do NOT invent identifiers.

Generate ${benchmarksPerBatch} benchmark questions with expected SQL answers. These benchmarks teach Genie what correct answers look like, so accuracy and simplicity are critical.

IMPORTANT — Benchmark SQL must be SIMPLE and VERIFIABLE:
- Use straightforward SELECT ... FROM ... WHERE ... GROUP BY ... ORDER BY patterns
- Max 1 CTE. No deeply nested CTEs or multi-stage analytical pipelines.
- Max 1 window function per query (e.g. a single RANK() or ROW_NUMBER() for top-N is OK)
- Do NOT include statistical functions (REGR_SLOPE, CORR, STDDEV, SKEWNESS, etc.)
- Do NOT include complex scoring formulas or composite indices
- Benchmarks with wrong SQL are WORSE than no benchmarks — keep them simple enough to be correct

For each benchmark:
- question: Natural language question a user would actually ask
- expectedSql: Simple, correct SQL that answers it
- alternatePhrasings: 2-3 different ways to ask the same question

SQL rules:
- For top-N queries, use ORDER BY ... LIMIT N (not RANK/DENSE_RANK). ANY query with ORDER BY must include LIMIT.
- Include human-readable columns (names, emails) alongside IDs
- Use proper JOIN conditions from the table relationships provided
- ONLY use column names that appear in the SCHEMA CONTEXT -- do NOT guess or abbreviate column names
- Format SQL across multiple lines with proper indentation (SELECT, FROM, WHERE, GROUP BY, ORDER BY on separate lines). NEVER output single-line SQL.
- For case-insensitive comparisons, use COLLATE UTF8_LCASE on BOTH sides: col COLLATE UTF8_LCASE = :param COLLATE UTF8_LCASE
- Cast DOUBLE monetary columns to DECIMAL(18,2) BEFORE aggregation: SUM(CAST(amt AS DECIMAL(18,2)))

${DATABRICKS_SQL_RULES_COMPACT}

Return JSON: { "benchmarks": [{ "question": "...", "expectedSql": "...", "alternatePhrasings": ["..."] }] }`;

  const domainPatterns = industryId ? buildDomainQuestionPatterns(industryId) : "";
  const skillsResolved = resolveForGeniePass("benchmarks");
  const skillBlock =
    skillsResolved.contextSections.length > 0
      ? formatContextSections(skillsResolved.contextSections)
      : "";

  const userMessage = `${schemaBlock}

${entityBlock ? `### ENTITY MATCHING VALUES\n${entityBlock}\n` : ""}
${joinBlock ? `${joinBlock}\n` : ""}
${sqlContextSection}
${domainPatterns ? `### DOMAIN QUESTION PATTERNS\n${domainPatterns}\n` : ""}
${skillBlock}
Generate ${benchmarksPerBatch} benchmark questions with expected SQL and alternate phrasings.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  const result = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: maxTokensLimit,
    responseFormat: "json_object",
    signal,
  });

  const content = result.content ?? "";
  const parsed = parseLLMJson(content, "genie:benchmark-generation") as Record<string, unknown>;
  const items: Record<string, unknown>[] = Array.isArray(parsed.benchmarks)
    ? parsed.benchmarks
    : Array.isArray(parsed)
      ? parsed
      : [];

  const MAX_BENCHMARK_SQL_CHARS = 3000;

  const candidates = items
    .map((b) => ({
      question: String(b.question ?? ""),
      expectedSql: String(b.expectedSql ?? b.expected_sql ?? ""),
      alternatePhrasings: Array.isArray(b.alternatePhrasings ?? b.alternate_phrasings)
        ? ((b.alternatePhrasings as string[]) ?? (b.alternate_phrasings as string[])).map(String)
        : [],
    }))
    .filter((b) => b.question.length > 0 && b.expectedSql.length > 0)
    .filter((b) => {
      if (b.expectedSql.length > MAX_BENCHMARK_SQL_CHARS) {
        logger.info("Dropping benchmark with oversized SQL", {
          question: b.question,
          sqlLength: b.expectedSql.length,
        });
        return false;
      }
      return true;
    });

  const valid: BenchmarkInput[] = [];
  const rejected: BenchmarkInput[] = [];
  for (const b of candidates) {
    if (validateSqlExpression(allowlist, b.expectedSql, `benchmark:${b.question}`, true)) {
      valid.push(b);
    } else {
      rejected.push(b);
    }
  }

  let benchmarks = valid;

  // LLM review gate: batch review + fix benchmark expected SQL
  if (isReviewEnabled("genie-benchmarks") && benchmarks.length > 0) {
    const items = benchmarks.map((b, i) => ({ id: `b${i}:${b.question}`, sql: b.expectedSql }));
    const results = await reviewBatch(items, "genie-benchmarks", {
      schemaContext: schemaBlock,
      requestFix: true,
    });
    const reviewed = benchmarks.map((b, i) => {
      const res = results.find((r) => r.id === items[i].id) ?? results[i];
      const review = res.result;
      if (review.fixedSql) {
        if (
          validateSqlExpression(allowlist, review.fixedSql, `benchmark_fix:${b.question}`, true)
        ) {
          if (review.verdict === "fail" && (review.qualityScore ?? 0) < 60) {
            logger.warn("Benchmark SQL dropped (fix applied but quality too low)", {
              question: b.question,
              qualityScore: review.qualityScore,
            });
            return null;
          }
          logger.info("Benchmark SQL fix applied", {
            question: b.question,
            verdict: review.verdict,
            qualityScore: review.qualityScore,
          });
          return { ...b, expectedSql: review.fixedSql };
        }
        logger.warn("Benchmark review fix failed schema validation, keeping original", {
          question: b.question,
        });
        return b;
      }
      if (review.verdict === "fail") {
        logger.warn("Benchmark SQL dropped (fail verdict, no usable fix)", {
          question: b.question,
          qualityScore: review.qualityScore,
        });
        return null;
      }
      return b;
    });
    benchmarks = reviewed.filter((b): b is NonNullable<typeof b> => b !== null);
  }

  // Phase 2 SQL validator gate: actually EXPLAIN benchmark SQL on the
  // warehouse and detect zero-row pathologies. Drop benchmarks whose
  // expected SQL fails to repair OR returns 0 rows. Off by default.
  if (isSqlRepairEnabled() && benchmarks.length > 0) {
    const items: ValidateAndRepairItem[] = benchmarks.map((b) => ({
      sql: b.expectedSql,
      kind: "benchmark",
      schemaContext: schemaBlock,
      surface: "genie-benchmarks",
    }));
    const validated = await validateAndRepairBatch(items);
    const survivors: BenchmarkInput[] = [];
    for (let i = 0; i < benchmarks.length; i++) {
      const b = benchmarks[i];
      const v = validated[i];
      if (v.status === "dropped") {
        logger.warn("Benchmark dropped by validator", {
          question: b.question,
          reason: v.reason,
        });
        rejected.push(b);
        continue;
      }
      if (v.rowCount === 0) {
        logger.warn("Benchmark dropped: expected SQL returns 0 rows", {
          question: b.question,
        });
        rejected.push(b);
        continue;
      }
      survivors.push(
        v.finalSql && v.finalSql !== b.expectedSql ? { ...b, expectedSql: v.finalSql } : b,
      );
    }
    benchmarks = survivors;
  }

  return { valid: benchmarks, rejected };
}

function dedup(items: BenchmarkInput[], keyFn: (item: BenchmarkInput) => string): BenchmarkInput[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
