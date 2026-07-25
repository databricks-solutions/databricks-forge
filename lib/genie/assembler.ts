/**
 * SerializedSpace Assembler — builds a complete Genie API v2 payload
 * from the aggregated pass outputs, with full schema-allowlist validation.
 */

import { createHash } from "crypto";
import type {
  SerializedSpace,
  SampleQuestion,
  DataSourceTable,
  DataSourceColumnConfig,
  DataSourceMetricView,
  ExampleQuestionSql,
  JoinSpec,
  SqlSnippetMeasure,
  SqlSnippetFilter,
  SqlSnippetExpression,
  TextInstruction,
  BenchmarkQuestion,
  GenieEnginePassOutputs,
  GenieSpaceRecommendation,
  JoinDiagnostic,
} from "./types";
import type { MetadataSnapshot } from "@/lib/domain/types";
import { isValidTable, validateSqlExpression, type SchemaAllowlist } from "./schema-allowlist";
import { logger } from "@/lib/logger";
import { isPiiColumn, isFormatAssistanceCandidate } from "@/lib/toolkit/pii-patterns";

function makeId(seed: string, category: string, index: number): string {
  const hash = createHash("md5").update(`${seed}:${category}:${index}`).digest("hex");
  return hash.slice(0, 32);
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** Extract the table name (last segment) from a fully-qualified name for use as a join alias. */
function fqnToAlias(fqn: string): string {
  const parts = fqn.replace(/`/g, "").split(".");
  return parts[parts.length - 1];
}

/**
 * Rewrite a join SQL condition from FQN-based references to alias-based
 * backtick-quoted references that the Genie API expects.
 *
 * Input:  "samples.bakehouse.orders.customerID = samples.bakehouse.customers.customerID"
 * Output: "`orders`.`customerID` = `customers`.`customerID`"
 */
function rewriteJoinSql(
  sql: string,
  leftFqn: string,
  leftAlias: string,
  rightFqn: string,
  rightAlias: string,
): string {
  let result = sql;

  // Replace FQN.column references (catalog.schema.table.column) with `alias`.`column`.
  // Process the longer FQN first to avoid partial matches.
  const replacements: [string, string][] = (
    [
      [leftFqn, leftAlias],
      [rightFqn, rightAlias],
    ] as [string, string][]
  ).sort((a, b) => b[0].length - a[0].length);

  for (const [fqn, alias] of replacements) {
    const escaped = fqn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match backtick-quoted columns first, then unquoted
    result = result.replace(
      new RegExp(`${escaped}\\.(?:\`([^\`]+)\`|([a-zA-Z_]\\w*))`, "g"),
      (_m, quoted: string | undefined, bare: string | undefined) =>
        `\`${alias}\`.\`${quoted ?? bare}\``,
    );
  }

  return result;
}

export interface AssembleOptions {
  runId: string;
  businessName: string;
  allowlist: SchemaAllowlist;
  metadata: MetadataSnapshot;
}

export function determineQualityGate(
  qualityScore: number,
  degradedReasons: string[],
): { gateDecision: "allow" | "warn" | "block"; gateReasons: string[] } {
  const gateReasons: string[] = [];
  let gateDecision: "allow" | "warn" | "block" = "allow";
  if (degradedReasons.includes("no_validated_joins")) {
    gateDecision = "block";
    gateReasons.push(
      "No validated joins for multi-table space — cross-table queries may not work correctly.",
    );
  } else if (qualityScore < 70 || degradedReasons.length > 0) {
    gateDecision = "warn";
    gateReasons.push("Space quality is degraded; review preview diagnostics before deploy.");
  }
  return { gateDecision, gateReasons };
}

/**
 * Assemble a complete SerializedSpace from engine pass outputs.
 * Every identifier is validated against the schema allowlist.
 */
export function assembleSerializedSpace(
  outputs: GenieEnginePassOutputs,
  opts: AssembleOptions,
): SerializedSpace {
  const { runId, allowlist, metadata } = opts;
  const { domain } = outputs;
  const seed = `${runId}:${domain}`;

  // Table comments lookup
  const tableComments = new Map<string, string>();
  for (const t of metadata.tables) {
    if (t.comment) tableComments.set(t.fqn, t.comment);
  }

  // Metric view comments lookup
  const mvComments = new Map<string, string>();
  for (const mv of metadata.metricViews) {
    if (mv.comment) mvComments.set(mv.fqn, mv.comment);
  }

  // Column enrichments lookup: tableFqn -> ColumnEnrichment[]
  const columnsByTable = new Map<string, typeof outputs.columnEnrichments>();
  for (const ce of outputs.columnEnrichments) {
    const list = columnsByTable.get(ce.tableFqn) ?? [];
    list.push(ce);
    columnsByTable.set(ce.tableFqn, list);
  }

  // Entity matching candidates lookup: "tableFqn:columnName" (lowercase)
  const entityCandidateKeys = new Set<string>();
  for (const ec of outputs.entityMatchingCandidates) {
    entityCandidateKeys.add(`${ec.tableFqn.toLowerCase()}:${ec.columnName.toLowerCase()}`);
  }

  // Join relationship lookup: tableFqn -> descriptions of related tables
  const joinRelationships = new Map<string, string[]>();
  for (const j of outputs.joinSpecs) {
    const leftKey = j.leftTable.toLowerCase();
    const rightKey = j.rightTable.toLowerCase();
    const leftRels = joinRelationships.get(leftKey) ?? [];
    leftRels.push(`Joins to ${j.rightTable} (${j.relationshipType ?? "related"})`);
    joinRelationships.set(leftKey, leftRels);
    const rightRels = joinRelationships.get(rightKey) ?? [];
    rightRels.push(`Joins to ${j.leftTable} (${j.relationshipType ?? "related"})`);
    joinRelationships.set(rightKey, rightRels);
  }

  // 1. Data source tables (validated)
  const validTables = outputs.tables.filter((fqn) => {
    if (!isValidTable(allowlist, fqn)) {
      logger.warn("Assembler rejected unknown table", { domain, table: fqn });
      return false;
    }
    return true;
  });

  const dataTables: DataSourceTable[] = validTables
    .sort((a, b) => a.localeCompare(b))
    .map((fqn) => {
      const descParts: string[] = [];
      const comment = tableComments.get(fqn);
      if (comment) descParts.push(comment);

      const rels = joinRelationships.get(fqn.toLowerCase());
      if (rels && rels.length > 0) {
        descParts.push(rels.join(". ") + ".");
      }

      const enrichments = columnsByTable.get(fqn);
      if (enrichments && enrichments.length > 0) {
        const keyDescs = enrichments
          .filter((ce) => ce.description && !ce.hidden)
          .slice(0, 5)
          .map((ce) => `${ce.columnName}: ${ce.description}`);
        if (keyDescs.length > 0) {
          descParts.push("Key columns: " + keyDescs.join("; ") + ".");
        }

        const synonymParts = enrichments
          .filter((ce) => ce.synonyms.length > 0 && !ce.hidden)
          .slice(0, 5)
          .map((ce) => `${ce.columnName} (aka ${ce.synonyms.join(", ")})`);
        if (synonymParts.length > 0) {
          descParts.push("Synonyms: " + synonymParts.join("; ") + ".");
        }

        const hiddenCols = enrichments.filter((ce) => ce.hidden).map((ce) => ce.columnName);
        if (hiddenCols.length > 0) {
          descParts.push("Ignore columns: " + hiddenCols.join(", ") + ".");
        }
      }

      const table: DataSourceTable = { identifier: fqn };
      if (descParts.length > 0) table.description = [descParts.join(" ")];

      if (enrichments && enrichments.length > 0) {
        const columnConfigs: DataSourceColumnConfig[] = enrichments
          .filter((ce) => !ce.hidden)
          .map((ce) => {
            const cfg: DataSourceColumnConfig = { column_name: ce.columnName };
            if (ce.description) cfg.description = [ce.description];
            if (ce.synonyms.length > 0) cfg.synonyms = ce.synonyms;

            const ecKey = `${fqn.toLowerCase()}:${ce.columnName.toLowerCase()}`;
            const isEntity = entityCandidateKeys.has(ecKey) || ce.entityMatchingCandidate;
            if (isEntity) {
              cfg.enable_entity_matching = true;
              cfg.enable_format_assistance = true;
            } else if (isPiiColumn(ce.columnName) || isFormatAssistanceCandidate(ce.columnName)) {
              cfg.enable_format_assistance = true;
            }

            return cfg;
          });
        if (columnConfigs.length > 0) table.column_configs = columnConfigs;
      }

      return table;
    });

  // 2. Data source metric views
  const dataMetricViews: DataSourceMetricView[] = outputs.metricViews
    .sort((a, b) => a.localeCompare(b))
    .map((fqn) => {
      const comment = mvComments.get(fqn);
      return comment ? { identifier: fqn, description: [comment] } : { identifier: fqn };
    });

  // Hard cap: Genie spaces support at most 30 tables + views combined.
  // Prioritise tables that participate in joins (higher connectivity = higher value).
  const MAX_DATA_OBJECTS = 30;
  let cappedTables = dataTables;
  let cappedMetricViews = dataMetricViews;
  const totalDataObjects = dataTables.length + dataMetricViews.length;

  if (totalDataObjects > MAX_DATA_OBJECTS) {
    const joinedTableIds = new Set(
      outputs.joinSpecs.flatMap((j) => [j.leftTable.toLowerCase(), j.rightTable.toLowerCase()]),
    );

    cappedTables = [...dataTables].sort((a, b) => {
      const aJoined = joinedTableIds.has(a.identifier.toLowerCase()) ? 1 : 0;
      const bJoined = joinedTableIds.has(b.identifier.toLowerCase()) ? 1 : 0;
      return bJoined - aJoined;
    });

    // Metric views always count; cap tables to fill remaining budget
    const mvBudget = Math.min(cappedMetricViews.length, Math.floor(MAX_DATA_OBJECTS * 0.3));
    cappedMetricViews = cappedMetricViews.slice(0, mvBudget);
    cappedTables = cappedTables.slice(0, MAX_DATA_OBJECTS - cappedMetricViews.length);

    logger.warn("Genie space capped to 30 data objects", {
      domain,
      originalTables: dataTables.length,
      originalMetricViews: dataMetricViews.length,
      keptTables: cappedTables.length,
      keptMetricViews: cappedMetricViews.length,
      droppedTables: dataTables.length - cappedTables.length,
      droppedMetricViews: dataMetricViews.length - cappedMetricViews.length,
    });
  }

  // 3. Sample questions
  const sampleQuestions: SampleQuestion[] = outputs.sampleQuestions.slice(0, 5).map((q, i) => ({
    id: makeId(seed, "q", i),
    question: [q],
  }));

  // 4. SQL examples (from trusted queries + use case SQL)
  // Cap at 8 examples; drop any with SQL longer than 4000 chars (Genie comprehension degrades)
  const MAX_EXAMPLE_SQL_CHARS = 4000;
  const MAX_SQL_EXAMPLES = 8;
  const exampleSqls: ExampleQuestionSql[] = outputs.trustedQueries
    .filter((tq) => tq.sql.length <= MAX_EXAMPLE_SQL_CHARS)
    .slice(0, MAX_SQL_EXAMPLES)
    .map((tq, i) => {
      const entry: ExampleQuestionSql = {
        id: makeId(seed, "sql", i),
        question: [tq.question],
        sql: [tq.sql],
      };
      if (tq.parameters.length > 0) {
        const guidance = tq.parameters.map(
          (p) =>
            `Parameter "${p.name}" (${p.type}): ${p.comment}${p.defaultValue ? ` [default: ${p.defaultValue}]` : ""}`,
        );
        entry.usage_guidance = guidance;
      } else {
        entry.usage_guidance = [`Use this query to answer: "${tq.question}"`];
      }
      return entry;
    });

  // 5. Join specs -- format for the Genie API:
  //    - left/right need identifier + alias
  //    - sql uses backtick-quoted alias.column references
  //    - relationship_type is encoded as a SQL comment: --rt=FROM_RELATIONSHIP_TYPE_...--
  const joinSpecs: JoinSpec[] = outputs.joinSpecs
    .filter((j) =>
      validateSqlExpression(allowlist, j.sql, `asm_join:${j.leftTable}->${j.rightTable}`, true),
    )
    .map((j, i) => {
      const leftAlias = fqnToAlias(j.leftTable);
      let rightAlias = fqnToAlias(j.rightTable);
      if (rightAlias === leftAlias) rightAlias = `${rightAlias}_2`;

      const rewrittenSql = rewriteJoinSql(j.sql, j.leftTable, leftAlias, j.rightTable, rightAlias);
      const sqlEntries = [rewrittenSql];

      if (j.relationshipType) {
        const rtTag = `FROM_RELATIONSHIP_TYPE_${j.relationshipType.toUpperCase()}`;
        sqlEntries.push(`--rt=${rtTag}--`);
      }

      const leftName = j.leftTable.split(".").pop() ?? j.leftTable;
      const rightName = j.rightTable.split(".").pop() ?? j.rightTable;
      const relDesc = j.relationshipType ? `${j.relationshipType} relationship` : "related";
      const comment = `Joins ${leftName} to ${rightName} (${relDesc})`;

      return {
        id: makeId(seed, "join", i),
        left: { identifier: j.leftTable, alias: leftAlias },
        right: { identifier: j.rightTable, alias: rightAlias },
        sql: sqlEntries,
        comment: [comment],
      };
    });

  // 6. SQL snippets (measures, filters, dimensions)
  // Focused spaces perform better — cap at 12 each (Genie best practice)
  const MAX_SNIPPETS = 12;
  const MAX_SNIPPET_SQL_CHARS = 500;

  const measures: SqlSnippetMeasure[] = outputs.measures
    .filter((m) => validateSqlExpression(allowlist, m.sql, `asm_measure:${m.name}`, true))
    .filter((m) => m.sql.length <= MAX_SNIPPET_SQL_CHARS)
    .slice(0, MAX_SNIPPETS)
    .map((m, i) => ({
      id: makeId(seed, "measure", i),
      alias: m.instructions ? `${m.name} -- ${m.instructions}` : m.name,
      display_name: m.name,
      sql: [m.sql],
      ...(m.synonyms.length > 0 ? { synonyms: m.synonyms } : {}),
      ...(m.instructions ? { comment: [m.instructions] } : {}),
    }));

  const filters: SqlSnippetFilter[] = outputs.filters
    .filter((f) => validateSqlExpression(allowlist, f.sql, `asm_filter:${f.name}`, true))
    .filter((f) => f.sql.length <= MAX_SNIPPET_SQL_CHARS)
    .slice(0, MAX_SNIPPETS)
    .map((f, i) => ({
      id: makeId(seed, "filter", i),
      sql: [f.sql],
      display_name: f.name,
      ...(f.synonyms.length > 0 ? { synonyms: f.synonyms } : {}),
      ...(f.instructions ? { comment: [f.instructions] } : {}),
    }));

  const expressions: SqlSnippetExpression[] = outputs.dimensions
    .filter((d) => validateSqlExpression(allowlist, d.sql, `asm_dim:${d.name}`, true))
    .filter((d) => d.sql.length <= MAX_SNIPPET_SQL_CHARS)
    .slice(0, MAX_SNIPPETS)
    .map((d, i) => ({
      id: makeId(seed, "expr", i),
      alias: d.instructions ? `${d.name} -- ${d.instructions}` : d.name,
      display_name: d.name,
      sql: [d.sql],
      ...(d.synonyms.length > 0 ? { synonyms: d.synonyms } : {}),
      ...(d.instructions ? { instruction: [d.instructions] } : {}),
    }));

  // 7. Text instructions -- API allows at most one TextInstruction entry;
  //    all instruction strings go into its content[] array.
  const instrContent = outputs.textInstructions.filter((t) => t.trim().length > 0);
  const textInstructions: TextInstruction[] =
    instrContent.length > 0 ? [{ id: makeId(seed, "instr", 0), content: instrContent }] : [];

  // Hard-truncate instructions to 3000 chars (Genie API recommended limit).
  // The instruction-generation pass already budgets, but this is a safety net.
  const MAX_INSTR_CHARS = 3000;
  let instrTotalChars = instrContent.reduce((sum, s) => sum + s.length, 0);
  if (instrTotalChars > MAX_INSTR_CHARS) {
    let charBudget = MAX_INSTR_CHARS;
    const trimmed: string[] = [];
    for (const block of instrContent) {
      if (charBudget <= 0) break;
      if (block.length <= charBudget) {
        trimmed.push(block);
        charBudget -= block.length;
      } else {
        trimmed.push(block.slice(0, charBudget));
        charBudget = 0;
      }
    }
    instrContent.length = 0;
    instrContent.push(...trimmed);
    logger.warn("Genie instructions truncated to fit 3000-char limit", {
      domain,
      originalChars: instrTotalChars,
      truncatedChars: trimmed.reduce((s, t) => s + t.length, 0),
    });
    instrTotalChars = trimmed.reduce((s, t) => s + t.length, 0);
  }
  logger.info("Genie instruction size", {
    domain,
    totalChars: instrTotalChars,
    blocks: instrContent.length,
  });

  // 8. Benchmarks -- each phrasing gets its own entry sharing the same answer
  const benchmarks: BenchmarkQuestion[] = [];
  let benchIdx = 0;
  for (const b of outputs.benchmarkQuestions) {
    const answer = b.expectedSql ? [{ format: "SQL", content: [b.expectedSql] }] : undefined;
    const allPhrasings = [b.question, ...b.alternatePhrasings];
    for (const phrasing of allPhrasings) {
      benchmarks.push({
        id: makeId(seed, "bench", benchIdx++),
        question: [phrasing],
        answer,
      });
    }
    if (benchmarks.length >= 10) break;
  }

  const space: SerializedSpace = {
    version: 2,
    config: { sample_questions: [...sampleQuestions].sort(byId) },
    data_sources: {
      tables: cappedTables,
      ...(cappedMetricViews.length > 0 ? { metric_views: cappedMetricViews } : {}),
    },
    instructions: {
      text_instructions: [...textInstructions].sort(byId),
      example_question_sqls: [...exampleSqls].sort(byId),
      join_specs: [...joinSpecs].sort(byId),
      sql_snippets: {
        measures: [...measures].sort(byId),
        filters: [...filters].sort(byId),
        expressions: [...expressions].sort(byId),
      },
    },
    ...(benchmarks.length > 0 ? { benchmarks: { questions: [...benchmarks].sort(byId) } } : {}),
  };

  return space;
}

/**
 * Generate an insightful title that avoids redundancy when businessName
 * equals domain (the ad-hoc default when no explicit title is provided).
 */
function generateTitle(
  businessName: string,
  domain: string,
  subdomains: string[],
  tables: string[],
): string {
  const bizLower = businessName.toLowerCase().trim();
  const domLower = domain.toLowerCase().trim();

  if (bizLower !== domLower) {
    return `${businessName} - ${domain} Analytics`;
  }

  if (subdomains.length > 0) {
    return `${domain} ${subdomains[0]} Analytics`;
  }

  if (tables.length > 0 && tables.length <= 3) {
    const shortNames = tables.map((t) => {
      const parts = t.split(".");
      const name = parts[parts.length - 1];
      return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    });
    return `${domain} Analytics — ${shortNames.join(", ")}`;
  }

  if (tables.length > 3) {
    return `${domain} Analytics — ${tables.length} Tables`;
  }

  return `${domain} Analytics`;
}

function generateDescription(
  businessName: string,
  domain: string,
  subdomains: string[],
  measureCount: number,
  filterCount: number,
  dimensionCount: number,
): string[] {
  const descParts: string[] = [];
  const bizLower = businessName.toLowerCase().trim();
  const domLower = domain.toLowerCase().trim();

  if (bizLower !== domLower) {
    descParts.push(`Genie space for the ${domain} domain of ${businessName}.`);
  } else {
    descParts.push(`Genie space for ${domain} data exploration and analytics.`);
  }

  if (subdomains.length > 0) {
    descParts.push(`Covers: ${subdomains.join(", ")}.`);
  }

  descParts.push(`${measureCount} measures, ${filterCount} filters, ${dimensionCount} dimensions.`);
  return descParts;
}

/**
 * Build a GenieSpaceRecommendation from engine pass outputs + assembled space.
 */
export function buildRecommendation(
  outputs: GenieEnginePassOutputs,
  space: SerializedSpace,
  businessName: string,
  options?: {
    titleOverride?: string;
    titleSource?: "llm" | "fallback";
    degradedReasons?: string[];
    qualityScore?: number;
    promptVersion?: string;
    joinDiagnostics?: JoinDiagnostic[];
  },
): GenieSpaceRecommendation {
  const title = options?.titleOverride
    ? options.titleOverride
    : generateTitle(businessName, outputs.domain, outputs.subdomains, outputs.tables);
  const descParts = generateDescription(
    businessName,
    outputs.domain,
    outputs.subdomains,
    space.instructions.sql_snippets.measures.length,
    space.instructions.sql_snippets.filters.length,
    space.instructions.sql_snippets.expressions.length,
  );

  const spaceTables = space.data_sources.tables.map((t) => t.identifier);
  const spaceMvs = space.data_sources.metric_views?.map((mv) => mv.identifier) ?? [];

  const degradedReasons = options?.degradedReasons ?? [];
  const qualityScore = options?.qualityScore ?? 100;
  const { gateDecision, gateReasons } = determineQualityGate(qualityScore, degradedReasons);

  return {
    domain: outputs.domain,
    subdomains: outputs.subdomains,
    title,
    description: descParts.join(" "),
    tableCount: spaceTables.length,
    metricViewCount: spaceMvs.length,
    useCaseCount: 0, // Will be set by the engine
    sqlExampleCount: space.instructions.example_question_sqls.length,
    joinCount: space.instructions.join_specs.length,
    measureCount: space.instructions.sql_snippets.measures.length,
    filterCount: space.instructions.sql_snippets.filters.length,
    dimensionCount: space.instructions.sql_snippets.expressions.length,
    benchmarkCount: space.benchmarks?.questions.length ?? 0,
    instructionCount: space.instructions.text_instructions.flatMap((t) => t.content).length,
    sampleQuestionCount: space.config.sample_questions.length,
    sqlFunctionCount: 0,
    tables: spaceTables,
    metricViews: spaceMvs,
    serializedSpace: JSON.stringify(space),
    quality: {
      promptVersion: options?.promptVersion ?? "genie-v2",
      titleSource: options?.titleSource ?? "fallback",
      instructionChars: space.instructions.text_instructions
        .flatMap((t) => t.content)
        .reduce((sum, block) => sum + block.length, 0),
      joinsCount: space.instructions.join_specs.length,
      sampleQueriesCount: space.instructions.example_question_sqls.length,
      degradedReasons,
      score: qualityScore,
      gateDecision,
      gateReasons,
      joinDiagnostics: options?.joinDiagnostics ?? outputs.joinDiagnostics ?? [],
    },
  };
}
