/**
 * SQL Validator -- 3-phase test/repair/retest pipeline for generated SQL.
 *
 * Mirrors the upstream `databricks-genie-workbench` `plan_builder.py` that
 * validates trusted_assets, benchmarks, measures, filters, named_expressions,
 * and joins by actually executing them on the SQL Warehouse with `EXPLAIN`
 * (and optional `LIMIT 1`).
 *
 * Phase 1 -- Test:    EXPLAIN <sql>; classify error if any
 * Phase 2 -- Repair:  LLM patch (metric-view-unbound-param uses a specialized prompt)
 * Phase 3 -- Re-Test: re-run; if still failing, drop with reason
 *
 * Synthetic test wrappers convert SQL fragments (measures, filters, named
 * expressions, joins) into runnable `SELECT ... FROM ... LIMIT 1` so they
 * can be EXPLAIN'd without the surrounding query template.
 *
 * Gated globally by `FORGE_SQL_REPAIR_ENABLED`. When disabled, callers can
 * still invoke `testSql` for diagnostic-only flows; `validateAndRepair`
 * returns `{status: "ok"}` without doing any work so existing surfaces are
 * un-perturbed.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { reviewSql, type ReviewResult } from "@/lib/ai/sql-reviewer";
import { logger } from "@/lib/logger";
import { withSpan } from "@/lib/observability/mlflow-tracing";

// ---------------------------------------------------------------------------
// Feature gate
// ---------------------------------------------------------------------------

/**
 * Returns true when the SQL repair loop is enabled. Default: OFF.
 *
 * Flip to ON via `FORGE_SQL_REPAIR_ENABLED=true` once the surface is proven
 * via telemetry on the first release.
 */
export function isSqlRepairEnabled(): boolean {
  const v = process.env.FORGE_SQL_REPAIR_ENABLED;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SqlItemKind =
  | "trusted_asset"
  | "benchmark"
  | "measure"
  | "filter"
  | "named_expression"
  | "join";

export type ErrorClass =
  | "ok"
  | "metric_view_unbound_param"
  | "unknown_column"
  | "syntax"
  | "permission"
  | "timeout"
  | "other";

export interface TestSqlResult {
  ok: boolean;
  rowCount?: number;
  errorClass: ErrorClass;
  errorMessage?: string;
}

export interface ValidateAndRepairItem {
  /** SQL string. For non-runnable items (measure/filter/expr/join) provide a fragment. */
  sql: string;
  kind: SqlItemKind;
  /** Synthetic test wrapper context -- `tableFqn` for measures/filters/named_expressions. */
  tableFqn?: string;
  /** Synthetic test wrapper context for joins. */
  leftTable?: string;
  /** Synthetic test wrapper context for joins. */
  rightTable?: string;
  /** Schema context for the LLM repair prompt. */
  schemaContext?: string;
  /** Optional surface label for logging. */
  surface?: string;
  oboToken?: string;
}

export interface ValidateAndRepairResult {
  status: "ok" | "repaired" | "dropped";
  finalSql?: string;
  reason?: string;
  errorClass?: ErrorClass;
  rowCount?: number;
}

// ---------------------------------------------------------------------------
// testSql -- run EXPLAIN, classify errors
// ---------------------------------------------------------------------------

const SAMPLE_LIMIT_FOR_BENCHMARK = 1;

/**
 * Try to validate a runnable SQL statement.
 *
 * 1. EXPLAIN <sql>             -- catches syntax + unknown columns
 * 2. SELECT * FROM (sql) LIMIT 1 -- catches semantic + permission errors
 *
 * `wantRowCount=true` actually executes (with LIMIT 1) so callers can detect
 * benchmark zero-row pathologies. By default we stop after EXPLAIN.
 */
export async function testSql(
  sql: string,
  opts?: { wantRowCount?: boolean },
): Promise<TestSqlResult> {
  if (!sql || !sql.trim()) {
    return { ok: false, errorClass: "other", errorMessage: "empty SQL" };
  }

  try {
    await executeSQL(`EXPLAIN ${sql}`);
  } catch (err) {
    return classifyAndWrap(err, "explain");
  }

  if (!opts?.wantRowCount) {
    return { ok: true, errorClass: "ok" };
  }

  try {
    const result = await executeSQL(
      `SELECT * FROM (${sql}) AS forge_sample LIMIT ${SAMPLE_LIMIT_FOR_BENCHMARK}`,
    );
    return { ok: true, errorClass: "ok", rowCount: result.rows.length };
  } catch (err) {
    return classifyAndWrap(err, "limit");
  }
}

function classifyAndWrap(err: unknown, phase: "explain" | "limit"): TestSqlResult {
  const message = err instanceof Error ? err.message : String(err);
  const errorClass = classifySqlError(message);
  logger.debug("SQL validator: error during phase", { phase, errorClass, message });
  return { ok: false, errorClass, errorMessage: message };
}

/**
 * Classify a Databricks SQL error message into one of our known buckets so
 * we can route to specialized repair prompts.
 */
export function classifySqlError(message: string): ErrorClass {
  const lower = message.toLowerCase();
  if (
    lower.includes("metric_view_unbound_parameter") ||
    lower.includes("metric view") && lower.includes("parameter")
  ) {
    return "metric_view_unbound_param";
  }
  if (
    lower.includes("cannot resolve") ||
    lower.includes("column not found") ||
    lower.includes("unresolved column") ||
    lower.includes("unresolvedcolumn")
  ) {
    return "unknown_column";
  }
  if (
    lower.includes("parse error") ||
    lower.includes("parseexception") ||
    lower.includes("syntax")
  ) {
    return "syntax";
  }
  if (lower.includes("permission") || lower.includes("access") || lower.includes("forbidden")) {
    return "permission";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "timeout";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Synthetic test-query wrappers
// ---------------------------------------------------------------------------

/**
 * Wrap a non-runnable SQL fragment in a runnable `SELECT ... FROM ... LIMIT 1`
 * so it can be EXPLAIN'd. Returns null when we don't have enough context to
 * build a sensible wrapper (caller should skip validation for that item).
 */
export function buildTestQuery(item: ValidateAndRepairItem): string | null {
  const sql = (item.sql ?? "").trim();
  if (!sql) return null;

  switch (item.kind) {
    case "trusted_asset":
    case "benchmark":
      return sql;

    case "measure":
      if (!item.tableFqn) return null;
      return `SELECT ${stripTrailingSemi(sql)} AS measure_value FROM ${item.tableFqn} LIMIT 1`;

    case "filter":
      if (!item.tableFqn) return null;
      return `SELECT * FROM ${item.tableFqn} WHERE ${stripTrailingSemi(sql)} LIMIT 1`;

    case "named_expression":
      if (!item.tableFqn) return null;
      return `SELECT ${stripTrailingSemi(sql)} AS expr_value FROM ${item.tableFqn} LIMIT 1`;

    case "join": {
      if (!item.leftTable || !item.rightTable) return null;
      const leftAlias = pickAlias(item.leftTable, "a");
      const rightAlias = pickAlias(item.rightTable, "b") === leftAlias ? "b2" : pickAlias(item.rightTable, "b");
      const onClause = stripTrailingSemi(sql);
      return `SELECT ${leftAlias}.* FROM ${item.leftTable} ${leftAlias} INNER JOIN ${item.rightTable} ${rightAlias} ON ${onClause} LIMIT 1`;
    }
  }
}

function stripTrailingSemi(s: string): string {
  return s.replace(/;\s*$/g, "");
}

function pickAlias(fqn: string, fallback: string): string {
  const tail = fqn.split(".").pop() ?? fallback;
  return tail.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16) || fallback;
}

// ---------------------------------------------------------------------------
// repairSql -- targeted LLM patch
// ---------------------------------------------------------------------------

interface RepairOptions {
  errorClass: ErrorClass;
  errorMessage: string;
  schemaContext?: string;
  kind: SqlItemKind;
  surface?: string;
}

/**
 * Ask the review endpoint to fix a single SQL item. Routes
 * `metric_view_unbound_param` to a CTE-binding specialization; everything
 * else falls back to the generic reviewer with the runtime error injected.
 */
export async function repairSql(
  sql: string,
  opts: RepairOptions,
): Promise<{ fixedSql?: string; review: ReviewResult }> {
  const surface = opts.surface ?? `sql-validator:${opts.kind}`;

  if (opts.errorClass === "metric_view_unbound_param") {
    const review = await reviewSql(sql, {
      surface,
      requestFix: true,
      schemaContext: opts.schemaContext,
      runtimeError:
        `${opts.errorMessage}\n\nThis is a metric-view UNBOUND PARAMETER error. ` +
        "To repair, wrap the metric view query in a CTE that binds every required parameter " +
        "with sensible defaults (e.g. WHERE date >= '2020-01-01' AND date < '2030-01-01'). " +
        "Do not introduce new tables or columns. Return the entire bound SQL.",
    });
    return { fixedSql: review.fixedSql, review };
  }

  const review = await reviewSql(sql, {
    surface,
    requestFix: true,
    schemaContext: opts.schemaContext,
    runtimeError: opts.errorMessage,
  });
  return { fixedSql: review.fixedSql, review };
}

// ---------------------------------------------------------------------------
// validateAndRepair -- orchestrator
// ---------------------------------------------------------------------------

/**
 * Main entry point. Test the item, repair on failure, retest. Drop on
 * persistent failure with a structured reason so callers can log/account.
 *
 * If `FORGE_SQL_REPAIR_ENABLED` is false, returns `{status: "ok"}` so this
 * function is safe to wire into existing passes without code-level guards.
 */
export async function validateAndRepair(
  item: ValidateAndRepairItem,
): Promise<ValidateAndRepairResult> {
  if (!isSqlRepairEnabled()) {
    return { status: "ok", finalSql: item.sql };
  }

  const testQuery = buildTestQuery(item);
  if (!testQuery) {
    return { status: "ok", finalSql: item.sql };
  }

  const wantRowCount = item.kind === "benchmark";

  // Phase 1: test the original SQL
  const phase1 = await withSpan(
    {
      name: `sql-validator.test:${item.kind}`,
      spanType: "TOOL",
      inputs: { surface: item.surface, kind: item.kind, sqlPreview: item.sql.slice(0, 240) },
      attributes: { phase: "test", surface: item.surface },
    },
    () => testSql(testQuery, { wantRowCount }),
  );
  if (phase1.ok) {
    return {
      status: "ok",
      finalSql: item.sql,
      rowCount: phase1.rowCount,
    };
  }

  // Phase 2: repair
  let fixed: { fixedSql?: string; review: ReviewResult };
  try {
    fixed = await withSpan(
      {
        name: `sql-validator.repair:${item.kind}`,
        spanType: "TOOL",
        inputs: {
          surface: item.surface,
          kind: item.kind,
          errorClass: phase1.errorClass,
          errorMessage: phase1.errorMessage,
        },
        attributes: { phase: "repair", surface: item.surface, errorClass: phase1.errorClass },
      },
      () =>
        repairSql(item.sql, {
          errorClass: phase1.errorClass,
          errorMessage: phase1.errorMessage ?? "(no error message)",
          schemaContext: item.schemaContext,
          kind: item.kind,
          surface: item.surface,
        }),
    );
  } catch (err) {
    logger.warn("SQL repair LLM call failed; dropping item", {
      kind: item.kind,
      error: String(err),
    });
    return {
      status: "dropped",
      reason: "repair_llm_error",
      errorClass: phase1.errorClass,
    };
  }

  if (!fixed.fixedSql || fixed.fixedSql.trim() === item.sql.trim()) {
    return {
      status: "dropped",
      reason: "repair_no_change",
      errorClass: phase1.errorClass,
    };
  }

  // Phase 3: re-test against the *wrapped* fixed SQL
  const repairedItem: ValidateAndRepairItem = { ...item, sql: fixed.fixedSql };
  const repairedTestQuery = buildTestQuery(repairedItem) ?? fixed.fixedSql;
  const phase3 = await withSpan(
    {
      name: `sql-validator.retest:${item.kind}`,
      spanType: "TOOL",
      inputs: { surface: item.surface, kind: item.kind, sqlPreview: fixed.fixedSql.slice(0, 240) },
      attributes: { phase: "retest", surface: item.surface, errorClass: phase1.errorClass },
    },
    () => testSql(repairedTestQuery, { wantRowCount }),
  );
  if (phase3.ok) {
    logger.info("SQL repair succeeded", {
      kind: item.kind,
      surface: item.surface,
      errorClass: phase1.errorClass,
    });
    return {
      status: "repaired",
      finalSql: fixed.fixedSql,
      rowCount: phase3.rowCount,
    };
  }

  return {
    status: "dropped",
    reason: `repair_retest_failed:${phase3.errorClass}`,
    errorClass: phase3.errorClass,
  };
}

// ---------------------------------------------------------------------------
// Batch helper -- map each item through `validateAndRepair`, preserving order
// ---------------------------------------------------------------------------

/**
 * Apply `validateAndRepair` to every item, in sequence (concurrency 1) so we
 * don't burst the warehouse. Returns the final SQL list aligned to the input
 * order, with any dropped items represented as `null`.
 *
 * When `FORGE_SQL_REPAIR_ENABLED` is OFF, returns the input SQLs untouched.
 */
export async function validateAndRepairBatch(
  items: ReadonlyArray<ValidateAndRepairItem>,
): Promise<ValidateAndRepairResult[]> {
  if (!isSqlRepairEnabled()) {
    return items.map((it) => ({ status: "ok" as const, finalSql: it.sql }));
  }
  const results: ValidateAndRepairResult[] = [];
  for (const item of items) {
    results.push(await validateAndRepair(item));
  }
  return results;
}
