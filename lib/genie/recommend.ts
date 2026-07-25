/**
 * Legacy Genie Space Recommendation Engine.
 *
 * Backward-compatible wrapper: the original regex-based, deterministic
 * generator that runs without LLM calls. The new Genie Engine
 * (lib/genie/engine.ts) supersedes this for production use, but this
 * module is kept as a fallback for older runs and environments where
 * the engine is unavailable.
 *
 * New code should use `runGenieEngine()` from `lib/genie/engine.ts`.
 */

import { createHash } from "crypto";
import type { PipelineRun, UseCase, MetadataSnapshot, BusinessContext } from "@/lib/domain/types";
import type {
  GenieSpaceRecommendation,
  SerializedSpace,
  SampleQuestion,
  DataSourceTable,
  DataSourceMetricView,
  ExampleQuestionSql,
  JoinSpec,
  TextInstruction,
  SqlSnippetMeasure,
  SqlSnippetFilter,
  SqlSnippetExpression,
  QuestionComplexity,
} from "./types";
import { statementToQuestion } from "./engine";

// ---------------------------------------------------------------------------
// Deterministic ID generator (based on run + domain + index)
// ---------------------------------------------------------------------------

function makeId(runId: string, domain: string, index: number): string {
  const hash = createHash("md5").update(`${runId}:${domain}:${index}`).digest("hex");
  return hash.slice(0, 32);
}

// ---------------------------------------------------------------------------
// SQL Snippet Extraction
// ---------------------------------------------------------------------------

interface ExtractedSnippets {
  measures: SqlSnippetMeasure[];
  filters: SqlSnippetFilter[];
  expressions: SqlSnippetExpression[];
}

/**
 * Extract sql_snippets (measures, filters, dimensions) from use case SQL code.
 * Uses regex to find aggregate functions, WHERE conditions, and GROUP BY expressions.
 */
function extractSqlSnippets(useCases: UseCase[], runId: string, domain: string): ExtractedSnippets {
  const measureMap = new Map<string, string>(); // sql -> alias
  const filterMap = new Map<string, string>(); // sql -> display_name
  const expressionMap = new Map<string, string>(); // sql -> alias

  for (const uc of useCases) {
    if (!uc.sqlCode) continue;
    const sql = uc.sqlCode;

    // Extract aggregate measures: SUM(...), AVG(...), COUNT(...), etc.
    const aggRegex = /\b(SUM|AVG|COUNT|MAX|MIN|COUNT\s*\(\s*DISTINCT)\s*\(\s*([^)]+)\)/gi;
    let match: RegExpExecArray | null;
    while ((match = aggRegex.exec(sql)) !== null) {
      const func = match[1].toUpperCase().replace(/\s+/g, " ");
      const col = match[2].trim();
      const fullExpr = `${func}(${col})`;
      if (!measureMap.has(fullExpr)) {
        const colName = col.replace(/.*\./, "").replace(/[`"]/g, "").toLowerCase();
        const funcPrefix = func.startsWith("COUNT") ? "count" : func.toLowerCase();
        measureMap.set(fullExpr, `${funcPrefix}_${colName}`);
      }
    }

    // Extract WHERE conditions (simple equality/comparison patterns)
    const whereRegex = /WHERE\s+([\s\S]*?)(?:GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|;|\)|$)/gi;
    let whereMatch: RegExpExecArray | null;
    while ((whereMatch = whereRegex.exec(sql)) !== null) {
      const whereClauses = whereMatch[1];
      // Split on AND and extract simple conditions
      const conditions = whereClauses.split(/\bAND\b/i);
      for (const cond of conditions) {
        const trimmed = cond.trim();
        if (!trimmed || trimmed.length > 120) continue;
        // Match patterns like column = 'value' or column >= date
        const simpleMatch = trimmed.match(
          /^([a-z_]\w*(?:\.[a-z_]\w*)*)\s*(=|!=|<>|>=|<=|>|<|LIKE|IN|IS NOT NULL|IS NULL)\s*(.+)$/i,
        );
        if (simpleMatch) {
          const colName = simpleMatch[1].replace(/.*\./, "").replace(/[`"]/g, "").toLowerCase();
          if (!filterMap.has(trimmed)) {
            filterMap.set(trimmed, `${colName}_filter`);
          }
        }
      }
    }

    // Extract dimension expressions from GROUP BY
    const groupByRegex = /GROUP\s+BY\s+([\s\S]*?)(?:HAVING|ORDER\s+BY|LIMIT|UNION|;|\)|$)/gi;
    let groupMatch: RegExpExecArray | null;
    while ((groupMatch = groupByRegex.exec(sql)) !== null) {
      const groupCols = groupMatch[1].split(",");
      for (const expr of groupCols) {
        const trimmed = expr.trim();
        if (!trimmed || trimmed.length > 100) continue;
        // Look for function calls like YEAR(col), MONTH(col), DATE_TRUNC(...)
        const funcMatch = trimmed.match(
          /^(YEAR|MONTH|DAY|QUARTER|DATE_TRUNC|DATE_FORMAT|UPPER|LOWER|CONCAT)\s*\(\s*(.+)\)/i,
        );
        if (funcMatch) {
          const func = funcMatch[1].toLowerCase();
          const col = funcMatch[2]
            .trim()
            .replace(/.*\./, "")
            .replace(/[`"',]/g, "")
            .toLowerCase();
          if (!expressionMap.has(trimmed)) {
            expressionMap.set(trimmed, `${func}_${col}`);
          }
        }
      }
    }
  }

  let idx = 0;
  const measures: SqlSnippetMeasure[] = Array.from(measureMap.entries())
    .slice(0, 15)
    .map(([sql, alias]) => ({
      id: makeId(runId, `${domain}_measure`, idx++),
      alias,
      sql: [sql],
    }));

  idx = 0;
  const filters: SqlSnippetFilter[] = Array.from(filterMap.entries())
    .slice(0, 10)
    .map(([sql, displayName]) => ({
      id: makeId(runId, `${domain}_filter`, idx++),
      sql: [sql],
      display_name: displayName,
    }));

  idx = 0;
  const expressions: SqlSnippetExpression[] = Array.from(expressionMap.entries())
    .slice(0, 10)
    .map(([sql, alias]) => ({
      id: makeId(runId, `${domain}_expr`, idx++),
      alias,
      sql: [sql],
    }));

  return { measures, filters, expressions };
}

// ---------------------------------------------------------------------------
// Table FQN Validation
// ---------------------------------------------------------------------------

/** Matches a valid Unity Catalog FQN: catalog.schema.table (alphanumeric + underscores). */
const TABLE_FQN_REGEX = /^[a-zA-Z_]\w*\.[a-zA-Z_]\w*\.[a-zA-Z_]\w*$/;

function isValidTableFqn(identifier: string): boolean {
  return TABLE_FQN_REGEX.test(identifier);
}

// ---------------------------------------------------------------------------
// Recommendation Generator
// ---------------------------------------------------------------------------

export function generateGenieRecommendations(
  run: PipelineRun,
  useCases: UseCase[],
  metadata: MetadataSnapshot,
  questionComplexity?: QuestionComplexity,
): GenieSpaceRecommendation[] {
  // Group use cases by domain
  const domainMap = new Map<string, UseCase[]>();
  for (const uc of useCases) {
    const d = uc.domain || "Uncategorised";
    if (!domainMap.has(d)) domainMap.set(d, []);
    domainMap.get(d)!.push(uc);
  }

  // Build a lookup for table comments
  const tableComments = new Map<string, string>();
  for (const t of metadata.tables) {
    if (t.comment) tableComments.set(t.fqn, t.comment);
  }

  // Build a set of catalog.schema pairs per table for metric view filtering
  const tableCatalogSchemas = new Map<string, Set<string>>();
  for (const t of metadata.tables) {
    const key = `${t.catalog}.${t.schema}`;
    if (!tableCatalogSchemas.has(t.fqn)) tableCatalogSchemas.set(t.fqn, new Set());
    tableCatalogSchemas.get(t.fqn)!.add(key);
  }

  const recommendations: GenieSpaceRecommendation[] = [];

  for (const [domain, domainUseCases] of domainMap.entries()) {
    // Sort by score descending
    const sorted = [...domainUseCases].sort((a, b) => b.overallScore - a.overallScore);

    // 1. Collect tables (strip backticks + filter out invalid identifiers)
    const tableSet = new Set<string>();
    for (const uc of sorted) {
      for (const t of uc.tablesInvolved) {
        const clean = t.replace(/`/g, "");
        if (isValidTableFqn(clean)) tableSet.add(clean);
      }
    }
    const tables = Array.from(tableSet);

    // A Genie Space requires at least one table -- skip domains with none
    if (tables.length === 0) continue;

    // 2. Find metric views in same catalog.schema as domain tables
    const domainCatalogSchemas = new Set<string>();
    for (const fqn of tables) {
      const parts = fqn.split(".");
      if (parts.length >= 2) domainCatalogSchemas.add(`${parts[0]}.${parts[1]}`);
    }
    const metricViews = (metadata.metricViews ?? []).filter((mv) =>
      domainCatalogSchemas.has(`${mv.catalog}.${mv.schema}`),
    );

    // 3. Subdomains
    const subdomains = [...new Set(sorted.map((uc) => uc.subdomain).filter(Boolean))];

    // 4. Join specs -- FK relationships where both tables are in this domain
    const joinSpecs: JoinSpec[] = [];
    let joinIdx = 0;
    for (const fk of metadata.foreignKeys) {
      if (tableSet.has(fk.tableFqn) && tableSet.has(fk.referencedTableFqn)) {
        const leftAlias = fk.tableFqn.split(".").pop() ?? fk.tableFqn;
        let rightAlias = fk.referencedTableFqn.split(".").pop() ?? fk.referencedTableFqn;
        if (rightAlias === leftAlias) rightAlias = `${rightAlias}_2`;

        const sqlCondition = `\`${leftAlias}\`.\`${fk.columnName}\` = \`${rightAlias}\`.\`${fk.referencedColumnName}\``;

        joinSpecs.push({
          id: makeId(run.runId, `${domain}_join`, joinIdx++),
          left: { identifier: fk.tableFqn, alias: leftAlias },
          right: { identifier: fk.referencedTableFqn, alias: rightAlias },
          sql: [sqlCondition, "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"],
        });
      }
    }

    // 5. Sample questions (from top 5 use case statements)
    const sampleQuestions: SampleQuestion[] = sorted.slice(0, 5).map((uc, i) => ({
      id: makeId(run.runId, `${domain}_q`, i),
      question: [statementToQuestion(uc.statement, questionComplexity)],
    }));

    // 6. Example SQL queries (up to 10 with generated SQL)
    const exampleSqls: ExampleQuestionSql[] = sorted
      .filter((uc) => uc.sqlStatus === "generated" && uc.sqlCode)
      .slice(0, 10)
      .map((uc, i) => ({
        id: makeId(run.runId, `${domain}_sql`, i),
        question: [uc.name],
        sql: [uc.sqlCode!],
      }));

    // 7. Extract sql_snippets
    const snippets = extractSqlSnippets(sorted, run.runId, domain);

    // 8. Text instructions
    const textInstructions = buildTextInstructions(run, domain, subdomains, sorted);

    // 9. Build data_sources.tables (must be sorted by identifier per Genie API)
    const dataTables: DataSourceTable[] = tables
      .sort((a, b) => a.localeCompare(b))
      .map((fqn) => {
        const comment = tableComments.get(fqn);
        return comment ? { identifier: fqn, description: [comment] } : { identifier: fqn };
      });

    // 10. Build data_sources.metric_views (sorted for consistency)
    const dataMetricViews: DataSourceMetricView[] = metricViews
      .sort((a, b) => a.fqn.localeCompare(b.fqn))
      .map((mv) =>
        mv.comment ? { identifier: mv.fqn, description: [mv.comment] } : { identifier: mv.fqn },
      );

    // 11. Assemble serialized_space
    //     The Genie API requires all arrays to be sorted by `id` (or `identifier`).
    const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

    const space: SerializedSpace = {
      version: 2,
      config: { sample_questions: [...sampleQuestions].sort(byId) },
      data_sources: {
        tables: dataTables, // already sorted by identifier above
        ...(dataMetricViews.length > 0
          ? { metric_views: dataMetricViews } // already sorted by identifier above
          : {}),
      },
      instructions: {
        text_instructions: [...textInstructions].sort(byId),
        example_question_sqls: [...exampleSqls].sort(byId),
        join_specs: [...joinSpecs].sort(byId),
        sql_snippets: {
          measures: [...snippets.measures].sort(byId),
          filters: [...snippets.filters].sort(byId),
          expressions: [...snippets.expressions].sort(byId),
        },
      },
    };

    const title = `${run.config.businessName} - ${domain} Analytics`;
    const description = buildDescription(run, domain, subdomains, sorted);

    recommendations.push({
      domain,
      subdomains,
      title,
      description,
      tableCount: tables.length,
      metricViewCount: metricViews.length,
      useCaseCount: sorted.length,
      sqlExampleCount: exampleSqls.length,
      joinCount: joinSpecs.length,
      measureCount: snippets.measures.length,
      filterCount: snippets.filters.length,
      dimensionCount: snippets.expressions.length,
      benchmarkCount: 0,
      instructionCount: textInstructions.length,
      sampleQuestionCount: sampleQuestions.length,
      sqlFunctionCount: 0,
      tables,
      metricViews: metricViews.map((mv) => mv.fqn),
      serializedSpace: JSON.stringify(space),
    });
  }

  // Sort by use case count descending
  recommendations.sort((a, b) => b.useCaseCount - a.useCaseCount);
  return recommendations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDescription(
  run: PipelineRun,
  domain: string,
  subdomains: string[],
  useCases: UseCase[],
): string {
  const bc = run.businessContext;
  const parts: string[] = [];

  parts.push(`Genie space for the ${domain} domain of ${run.config.businessName}.`);

  if (subdomains.length > 0) {
    parts.push(`Covers: ${subdomains.join(", ")}.`);
  }

  parts.push(
    `${useCases.length} use cases across ${new Set(useCases.map((uc) => uc.type)).size > 1 ? "AI and Statistical" : (useCases[0]?.type ?? "AI")} analytics.`,
  );

  if (bc?.industries) {
    parts.push(`Industry: ${bc.industries}.`);
  }

  return parts.join(" ");
}

function buildTextInstructions(
  run: PipelineRun,
  domain: string,
  subdomains: string[],
  useCases: UseCase[],
): TextInstruction[] {
  const bc: BusinessContext | null = run.businessContext;
  const instructions: TextInstruction[] = [];

  // General business context
  const contextLines: string[] = [
    `This Genie space serves the ${domain} domain for ${run.config.businessName}.`,
  ];

  if (bc) {
    if (bc.industries) contextLines.push(`Industry: ${bc.industries}.`);
    if (bc.strategicGoals) contextLines.push(`Strategic goals: ${bc.strategicGoals}`);
    if (bc.businessPriorities) contextLines.push(`Business priorities: ${bc.businessPriorities}`);
    if (bc.valueChain) contextLines.push(`Value chain: ${bc.valueChain}`);
  }

  if (subdomains.length > 0) {
    contextLines.push(`Sub-areas: ${subdomains.join(", ")}.`);
  }

  // Analytics techniques used in this domain
  const techniques = [...new Set(useCases.map((uc) => uc.analyticsTechnique).filter(Boolean))];
  if (techniques.length > 0) {
    contextLines.push(`Analytics techniques in this domain: ${techniques.join(", ")}.`);
  }

  instructions.push({
    id: makeId(run.runId, `${domain}_instr`, 0),
    content: [contextLines.join("\n")],
  });

  return instructions;
}
