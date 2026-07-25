/**
 * Genie Space Health Check -- deterministic scorer.
 *
 * Pure function: takes a parsed serialized_space JSON object and optional
 * user overrides, returns a SpaceHealthReport with per-category and overall
 * scores, individual check results, and quick wins.
 *
 * No LLM calls, no side effects, no network IO.
 */

import {
  runEvaluator,
  clearPendingSqlQualityChecks,
  resolveSqlQualityChecks,
} from "./health-checks/evaluators";
import { resolveRegistry } from "./health-checks/registry";
import type {
  CategoryScore,
  CheckResult,
  Finding,
  Grade,
  MaturityTier,
  Severity,
  SpaceHealthReport,
  UserCheckOverride,
  UserCustomCheck,
} from "./health-checks/types";
import type { SpaceJson } from "@/lib/genie/types";
import { fetchTableComments, fetchColumnsBatch } from "@/lib/queries/metadata";
import { logger } from "@/lib/logger";

const MAX_QUICK_WINS = 5;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function computeGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Compute the customer-facing maturity tier from the space and per-check
 * results. Mirrors upstream IQ Scanner tiering (`scoring.py`).
 *
 * - `trusted`           -- ≥ 4 tables described, ≥ 1 dimension, ≥ 3 measures,
 *                          ≥ 5 trusted_assets with passing SQL, no critical findings
 * - `ready_to_optimize` -- ≥ 1 table with ≥ 1 measure or trusted_asset,
 *                          no critical findings
 * - `not_ready`         -- anything else
 */
export function computeMaturityTier(
  space: SpaceJson,
  checks: CheckResult[],
): MaturityTier {
  const hasCriticalFailure = checks.some((c) => c.severity === "critical" && !c.passed);

  const tables = (space?.data_sources?.tables ?? []) as Array<{
    description?: unknown;
  }>;
  const tablesDescribed = tables.filter((t) => {
    const d = t.description;
    if (!d) return false;
    if (Array.isArray(d)) return d.some((s) => typeof s === "string" && s.trim().length > 0);
    return typeof d === "string" && d.trim().length > 0;
  }).length;

  const measures = (space?.instructions?.sql_snippets?.measures ?? []) as unknown[];
  const filters = (space?.instructions?.sql_snippets?.filters ?? []) as unknown[];
  const expressions = (space?.instructions?.sql_snippets?.expressions ?? []) as unknown[];
  const dimensions = expressions.length + filters.length;
  const trustedAssets = (space?.instructions?.example_question_sqls ?? []) as Array<{
    sql?: unknown;
  }>;
  const trustedAssetsWithSql = trustedAssets.filter((t) => {
    const sql = t.sql;
    if (Array.isArray(sql))
      return sql.some((s) => typeof s === "string" && s.trim().length > 0);
    return typeof sql === "string" && sql.trim().length > 0;
  }).length;

  if (
    !hasCriticalFailure &&
    tablesDescribed >= 4 &&
    dimensions >= 1 &&
    measures.length >= 3 &&
    trustedAssetsWithSql >= 5
  ) {
    return "trusted";
  }

  const minimallyConfigured =
    tables.length >= 1 && (measures.length >= 1 || trustedAssetsWithSql >= 1);
  if (!hasCriticalFailure && minimallyConfigured) {
    return "ready_to_optimize";
  }

  return "not_ready";
}

/**
 * Run the full health check against a parsed serialized space JSON.
 *
 * @param space - The parsed `serialized_space` JSON (v2 format)
 * @param overrides - Optional user overrides for built-in check thresholds
 * @param customChecks - Optional user-defined custom checks
 * @param categoryWeights - Optional category weight overrides (must sum to 100)
 */
export function runHealthCheck(
  space: SpaceJson,
  overrides?: UserCheckOverride[],
  customChecks?: UserCustomCheck[],
  categoryWeights?: Record<string, number>,
): SpaceHealthReport {
  const registry = resolveRegistry(overrides, customChecks, categoryWeights);

  clearPendingSqlQualityChecks();

  const results: CheckResult[] = [];
  for (const check of registry.checks) {
    if (check.enabled === false) continue;
    const result = runEvaluator(space, check);
    if (result) results.push(result);
  }

  const categories: Record<string, CategoryScore> = {};
  for (const [catId, catDef] of Object.entries(registry.categories)) {
    const catChecks = results.filter((r) => r.category === catId);
    const passed = catChecks.filter((r) => r.passed).length;
    const total = catChecks.length;
    categories[catId] = {
      label: catDef.label,
      weight: catDef.weight,
      score: total > 0 ? Math.round((passed / total) * 100) : 100,
      passed,
      total,
    };
  }

  const totalWeight = Object.values(categories).reduce((sum, c) => sum + c.weight, 0);
  const overallScore =
    totalWeight > 0
      ? Math.round(
          Object.values(categories).reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight,
        )
      : 0;

  const failedChecks = results.filter((r) => !r.passed);
  const fixableCount = failedChecks.filter((r) => r.fixable).length;

  const quickWins = failedChecks
    .map((r) => {
      const checkDef = registry.checks.find((c) => c.id === r.id);
      if (!checkDef?.quick_win) return null;
      return { text: checkDef.quick_win, severity: r.severity };
    })
    .filter((qw): qw is { text: string; severity: Severity } => qw != null)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .slice(0, MAX_QUICK_WINS)
    .map((qw) => qw.text);

  const findings: Finding[] = failedChecks
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .map((check) => {
      const checkDef = registry.checks.find((c) => c.id === check.id);
      const fixHint =
        check.fixable && check.fixStrategy
          ? ` (auto-fixable via ${check.fixStrategy.replace(/_/g, " ")})`
          : "";
      return {
        category: check.severity === "critical" ? ("warning" as const) : ("suggestion" as const),
        severity: check.severity,
        description: check.description + (check.detail ? `: ${check.detail}` : ""),
        recommendation:
          (checkDef?.quick_win ?? `Address the "${check.description}" check`) + fixHint,
        reference: check.id,
      };
    });

  return {
    overallScore,
    grade: computeGrade(overallScore),
    maturityTier: computeMaturityTier(space, results),
    categories,
    checks: results,
    quickWins,
    fixableCount,
    findings,
  };
}

/**
 * Resolve async SQL quality checks and merge results into an existing report.
 * Call after runHealthCheck() when the review endpoint is configured.
 * This mutates the report in place, updating check results and recalculating scores.
 */
export async function enrichReportWithSqlQuality(
  space: SpaceJson,
  report: SpaceHealthReport,
): Promise<SpaceHealthReport> {
  const asyncResults = await resolveSqlQualityChecks(space);
  if (asyncResults.length === 0) return report;

  for (const asyncResult of asyncResults) {
    const idx = report.checks.findIndex((c) => c.id === asyncResult.id);
    if (idx >= 0) {
      report.checks[idx] = asyncResult;
    } else {
      report.checks.push(asyncResult);
    }
  }

  // Recalculate category scores
  for (const [catId, catScore] of Object.entries(report.categories)) {
    const catChecks = report.checks.filter((r) => r.category === catId);
    const passed = catChecks.filter((r) => r.passed).length;
    const total = catChecks.length;
    catScore.passed = passed;
    catScore.total = total;
    catScore.score = total > 0 ? Math.round((passed / total) * 100) : 100;
  }

  // Recalculate overall score
  const totalWeight = Object.values(report.categories).reduce((sum, c) => sum + c.weight, 0);
  report.overallScore =
    totalWeight > 0
      ? Math.round(
          Object.values(report.categories).reduce((sum, c) => sum + c.score * c.weight, 0) /
            totalWeight,
        )
      : 0;
  report.grade = computeGrade(report.overallScore);
  report.maturityTier = computeMaturityTier(space, report.checks);

  return report;
}

/**
 * Enrich an in-memory copy of the space JSON with Unity Catalog descriptions
 * before scoring. Mirrors upstream `iq_scanner.enrich_with_uc_metadata`:
 * any table/column whose `description` is empty in the space but has a
 * non-empty `comment` in UC adopts that comment for scoring purposes.
 *
 * The returned object is a fresh deep copy -- the caller's space JSON is never
 * mutated, and any persisted serialized_space sent to the Genie API stays
 * untouched. UC metadata is opt-in: any error fetching it is swallowed and
 * the original space is returned.
 *
 * Use only for *scoring* (so a well-described UC table is not penalized for
 * an empty space-level description). Never persist the enriched copy back
 * to Genie -- that would mask the actual configuration drift.
 */
export async function enrichSpaceWithUcMetadata(
  space: SpaceJson,
  oboToken?: string,
): Promise<{ space: SpaceJson; tablesEnriched: number; columnsEnriched: number }> {
  void oboToken;

  const enriched = JSON.parse(JSON.stringify(space ?? {})) as SpaceJson;
  // The canonical `SerializedSpace` (see `lib/genie/types.ts`) stores the
  // table FQN as `identifier` and the column name as `column_name`. Earlier
  // payloads from external workspaces sometimes carry `path`/`name` instead,
  // so accept either spelling. Codex P2 caught this -- previously we only
  // looked for `path`/`name`, so UC enrichment was a no-op for any space
  // generated by Forge.
  const tables = (enriched.data_sources?.tables ?? []) as Array<{
    identifier?: string;
    path?: string;
    description?: unknown;
    column_configs?: Array<{
      column_name?: string;
      name?: string;
      description?: unknown;
    }>;
  }>;
  if (tables.length === 0) return { space: enriched, tablesEnriched: 0, columnsEnriched: 0 };

  const tableFqn = (t: (typeof tables)[number]): string => {
    const id = typeof t.identifier === "string" ? t.identifier.trim() : "";
    if (id) return id;
    const path = typeof t.path === "string" ? t.path.trim() : "";
    return path;
  };
  const colName = (c: NonNullable<(typeof tables)[number]["column_configs"]>[number]): string => {
    const n = typeof c.column_name === "string" ? c.column_name : c.name;
    return (n ?? "").toString().trim().toLowerCase();
  };

  const fqns = tables
    .map(tableFqn)
    .filter((f): f is string => f.length > 0);
  if (fqns.length === 0) return { space: enriched, tablesEnriched: 0, columnsEnriched: 0 };

  const isDescriptionEmpty = (d: unknown): boolean => {
    if (d == null) return true;
    if (Array.isArray(d)) {
      return !d.some((v) => typeof v === "string" && v.trim().length > 0);
    }
    if (typeof d === "string") return d.trim().length === 0;
    return true;
  };

  let tablesEnriched = 0;
  let columnsEnriched = 0;

  try {
    const catalogToFqns = new Map<string, string[]>();
    for (const f of fqns) {
      const cat = f.split(".")[0];
      if (!cat) continue;
      const list = catalogToFqns.get(cat) ?? [];
      list.push(f);
      catalogToFqns.set(cat, list);
    }

    const tableComments = new Map<string, string>();
    for (const cat of catalogToFqns.keys()) {
      try {
        const m = await fetchTableComments(cat);
        for (const [k, v] of m) tableComments.set(k, v);
      } catch (err) {
        logger.warn("[health] enrichSpaceWithUcMetadata table comments failed", {
          catalog: cat,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    let columns: Awaited<ReturnType<typeof fetchColumnsBatch>> = [];
    try {
      columns = await fetchColumnsBatch(fqns);
    } catch (err) {
      logger.warn("[health] enrichSpaceWithUcMetadata columns failed", {
        count: fqns.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const columnCommentsByTable = new Map<string, Map<string, string>>();
    for (const c of columns) {
      const fqn = c.tableFqn;
      if (!fqn) continue;
      const map = columnCommentsByTable.get(fqn) ?? new Map<string, string>();
      const cmt = (c.comment ?? "").trim();
      if (cmt) map.set(c.columnName.toLowerCase(), cmt);
      columnCommentsByTable.set(fqn, map);
    }

    for (const t of tables) {
      const fqn = tableFqn(t);
      if (!fqn) continue;
      const tableComment = tableComments.get(fqn);
      if (tableComment && isDescriptionEmpty(t.description)) {
        t.description = tableComment;
        tablesEnriched += 1;
      }
      const colMap = columnCommentsByTable.get(fqn);
      if (!colMap || !Array.isArray(t.column_configs)) continue;
      for (const col of t.column_configs) {
        if (!col) continue;
        const name = colName(col);
        if (!name) continue;
        const colComment = colMap.get(name);
        if (colComment && isDescriptionEmpty(col.description)) {
          col.description = colComment;
          columnsEnriched += 1;
        }
      }
    }
  } catch (err) {
    logger.warn("[health] enrichSpaceWithUcMetadata failed, returning original space", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { space: enriched, tablesEnriched, columnsEnriched };
}
