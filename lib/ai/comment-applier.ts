/**
 * DDL execution for applying / undoing AI-generated comments to Unity Catalog.
 *
 * Handles:
 * - Permission pre-checks via SHOW GRANTS
 * - Table comments via COMMENT ON TABLE
 * - Column comments via ALTER TABLE ... ALTER COLUMN ... COMMENT (Delta only)
 * - Column comments via ALTER VIEW ... ALTER COLUMN ... COMMENT (views)
 * - Batched execution with concurrency control
 * - Per-proposal error tracking
 */

import { executeSQL } from "@/lib/dbx/sql";
import { validateFqn, validateIdentifier } from "@/lib/validation";
import {
  markProposalsApplied,
  markProposalFailed,
  markProposalsUndone,
  type CommentProposal,
} from "@/lib/lakebase/comment-proposals";
import { updateCommentJobStatus } from "@/lib/lakebase/comment-jobs";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { logger } from "@/lib/logger";

const APPLY_CONCURRENCY = 5;

/** Table types that support ALTER COLUMN COMMENT. */
const COLUMN_COMMENT_SUPPORTED_TYPES = new Set(["MANAGED", "EXTERNAL", "DELTA"]);
const VIEW_TYPES = new Set(["VIEW", "MATERIALIZED_VIEW"]);

// ---------------------------------------------------------------------------
// Permission checking
// ---------------------------------------------------------------------------

export interface PermissionResult {
  canModify: boolean;
  grants: string[];
  error?: string;
}

/**
 * Check whether the current user/SP has MODIFY permission on each table.
 * Uses SHOW GRANTS ON TABLE, falling back gracefully if SHOW GRANTS
 * is not accessible (e.g., on some workspace configurations).
 */
export async function checkPermissions(
  tableFqns: string[],
): Promise<Record<string, PermissionResult>> {
  const results: Record<string, PermissionResult> = {};

  for (const fqn of tableFqns) {
    try {
      const safeFqn = validateFqn(fqn, "table");
      const parts = safeFqn.split(".");
      const quotedFqn = parts.map((p) => `\`${p}\``).join(".");

      const resp = await executeSQL(`SHOW GRANTS ON TABLE ${quotedFqn}`);
      const grants = resp.rows.map((row) => row.join(" | "));
      const hasModify = resp.rows.some((row) =>
        row.some(
          (cell) =>
            cell.toUpperCase().includes("MODIFY") ||
            cell.toUpperCase().includes("ALL_PRIVILEGES") ||
            cell.toUpperCase().includes("ALL PRIVILEGES") ||
            cell.toUpperCase().includes("OWN"),
        ),
      );

      results[fqn] = { canModify: hasModify, grants };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("INSUFFICIENT_PERMISSIONS") || msg.includes("does not exist")) {
        results[fqn] = { canModify: false, grants: [], error: msg };
      } else {
        // SHOW GRANTS may not be accessible; assume permission exists
        // and let the actual ALTER fail if not
        results[fqn] = { canModify: true, grants: [], error: `Could not verify: ${msg}` };
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// DDL builders (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Multi-word SQL statement patterns that should never appear in a catalog
 * comment. Single words like "drop" or "delete" are allowed since they
 * can appear in legitimate business descriptions (e.g. "customer drop-off
 * rate", "soft delete flag").
 */
const DANGEROUS_SQL_PATTERNS = [
  /\bDROP\s+(TABLE|VIEW|SCHEMA|DATABASE|CATALOG|COLUMN|FUNCTION|INDEX)\b/i,
  /\bTRUNCATE\s+(TABLE)?\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
  /\bALTER\s+(TABLE|VIEW|SCHEMA|DATABASE|CATALOG)\b/i,
  /\bCREATE\s+(TABLE|VIEW|SCHEMA|DATABASE|FUNCTION|INDEX)\b/i,
  /\bGRANT\s+\S+\s+ON\b/i,
  /\bREVOKE\s+\S+\s+(ON|FROM)\b/i,
  /\bEXEC(UTE)?\s*\(/i,
  /\bCALL\s+\S+\s*\(/i,
  /;\s*(DROP|TRUNCATE|DELETE|INSERT|UPDATE|ALTER|CREATE|GRANT|REVOKE)\b/i,
];

/**
 * Validate that comment text does not contain destructive SQL patterns.
 * Throws if a dangerous pattern is detected.
 */
export function validateCommentText(comment: string): void {
  for (const pattern of DANGEROUS_SQL_PATTERNS) {
    if (pattern.test(comment)) {
      throw new Error(
        `Comment contains a disallowed SQL pattern: "${comment.match(pattern)?.[0]}". ` +
          "Comments must be plain descriptive text, not SQL statements.",
      );
    }
  }
}

/**
 * Escape a comment string for safe interpolation into a SQL string literal.
 *
 * Databricks SQL uses ANSI-standard single-quote doubling ('') as the only
 * escape inside string literals. Backslashes are literal characters, not
 * escape prefixes. We double single quotes and also strip NUL bytes and
 * control characters (U+0000-U+001F except tab/newline) as defense-in-depth.
 *
 * Also rejects comments containing destructive SQL statement patterns.
 */
export function escapeComment(comment: string): string {
  if (comment.length > 4000) {
    throw new Error("Comment exceeds maximum length (4000 characters)");
  }
  validateCommentText(comment);
  // Strip NUL and control characters except \t \n \r
  const sanitized = comment.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return sanitized.replace(/'/g, "''");
}

function quoteFqn(fqn: string): string {
  return validateFqn(fqn, "table")
    .split(".")
    .map((p) => `\`${p}\``)
    .join(".");
}

export function buildTableCommentDDL(fqn: string, comment: string | null): string {
  const quoted = quoteFqn(fqn);
  if (comment === null) {
    return `COMMENT ON TABLE ${quoted} IS NULL`;
  }
  return `COMMENT ON TABLE ${quoted} IS '${escapeComment(comment)}'`;
}

/**
 * Build column-level comment DDL. Uses ALTER VIEW for views.
 *
 * @param tableType - UC table type (e.g. "MANAGED", "EXTERNAL", "VIEW").
 *                    When undefined, defaults to ALTER TABLE.
 */
export function buildColumnCommentDDL(
  fqn: string,
  columnName: string,
  comment: string | null,
  tableType?: string,
): string {
  const quoted = quoteFqn(fqn);
  const safeCol = validateIdentifier(columnName, "column");
  const keyword = tableType && VIEW_TYPES.has(tableType.toUpperCase()) ? "VIEW" : "TABLE";
  const escapedComment = comment === null ? "''" : `'${escapeComment(comment)}'`;
  return `ALTER ${keyword} ${quoted} ALTER COLUMN \`${safeCol}\` COMMENT ${escapedComment}`;
}

/**
 * Build a single ALTER TABLE/VIEW statement that sets comments on multiple
 * columns at once, e.g.:
 *
 *   ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN
 *     `col1` COMMENT 'desc1',
 *     `col2` COMMENT 'desc2';
 *
 * One DDL = one Delta metadata transaction = no DELTA_METADATA_CHANGED conflict.
 */
export function buildBatchColumnCommentDDL(
  fqn: string,
  columns: Array<{ columnName: string; comment: string | null }>,
  tableType?: string,
): string {
  if (columns.length === 0) throw new Error("No columns to update");
  if (columns.length === 1) {
    return buildColumnCommentDDL(fqn, columns[0].columnName, columns[0].comment, tableType);
  }

  const quoted = quoteFqn(fqn);
  const keyword = tableType && VIEW_TYPES.has(tableType.toUpperCase()) ? "VIEW" : "TABLE";

  const clauses = columns.map((c) => {
    const safeCol = validateIdentifier(c.columnName, "column");
    const escapedComment = c.comment === null ? "''" : `'${escapeComment(c.comment)}'`;
    return `\`${safeCol}\` COMMENT ${escapedComment}`;
  });

  return `ALTER ${keyword} ${quoted} ALTER COLUMN ${clauses.join(", ")}`;
}

/**
 * Returns true if column-level comments are supported for the given table type.
 * Column comments require Delta Lake tables or views with column mapping enabled.
 */
export function supportsColumnComments(tableType?: string | null): boolean {
  if (!tableType) return true; // optimistic default
  const upper = tableType.toUpperCase();
  return COLUMN_COMMENT_SUPPORTED_TYPES.has(upper) || VIEW_TYPES.has(upper);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group proposals by tableFqn, preserving insertion order. */
function groupByTable(proposals: CommentProposal[]): Map<string, CommentProposal[]> {
  const map = new Map<string, CommentProposal[]>();
  for (const p of proposals) {
    let arr = map.get(p.tableFqn);
    if (!arr) {
      arr = [];
      map.set(p.tableFqn, arr);
    }
    arr.push(p);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Apply proposals
// ---------------------------------------------------------------------------

export interface ApplyResult {
  applied: number;
  failed: number;
  skipped: number;
  errors: Array<{ proposalId: string; tableFqn: string; columnName: string | null; error: string }>;
}

/**
 * Apply accepted proposals as DDL statements to Unity Catalog.
 *
 * Groups proposals by table so all column comments for a single table are
 * applied in one `ALTER TABLE ... ALTER COLUMN col1 COMMENT '...', col2 ...`
 * statement. This avoids DELTA_METADATA_CHANGED conflicts from concurrent
 * metadata writes to the same table. Tables are processed in parallel.
 *
 * @param tableTypes - optional map of FQN -> table type for correct DDL generation
 */
export async function applyProposals(
  jobId: string,
  proposals: CommentProposal[],
  tableTypes?: Map<string, string>,
  onProgress?: (applied: number, total: number) => void,
): Promise<ApplyResult> {
  await updateCommentJobStatus(jobId, "applying");

  const result: ApplyResult = { applied: 0, failed: 0, skipped: 0, errors: [] };
  let completed = 0;
  const total = proposals.length;

  const tableGroups = groupByTable(proposals);

  await mapWithConcurrency(
    Array.from(tableGroups.entries()).map(([tableFqn, tableProposals]) => async () => {
      const tblType = tableTypes?.get(tableFqn.toLowerCase());

      // --- 1. Table-level comment (always a separate COMMENT ON TABLE) ---
      const tableProposal = tableProposals.find((p) => !p.columnName);
      if (tableProposal) {
        const comment = tableProposal.editedComment ?? tableProposal.proposedComment;
        try {
          await executeSQL(buildTableCommentDDL(tableFqn, comment));
          await markProposalsApplied([tableProposal.id]);
          result.applied++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed++;
          result.errors.push({
            proposalId: tableProposal.id,
            tableFqn,
            columnName: null,
            error: msg,
          });
          await markProposalFailed(tableProposal.id, msg).catch(() => {});
        }
        completed++;
        onProgress?.(completed, total);
      }

      // --- 2. Column-level comments (batched into one ALTER TABLE) ---
      const columnProposals = tableProposals.filter((p) => p.columnName);
      if (columnProposals.length === 0) return;

      // Check table type support
      const unsupported = !supportsColumnComments(tblType);
      if (unsupported) {
        for (const p of columnProposals) {
          const msg = `Column comments not supported for ${tblType ?? "unknown"} table type`;
          result.skipped++;
          result.errors.push({ proposalId: p.id, tableFqn, columnName: p.columnName, error: msg });
          await markProposalFailed(p.id, msg).catch(() => {});
          completed++;
        }
        onProgress?.(completed, total);
        return;
      }

      // Build batched DDL
      const columns = columnProposals.map((p) => ({
        columnName: p.columnName!,
        comment: p.editedComment ?? p.proposedComment,
      }));

      try {
        const ddl = buildBatchColumnCommentDDL(tableFqn, columns, tblType);
        await executeSQL(ddl);

        // All succeeded
        await markProposalsApplied(columnProposals.map((p) => p.id));
        result.applied += columnProposals.length;
        completed += columnProposals.length;
        onProgress?.(completed, total);
      } catch (batchErr) {
        // Batched DDL failed -- fall back to per-column sequential execution
        logger.warn("[comment-applier] Batched column DDL failed, falling back to per-column", {
          tableFqn,
          error: batchErr instanceof Error ? batchErr.message : String(batchErr),
        });

        for (const p of columnProposals) {
          const comment = p.editedComment ?? p.proposedComment;
          try {
            const ddl = buildColumnCommentDDL(tableFqn, p.columnName!, comment, tblType);
            await executeSQL(ddl);
            await markProposalsApplied([p.id]);
            result.applied++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.failed++;
            result.errors.push({
              proposalId: p.id,
              tableFqn,
              columnName: p.columnName,
              error: msg,
            });
            await markProposalFailed(p.id, msg).catch(() => {});
          }
          completed++;
          onProgress?.(completed, total);
        }
      }
    }),
    APPLY_CONCURRENCY,
  );

  const finalStatus = result.failed === 0 && result.skipped === 0 ? "completed" : "ready";
  await updateCommentJobStatus(jobId, finalStatus, {
    appliedCount: result.applied,
    errorMessage: result.failed > 0 ? `${result.failed} proposals failed to apply` : undefined,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Undo proposals
// ---------------------------------------------------------------------------

/**
 * Undo previously applied proposals by restoring original comments.
 *
 * Uses the same group-by-table + batched DDL strategy as applyProposals
 * to avoid DELTA_METADATA_CHANGED conflicts.
 */
export async function undoProposals(
  jobId: string,
  proposals: CommentProposal[],
  tableTypes?: Map<string, string>,
  onProgress?: (undone: number, total: number) => void,
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, failed: 0, skipped: 0, errors: [] };
  let completed = 0;
  const total = proposals.length;

  const tableGroups = groupByTable(proposals);

  await mapWithConcurrency(
    Array.from(tableGroups.entries()).map(([tableFqn, tableProposals]) => async () => {
      const tblType = tableTypes?.get(tableFqn.toLowerCase());

      // --- 1. Table-level comment ---
      const tableProposal = tableProposals.find((p) => !p.columnName);
      if (tableProposal) {
        try {
          await executeSQL(buildTableCommentDDL(tableFqn, tableProposal.originalComment));
          await markProposalsUndone([tableProposal.id]);
          result.applied++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed++;
          result.errors.push({
            proposalId: tableProposal.id,
            tableFqn,
            columnName: null,
            error: msg,
          });
        }
        completed++;
        onProgress?.(completed, total);
      }

      // --- 2. Column-level comments (batched) ---
      const columnProposals = tableProposals.filter((p) => p.columnName);
      if (columnProposals.length === 0) return;

      const columns = columnProposals.map((p) => ({
        columnName: p.columnName!,
        comment: p.originalComment,
      }));

      try {
        const ddl = buildBatchColumnCommentDDL(tableFqn, columns, tblType);
        await executeSQL(ddl);
        await markProposalsUndone(columnProposals.map((p) => p.id));
        result.applied += columnProposals.length;
        completed += columnProposals.length;
        onProgress?.(completed, total);
      } catch (batchErr) {
        logger.warn("[comment-applier] Batched undo DDL failed, falling back to per-column", {
          tableFqn,
          error: batchErr instanceof Error ? batchErr.message : String(batchErr),
        });

        for (const p of columnProposals) {
          try {
            const ddl = buildColumnCommentDDL(tableFqn, p.columnName!, p.originalComment, tblType);
            await executeSQL(ddl);
            await markProposalsUndone([p.id]);
            result.applied++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.failed++;
            result.errors.push({
              proposalId: p.id,
              tableFqn,
              columnName: p.columnName,
              error: msg,
            });
          }
          completed++;
          onProgress?.(completed, total);
        }
      }
    }),
    APPLY_CONCURRENCY,
  );

  return result;
}
