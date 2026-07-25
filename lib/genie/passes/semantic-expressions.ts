/**
 * Pass 2: Semantic SQL Expressions
 *
 * Phase A: Rule-based auto-generation of standard time-period filters and
 * dimensions from date/timestamp columns with fiscal year support.
 *
 * Phase B: LLM-generated business-semantic measures, filters, and dimensions
 * grounded to the physical schema allowlist.
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import type { MetadataSnapshot, UseCase, BusinessContext } from "@/lib/domain/types";
import type {
  GenieEngineConfig,
  GlossaryEntry,
  EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetFilter,
  EnrichedSqlSnippetDimension,
  SampleDataCache,
} from "../types";
import {
  buildSchemaContextBlock,
  validateSqlExpression,
  type SchemaAllowlist,
} from "../schema-allowlist";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/toolkit/sql-rules";
import { reviewBatch, type BatchReviewItem } from "@/lib/ai/sql-reviewer";
import { isReviewEnabled } from "@/lib/dbx/client";
import {
  isSqlRepairEnabled,
  validateAndRepairBatch,
  type ValidateAndRepairItem,
} from "@/lib/genie/sql-validator";
import { generateTimePeriods } from "../time-periods";
import {
  buildProfileGroundingBlock,
  snapshotsFromEntityCandidates,
  snapshotsFromSampleCache,
} from "../profile-grounding";
import {
  resolveForGeniePass,
  formatContextSections,
  buildIndustrySkillSections,
} from "@/lib/skills";
import type { GenerationBudget } from "../quality-presets";

const TEMPERATURE = 0.2;

export interface SemanticExpressionsInput {
  tableFqns: string[];
  metadata: MetadataSnapshot;
  allowlist: SchemaAllowlist;
  useCases: UseCase[];
  businessContext: BusinessContext | null;
  config: GenieEngineConfig;
  /** Industry outcome map ID for domain-specific measure patterns. */
  industryId?: string;
  /**
   * Entity candidates from column-intelligence. When present, sample values
   * are folded into a "Profile-Grounded Values" prompt prefix so the LLM
   * doesn't invent literals that don't exist in the data.
   */
  entityCandidates?: ReadonlyArray<{
    tableFqn: string;
    columnName: string;
    sampleValues: string[];
  }>;
  /**
   * Raw sample-data cache (preferred when available). Used in parallel
   * call sites where `entityCandidates` haven't been computed yet.
   */
  sampleData?: SampleDataCache | null;
  endpoint: string;
  signal?: AbortSignal;
  /** Generation budget controlling target counts and maxTokens. */
  budget?: GenerationBudget;
}

export interface SemanticExpressionsOutput {
  measures: EnrichedSqlSnippetMeasure[];
  filters: EnrichedSqlSnippetFilter[];
  dimensions: EnrichedSqlSnippetDimension[];
}

export async function runSemanticExpressions(
  input: SemanticExpressionsInput,
): Promise<SemanticExpressionsOutput> {
  const {
    tableFqns,
    metadata,
    allowlist,
    useCases,
    businessContext,
    config,
    industryId,
    endpoint,
    signal,
    budget,
  } = input;

  const targetWorkerA = budget?.measuresWorkerA ?? 15;
  const targetWorkerB = budget?.measuresWorkerB ?? 10;
  const targetFilters = budget?.filters ?? 12;
  const targetDimensions = budget?.dimensions ?? 12;
  const maxTokens = budget?.maxTokensExpressions ?? 4096;

  // Phase A: auto-generate time periods
  let timeFilters: EnrichedSqlSnippetFilter[] = [];
  let timeDimensions: EnrichedSqlSnippetDimension[] = [];

  if (config.autoTimePeriods) {
    const tp = generateTimePeriods(metadata.columns, tableFqns, {
      fiscalYearStartMonth: config.fiscalYearStartMonth,
      targetDateColumns:
        config.timePeriodDateColumns.length > 0 ? config.timePeriodDateColumns : undefined,
    });
    timeFilters = tp.filters;
    timeDimensions = tp.dimensions;
  }

  // Phase B: LLM-generated expressions
  let llmMeasures: EnrichedSqlSnippetMeasure[] = [];
  let llmFilters: EnrichedSqlSnippetFilter[] = [];
  let llmDimensions: EnrichedSqlSnippetDimension[] = [];

  if (config.llmRefinement) {
    try {
      const llmResult = await generateLLMExpressions(
        tableFqns,
        metadata,
        useCases,
        businessContext,
        config.glossary,
        endpoint,
        industryId,
        signal,
        { targetWorkerA, targetWorkerB, targetFilters, targetDimensions, maxTokens },
        input.entityCandidates,
        input.sampleData ?? null,
      );
      llmMeasures = llmResult.measures
        .filter((m) => !isSnippetTooComplex(m.sql, m.name))
        .filter((m) => validateSqlExpression(allowlist, m.sql, `measure:${m.name}`, true));
      llmFilters = llmResult.filters
        .filter((f) => !isSnippetTooComplex(f.sql, f.name))
        .filter((f) => validateSqlExpression(allowlist, f.sql, `filter:${f.name}`, true));
      llmDimensions = llmResult.dimensions
        .filter((d) => !isSnippetTooComplex(d.sql, d.name))
        .filter((d) => validateSqlExpression(allowlist, d.sql, `dimension:${d.name}`, true));
    } catch (err) {
      logger.warn("LLM expression generation failed, using time periods only", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // LLM batch review: review all generated expressions in a single call
  if (isReviewEnabled("genie-semantic-expressions")) {
    const batchItems: BatchReviewItem[] = [
      ...llmMeasures.map((m) => ({ id: `m:${m.name}`, sql: m.sql, context: "measure" })),
      ...llmFilters.map((f) => ({ id: `f:${f.name}`, sql: f.sql, context: "filter" })),
      ...llmDimensions.map((d) => ({ id: `d:${d.name}`, sql: d.sql, context: "dimension" })),
    ];
    if (batchItems.length > 0) {
      const batchSchemaCtx = buildSchemaContextBlock(input.metadata, input.tableFqns);
      const batchResults = await reviewBatch(
        batchItems,
        "genie-semantic-expressions",
        batchSchemaCtx,
      );
      const failedIds = new Set(
        batchResults.filter((r) => r.result.verdict === "fail").map((r) => r.id),
      );
      if (failedIds.size > 0) {
        logger.info("Semantic expressions: batch review rejected items", {
          rejectedCount: failedIds.size,
          totalItems: batchItems.length,
        });
        llmMeasures = llmMeasures.filter((m) => !failedIds.has(`m:${m.name}`));
        llmFilters = llmFilters.filter((f) => !failedIds.has(`f:${f.name}`));
        llmDimensions = llmDimensions.filter((d) => !failedIds.has(`d:${d.name}`));
      }
    }
  }

  // Phase 2 SQL validator gate: wrap each fragment in a synthetic SELECT
  // and EXPLAIN it on the warehouse. Drops items that can't be EXPLAIN'd or
  // repaired. Off by default; flip on via FORGE_SQL_REPAIR_ENABLED.
  if (isSqlRepairEnabled() && tableFqns.length > 0) {
    const schemaContext = buildSchemaContextBlock(metadata, tableFqns);

    // Codex P2: previously every fragment was wrapped against `tableFqns[0]`,
    // so a valid fragment that referenced a column from any other selected
    // table would fail EXPLAIN as an unknown column. Resolve each fragment
    // to its most-likely owning table by counting how many of the columns
    // it references actually exist on each candidate.
    const tableColumnsByFqn = new Map<string, Set<string>>();
    for (const c of metadata.columns) {
      const key = c.tableFqn.toLowerCase();
      const set = tableColumnsByFqn.get(key) ?? new Set<string>();
      set.add(c.columnName.toLowerCase());
      tableColumnsByFqn.set(key, set);
    }

    const pickOwningTable = (sql: string): string => {
      const refs = extractColumnRefs(sql);
      if (refs.qualified.length > 0) {
        for (const tableLike of refs.qualified) {
          const match = tableFqns.find((f) => f.toLowerCase().endsWith(`.${tableLike}`));
          if (match) return match;
        }
      }
      if (refs.bare.length === 0) return tableFqns[0];
      let best = tableFqns[0];
      let bestHits = -1;
      for (const fqn of tableFqns) {
        const cols = tableColumnsByFqn.get(fqn.toLowerCase());
        if (!cols) continue;
        let hits = 0;
        for (const ref of refs.bare) if (cols.has(ref)) hits++;
        if (hits > bestHits) {
          bestHits = hits;
          best = fqn;
        }
      }
      return best;
    };

    const measureItems: ValidateAndRepairItem[] = llmMeasures.map((m) => ({
      sql: m.sql,
      kind: "measure",
      tableFqn: pickOwningTable(m.sql),
      schemaContext,
      surface: "genie-semantic-measures",
    }));
    const filterItems: ValidateAndRepairItem[] = llmFilters.map((f) => ({
      sql: f.sql,
      kind: "filter",
      tableFqn: pickOwningTable(f.sql),
      schemaContext,
      surface: "genie-semantic-filters",
    }));
    const dimItems: ValidateAndRepairItem[] = llmDimensions.map((d) => ({
      sql: d.sql,
      kind: "named_expression",
      tableFqn: pickOwningTable(d.sql),
      schemaContext,
      surface: "genie-semantic-dimensions",
    }));

    const [mResults, fResults, dResults] = await Promise.all([
      validateAndRepairBatch(measureItems),
      validateAndRepairBatch(filterItems),
      validateAndRepairBatch(dimItems),
    ]);

    llmMeasures = llmMeasures
      .map((m, i) => {
        const r = mResults[i];
        if (r.status === "dropped") {
          logger.warn("Measure dropped by validator", { name: m.name, reason: r.reason });
          return null;
        }
        return r.finalSql && r.finalSql !== m.sql ? { ...m, sql: r.finalSql } : m;
      })
      .filter((m): m is EnrichedSqlSnippetMeasure => m !== null);
    llmFilters = llmFilters
      .map((f, i) => {
        const r = fResults[i];
        if (r.status === "dropped") {
          logger.warn("Filter dropped by validator", { name: f.name, reason: r.reason });
          return null;
        }
        return r.finalSql && r.finalSql !== f.sql ? { ...f, sql: r.finalSql } : f;
      })
      .filter((f): f is EnrichedSqlSnippetFilter => f !== null);
    llmDimensions = llmDimensions
      .map((d, i) => {
        const r = dResults[i];
        if (r.status === "dropped") {
          logger.warn("Dimension dropped by validator", { name: d.name, reason: r.reason });
          return null;
        }
        return r.finalSql && r.finalSql !== d.sql ? { ...d, sql: r.finalSql } : d;
      })
      .filter((d): d is EnrichedSqlSnippetDimension => d !== null);
  }

  // Merge custom expressions from config
  const customMeasures: EnrichedSqlSnippetMeasure[] = config.customMeasures.map((m) => ({
    name: m.name,
    sql: m.sql,
    synonyms: m.synonyms,
    instructions: m.instructions,
  }));
  const customFilters: EnrichedSqlSnippetFilter[] = config.customFilters.map((f) => ({
    name: f.name,
    sql: f.sql,
    synonyms: f.synonyms,
    instructions: f.instructions,
    isTimePeriod: false,
  }));
  const customDimensions: EnrichedSqlSnippetDimension[] = config.customDimensions.map((d) => ({
    name: d.name,
    sql: d.sql,
    synonyms: d.synonyms,
    instructions: d.instructions,
    isTimePeriod: false,
  }));

  return {
    measures: dedup([...llmMeasures, ...customMeasures], (m) => m.name),
    filters: dedup([...timeFilters, ...llmFilters, ...customFilters], (f) => f.name),
    dimensions: dedup([...timeDimensions, ...llmDimensions, ...customDimensions], (d) => d.name),
  };
}

/**
 * Parallel measure generation strategy:
 * - Worker A: Foundation metrics (standard aggregates per column)
 * - Worker B: Ratio metrics (cross-column ratios, percentages, rates)
 * - Worker C: Filters and dimensions (WHERE conditions + GROUP BY expressions)
 *
 * All three run in parallel and results are merged and deduplicated.
 */

const SHARED_RULES = `IMPORTANT — Genie SQL snippets must be SHORT, reusable expressions (single aggregates or simple CASE WHEN). They are building blocks Genie composes into queries.

GOOD snippet examples:
- Measure: SUM(CAST(amount AS DECIMAL(18,2)))
- Measure: COUNT(DISTINCT customer_id)
- Filter: status = 'active'
- Dimension: DATE_TRUNC('month', order_date)

BAD snippets (DO NOT generate):
- Window functions (OVER(...))
- Statistical functions (REGR_SLOPE, CORR, STDDEV, SKEWNESS)
- Nested subqueries
- Multiple chained function calls

Each SQL expression should be a SINGLE expression, ideally under 200 characters.
You MUST only use table and column identifiers from the SCHEMA CONTEXT. Do NOT invent identifiers.

For each expression provide:
- name: Business-friendly display name
- sql: Valid Databricks SQL expression
- synonyms: Array of alternative terms users might say
- instructions: When and how to use this expression`;

interface ExpressionBudgetParams {
  targetWorkerA: number;
  targetWorkerB: number;
  targetFilters: number;
  targetDimensions: number;
  maxTokens: number;
}

async function generateLLMExpressions(
  tableFqns: string[],
  metadata: MetadataSnapshot,
  useCases: UseCase[],
  businessContext: BusinessContext | null,
  glossary: GlossaryEntry[],
  endpoint: string,
  industryId?: string,
  signal?: AbortSignal,
  budgetParams?: ExpressionBudgetParams,
  entityCandidates?: ReadonlyArray<{
    tableFqn: string;
    columnName: string;
    sampleValues: string[];
  }>,
  sampleData?: SampleDataCache | null,
): Promise<{
  measures: EnrichedSqlSnippetMeasure[];
  filters: EnrichedSqlSnippetFilter[];
  dimensions: EnrichedSqlSnippetDimension[];
}> {
  const {
    targetWorkerA = 15,
    targetWorkerB = 10,
    targetFilters = 12,
    targetDimensions = 12,
    maxTokens = 4096,
  } = budgetParams ?? {};

  const schemaBlock = buildSchemaContextBlock(metadata, tableFqns);

  const sqlExamples = useCases
    .filter((uc) => uc.sqlCode)
    .slice(0, 10)
    .map((uc) => `-- ${uc.name}\n${uc.sqlCode}`)
    .join("\n\n");

  const glossaryBlock =
    glossary.length > 0
      ? `### BUSINESS GLOSSARY\n${glossary.map((g) => `- **${g.term}**: ${g.definition} (synonyms: ${g.synonyms.join(", ")})`).join("\n")}`
      : "";

  const bizContext = businessContext
    ? `Industry: ${businessContext.industries}\nPriorities: ${businessContext.businessPriorities}\nGoals: ${businessContext.strategicGoals}`
    : "";

  const profileSnapshots = entityCandidates && entityCandidates.length > 0
    ? snapshotsFromEntityCandidates(entityCandidates)
    : sampleData && sampleData.size > 0
      ? snapshotsFromSampleCache(sampleData)
      : [];
  const profileBlock = profileSnapshots.length > 0 ? buildProfileGroundingBlock(profileSnapshots) : "";

  const contextBlock = `${schemaBlock}${profileBlock ? `\n\n${profileBlock}` : ""}\n\n${bizContext ? `### BUSINESS CONTEXT\n${bizContext}\n` : ""}${glossaryBlock}\n\n### USE CASE SQL EXAMPLES\n${sqlExamples || "(no SQL examples available)"}\n\n${buildSemanticSkillBlock(industryId)}`;

  // Worker A: Foundation metrics (standard aggregates)
  const workerA = cachedChatCompletion({
    endpoint,
    messages: [
      {
        role: "system",
        content: `You are a SQL analytics expert. Generate foundation aggregate measures for a Databricks Genie space.

Focus on standard aggregate KPIs: SUM, COUNT, COUNT DISTINCT, AVG, MIN, MAX for the most business-relevant numeric and key columns. Generate ${targetWorkerA} measures.

${SHARED_RULES}
${DATABRICKS_SQL_RULES_COMPACT}

Return JSON: { "measures": [...] }`,
      },
      { role: "user", content: `${contextBlock}\n\nGenerate foundation aggregate measures.` },
    ],
    temperature: TEMPERATURE,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  // Worker B: Ratio and derived metrics
  const workerB = cachedChatCompletion({
    endpoint,
    messages: [
      {
        role: "system",
        content: `You are a SQL analytics expert. Generate ratio and derived business KPI measures for a Databricks Genie space.

Focus on:
- Cross-column ratios (e.g., revenue per customer, cost per unit)
- Percentage calculations (e.g., conversion rate, margin percentage)
- Business-specific derived KPIs (e.g., customer lifetime value, basket size)
- Rate calculations using try_divide() to avoid division by zero

Generate ${targetWorkerB} measures. These should be MORE insightful than simple aggregates.

${SHARED_RULES}
${DATABRICKS_SQL_RULES_COMPACT}

Return JSON: { "measures": [...] }`,
      },
      {
        role: "user",
        content: `${contextBlock}\n\nGenerate ratio, percentage, and derived KPI measures.`,
      },
    ],
    temperature: TEMPERATURE,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  // Worker C: Filters and dimensions
  const workerC = cachedChatCompletion({
    endpoint,
    messages: [
      {
        role: "system",
        content: `You are a SQL analytics expert. Generate filters (WHERE conditions) and dimensions (GROUP BY expressions) for a Databricks Genie space.

**Filters** (${targetFilters}): Common business conditions users ask about (status values, date ranges, categorical splits, active/inactive flags).
**Dimensions** (${targetDimensions}): Useful analytical breakdowns (categorical groupings, date parts, bucketed ranges).

${SHARED_RULES}
${DATABRICKS_SQL_RULES_COMPACT}

Return JSON: { "filters": [...], "dimensions": [...] }`,
      },
      {
        role: "user",
        content: `${contextBlock}\n\nGenerate filters and dimensions for common business analysis.`,
      },
    ],
    temperature: TEMPERATURE,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  const [resultA, resultB, resultC] = await Promise.all([workerA, workerB, workerC]);

  const parsedA = parseLLMExpressions(resultA.content ?? "");
  const parsedB = parseLLMExpressions(resultB.content ?? "");
  const parsedC = parseLLMExpressions(resultC.content ?? "");

  const allMeasures = [...parsedA.measures, ...parsedB.measures, ...parsedC.measures];
  const allFilters = [...parsedA.filters, ...parsedB.filters, ...parsedC.filters];
  const allDimensions = [...parsedA.dimensions, ...parsedB.dimensions, ...parsedC.dimensions];

  logger.info("Parallel semantic expression generation complete", {
    endpoint,
    workerA: parsedA.measures.length,
    workerB: parsedB.measures.length,
    workerC: { filters: parsedC.filters.length, dimensions: parsedC.dimensions.length },
    totalMeasures: allMeasures.length,
    totalFilters: allFilters.length,
    totalDimensions: allDimensions.length,
  });

  return {
    measures: dedup(allMeasures, (m) => m.name),
    filters: dedup(allFilters, (f) => f.name),
    dimensions: dedup(allDimensions, (d) => d.name),
  };
}

function parseLLMExpressions(content: string): {
  measures: EnrichedSqlSnippetMeasure[];
  filters: EnrichedSqlSnippetFilter[];
  dimensions: EnrichedSqlSnippetDimension[];
} {
  try {
    const parsed = parseLLMJson(content, "genie:semantic-expressions") as Record<string, unknown>;
    return {
      measures: parseArray(parsed.measures).map((m) => ({
        name: String(m.name ?? ""),
        sql: String(m.sql ?? ""),
        synonyms: Array.isArray(m.synonyms) ? m.synonyms.map(String) : [],
        instructions: String(m.instructions ?? ""),
      })),
      filters: parseArray(parsed.filters).map((f) => ({
        name: String(f.name ?? ""),
        sql: String(f.sql ?? ""),
        synonyms: Array.isArray(f.synonyms) ? f.synonyms.map(String) : [],
        instructions: String(f.instructions ?? ""),
        isTimePeriod: false,
      })),
      dimensions: parseArray(parsed.dimensions).map((d) => ({
        name: String(d.name ?? ""),
        sql: String(d.sql ?? ""),
        synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(String) : [],
        instructions: String(d.instructions ?? ""),
        isTimePeriod: false,
      })),
    };
  } catch (err) {
    logger.warn("Failed to parse LLM expressions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { measures: [], filters: [], dimensions: [] };
  }
}

function parseArray(val: unknown): Record<string, unknown>[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null);
}

/**
 * Reject SQL snippets that are too complex for Genie knowledge store expressions.
 * Snippets should be simple, composable building blocks (single aggregates, CASE WHEN).
 */
function isSnippetTooComplex(sql: string, name: string): boolean {
  if (sql.length > 500) {
    logger.info("Rejecting oversized snippet", { name, length: sql.length });
    return true;
  }
  if (/\bOVER\s*\(/i.test(sql)) {
    logger.info("Rejecting snippet with window function", { name });
    return true;
  }
  if (
    /\b(REGR_SLOPE|REGR_R2|REGR_INTERCEPT|CORR|STDDEV_POP|STDDEV_SAMP|SKEWNESS|KURTOSIS|CUME_DIST)\b/i.test(
      sql,
    )
  ) {
    logger.info("Rejecting snippet with statistical function", { name });
    return true;
  }
  if (/\bSELECT\b/i.test(sql)) {
    logger.info("Rejecting snippet with subquery", { name });
    return true;
  }
  return false;
}

function dedup<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract column references from a SQL fragment. Returns:
 *   - `qualified`: lowercased `table.column` references (table portion only)
 *   - `bare`: lowercased unqualified column identifiers
 *
 * SQL keywords/functions that look like identifiers are filtered out via a
 * conservative reserved-word list. Used by the validator to pick the most
 * likely owning table for `EXPLAIN`-wrapping (Codex P2).
 */
const SQL_RESERVED_WORDS = new Set([
  "select", "from", "where", "group", "by", "order", "having", "as", "and",
  "or", "not", "in", "on", "is", "null", "true", "false", "case", "when",
  "then", "else", "end", "distinct", "limit", "offset", "asc", "desc",
  "between", "like", "ilike", "with", "union", "all", "any", "exists",
  "join", "left", "right", "inner", "outer", "cross", "full",
  "sum", "count", "avg", "min", "max", "coalesce", "nullif", "cast",
  "try_cast", "try_divide", "current_date", "current_timestamp", "now",
  "interval", "date", "timestamp", "string", "int", "bigint", "double",
  "boolean", "year", "month", "day", "quarter", "week", "hour", "minute",
  "extract", "date_trunc", "datediff", "if", "ifnull", "concat",
]);

export function extractColumnRefs(sql: string): { qualified: string[]; bare: string[] } {
  const lower = (sql ?? "").toLowerCase();
  if (!lower.trim()) return { qualified: [], bare: [] };
  const qualified: string[] = [];
  const bare: string[] = [];
  // Strip string literals so identifiers inside them aren't picked up.
  const stripped = lower
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
  // Qualified: `table.column` -- record the table portion only.
  const qRegex = /\b([a-z_][\w]*)\.([a-z_][\w]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = qRegex.exec(stripped)) !== null) {
    if (!SQL_RESERVED_WORDS.has(m[1])) qualified.push(m[1]);
  }
  // Bare identifiers: any standalone word that isn't reserved or numeric.
  const bareRegex = /\b([a-z_][\w]*)\b/g;
  while ((m = bareRegex.exec(stripped)) !== null) {
    const tok = m[1];
    if (SQL_RESERVED_WORDS.has(tok)) continue;
    // Skip the table portion of a qualified reference -- it isn't a column.
    const idx = m.index + tok.length;
    if (stripped[idx] === ".") continue;
    bare.push(tok);
  }
  return { qualified: Array.from(new Set(qualified)), bare: Array.from(new Set(bare)) };
}

function buildSemanticSkillBlock(industryId?: string): string {
  const parts: string[] = [];

  const skillsResolved = resolveForGeniePass("semanticExpressions");
  if (skillsResolved.contextSections.length > 0) {
    parts.push(formatContextSections(skillsResolved.contextSections));
  }

  if (industryId) {
    const industrySections = buildIndustrySkillSections(industryId);
    if (industrySections.length > 0) {
      parts.push(formatContextSections(industrySections));
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}
