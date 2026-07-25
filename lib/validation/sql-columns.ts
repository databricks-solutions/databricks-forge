/**
 * Shared SQL column-reference validation.
 *
 * Extracts `alias.column` references (both plain and backtick-quoted) from
 * generated SQL and validates them against a known-columns set. Used by the
 * pipeline SQL generation step, the Genie schema-allowlist, the dashboard
 * engines, and the Ask Forge assistant to catch hallucinated column names
 * before SQL reaches execution.
 *
 * Design: this module owns alias/CTE detection and column-reference
 * extraction. Consumers keep their own structural checks (e.g. pipeline
 * checks SQL start keyword; Genie checks 3/4-part FQNs).
 */

import { SQL_KEYWORDS } from "@/lib/genie/schema-allowlist";

export { SQL_KEYWORDS };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnReference {
  prefix: string;
  column: string;
  position: number;
  isQuoted: boolean;
}

export interface SqlAliases {
  tableAliases: Set<string>;
  columnAliases: Set<string>;
  cteNames: Set<string>;
  /** Table aliases that point to a CTE rather than a real table (e.g. `FROM my_cte mc` → `mc`). */
  cteAliases: Set<string>;
  all: Set<string>;
}

export interface SqlColumnValidationResult {
  valid: boolean;
  unknownColumns: string[];
  warnings: string[];
}

export interface ValidateColumnOptions {
  tablesInvolved?: string[];
  allowAiFunctionFields?: boolean;
}

// ---------------------------------------------------------------------------
// AI function return fields
// ---------------------------------------------------------------------------

/**
 * Known struct fields returned by `ai_query()` when `failOnError => false`.
 * These are runtime struct fields, not table columns, so they must be
 * allowlisted to avoid false-positive hallucination flags.
 *
 * Includes:
 * - `result` / `errormessage`: direct fields from the ai_query return struct
 * - `parsed_result`: common alias for `from_json(ai_result.result, ...)` output
 */
export const AI_FUNCTION_RETURN_FIELDS = new Set([
  "result",
  "errormessage",
  "parsed_result",
  "ai_result",
]);

// ---------------------------------------------------------------------------
// Comment and string-literal stripping
// ---------------------------------------------------------------------------

/**
 * Strip SQL comments to prevent false positives from prose text.
 * Removes `-- line comments` and `/* block comments *​/`.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Replace SQL string literals with empty strings to prevent false-positive
 * column-reference matches on prose inside CONCAT(), ai_query prompts, etc.
 * Handles escaped single quotes (`''`) inside literals.
 */
export function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

// ---------------------------------------------------------------------------
// Alias / CTE extraction
// ---------------------------------------------------------------------------

/**
 * Extract all SQL aliases (table aliases, column aliases, CTE names) from
 * a SQL string. Detects both plain identifiers and backtick-quoted aliases
 * (e.g. `` AS `Age Group` ``).
 */
export function extractSqlAliases(sql: string): SqlAliases {
  const normalizedSql = sql.replace(/`/g, "");
  const tableAliases = new Set<string>();
  const columnAliases = new Set<string>();
  const cteNames = new Set<string>();
  const cteAliases = new Set<string>();

  // Table aliases: FROM/JOIN <fqn> [AS] <alias>
  const tableAliasPattern = /(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?([a-z_]\w*)/gi;
  let m: RegExpExecArray | null;
  while ((m = tableAliasPattern.exec(normalizedSql)) !== null) {
    tableAliases.add(m[1].toLowerCase());
  }

  // Column aliases (plain): AS <alias>
  const colAliasPattern = /\bAS\s+([a-z_]\w*)/gi;
  while ((m = colAliasPattern.exec(normalizedSql)) !== null) {
    columnAliases.add(m[1].toLowerCase());
  }

  // Column aliases (backtick-quoted): AS `Alias With Spaces`
  // Must run on original SQL before backtick stripping.
  const quotedAliasPattern = /\bAS\s+`([^`]+)`/gi;
  while ((m = quotedAliasPattern.exec(sql)) !== null) {
    columnAliases.add(m[1].toLowerCase());
  }

  // Implicit column aliases (without AS): `) alias,` or `) alias\n`
  // Catches patterns like `COUNT(*) total_count,` or `SUM(x) revenue`
  const implicitAliasPattern = /\)\s+([a-z_]\w*)(?:\s*[,\n])/gi;
  while ((m = implicitAliasPattern.exec(normalizedSql)) !== null) {
    const candidate = m[1].toLowerCase();
    if (!SQL_KEYWORDS.has(candidate)) {
      columnAliases.add(candidate);
    }
  }

  // CTE names: WITH cte_name AS ( and chained , cte_name AS (
  const ctePattern = /\bWITH\s+([a-z_]\w*)\s+AS\s*\(/gi;
  while ((m = ctePattern.exec(normalizedSql)) !== null) {
    cteNames.add(m[1].toLowerCase());
  }
  const chainedCtePattern = /,\s*([a-z_]\w*)\s+AS\s*\(/gi;
  while ((m = chainedCtePattern.exec(normalizedSql)) !== null) {
    cteNames.add(m[1].toLowerCase());
  }

  // CTE-derived aliases: FROM/JOIN <cte_name> [AS] <alias>
  // Identifies table aliases that point to CTEs rather than real tables.
  const fromCtePattern = /(?:FROM|JOIN)\s+([a-z_]\w*)\s+(?:AS\s+)?([a-z_]\w*)/gi;
  while ((m = fromCtePattern.exec(normalizedSql)) !== null) {
    if (cteNames.has(m[1].toLowerCase())) {
      cteAliases.add(m[2].toLowerCase());
    }
  }

  const all = new Set([...tableAliases, ...columnAliases, ...cteNames, ...cteAliases]);
  return { tableAliases, columnAliases, cteNames, cteAliases, all };
}

// ---------------------------------------------------------------------------
// Column reference extraction
// ---------------------------------------------------------------------------

/**
 * Extract all `alias.column` references from SQL, both plain identifiers
 * and backtick-quoted identifiers (e.g. `alias.\`Column Name\``).
 *
 * Strips SQL comments first to avoid false positives from prose text
 * (e.g. `-- e.g. some example` would otherwise match as prefix=e, col=g).
 * Runs against the original SQL (before backtick stripping) so that
 * backtick-quoted column names with spaces are captured correctly.
 */
export function extractColumnReferences(sql: string): ColumnReference[] {
  const cleanSql = stripStringLiterals(stripSqlComments(sql));
  const refs: ColumnReference[] = [];

  // Plain: alias.column_name
  const plainRegex = /\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = plainRegex.exec(cleanSql)) !== null) {
    refs.push({
      prefix: m[1],
      column: m[2],
      position: m.index,
      isQuoted: false,
    });
  }

  // Backtick-quoted: alias.`column with spaces`
  const quotedRegex = /\b([a-zA-Z_]\w*)\.`([^`]+)`/g;
  while ((m = quotedRegex.exec(cleanSql)) !== null) {
    refs.push({
      prefix: m[1],
      column: m[2],
      position: m.index,
      isQuoted: true,
    });
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validate column references in SQL against a set of known column names.
 *
 * Extracts all `alias.column` references, filters out SQL keywords, FQN
 * parts, known aliases/CTEs, and optionally AI function return fields,
 * then flags any column that does not appear in `knownColumns`.
 *
 * @param sql          The generated SQL string (original, with backticks)
 * @param knownColumns Set of valid column names (lowercased)
 * @param options      Additional filtering options
 */
export function validateColumnReferences(
  sql: string,
  knownColumns: Set<string>,
  options: ValidateColumnOptions = {},
): SqlColumnValidationResult {
  const { tablesInvolved = [], allowAiFunctionFields = false } = options;
  const warnings: string[] = [];

  // Build exclusion sets
  const fqnParts = new Set<string>();
  for (const fqn of tablesInvolved) {
    for (const part of fqn.replace(/`/g, "").split(".")) {
      fqnParts.add(part.toLowerCase());
    }
  }

  const aliases = extractSqlAliases(sql);
  const refs = extractColumnReferences(sql);

  const unknownCols: string[] = [];

  for (const ref of refs) {
    const colLower = ref.column.toLowerCase();
    const prefixLower = ref.prefix.toLowerCase();

    // Skip SQL keywords used as prefix or column
    if (SQL_KEYWORDS.has(colLower) || SQL_KEYWORDS.has(prefixLower)) continue;

    // Skip FQN parts (catalog, schema, table name fragments)
    if (fqnParts.has(colLower)) continue;

    // Skip references where the prefix is a CTE or CTE-derived alias --
    // CTE columns are user-defined in the query and cannot be validated
    // against source table schemas.
    if (aliases.cteNames.has(prefixLower) || aliases.cteAliases.has(prefixLower)) continue;

    // Skip references where the prefix is a column alias (struct field
    // access). This handles from_json() output aliases -- e.g.
    // `from_json(ai_result.result, 'STRUCT<...>') AS parsed_result` makes
    // `parsed_result.field` valid. We exclude table aliases and CTE names
    // to avoid accidentally skipping real table-column references.
    if (
      aliases.columnAliases.has(prefixLower) &&
      !aliases.tableAliases.has(prefixLower) &&
      !aliases.cteNames.has(prefixLower)
    )
      continue;

    // Skip known aliases and CTE names used as column references
    if (aliases.all.has(colLower)) continue;

    // Skip AI function return fields when enabled
    if (allowAiFunctionFields && AI_FUNCTION_RETURN_FIELDS.has(colLower)) continue;

    // Skip if column exists in the known set
    if (knownColumns.has(colLower)) continue;

    const display = ref.isQuoted
      ? `${ref.prefix}.\`${ref.column}\``
      : `${ref.prefix}.${ref.column}`;
    unknownCols.push(display);
  }

  const dedupedUnknown = [...new Set(unknownCols)];
  if (dedupedUnknown.length > 0) {
    warnings.push(`SQL references unknown columns: ${dedupedUnknown.slice(0, 10).join(", ")}`);
  }

  return {
    valid: dedupedUnknown.length === 0,
    unknownColumns: dedupedUnknown,
    warnings,
  };
}
