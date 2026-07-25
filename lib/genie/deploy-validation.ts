import { fetchColumnsBatch, fetchTableInfoBatch } from "@/lib/queries/metadata";
import { buildSchemaAllowlist, validateSqlExpression } from "@/lib/genie/schema-allowlist";
import type { SerializedSpace } from "@/lib/genie/types";
import type { MetadataSnapshot } from "@/lib/domain/types";

export interface SerializedSpaceValidationFailure {
  ok: false;
  error: string;
  code:
    | "invalid_json"
    | "no_tables"
    | "invalid_join_sql"
    | "missing_multitable_joins"
    | "invalid_example_sql";
  diagnostics?: Record<string, unknown>;
}

export interface SerializedSpaceValidationSuccess {
  ok: true;
}

export type SerializedSpaceValidationResult =
  | SerializedSpaceValidationFailure
  | SerializedSpaceValidationSuccess;

export async function revalidateSerializedSpace(
  serializedSpace: string,
): Promise<SerializedSpaceValidationResult> {
  let parsed: SerializedSpace;
  try {
    parsed = JSON.parse(serializedSpace) as SerializedSpace;
  } catch {
    return { ok: false, error: "Invalid serializedSpace JSON", code: "invalid_json" };
  }

  const tableFqns = parsed?.data_sources?.tables?.map((t) => t.identifier) ?? [];
  if (!Array.isArray(tableFqns) || tableFqns.length === 0) {
    return {
      ok: false,
      error: "Cannot create a Genie Space with no tables. At least one table is required.",
      code: "no_tables",
    };
  }

  const [tables, columns] = await Promise.all([
    fetchTableInfoBatch(tableFqns),
    fetchColumnsBatch(tableFqns),
  ]);

  const metadata: MetadataSnapshot = {
    cacheKey: `deploy-validate-${Date.now()}`,
    ucPath: tableFqns.map((t) => t.split(".").slice(0, 2).join(".")).join(", "),
    tables,
    columns,
    foreignKeys: [],
    metricViews: [],

    tableCount: tables.length,
    columnCount: columns.length,
    cachedAt: new Date().toISOString(),
    lineageDiscoveredFqns: [],
  };
  const allowlist = buildSchemaAllowlist(metadata);

  for (const join of parsed.instructions.join_specs ?? []) {
    for (const sql of join.sql ?? []) {
      if (!sql || sql.startsWith("--rt=")) continue;
      if (!validateSqlExpression(allowlist, sql, `deploy_join:${join.id}`, true)) {
        return {
          ok: false,
          error:
            "Schema drift detected: one or more join conditions are no longer valid. Regenerate before deploy.",
          code: "invalid_join_sql",
          diagnostics: {
            joinId: join.id,
            joinLeft: join.left?.identifier,
            joinRight: join.right?.identifier,
            sql,
          },
        };
      }
    }
  }

  if (tableFqns.length > 1 && (parsed.instructions.join_specs?.length ?? 0) === 0) {
    return {
      ok: false,
      error:
        "Quality gate: multi-table spaces must include at least one validated join before deploy.",
      code: "missing_multitable_joins",
      diagnostics: { tableCount: tableFqns.length, tables: tableFqns.slice(0, 20) },
    };
  }

  for (const ex of parsed.instructions.example_question_sqls ?? []) {
    const sql = ex.sql?.join("\n") ?? "";
    if (sql && !validateSqlExpression(allowlist, sql, `deploy_example_sql:${ex.id}`, true)) {
      return {
        ok: false,
        error:
          "Schema drift detected: one or more sample SQL queries are no longer valid. Regenerate before deploy.",
        code: "invalid_example_sql",
        diagnostics: {
          exampleId: ex.id,
          question: ex.question?.join(" "),
          sql: sql.slice(0, 1000),
        },
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pre-Deploy Review (Gap 7: Config Review Agent)
// ---------------------------------------------------------------------------

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface PreDeployFinding {
  area: string;
  severity: ReviewSeverity;
  title: string;
  detail: string;
}

export interface PreDeployReviewResult {
  findings: PreDeployFinding[];
  criticalCount: number;
  highCount: number;
  deployRecommendation: "safe" | "review_recommended" | "not_recommended";
}

/**
 * Run a comprehensive pre-deploy review of a serialized space configuration.
 * Returns categorized findings with severity levels. This goes beyond basic
 * validation to check instruction quality, join completeness, coverage, etc.
 */
export function runPreDeployReview(
  parsed: SerializedSpace,
  metadata: MetadataSnapshot,
): PreDeployReviewResult {
  const findings: PreDeployFinding[] = [];
  const tableFqns = parsed?.data_sources?.tables?.map((t) => t.identifier) ?? [];

  // -- Instruction Quality --
  const textInstructions = parsed.instructions?.text_instructions ?? [];
  const totalInstructionChars = textInstructions.reduce((sum, inst) => {
    const content = inst.content?.join(" ") ?? "";
    return sum + content.length;
  }, 0);

  if (textInstructions.length === 0) {
    findings.push({
      area: "instructions",
      severity: "high",
      title: "No text instructions",
      detail:
        "The space has no text instructions. Genie performs better with clear instructions about business context, conventions, and disambiguation rules.",
    });
  } else if (totalInstructionChars < 100) {
    findings.push({
      area: "instructions",
      severity: "medium",
      title: "Very brief instructions",
      detail: `Instructions total only ${totalInstructionChars} characters. Aim for 200+ characters covering business context, time conventions, and disambiguation rules.`,
    });
  }
  if (textInstructions.length > 3) {
    findings.push({
      area: "instructions",
      severity: "low",
      title: "Multiple instruction blocks",
      detail: `${textInstructions.length} separate instruction blocks. Consider consolidating into 1-2 blocks for clarity.`,
    });
  }

  // -- Join Completeness --
  const joinSpecs = parsed.instructions?.join_specs ?? [];
  if (tableFqns.length > 1) {
    const joinTablePairs = new Set<string>();
    for (const j of joinSpecs) {
      joinTablePairs.add(j.left?.identifier?.toLowerCase() ?? "");
      joinTablePairs.add(j.right?.identifier?.toLowerCase() ?? "");
    }
    const unjoinedTables = tableFqns.filter((t) => !joinTablePairs.has(t.toLowerCase()));

    if (unjoinedTables.length > 0) {
      findings.push({
        area: "joins",
        severity: unjoinedTables.length > tableFqns.length / 2 ? "high" : "medium",
        title: `${unjoinedTables.length} table${unjoinedTables.length !== 1 ? "s" : ""} not in any join`,
        detail: `Tables without joins: ${unjoinedTables.slice(0, 5).join(", ")}${unjoinedTables.length > 5 ? ` (+${unjoinedTables.length - 5} more)` : ""}. Genie may not be able to answer cross-table questions involving these.`,
      });
    }

    const minJoins = tableFqns.length - 1;
    if (joinSpecs.length < minJoins) {
      findings.push({
        area: "joins",
        severity: "medium",
        title: "Potentially incomplete join coverage",
        detail: `${joinSpecs.length} join${joinSpecs.length !== 1 ? "s" : ""} for ${tableFqns.length} tables. A fully connected graph needs at least ${minJoins} joins.`,
      });
    }
  }

  // -- Example SQL Coverage --
  const exampleSqls = parsed.instructions?.example_question_sqls ?? [];
  if (exampleSqls.length === 0) {
    findings.push({
      area: "examples",
      severity: "high",
      title: "No example SQL queries",
      detail:
        "Example SQL queries teach Genie correct patterns. Add 3-10 representative question-SQL pairs.",
    });
  } else if (exampleSqls.length < 3) {
    findings.push({
      area: "examples",
      severity: "medium",
      title: "Few example SQL queries",
      detail: `Only ${exampleSqls.length} example${exampleSqls.length !== 1 ? "s" : ""}. Aim for 5-10 covering different query patterns (aggregation, filtering, joins).`,
    });
  }

  // -- Semantic Richness --
  const measures = parsed.instructions?.sql_snippets?.measures ?? [];
  const filters = parsed.instructions?.sql_snippets?.filters ?? [];

  if (measures.length === 0 && filters.length === 0) {
    findings.push({
      area: "semantic",
      severity: "high",
      title: "No measures or filters defined",
      detail:
        "SQL snippets (measures and filters) help Genie understand business metrics. Add common aggregations and frequently-used WHERE conditions.",
    });
  } else {
    if (measures.length < 3) {
      findings.push({
        area: "semantic",
        severity: "low",
        title: "Few measures",
        detail: `Only ${measures.length} measure${measures.length !== 1 ? "s" : ""}. Consider adding common business KPIs.`,
      });
    }
    if (filters.length === 0) {
      findings.push({
        area: "semantic",
        severity: "low",
        title: "No filters defined",
        detail:
          "Filters help Genie apply common WHERE conditions (e.g., date ranges, active records).",
      });
    }
  }

  // -- Benchmark Questions --
  const benchmarks = parsed.benchmarks?.questions ?? [];
  if (benchmarks.length === 0) {
    findings.push({
      area: "benchmarks",
      severity: "info",
      title: "No benchmark questions",
      detail:
        "Benchmark questions help validate Genie's accuracy. Consider adding 5-20 test questions with expected SQL.",
    });
  }

  // -- Column Descriptions --
  const allTables = parsed.data_sources?.tables ?? [];
  let totalCols = 0;
  let describedCols = 0;
  for (const t of allTables) {
    const colConfigs = t.column_configs ?? [];
    totalCols += colConfigs.length;
    describedCols += colConfigs.filter((c) => {
      const desc = c.description;
      return Array.isArray(desc) && desc.some((d) => typeof d === "string" && d.trim().length > 0);
    }).length;
  }
  const metaCols = metadata.columns.length;
  const configuredRatio = metaCols > 0 ? totalCols / metaCols : totalCols > 0 ? 1 : 0;

  if (configuredRatio < 0.5 && metaCols > 10) {
    findings.push({
      area: "data_sources",
      severity: "medium",
      title: "Many columns not configured",
      detail: `Only ${totalCols} of ${metaCols} columns have configuration. Adding descriptions and synonyms improves Genie's understanding.`,
    });
  }

  if (totalCols > 0 && describedCols / totalCols < 0.3) {
    findings.push({
      area: "data_sources",
      severity: "low",
      title: "Few column descriptions",
      detail: `${describedCols} of ${totalCols} configured columns have descriptions (${Math.round((describedCols / totalCols) * 100)}%).`,
    });
  }

  // -- Compute summary --
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const deployRecommendation: PreDeployReviewResult["deployRecommendation"] =
    criticalCount > 0 ? "not_recommended" : highCount > 0 ? "review_recommended" : "safe";

  return { findings, criticalCount, highCount, deployRecommendation };
}
