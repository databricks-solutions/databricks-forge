/**
 * Dashboard SQL Validation — EXPLAIN-based dry-run and metric view checks.
 *
 * Runs EXPLAIN on each dataset SQL to catch runtime planning errors
 * (bad column references, missing tables, syntax errors) that schema
 * allowlist validation alone cannot detect.
 *
 * Also provides deterministic validation that SQL querying metric views
 * uses the required MEASURE() syntax with aliases and GROUP BY.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import type { SqlExecutor } from "@/lib/ports/sql-executor";
import { normalizeThreePartFqn } from "@/lib/metric-views/parser";
import {
  safeSqlExecutorDiagnostic,
  type SafeSqlExecutorDiagnostic,
} from "./executor-diagnostic";

/**
 * Validate dashboard dataset SQL via EXPLAIN dry-run.
 * Returns null on success, or a bounded safe diagnostic on failure.
 */
export async function validateDatasetSql(
  sql: string,
  datasetName: string,
  sqlExecutor?: SqlExecutor,
): Promise<SafeSqlExecutorDiagnostic | null> {
  try {
    const explainSql = `EXPLAIN ${sql}`;
    if (sqlExecutor) {
      await sqlExecutor.execute(explainSql);
    } else {
      await executeSQL(explainSql);
    }
    return null;
  } catch (err) {
    const diagnostic = safeSqlExecutorDiagnostic(err);
    logger.warn("Dashboard SQL EXPLAIN failed", {
      dataset: datasetName,
      errorCategory: diagnostic.errorCategory,
      ...(diagnostic.errorCode ? { errorCode: diagnostic.errorCode } : {}),
      errorMessage: diagnostic.message,
    });
    return diagnostic;
  }
}

// ---------------------------------------------------------------------------
// Static GROUP BY Lint
// ---------------------------------------------------------------------------

const AGGREGATE_RE = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;
const GROUP_BY_RE = /\bGROUP\s+BY\b/i;
const HAVING_RE = /\bHAVING\b/i;

function outerSelectList(sql: string): string | null {
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  let word = "";
  let selectEnd = -1;

  const finishWord = (index: number): string | null => {
    const finished = word.toLowerCase();
    word = "";
    if (depth !== 0) return null;
    if (finished === "select") {
      selectEnd = index;
    } else if (finished === "from" && selectEnd >= 0) {
      return sql.slice(selectEnd, index - finished.length);
    }
    return null;
  };

  for (let index = 0; index <= sql.length; index += 1) {
    const char = sql[index] ?? " ";
    if (state !== "normal") {
      const delimiter = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === delimiter) {
        if (sql[index + 1] === delimiter) index += 1;
        else state = "normal";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const result = finishWord(index);
      if (result !== null) return result;
      state = char === "'" ? "single" : char === '"' ? "double" : "backtick";
    } else if (char === "(") {
      const result = finishWord(index);
      if (result !== null) return result;
      depth += 1;
    } else if (char === ")") {
      const result = finishWord(index);
      if (result !== null) return result;
      depth = Math.max(0, depth - 1);
    } else if (/[A-Za-z0-9_]/.test(char)) {
      word += char;
    } else {
      const result = finishWord(index);
      if (result !== null) return result;
    }
  }
  return selectEnd >= 0 ? sql.slice(selectEnd) : null;
}

function splitTopLevelExpressions(selectList: string): string[] {
  const expressions: string[] = [];
  let start = 0;
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  for (let index = 0; index < selectList.length; index += 1) {
    const char = selectList[index];
    if (state !== "normal") {
      const delimiter = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === delimiter) {
        if (selectList[index + 1] === delimiter) index += 1;
        else state = "normal";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      state = char === "'" ? "single" : char === '"' ? "double" : "backtick";
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      expressions.push(selectList.slice(start, index).trim());
      start = index + 1;
    }
  }
  expressions.push(selectList.slice(start).trim());
  return expressions.filter(Boolean);
}

/**
 * Heuristic check: if the outermost SELECT contains aggregate functions but
 * no GROUP BY clause, flag it. This catches CROSS JOIN + aggregate patterns
 * that EXPLAIN may miss or that appear at runtime.
 *
 * Returns a warning string if the issue is detected, null otherwise.
 */
export function lintMissingGroupBy(sql: string): string | null {
  if (!AGGREGATE_RE.test(sql)) return null;
  if (GROUP_BY_RE.test(sql)) return null;
  if (HAVING_RE.test(sql)) return null;
  const selectList = outerSelectList(sql);
  if (selectList) {
    const projections = splitTopLevelExpressions(selectList);
    if (
      projections.length > 0 &&
      projections.every((projection) => AGGREGATE_RE.test(projection))
    ) {
      return null;
    }
  }

  return (
    "SQL uses aggregate functions (COUNT/SUM/AVG/MIN/MAX) without GROUP BY. " +
    "Add GROUP BY for all non-aggregated columns or wrap non-aggregated values in an aggregate."
  );
}

// ---------------------------------------------------------------------------
// Metric View SQL Validation
// ---------------------------------------------------------------------------

export interface MetricViewValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Detect which metric view FQN (if any) is referenced in a SQL string's
 * FROM clause. Returns the FQN lowercased, or null if none found.
 */
function detectMetricViewInSql(sql: string, metricViewFqns: Set<string>): string | null {
  const upper = sql.replace(/`/g, "").toUpperCase();
  for (const fqn of metricViewFqns) {
    const fqnUpper = fqn.toUpperCase();
    const fromIdx = upper.indexOf(fqnUpper);
    if (fromIdx !== -1) return fqn;
  }
  return null;
}

/**
 * Validate that SQL querying a metric view follows the required syntax:
 *
 * 1. Measure columns must be wrapped in MEASURE(col) AS col
 * 2. Every MEASURE() call must have an explicit AS alias
 * 3. GROUP BY (or GROUP BY ALL) must be present
 * 4. No SELECT * on metric views
 *
 * Returns { valid: true, issues: [] } when no metric view is referenced
 * or all checks pass. Issues are descriptive strings for logging.
 */
export function validateMetricViewSql(
  sql: string,
  metricViewFqns: Set<string>,
  metricViewMeasures: Map<string, string[]>,
): MetricViewValidationResult {
  const issues: string[] = [];

  const matchedFqn = detectMetricViewInSql(sql, metricViewFqns);
  if (!matchedFqn) return { valid: true, issues: [] };

  const sqlUpper = sql.toUpperCase();

  // Check 1: No SELECT *
  if (/\bSELECT\s+\*/i.test(sql)) {
    issues.push("SELECT * is not supported on metric views");
  }

  // Check 2: GROUP BY must be present when dimensions accompany measures.
  const selectList = outerSelectList(sql);
  const hasNonMeasureProjection =
    selectList !== null &&
    splitTopLevelExpressions(selectList).some(
      (projection) => !/^\s*MEASURE\s*\(/i.test(projection),
    );
  if (hasNonMeasureProjection && !sqlUpper.includes("GROUP BY")) {
    issues.push("Missing GROUP BY (use GROUP BY ALL) when querying a metric view with MEASURE()");
  }

  // Check 3: Measure columns should appear inside MEASURE() calls with AS aliases
  const measures = metricViewMeasures.get(matchedFqn.toLowerCase()) ?? [];
  if (measures.length > 0) {
    const measureCallRegex = /\bMEASURE\s*\(\s*`?([a-zA-Z0-9_-]+)`?\s*\)/gi;
    const foundMeasureCalls = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = measureCallRegex.exec(sql)) !== null) {
      foundMeasureCalls.add(m[1].toLowerCase());
    }

    for (const measure of measures) {
      const measureLower = measure.toLowerCase();
      if (!foundMeasureCalls.has(measureLower)) {
        const escapedMeasure = measure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const bareRefRegex = new RegExp(`(?:\\b|\\\`)${escapedMeasure}(?:\\b|\\\`)`, "i");
        if (bareRefRegex.test(sql)) {
          issues.push(
            `Measure "${measure}" referenced without MEASURE() wrapper -- use MEASURE(${measure}) AS ${measure}`,
          );
        }
      }
    }

    // Check 4: Every MEASURE() call should have an AS alias
    const measureWithAliasRegex = /\bMEASURE\s*\([^)]+\)\s+AS\s+/gi;
    const aliasedCount = (sql.match(measureWithAliasRegex) ?? []).length;
    const totalMeasureCalls = foundMeasureCalls.size;
    if (totalMeasureCalls > 0 && aliasedCount < totalMeasureCalls) {
      issues.push(
        `${totalMeasureCalls - aliasedCount} MEASURE() call(s) missing AS alias -- use MEASURE(col) AS col`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

function normalizedIdentifier(value: string): string {
  return value.replace(/`/g, "").trim().toLowerCase();
}

function incrementCount(counts: Map<string, number>, name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function validateExactNames(
  kind: "measure" | "dimension",
  requested: Set<string>,
  observed: Map<string, number>,
  issues: string[],
): void {
  for (const name of requested) {
    const count = observed.get(name) ?? 0;
    if (count !== 1) {
      issues.push(`Reviewed SQL must project required ${kind} "${name}" exactly once`);
    }
  }
  for (const name of observed.keys()) {
    if (!requested.has(name)) {
      issues.push(`Reviewed SQL added unrequested ${kind} "${name}"`);
    }
  }
}

function splitTopLevelSelectFrom(
  sql: string,
): { selectList: string; fromTail: string } | null {
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  let wordStart = -1;
  let selectEnd = -1;
  let firstTopLevelWord: string | null = null;

  const finishWord = (end: number): { selectList: string; fromTail: string } | null => {
    if (wordStart < 0) return null;
    const start = wordStart;
    const word = sql.slice(start, end).toLowerCase();
    wordStart = -1;
    if (depth !== 0) return null;
    firstTopLevelWord ??= word;
    if (firstTopLevelWord !== "select") return null;
    if (word === "select" && selectEnd < 0) {
      selectEnd = end;
    } else if (word === "from" && selectEnd >= 0) {
      return {
        selectList: sql.slice(selectEnd, start),
        fromTail: sql.slice(end),
      };
    }
    return null;
  };

  for (let index = 0; index <= sql.length; index += 1) {
    const char = sql[index] ?? " ";
    if (state !== "normal") {
      const delimiter = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === delimiter) {
        if (sql[index + 1] === delimiter) index += 1;
        else state = "normal";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const result = finishWord(index);
      if (result) return result;
      state = char === "'" ? "single" : char === '"' ? "double" : "backtick";
    } else if (char === "(") {
      const result = finishWord(index);
      if (result) return result;
      depth += 1;
    } else if (char === ")") {
      const result = finishWord(index);
      if (result) return result;
      depth -= 1;
      if (depth < 0) return null;
    } else if (/[A-Za-z0-9_]/.test(char)) {
      if (wordStart < 0) wordStart = index;
    } else {
      const result = finishWord(index);
      if (result) return result;
    }
  }
  return null;
}

function containsSqlComment(sql: string): boolean {
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (state !== "normal") {
      const delimiter = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === delimiter) {
        if (next === delimiter) index += 1;
        else state = "normal";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      state = char === "'" ? "single" : char === '"' ? "double" : "backtick";
    } else if ((char === "-" && next === "-") || (char === "/" && next === "*")) {
      return true;
    }
  }
  return false;
}

export function validateSelectedMetricViewBinding(
  sql: string,
  binding: {
    fqn: string;
    measureNames: string[];
    dimensionNames: string[];
    limit?: number;
  },
): MetricViewValidationResult {
  const issues: string[] = [];
  const statement = sql.trim();
  const maxLimit = binding.limit ?? 1000;
  if (containsSqlComment(statement)) {
    issues.push("Reviewed metric SQL must not contain comments");
  }
  if (statement.includes(";")) {
    issues.push("Reviewed metric SQL must contain exactly one statement without semicolons");
  }
  if (!/^SELECT\b/i.test(statement)) {
    issues.push("Reviewed metric SQL must start with SELECT");
  }
  if (issues.length > 0) return { valid: false, issues };

  const selectParts = splitTopLevelSelectFrom(statement);
  if (!selectParts) {
    return {
      valid: false,
      issues: ["Reviewed metric SQL must match SELECT ... FROM ... LIMIT ..."],
    };
  }

  const identifierPattern = "`?[a-zA-Z0-9_-]+`?";
  const fqnPattern = `${identifierPattern}\\s*\\.\\s*${identifierPattern}\\s*\\.\\s*${identifierPattern}`;
  const tailPattern = new RegExp(
    `^\\s*(${fqnPattern})(?:\\s+(GROUP\\s+BY\\s+ALL))?\\s+LIMIT\\s+([0-9]+)\\s*$`,
    "i",
  );
  const tailMatch = selectParts.fromTail.match(tailPattern);
  if (!tailMatch) {
    return {
      valid: false,
      issues: [
        "Reviewed metric SQL FROM clause must contain only the selected three-part FQN, optional GROUP BY ALL, and a literal LIMIT",
      ],
    };
  }

  const selectedFqn = normalizeThreePartFqn(binding.fqn);
  const reviewedFqn = normalizeThreePartFqn(tailMatch[1].replace(/\s*\.\s*/g, "."));
  if (!selectedFqn || !reviewedFqn || reviewedFqn.toLowerCase() !== selectedFqn.toLowerCase()) {
    issues.push(
      `Reviewed SQL must reference exactly the selected metric view FQN "${binding.fqn}"`,
    );
  }

  const hasGroupByAll = tailMatch[2] !== undefined;
  const requestedMeasures = new Set(binding.measureNames.map(normalizedIdentifier));
  const requestedDimensions = new Set(binding.dimensionNames.map(normalizedIdentifier));
  if (requestedDimensions.size > 0 && !hasGroupByAll) {
    issues.push("Reviewed metric SQL requires GROUP BY ALL when dimensions are requested");
  }
  if (requestedDimensions.size === 0 && hasGroupByAll) {
    issues.push("Reviewed metric SQL must not use GROUP BY ALL without dimensions");
  }

  const parsedLimit = Number(tailMatch[3]);
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit <= 0 ||
    !Number.isSafeInteger(maxLimit) ||
    maxLimit <= 0 ||
    parsedLimit > maxLimit
  ) {
    issues.push(`Reviewed metric SQL LIMIT must be an integer from 1 through ${maxLimit}`);
  }

  const observedMeasures = new Map<string, number>();
  const observedDimensions = new Map<string, number>();
  const outputAliases = new Map<string, number>();
  const projections = splitTopLevelExpressions(selectParts.selectList);
  for (const projection of projections) {
    const measure = projection.match(
      /^\s*MEASURE\s*\(\s*`?([a-zA-Z0-9_-]+)`?\s*\)\s+AS\s+`?([a-zA-Z0-9_-]+)`?\s*$/i,
    );
    if (measure) {
      const name = normalizedIdentifier(measure[1]);
      const alias = normalizedIdentifier(measure[2]);
      incrementCount(observedMeasures, name);
      incrementCount(outputAliases, alias);
      if (name !== alias) {
        issues.push(`Reviewed metric SQL measure "${name}" must use the same output alias`);
      }
      continue;
    }

    const dimension = projection.match(
      /^\s*`?([a-zA-Z0-9_-]+)`?(?:\s+AS\s+`?([a-zA-Z0-9_-]+)`?)?\s*$/i,
    );
    if (dimension) {
      const name = normalizedIdentifier(dimension[1]);
      const alias = normalizedIdentifier(dimension[2] ?? dimension[1]);
      incrementCount(observedDimensions, name);
      incrementCount(outputAliases, alias);
      if (name !== alias) {
        issues.push(`Reviewed metric SQL dimension "${name}" must use the same output alias`);
      }
      continue;
    }

    issues.push(`Reviewed metric SQL contains unsupported projection "${projection}"`);
  }
  if (projections.length === 0) {
    issues.push("Reviewed metric SQL must contain explicit projections");
  }
  for (const [alias, count] of outputAliases) {
    if (count !== 1) {
      issues.push(`Reviewed metric SQL contains duplicate normalized output alias "${alias}"`);
    }
  }
  validateExactNames("measure", requestedMeasures, observedMeasures, issues);
  validateExactNames("dimension", requestedDimensions, observedDimensions, issues);

  return { valid: issues.length === 0, issues };
}
