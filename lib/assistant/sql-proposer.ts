/**
 * SQL proposer for the Ask Forge assistant.
 *
 * CRITICAL CONSTRAINT: This is a thin wrapper that delegates to the existing
 * SQL generation engine. It does NOT define new SQL prompts. All SQL quality
 * comes from:
 *   - USE_CASE_SQL_GEN_PROMPT template (lib/ai/templates.ts)
 *   - DATABRICKS_SQL_RULES (lib/ai/sql-rules.ts)
 *   - cleanSqlResponse + attemptSqlFix (lib/pipeline/steps/sql-generation.ts)
 *
 * The assistant's LLM response may already include SQL in markdown code blocks.
 * This module handles the "Run SQL" and "Fix SQL" flows after the user clicks
 * those CTAs.
 */

import { executeSQL, type SqlResult } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";

export interface SqlExecutionResult {
  success: boolean;
  result?: SqlResult;
  error?: string;
  durationMs: number;
}

const WRITE_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|CALL|EXEC|EXECUTE|USE|MSCK|OPTIMIZE|VACUUM|COPY)\b/i;

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
}

function hasMultipleStatements(sql: string): boolean {
  const normalized = stripSqlComments(sql).replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const withoutTrailing = normalized.replace(/;+\s*$/, "");
  return withoutTrailing.includes(";");
}

export function validateReadOnlySql(sql: string): string | null {
  const normalized = stripSqlComments(sql);
  if (!normalized) return "SQL statement is empty.";
  if (hasMultipleStatements(normalized)) {
    return "Only a single SQL statement is allowed.";
  }
  const upper = normalized.toUpperCase();
  const startsReadOnly = upper.startsWith("SELECT") || upper.startsWith("WITH");
  if (!startsReadOnly) {
    return "Only read-only SELECT queries are allowed from Ask Forge.";
  }
  if (WRITE_SQL_RE.test(upper)) {
    return "Detected non-read-only SQL keywords in the statement.";
  }
  return null;
}

/**
 * Execute SQL proposed by the assistant against the configured warehouse.
 * Wraps executeSQL with error handling and timing.
 */
export async function executeSql(sql: string): Promise<SqlExecutionResult> {
  const start = Date.now();
  try {
    const readOnlyError = validateReadOnlySql(sql);
    if (readOnlyError) {
      return {
        success: false,
        error: readOnlyError,
        durationMs: Date.now() - start,
      };
    }

    const result = await executeSQL(sql, undefined, undefined, {
      waitTimeout: "30s",
    });
    return {
      success: true,
      result,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[assistant/sql] Execution failed", { error: msg });
    return {
      success: false,
      error: msg,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Validate SQL by running EXPLAIN (dry-run).
 */
export async function validateSql(sql: string): Promise<string | null> {
  const readOnlyError = validateReadOnlySql(sql);
  if (readOnlyError) return readOnlyError;

  try {
    await executeSQL(`EXPLAIN ${sql}`);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Extract SQL code blocks from a markdown response.
 */
export function extractSqlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```sql\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const sql = match[1].trim();
    if (sql) blocks.push(sql);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Column resolution error detection
// ---------------------------------------------------------------------------

const COLUMN_ERROR_PATTERNS = [
  /UNRESOLVED_COLUMN/i,
  /cannot be resolved/i,
  /Column .+ not found/i,
  /AnalysisException.*column/i,
];

export function isColumnResolutionError(error: string): boolean {
  return COLUMN_ERROR_PATTERNS.some((p) => p.test(error));
}

/**
 * Build a fix prompt for SQL that failed with a column resolution error.
 * Includes the exact error message and the correct column schema so the
 * LLM can self-correct.
 */
export function buildSqlFixPrompt(
  sql: string,
  error: string,
  knownColumns: Array<{ tableFqn: string; name: string; dataType: string }>,
): string {
  const colsByTable = new Map<string, string[]>();
  for (const col of knownColumns) {
    const list = colsByTable.get(col.tableFqn) ?? [];
    const quoted = /^\w+$/.test(col.name) ? col.name : `\`${col.name}\``;
    list.push(`${quoted} (${col.dataType})`);
    colsByTable.set(col.tableFqn, list);
  }

  const schemaLines = Array.from(colsByTable.entries())
    .map(([fqn, cols]) => `### ${fqn}\n${cols.map((c) => `  - ${c}`).join("\n")}`)
    .join("\n\n");

  return `The following SQL failed execution. Fix it using ONLY the columns listed below.

## Error
${error}

## Failing SQL
\`\`\`sql
${sql}
\`\`\`

## AVAILABLE COLUMNS (USE ONLY THESE -- NO OTHER COLUMNS EXIST)
${schemaLines}

## Rules
- Use column names EXACTLY as shown above, including spaces and casing.
- Backtick-quote column names with spaces: \`Net Cash Flow\`, \`Account ID\`.
- NEVER invent, guess, or transform column names.
- Return ONLY the corrected SQL in a \`\`\`sql code block. No explanation.`;
}
