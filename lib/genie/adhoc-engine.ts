/**
 * Ad-Hoc Genie Engine — two-tier space generator from a table list.
 *
 * **Fast mode** (default): Scrapes metadata from information_schema and
 * generates a usable Genie Space using mostly rule-based passes with
 * focused fast-LLM refinements for title/instructions/example SQL.
 *
 * **Full mode**: Runs all 7 Genie Engine LLM passes (column intelligence,
 * semantic expressions, join inference, trusted assets, instruction
 * generation, benchmarks, metric views). Takes 1–3 minutes but produces
 * production-grade output.
 *
 * Designed for the Ask Forge inline Genie builder flow.
 */

import type { MetadataSnapshot, BusinessContext, ColumnInfo } from "@/lib/domain/types";
import type {
  GenieEngineConfig,
  GenieEnginePassOutputs,
  GenieSpaceRecommendation,
  EnrichedSqlSnippetMeasure,
  EnrichedSqlSnippetFilter,
  EnrichedSqlSnippetDimension,
  QuestionComplexity,
  QualityPreset,
} from "./types";
import { defaultGenieEngineConfig } from "./types";
import { buildSchemaAllowlist } from "./schema-allowlist";
import { runColumnIntelligence } from "./passes/column-intelligence";
import { runSemanticExpressions } from "./passes/semantic-expressions";
import { runJoinInference } from "./passes/join-inference";
import { runTrustedAssetAuthoring } from "./passes/trusted-assets";
import { runInstructionGeneration } from "./passes/instruction-generation";
import { runBenchmarkGeneration } from "./passes/benchmark-generation";
import { runMetricViewProposals } from "./passes/metric-view-proposals";
import { isMetricViewsEnabled } from "./metric-views-config";
import { saveMetricViewProposals } from "@/lib/lakebase/metric-view-proposals";
import { runTitleGeneration } from "./passes/title-generation";
import { runExampleQueryGeneration } from "./passes/example-query-generation";
import { inferNormalizedDomainFromTables, normalizeDomainLabel } from "./domain-normalization";
import { tableHasSynonymPair } from "./key-synonyms";
import { evaluateJoinCandidates } from "./join-diagnostics";
import { extractEntityCandidatesFromSchema } from "./entity-extraction";
import { generateTimePeriods } from "./time-periods";
import { assembleSerializedSpace, buildRecommendation } from "./assembler";
import { runHealthCheck } from "./space-health-check";
import {
  buildSchemaContextBlock,
  validateSqlExpression,
  type SchemaAllowlist,
} from "./schema-allowlist";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "./passes/parse-llm-json";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/toolkit/sql-rules";
import type { ChatMessage } from "@/lib/dbx/model-serving";
import "@/lib/skills/content";
import {
  resolveForGeniePass,
  formatContextSections,
  formatSystemOverlay,
} from "@/lib/skills/resolver";
import {
  fetchTableInfoBatch,
  fetchColumnsBatch,
  fetchForeignKeysBatch,
} from "@/lib/queries/metadata";
import { resolveEndpoint, isReviewEnabled } from "@/lib/dbx/client";
import { reviewBatch, type BatchReviewItem } from "@/lib/ai/sql-reviewer";
import { createScopedLogger } from "@/lib/logger";
import { gatherCreationHints, type CreationHints } from "./creation-hints";
import { runBenchmarkAlignment } from "./passes/benchmark-alignment";
import { casingProfilesFromCandidates } from "@/lib/metadata/casing-profile";

export interface AdHocGenieConfig {
  title?: string;
  description?: string;
  domain?: string;
  glossary?: GenieEngineConfig["glossary"];
  fiscalYearStartMonth?: number;
  autoTimePeriods?: boolean;
  llmRefinement?: boolean;
  globalInstructions?: string;
  businessContext?: BusinessContext | null;
  conversationSummary?: string;
  generateBenchmarks?: boolean;
  generateMetricViews?: boolean;
  generateTrustedAssets?: boolean;
  questionComplexity?: QuestionComplexity;
  qualityPreset?: QualityPreset;
  mode?: "fast" | "full";
}

export type { GenieBuilderStep } from "./builder-steps";
export { GENIE_BUILDER_STEPS } from "./builder-steps";
import type { GenieBuilderStep } from "./builder-steps";

export interface AdHocEngineInput {
  tables: string[];
  /** Trusted owner derived by the calling route or parent resource. */
  ownerEmail?: string | null;
  config?: AdHocGenieConfig;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number, step?: GenieBuilderStep) => void;
}

export interface AdHocEngineResult {
  recommendation: GenieSpaceRecommendation;
  passOutputs: GenieEnginePassOutputs;
  metadata: MetadataSnapshot;
  mode: "fast" | "full";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const NUMERIC_TYPE_PATTERN = /^(int|bigint|smallint|tinyint|float|double|decimal|numeric|real)/i;

function buildEntityFallbackQuestion(columnName: string, complexity: QuestionComplexity): string {
  const col = columnName.replace(/_/g, " ");
  switch (complexity) {
    case "simple":
      return `What are the most common ${col} values?`;
    case "medium":
      return `Which ${col} values appear most frequently?`;
    case "complex":
      return `What are the top ${col}s?`;
  }
}

function buildEngineConfig(adhoc?: AdHocGenieConfig): GenieEngineConfig {
  const base = defaultGenieEngineConfig();
  if (!adhoc) return base;
  if (adhoc.glossary) base.glossary = adhoc.glossary;
  if (adhoc.fiscalYearStartMonth !== undefined)
    base.fiscalYearStartMonth = adhoc.fiscalYearStartMonth;
  if (adhoc.autoTimePeriods !== undefined) base.autoTimePeriods = adhoc.autoTimePeriods;
  if (adhoc.llmRefinement !== undefined) base.llmRefinement = adhoc.llmRefinement;
  if (adhoc.globalInstructions) base.globalInstructions = adhoc.globalInstructions;
  if (adhoc.generateBenchmarks !== undefined) base.generateBenchmarks = adhoc.generateBenchmarks;
  if (adhoc.generateMetricViews !== undefined) base.generateMetricViews = adhoc.generateMetricViews;
  if (adhoc.generateTrustedAssets !== undefined)
    base.generateTrustedAssets = adhoc.generateTrustedAssets;
  if (adhoc.questionComplexity) base.questionComplexity = adhoc.questionComplexity;
  if (adhoc.qualityPreset) base.qualityPreset = adhoc.qualityPreset;
  return base;
}

function resolveBusinessContext(adhoc?: AdHocGenieConfig): BusinessContext | null {
  if (adhoc?.businessContext) return adhoc.businessContext;
  if (adhoc?.conversationSummary) {
    return {
      industries: "",
      strategicGoals: adhoc.conversationSummary,
      businessPriorities: "",
      strategicInitiative: "",
      valueChain: "",
      revenueModel: "",
      additionalContext: "",
    };
  }
  return null;
}

function inferDomain(tables: string[]): string {
  return inferNormalizedDomainFromTables(tables, "Analytics");
}

/**
 * System-table mining at creation time. Gated behind
 * `FORGE_CREATION_HINTS_ENABLED` (default OFF) so tenants without the right
 * grants don't hit avoidable 403s on every space build. All queries are
 * best-effort and never fatal.
 */
async function maybeGatherCreationHints(
  validTableFqns: string[],
  log: ReturnType<typeof createScopedLogger>,
): Promise<CreationHints | null> {
  if (process.env.FORGE_CREATION_HINTS_ENABLED !== "true") return null;
  if (validTableFqns.length === 0) return null;
  const first = validTableFqns[0];
  const parts = first.split(".");
  if (parts.length !== 3) return null;
  const [catalog, schema] = parts;
  try {
    const hints = await gatherCreationHints({
      catalog,
      schema,
      tableFqns: validTableFqns,
    });
    log.info("Creation hints gathered", {
      joinHints: hints.joinHints.length,
      tableImportance: hints.tableImportance.length,
      sensitivityTags: hints.sensitivityTags.length,
    });
    return hints;
  } catch (err) {
    log.warn("Creation hints failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function sensitiveColumnSetFromHints(hints: CreationHints | null): Set<string> | undefined {
  if (!hints || hints.sensitivityTags.length === 0) return undefined;
  return new Set(hints.sensitivityTags.map((t) => t.qualifiedColumn.toLowerCase()));
}

async function scrapeMetadata(tables: string[]): Promise<MetadataSnapshot> {
  const [tableInfos, columns, foreignKeys] = await Promise.all([
    fetchTableInfoBatch(tables),
    fetchColumnsBatch(tables),
    fetchForeignKeysBatch(tables),
  ]);

  if (tableInfos.length === 0) {
    throw new Error("No tables found. Verify the table names and your access permissions.");
  }

  return {
    cacheKey: `adhoc-${Date.now()}`,
    ucPath: tables
      .map((t) => t.split(".").slice(0, 2).join("."))
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", "),
    tables: tableInfos,
    columns,
    foreignKeys,
    metricViews: [],
    tableCount: tableInfos.length,
    columnCount: columns.length,
    cachedAt: new Date().toISOString(),
    lineageDiscoveredFqns: [],
  };
}

function buildFkJoins(foreignKeys: MetadataSnapshot["foreignKeys"], tableSet: Set<string>) {
  return foreignKeys
    .filter(
      (fk) =>
        tableSet.has(fk.tableFqn.toLowerCase()) &&
        tableSet.has(fk.referencedTableFqn.toLowerCase()),
    )
    .map((fk) => ({
      leftTable: fk.tableFqn,
      rightTable: fk.referencedTableFqn,
      sql: `${fk.tableFqn}.${fk.columnName} = ${fk.referencedTableFqn}.${fk.referencedColumnName}`,
      relationshipType: "many_to_one" as const,
    }));
}

function humanize(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferHeuristicJoins(
  columns: ColumnInfo[],
  tableFqns: string[],
  existingKeys: Set<string>,
): Array<{ leftTable: string; rightTable: string; sql: string; relationshipType: "many_to_one" }> {
  const byTable = new Map<string, Set<string>>();
  for (const c of columns) {
    const key = c.tableFqn.toLowerCase();
    const cols = byTable.get(key) ?? new Set<string>();
    cols.add(c.columnName.toLowerCase());
    byTable.set(key, cols);
  }

  const joins: Array<{
    leftTable: string;
    rightTable: string;
    sql: string;
    relationshipType: "many_to_one";
  }> = [];
  for (let i = 0; i < tableFqns.length; i++) {
    for (let j = i + 1; j < tableFqns.length; j++) {
      const left = tableFqns[i];
      const right = tableFqns[j];
      const pair = `${left.toLowerCase()}|${right.toLowerCase()}`;
      const reverse = `${right.toLowerCase()}|${left.toLowerCase()}`;
      if (existingKeys.has(pair) || existingKeys.has(reverse)) continue;

      const leftCols = byTable.get(left.toLowerCase()) ?? new Set<string>();
      const rightCols = byTable.get(right.toLowerCase()) ?? new Set<string>();
      const synonym = tableHasSynonymPair(leftCols, rightCols);
      if (!synonym) continue;

      joins.push({
        leftTable: left,
        rightTable: right,
        sql: `${left}.${synonym.leftColumn} = ${right}.${synonym.rightColumn}`,
        relationshipType: "many_to_one",
      });
      existingKeys.add(pair);
      existingKeys.add(reverse);
    }
  }
  return joins;
}

/** @deprecated Kept as fallback; prefer runHealthCheck() for accurate scoring. */
function _scoreQualityFallback(degradedReasons: string[]): number {
  return Math.max(40, 100 - degradedReasons.length * 12);
}

// ---------------------------------------------------------------------------
// Fast LLM expressions — replaces blind rule-based SUM/AVG per column
// ---------------------------------------------------------------------------

async function generateFastLLMExpressions(
  tableFqns: string[],
  metadata: MetadataSnapshot,
  allowlist: SchemaAllowlist,
  domain: string,
  conversationSummary: string | undefined,
  endpoint: string,
  signal?: AbortSignal,
): Promise<{
  measures: EnrichedSqlSnippetMeasure[];
  filters: EnrichedSqlSnippetFilter[];
  dimensions: EnrichedSqlSnippetDimension[];
}> {
  const schemaBlock = buildSchemaContextBlock(metadata, tableFqns);

  const systemMessage = `You are a SQL analytics expert building knowledge store expressions for a Databricks Genie space.

You MUST only use table and column identifiers from the SCHEMA CONTEXT below. Do NOT invent identifiers.

Generate SQL expressions in three categories:
1. **Measures** (up to 12): Simple aggregate KPIs (SUM, COUNT, AVG, MIN, MAX) that are the most business-relevant for this domain
2. **Filters** (up to 12): Common WHERE conditions users would actually ask about (status values, date ranges, categorical splits)
3. **Dimensions** (up to 12): Simple GROUP BY expressions for the most useful analytical breakdowns

Focus on QUALITY over QUANTITY — pick the columns that matter most for business analysis. Do NOT generate an expression for every column; only the most meaningful ones.

Genie SQL snippets must be SHORT, reusable expressions (single aggregates or simple CASE WHEN). They are building blocks Genie composes into queries.

GOOD snippet examples:
- Measure: SUM(catalog.schema.table.amount)
- Measure: COUNT(DISTINCT catalog.schema.table.customer_id)
- Filter: catalog.schema.table.status = 'active'
- Dimension: DATE_TRUNC('month', catalog.schema.table.order_date)
- Dimension: CASE WHEN catalog.schema.table.amount > 1000 THEN 'High' WHEN catalog.schema.table.amount > 100 THEN 'Medium' ELSE 'Low' END

BAD snippet examples (too complex):
- Anything with window functions (OVER(...))
- Statistical functions (REGR_SLOPE, CORR, STDDEV)
- Nested subqueries

CRITICAL: Use fully qualified column references (catalog.schema.table.column) in all SQL expressions.

For each expression provide:
- name: Business-friendly display name
- sql: Valid Databricks SQL expression using ONLY identifiers from the schema
- synonyms: Array of 2-3 alternative terms users might say
- instructions: One sentence on when to use this expression

${DATABRICKS_SQL_RULES_COMPACT}

Return JSON: { "measures": [...], "filters": [...], "dimensions": [...] }`;

  const adhocSkills = resolveForGeniePass("semanticExpressions");
  const adhocSkillOverlay = formatSystemOverlay(adhocSkills.systemOverlay);
  const adhocSkillContext = formatContextSections(adhocSkills.contextSections);
  const systemWithSkills = systemMessage + adhocSkillOverlay;

  const contextLine = conversationSummary
    ? `Domain: ${domain}\nConversation context: ${conversationSummary}`
    : `Domain: ${domain}`;

  const userMessage = `${schemaBlock}

### BUSINESS CONTEXT
${contextLine}
${adhocSkillContext ? `\n### Databricks SQL Patterns\n${adhocSkillContext}\n` : ""}
Generate the most useful measures, filters, and dimensions for a Genie space serving this domain. Pick only the expressions that would matter most to a business analyst.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemWithSkills },
    { role: "user", content: userMessage },
  ];

  const result = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: 0.2,
    maxTokens: 6144,
    responseFormat: "json_object",
    signal,
  });

  const content = result.content ?? "";
  const parsed = parseLLMJson(content, "genie:fast-expressions") as Record<string, unknown>;

  const toArray = (val: unknown): Record<string, unknown>[] =>
    Array.isArray(val)
      ? val.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
      : [];

  let measures = toArray(parsed.measures)
    .map((m) => ({
      name: String(m.name ?? ""),
      sql: String(m.sql ?? ""),
      synonyms: Array.isArray(m.synonyms) ? m.synonyms.map(String) : [],
      instructions: String(m.instructions ?? ""),
    }))
    .filter((m) => m.name && m.sql)
    .filter((m) => m.sql.length <= 500)
    .filter((m) => validateSqlExpression(allowlist, m.sql, `fast_measure:${m.name}`, true));

  let filters = toArray(parsed.filters)
    .map((f) => ({
      name: String(f.name ?? ""),
      sql: String(f.sql ?? ""),
      synonyms: Array.isArray(f.synonyms) ? f.synonyms.map(String) : [],
      instructions: String(f.instructions ?? ""),
      isTimePeriod: false,
    }))
    .filter((f) => f.name && f.sql)
    .filter((f) => f.sql.length <= 500)
    .filter((f) => validateSqlExpression(allowlist, f.sql, `fast_filter:${f.name}`, true));

  let dimensions = toArray(parsed.dimensions)
    .map((d) => ({
      name: String(d.name ?? ""),
      sql: String(d.sql ?? ""),
      synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(String) : [],
      instructions: String(d.instructions ?? ""),
      isTimePeriod: false,
    }))
    .filter((d) => d.name && d.sql)
    .filter((d) => d.sql.length <= 500)
    .filter((d) => validateSqlExpression(allowlist, d.sql, `fast_dimension:${d.name}`, true));

  if (isReviewEnabled("adhoc-engine-expressions")) {
    const batchItems: BatchReviewItem[] = [
      ...measures.map((m) => ({ id: `m:${m.name}`, sql: m.sql, context: "measure" })),
      ...filters.map((f) => ({ id: `f:${f.name}`, sql: f.sql, context: "filter" })),
      ...dimensions.map((d) => ({ id: `d:${d.name}`, sql: d.sql, context: "dimension" })),
    ];
    if (batchItems.length > 0) {
      const batchResults = await reviewBatch(batchItems, "adhoc-engine-expressions", schemaBlock);
      const failedIds = new Set(
        batchResults.filter((r) => r.result.verdict === "fail").map((r) => r.id),
      );
      if (failedIds.size > 0) {
        measures = measures.filter((m) => !failedIds.has(`m:${m.name}`));
        filters = filters.filter((f) => !failedIds.has(`f:${f.name}`));
        dimensions = dimensions.filter((d) => !failedIds.has(`d:${d.name}`));
      }
    }
  }

  return { measures, filters, dimensions };
}

// ---------------------------------------------------------------------------
// Fast mode — LLM expressions with rule-based fallback
// ---------------------------------------------------------------------------

/**
 * Generate numeric measures from column metadata (SUM, AVG, COUNT for each
 * numeric column). This is the fast-mode substitute for LLM semantic
 * expressions.
 */
function generateNumericMeasures(
  columns: ColumnInfo[],
  tableFqns: string[],
): EnrichedSqlSnippetMeasure[] {
  const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const measures: EnrichedSqlSnippetMeasure[] = [];

  for (const col of columns) {
    if (!tableSet.has(col.tableFqn.toLowerCase())) continue;
    if (!NUMERIC_TYPE_PATTERN.test(col.dataType)) continue;
    // Skip likely ID/key columns
    const lower = col.columnName.toLowerCase();
    if (lower.endsWith("_id") || lower === "id" || lower.endsWith("_key")) continue;

    const label = humanize(col.columnName);
    const ref = `${col.tableFqn}.${col.columnName}`;

    measures.push({
      name: `Total ${label}`,
      sql: `SUM(${ref})`,
      synonyms: [`sum of ${label.toLowerCase()}`, `total ${label.toLowerCase()}`],
      instructions: `Sum of ${col.columnName} from ${col.tableFqn.split(".").pop()}`,
    });

    measures.push({
      name: `Average ${label}`,
      sql: `AVG(${ref})`,
      synonyms: [`avg ${label.toLowerCase()}`, `mean ${label.toLowerCase()}`],
      instructions: `Average of ${col.columnName} from ${col.tableFqn.split(".").pop()}`,
    });
  }

  return measures;
}

/**
 * Generate basic string-column filters (IS NOT NULL, IS NULL) and
 * add a row-count measure for each table.
 */
function generateBasicFilters(
  columns: ColumnInfo[],
  tableFqns: string[],
): EnrichedSqlSnippetFilter[] {
  const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const filters: EnrichedSqlSnippetFilter[] = [];
  const seenTables = new Set<string>();

  for (const col of columns) {
    if (!tableSet.has(col.tableFqn.toLowerCase())) continue;

    // Add one "has data" filter per table
    if (!seenTables.has(col.tableFqn.toLowerCase())) {
      seenTables.add(col.tableFqn.toLowerCase());
      const tableName = col.tableFqn.split(".").pop() ?? col.tableFqn;
      if (col.isNullable) {
        filters.push({
          name: `${humanize(tableName)} has ${humanize(col.columnName)}`,
          sql: `${col.tableFqn}.${col.columnName} IS NOT NULL`,
          synonyms: [],
          instructions: `Filter to rows where ${col.columnName} is present`,
          isTimePeriod: false,
        });
      }
    }
  }

  return filters;
}

/**
 * Build simple instructions from table/column comments (no LLM).
 */
function buildRuleBasedInstructions(
  metadata: MetadataSnapshot,
  tableFqns: string[],
  domain: string,
  conversationSummary?: string,
): string[] {
  const instructions: string[] = [];

  if (conversationSummary) {
    instructions.push(`User intent: ${conversationSummary}`);
  }

  instructions.push(
    `This space covers the ${domain} domain with ${tableFqns.length} table${tableFqns.length !== 1 ? "s" : ""}.`,
  );

  for (const t of metadata.tables) {
    if (!tableFqns.some((fqn) => fqn.toLowerCase() === t.fqn.toLowerCase())) continue;
    if (t.comment) {
      const shortName = t.fqn.split(".").pop();
      instructions.push(`${shortName}: ${t.comment}`);
    }
  }

  return instructions;
}

/**
 * Run the fast Genie Engine: scrape metadata, then build a space using
 * mostly rule-based passes plus fast-LLM title/instruction/query generation.
 * Typically completes in seconds. The result is a usable space that can be enhanced later with
 * the full engine.
 */
export async function runFastGenieEngine(input: AdHocEngineInput): Promise<AdHocEngineResult> {
  const { tables, config: adhocConfig, signal, onProgress } = input;

  if (tables.length === 0) {
    throw new Error("At least one table is required");
  }

  const jobId = `fast-${Date.now()}`;
  const log = createScopedLogger({
    origin: "GenieAdhoc",
    module: "genie/adhoc-engine",
    jobId,
  });

  const domain = normalizeDomainLabel(adhocConfig?.domain || inferDomain(tables));
  const fiscalYearStartMonth = adhocConfig?.fiscalYearStartMonth ?? 1;

  const fastEndpoint = resolveEndpoint("classification");
  const premiumEndpoint = resolveEndpoint("generation");
  log.info("Fast Genie Engine starting", { tableCount: tables.length, domain });

  const checkAborted = () => {
    if (signal?.aborted) throw new Error("Cancelled");
  };

  // Step 1: Scrape metadata (SQL queries only, no LLM)
  onProgress?.("Scraping table metadata...", 5);
  const metadata = await scrapeMetadata(tables);
  const validTableFqns = metadata.tables.map((t) => t.fqn);
  const allowlist = buildSchemaAllowlist(metadata);

  // Step 2: Rule-based joins from foreign keys
  const tableSet = new Set(validTableFqns.map((t) => t.toLowerCase()));
  const fkJoins = buildFkJoins(metadata.foreignKeys, tableSet);
  const existingJoinKeys = new Set(
    fkJoins.flatMap((j) => [
      `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`,
      `${j.rightTable.toLowerCase()}|${j.leftTable.toLowerCase()}`,
    ]),
  );
  const heuristicJoins =
    fkJoins.length === 0 && validTableFqns.length > 1
      ? inferHeuristicJoins(metadata.columns, validTableFqns, existingJoinKeys)
      : [];
  const { accepted: acceptedJoinCandidates, diagnostics: joinDiagnostics } = evaluateJoinCandidates(
    allowlist,
    [
      ...fkJoins.map((j) => ({ ...j, source: "fk" as const, confidence: "high" as const })),
      ...heuristicJoins.map((j) => ({
        ...j,
        source: "heuristic" as const,
        confidence: "low" as const,
      })),
    ],
    "adhoc_fast_join",
  );
  const allJoins = acceptedJoinCandidates;

  // Step 3: Rule-based entity extraction from schema
  const entityCandidates = extractEntityCandidatesFromSchema(
    metadata.columns.map((c) => ({
      tableFqn: c.tableFqn,
      columnName: c.columnName,
      dataType: c.dataType,
    })),
    validTableFqns,
  );

  // Step 4: LLM-generated measures, filters, and dimensions (fast endpoint)
  checkAborted();
  onProgress?.("Generating measures, filters & dimensions...", 25);
  let llmMeasures: EnrichedSqlSnippetMeasure[] = [];
  let llmFilters: EnrichedSqlSnippetFilter[] = [];
  let llmDimensions: EnrichedSqlSnippetDimension[] = [];

  try {
    const llmResult = await generateFastLLMExpressions(
      validTableFqns,
      metadata,
      allowlist,
      domain,
      adhocConfig?.conversationSummary,
      fastEndpoint,
      signal,
    );
    llmMeasures = llmResult.measures;
    llmFilters = llmResult.filters;
    llmDimensions = llmResult.dimensions;
    log.info("Fast LLM expressions generated", {
      measures: llmMeasures.length,
      filters: llmFilters.length,
      dimensions: llmDimensions.length,
    });
  } catch (err) {
    log.warn("Fast LLM expressions failed, falling back to rule-based", {
      fn: "runFastGenieEngine",
      errorCategory: "llm_error",
      error: err instanceof Error ? err.message : String(err),
    });
    llmMeasures = generateNumericMeasures(metadata.columns, validTableFqns);
    llmFilters = generateBasicFilters(metadata.columns, validTableFqns);
  }

  // Step 5: Rule-based time periods from date columns (deterministic, always useful)
  const autoTimePeriods = adhocConfig?.autoTimePeriods ?? true;
  let timePeriodFilters: EnrichedSqlSnippetFilter[] = [];
  let timePeriodDimensions: EnrichedSqlSnippetDimension[] = [];

  if (autoTimePeriods) {
    const tpResult = generateTimePeriods(metadata.columns, validTableFqns, {
      fiscalYearStartMonth,
    });
    timePeriodFilters = tpResult.filters;
    timePeriodDimensions = tpResult.dimensions;
  }

  // Step 7: Rule-based instructions from comments
  checkAborted();
  onProgress?.("Generating instructions...", 50);
  const engineConfig = buildEngineConfig(adhocConfig);
  const instructionResult = await runInstructionGeneration({
    domain,
    subdomains: [],
    businessName: adhocConfig?.title || domain,
    businessContext: resolveBusinessContext(adhocConfig),
    config: engineConfig,
    entityCandidates,
    joinSpecs: allJoins,
    endpoint: fastEndpoint,
    fallbackEndpoint: premiumEndpoint,
    metadata,
    tableFqns: validTableFqns,
    conversationSummary: adhocConfig?.conversationSummary,
    casingProfiles: casingProfilesFromCandidates(entityCandidates),
    signal,
  });
  const instructions =
    instructionResult.instructions.length > 0
      ? instructionResult.instructions
      : buildRuleBasedInstructions(
          metadata,
          validTableFqns,
          domain,
          adhocConfig?.conversationSummary,
        );

  const complexity = engineConfig.questionComplexity ?? "simple";

  checkAborted();
  onProgress?.("Generating example queries...", 65);
  const exampleQueryResult = await runExampleQueryGeneration({
    domain,
    tableFqns: validTableFqns,
    metadata,
    allowlist,
    joinSpecs: allJoins,
    endpoint: fastEndpoint,
    fallbackEndpoint: premiumEndpoint,
    questionComplexity: complexity,
    signal,
  });

  // Step 8: Sample questions from entity candidates
  const sampleQuestions = entityCandidates
    .slice(0, 5)
    .map((ec) => buildEntityFallbackQuestion(ec.columnName, complexity));

  const passOutputs: GenieEnginePassOutputs = {
    domain,
    subdomains: [],
    tables: validTableFqns,
    metricViews: [],
    columnEnrichments: [],
    entityMatchingCandidates: entityCandidates,
    measures: llmMeasures,
    filters: [...llmFilters, ...timePeriodFilters],
    dimensions: [...llmDimensions, ...timePeriodDimensions],
    trustedQueries: exampleQueryResult.queries,
    trustedFunctions: [],
    textInstructions: instructions,
    sampleQuestions,
    benchmarkQuestions: [],
    metricViewProposals: [],
    joinSpecs: allJoins,
    joinDiagnostics,
  };

  // Step 9: Assemble via same pipeline as full engine
  checkAborted();
  onProgress?.("Assembling space configuration...", 80);
  const seedId = jobId;
  const titleInputBusinessName = adhocConfig?.title || domain;
  const titleResult = adhocConfig?.title
    ? { title: adhocConfig.title, source: "fallback" as const }
    : await runTitleGeneration({
        businessName: titleInputBusinessName,
        domain,
        subdomains: [],
        tableFqns: validTableFqns,
        conversationSummary: adhocConfig?.conversationSummary,
        endpoint: fastEndpoint,
        fallbackEndpoint: premiumEndpoint,
        signal,
      });
  const degradedReasons: string[] = [];
  if (validTableFqns.length > 1 && allJoins.length === 0)
    degradedReasons.push("no_validated_joins");
  if (allJoins.length > 0 && exampleQueryResult.queries.length < 2)
    degradedReasons.push("insufficient_sample_sql");
  if (titleResult.source === "fallback") degradedReasons.push("title_fallback_used");

  checkAborted();
  const space = assembleSerializedSpace(passOutputs, {
    runId: seedId,
    businessName: titleInputBusinessName,
    allowlist,
    metadata,
  });

  onProgress?.("Running quality checks...", 92);
  const healthReport = runHealthCheck(space as unknown as Record<string, unknown>);
  const actualScore = Math.round(healthReport.overallScore);

  const recommendation = buildRecommendation(passOutputs, space, titleInputBusinessName, {
    titleOverride: titleResult.title,
    titleSource: titleResult.source,
    degradedReasons,
    qualityScore: actualScore,
    joinDiagnostics,
    promptVersion: "genie-v2-phase2",
  });
  if (adhocConfig?.title) recommendation.title = adhocConfig.title;
  if (adhocConfig?.description) recommendation.description = adhocConfig.description;

  log.info("Fast Genie Engine complete", {
    domain,
    tables: validTableFqns.length,
    llmMeasures: llmMeasures.length,
    llmFilters: llmFilters.length,
    llmDimensions: llmDimensions.length,
    timePeriodFilters: timePeriodFilters.length,
    timePeriodDimensions: timePeriodDimensions.length,
    assembledMeasures: space.instructions.sql_snippets.measures.length,
    assembledFilters: space.instructions.sql_snippets.filters.length,
    assembledDimensions: space.instructions.sql_snippets.expressions.length,
    joins: allJoins.length,
    heuristicJoins: heuristicJoins.length,
    entities: entityCandidates.length,
    sampleSqlQueries: exampleQueryResult.queries.length,
  });

  return { recommendation, passOutputs, metadata, mode: "fast" };
}

// ---------------------------------------------------------------------------
// Full mode — all 7 LLM passes
// ---------------------------------------------------------------------------

/**
 * Run the ad-hoc Genie Engine with full pass coverage: scrape metadata
 * for the given tables, then run all 7 engine passes (column intelligence,
 * semantic expressions, join inference, trusted assets, instructions,
 * benchmarks, metric views) to produce a production-grade SerializedSpace.
 */
export async function runAdHocGenieEngine(input: AdHocEngineInput): Promise<AdHocEngineResult> {
  const { tables, config: adhocConfig, signal, onProgress } = input;

  if (tables.length === 0) {
    throw new Error("At least one table is required");
  }

  const jobId = `adhoc-${Date.now()}`;
  const log = createScopedLogger({
    origin: "GenieAdhoc",
    module: "genie/adhoc-engine",
    jobId,
  });

  const engineConfig = buildEngineConfig(adhocConfig);
  const premiumEndpoint = resolveEndpoint("generation");
  const fastEndpoint = resolveEndpoint("classification");
  const domain = normalizeDomainLabel(adhocConfig?.domain || inferDomain(tables));
  const businessContext = resolveBusinessContext(adhocConfig);

  log.info("Full ad-hoc Genie Engine starting", {
    tableCount: tables.length,
    domain,
    llmRefinement: engineConfig.llmRefinement,
    generateTrustedAssets: engineConfig.generateTrustedAssets,
    generateBenchmarks: engineConfig.generateBenchmarks,
    generateMetricViews: engineConfig.generateMetricViews,
    hasBusinessContext: !!businessContext,
  });

  onProgress?.("Fetching table metadata...", 5, "metadata-scrape");
  const metadata = await scrapeMetadata(tables);
  const validTableFqns = metadata.tables.map((t) => t.fqn);
  const allowlist = buildSchemaAllowlist(metadata);

  // Best-effort: mine system tables for creation hints (joins, sensitivity,
  // table importance). Always opt-in via env flag and never fatal.
  const creationHints = await maybeGatherCreationHints(validTableFqns, log);

  // Pass 1 (fast) + Pass 2 (premium) in parallel
  onProgress?.("Analyzing columns & generating SQL expressions...", 10, "column-intelligence");
  const [columnResult, exprResult] = await Promise.all([
    runColumnIntelligence({
      tableFqns: validTableFqns,
      metadata,
      allowlist,
      config: engineConfig,
      sampleData: null,
      endpoint: fastEndpoint,
      signal,
    }),
    runSemanticExpressions({
      tableFqns: validTableFqns,
      metadata,
      allowlist,
      useCases: [],
      businessContext,
      config: engineConfig,
      endpoint: premiumEndpoint,
      signal,
    }),
  ]);

  // Build join specs from foreign keys + LLM inference
  onProgress?.("Inferring table relationships...", 35, "join-inference");
  const tableSet = new Set(validTableFqns.map((t) => t.toLowerCase()));
  const fkJoins = buildFkJoins(metadata.foreignKeys, tableSet);

  const existingJoinKeys = new Set(
    fkJoins.map((j) => `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`),
  );

  let llmJoins: typeof fkJoins = [];
  if (engineConfig.llmRefinement && fkJoins.length < 3) {
    try {
      const llmResult = await runJoinInference({
        tableFqns: validTableFqns,
        metadata,
        allowlist,
        existingJoinKeys,
        endpoint: fastEndpoint,
        signal,
      });
      llmJoins = llmResult.joins;
    } catch (err) {
      log.warn("Ad-hoc LLM join inference failed", {
        fn: "runAdHocGenieEngine",
        errorCategory: "llm_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const existingAllJoinKeys = new Set(
    [...fkJoins, ...llmJoins].flatMap((j) => [
      `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`,
      `${j.rightTable.toLowerCase()}|${j.leftTable.toLowerCase()}`,
    ]),
  );
  const heuristicJoins =
    validTableFqns.length > 1 && fkJoins.length + llmJoins.length === 0
      ? inferHeuristicJoins(metadata.columns, validTableFqns, existingAllJoinKeys)
      : [];
  const { accepted: acceptedJoinCandidates, diagnostics: joinDiagnostics } = evaluateJoinCandidates(
    allowlist,
    [
      ...fkJoins.map((j) => ({ ...j, source: "fk" as const, confidence: "high" as const })),
      ...llmJoins.map((j) => ({ ...j, source: "llm" as const, confidence: "medium" as const })),
      ...heuristicJoins.map((j) => ({
        ...j,
        source: "heuristic" as const,
        confidence: "low" as const,
      })),
    ],
    "adhoc_full_join",
  );
  const allJoins = acceptedJoinCandidates;

  log.info("Ad-hoc join specs assembled", {
    domain,
    fkJoins: fkJoins.length,
    llmInferred: llmJoins.length,
    total: allJoins.length,
  });

  // Phase A: Metric views first
  onProgress?.("Generating metric views...", 50, "metric-views");
  const metricViewResult =
    isMetricViewsEnabled() && engineConfig.generateMetricViews
      ? await runMetricViewProposals({
          domain,
          tableFqns: validTableFqns,
          metadata,
          allowlist,
          useCases: [],
          measures: exprResult.measures,
          dimensions: exprResult.dimensions,
          joinSpecs: allJoins,
          columnEnrichments: columnResult.enrichments,
          endpoint: premiumEndpoint,
          signal,
        })
      : { proposals: [] };

  // Persist metric view proposals to standalone table (best-effort)
  try {
    const schemaScope = metadata.ucPath;
    await saveMetricViewProposals(
      null,
      schemaScope,
      domain,
      metricViewResult.proposals,
      input.ownerEmail,
    );
  } catch (err) {
    log.warn("Failed to persist ad-hoc metric view proposals (non-fatal)", {
      fn: "runAdHocGenieEngine",
      errorCategory: "db",
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Phase B: Passes 3-5 in parallel
  onProgress?.("Creating trusted assets, instructions & benchmarks...", 60, "trusted-assets");
  const [trustedResult, instructionResult, benchmarkResult] = await Promise.all([
    engineConfig.generateTrustedAssets
      ? runTrustedAssetAuthoring({
          tableFqns: validTableFqns,
          metadata,
          allowlist,
          useCases: [],
          entityCandidates: columnResult.entityCandidates,
          joinSpecs: allJoins,
          endpoint: premiumEndpoint,
          questionComplexity: engineConfig.questionComplexity,
          signal,
        })
      : Promise.resolve({ queries: [], functions: [] }),

    runInstructionGeneration({
      domain,
      subdomains: [],
      businessName: adhocConfig?.title || domain,
      businessContext,
      config: engineConfig,
      entityCandidates: columnResult.entityCandidates,
      joinSpecs: allJoins,
      endpoint: fastEndpoint,
      fallbackEndpoint: premiumEndpoint,
      metadata,
      tableFqns: validTableFqns,
      conversationSummary: adhocConfig?.conversationSummary,
      sensitiveColumns: sensitiveColumnSetFromHints(creationHints),
      casingProfiles: casingProfilesFromCandidates(columnResult.entityCandidates),
      signal,
    }),

    engineConfig.generateBenchmarks
      ? runBenchmarkGeneration({
          tableFqns: validTableFqns,
          metadata,
          allowlist,
          useCases: [],
          entityCandidates: columnResult.entityCandidates,
          customerBenchmarks: engineConfig.benchmarkQuestions,
          joinSpecs: allJoins,
          endpoint: premiumEndpoint,
          signal,
        })
      : Promise.resolve({ benchmarks: [...engineConfig.benchmarkQuestions] }),
  ]);

  onProgress?.("Assembling Genie Space...", 90, "assembly");

  let trustedQueries = trustedResult.queries;
  if (trustedQueries.length === 0) {
    const exampleResult = await runExampleQueryGeneration({
      domain,
      tableFqns: validTableFqns,
      metadata,
      allowlist,
      joinSpecs: allJoins,
      endpoint: fastEndpoint,
      fallbackEndpoint: premiumEndpoint,
      questionComplexity: engineConfig.questionComplexity,
      signal,
    });
    trustedQueries = exampleResult.queries;
  }

  const trustedQuestionTexts = trustedQueries
    .filter((tq) => tq.question.trim().length > 0)
    .map((tq) => tq.question);
  const fullComplexity = engineConfig.questionComplexity ?? "simple";
  const entityFallbackQuestions = columnResult.entityCandidates
    .slice(0, 5)
    .map((ec) => buildEntityFallbackQuestion(ec.columnName, fullComplexity));
  const sampleQuestions = [...trustedQuestionTexts.slice(0, 5), ...entityFallbackQuestions]
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .slice(0, 5);

  // Pass 5b: Benchmark Alignment Review (post-pass).
  const alignedBenchmarkResult = await runBenchmarkAlignment({
    benchmarks: benchmarkResult.benchmarks,
    surface: "adhoc-engine.benchmark-alignment",
    signal,
  });

  const passOutputs: GenieEnginePassOutputs = {
    domain,
    subdomains: [],
    tables: validTableFqns,
    metricViews: [],
    columnEnrichments: columnResult.enrichments,
    entityMatchingCandidates: columnResult.entityCandidates,
    measures: exprResult.measures,
    filters: exprResult.filters,
    dimensions: exprResult.dimensions,
    trustedQueries,
    trustedFunctions: [],
    textInstructions: instructionResult.instructions,
    sampleQuestions,
    benchmarkQuestions: alignedBenchmarkResult.aligned,
    metricViewProposals: metricViewResult.proposals,
    joinSpecs: allJoins,
    joinDiagnostics,
  };

  const seedId = `adhoc-${Date.now()}`;
  const titleInputBusinessName = adhocConfig?.title || domain;
  const titleResult = adhocConfig?.title
    ? { title: adhocConfig.title, source: "fallback" as const }
    : await runTitleGeneration({
        businessName: titleInputBusinessName,
        domain,
        subdomains: [],
        tableFqns: validTableFqns,
        conversationSummary: adhocConfig?.conversationSummary,
        endpoint: fastEndpoint,
        fallbackEndpoint: premiumEndpoint,
        signal,
      });
  const degradedReasons: string[] = [];
  if (validTableFqns.length > 1 && allJoins.length === 0)
    degradedReasons.push("no_validated_joins");
  if (allJoins.length > 0 && trustedQueries.length < 2)
    degradedReasons.push("insufficient_sample_sql");
  if (titleResult.source === "fallback") degradedReasons.push("title_fallback_used");

  const space = assembleSerializedSpace(passOutputs, {
    runId: seedId,
    businessName: titleInputBusinessName,
    allowlist,
    metadata,
  });

  const fullHealthReport = runHealthCheck(space as unknown as Record<string, unknown>);
  const fullScore = Math.round(fullHealthReport.overallScore);

  const recommendation = buildRecommendation(passOutputs, space, titleInputBusinessName, {
    titleOverride: titleResult.title,
    titleSource: titleResult.source,
    degradedReasons,
    qualityScore: fullScore,
    joinDiagnostics,
    promptVersion: "genie-v2-phase2",
  });
  if (adhocConfig?.title) recommendation.title = adhocConfig.title;
  if (adhocConfig?.description) recommendation.description = adhocConfig.description;

  onProgress?.("Complete", 100);

  log.info("Full ad-hoc Genie Engine complete", {
    domain,
    tables: validTableFqns.length,
    measures: exprResult.measures.length,
    filters: exprResult.filters.length,
    joins: allJoins.length,
    instructions: instructionResult.instructions.length,
    trustedQueries: trustedQueries.length,
    benchmarks: benchmarkResult.benchmarks.length,
    metricViews: metricViewResult.proposals.length,
    sampleQuestions: sampleQuestions.length,
  });

  return { recommendation, passOutputs, metadata, mode: "full" };
}
