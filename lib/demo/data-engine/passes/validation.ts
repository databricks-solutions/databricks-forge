/**
 * Data Engine Pass 4: Validation
 *
 * Runs validation queries per table: row counts, FK integrity, date
 * coverage / freshness, and distribution checks. No LLM calls -- pure SQL.
 */

import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import type { SqlExecutor } from "@/lib/ports/sql-executor";
import type { Logger } from "@/lib/ports/logger";
import type {
  TableColumn,
  TableDesign,
  ValidationResult,
  ValidationSummary,
} from "../../types";
import type { DemoDateWindow } from "../date-window";

/** Max number of days MIN(date) is allowed to predate the window start. */
const MAX_START_DRIFT_DAYS = 30;
/** MAX(date) older than this many days => stale / out-of-date. */
const MAX_STALE_DAYS = 30;

const VALIDATION_CONCURRENCY = 6;

/**
 * Heuristically pick the primary date/timestamp column on a fact table.
 * Preference order:
 *   1. `role === "timestamp"` columns (ideal signal from schema design)
 *   2. DATE-typed columns with a transactional name (order_date, event_date, ...)
 *   3. Any DATE/TIMESTAMP column other than created_at/updated_at
 *   4. created_at / updated_at as a last resort
 */
function pickPrimaryDateColumn(table: TableDesign): TableColumn | null {
  if (table.tableType !== "fact") return null;

  const dateLike = (c: TableColumn) => {
    const t = c.dataType.toUpperCase();
    return t.startsWith("DATE") || t.startsWith("TIMESTAMP");
  };

  const timestamps = table.columns.filter((c) => c.role === "timestamp" && dateLike(c));
  if (timestamps.length > 0) {
    const audit = new Set(["created_at", "updated_at"]);
    const nonAudit = timestamps.find((c) => !audit.has(c.name));
    return nonAudit ?? timestamps[0];
  }

  const transactional = table.columns.find(
    (c) => dateLike(c) && /(date|at|ts|timestamp)$/i.test(c.name),
  );
  if (transactional) return transactional;

  const audit = new Set(["created_at", "updated_at"]);
  const anyDate = table.columns.find((c) => dateLike(c) && !audit.has(c.name));
  if (anyDate) return anyDate;

  return table.columns.find((c) => dateLike(c)) ?? null;
}

/** Add `days` to an ISO date string (YYYY-MM-DD) and return the result. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ts = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 24 * 60 * 60 * 1000;
  const nd = new Date(ts);
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function runValidation(
  tables: TableDesign[],
  catalog: string,
  schema: string,
  dateWindow: DemoDateWindow,
  opts: {
    sql: SqlExecutor;
    logger: Logger;
  },
): Promise<ValidationSummary> {
  const { sql, logger: log } = opts;

  const minAllowedStart = addDays(dateWindow.startDate, -MAX_START_DRIFT_DAYS);
  const maxStaleThreshold = addDays(dateWindow.endDate, -MAX_STALE_DAYS);

  const validateTable = async (table: TableDesign): Promise<ValidationResult> => {
    const fqn = `\`${catalog}\`.\`${schema}\`.\`${table.name}\``;
    const result: ValidationResult = {
      tableName: table.name,
      rowCount: 0,
      fkIntegrity: { valid: true, orphanCount: 0 },
      distributionQuality: "good",
      issues: [],
    };

    try {
      const count = await sql.executeScalar<string>(`SELECT COUNT(*) FROM ${fqn}`);
      result.rowCount = parseInt(count ?? "0", 10);

      if (result.rowCount === 0) {
        result.issues.push("Table is empty");
      } else if (result.rowCount < table.rowTarget * 0.5) {
        result.issues.push(
          `Row count ${result.rowCount} is below 50% of target ${table.rowTarget}`,
        );
      }
    } catch (err) {
      result.issues.push(`Row count check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const fkColumns = table.columns.filter((c) => c.role === "fk" && c.fkTarget);
    for (const col of fkColumns) {
      if (!col.fkTarget) continue;
      const [refTable, refCol] = col.fkTarget.split(".");
      if (!refTable || !refCol) continue;

      const refFqn = `\`${catalog}\`.\`${schema}\`.\`${refTable}\``;
      try {
        const orphanCount = await sql.executeScalar<string>(
          `SELECT COUNT(*) FROM ${fqn} t LEFT JOIN ${refFqn} r ON t.\`${col.name}\` = r.\`${refCol}\` WHERE r.\`${refCol}\` IS NULL AND t.\`${col.name}\` IS NOT NULL`,
        );
        const orphans = parseInt(orphanCount ?? "0", 10);
        if (orphans > 0) {
          result.fkIntegrity = { valid: false, orphanCount: orphans };
          result.issues.push(
            `${orphans} orphan FK values in ${col.name} -> ${col.fkTarget}`,
          );
        }
      } catch {
        // FK check failed -- non-fatal
      }
    }

    // -------------------------------------------------------------------
    // Date freshness (fact tables only, when they have a date column
    // and at least one row).
    // -------------------------------------------------------------------
    const primaryDateCol = pickPrimaryDateColumn(table);
    if (primaryDateCol && result.rowCount > 0) {
      try {
        const rows = await sql.executeMapped(
          `SELECT CAST(MIN(\`${primaryDateCol.name}\`) AS STRING) AS min_date,
                  CAST(MAX(\`${primaryDateCol.name}\`) AS STRING) AS max_date,
                  CAST(COUNT_IF(\`${primaryDateCol.name}\` >= DATE_SUB(CURRENT_DATE(), 90)) AS STRING) AS rows_last_90d
           FROM ${fqn}`,
          (row) => ({
            minDate: row[0] ?? "",
            maxDate: row[1] ?? "",
            rowsLast90d: Number(row[2] ?? 0),
          }),
        );

        const row = rows.length > 0 ? rows[0] : null;
        if (row && row.minDate && row.maxDate) {
          // Some drivers return TIMESTAMP literals; trim to the date portion.
          const minDate = row.minDate.slice(0, 10);
          const maxDate = row.maxDate.slice(0, 10);
          const rowsLast90d = row.rowsLast90d;

          const predateWindow = minDate < minAllowedStart;
          const stalemax = maxDate < maxStaleThreshold;
          const stale = predateWindow || stalemax;

          result.dateCoverage = {
            columnName: primaryDateCol.name,
            minDate,
            maxDate,
            rowsLast90d,
            stale,
          };

          if (predateWindow) {
            result.issues.push(
              `Dates predate demo window (MIN=${minDate}, window start ${dateWindow.startDate})`,
            );
          }
          if (stalemax) {
            result.issues.push(
              `No data in the last ${MAX_STALE_DAYS} days (MAX=${maxDate}) -- window is stale`,
            );
          }
          if (rowsLast90d === 0 && result.rowCount > 0) {
            result.issues.push("No rows in the last 90 days -- YTD coverage is thin");
          }
        }
      } catch (err) {
        log.warn("Date coverage check failed (non-fatal)", {
          table: table.name,
          column: primaryDateCol.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.issues.length > 0) {
      result.distributionQuality = result.issues.length > 2 ? "poor" : "acceptable";
    }

    return result;
  };

  const results = await mapWithConcurrency(
    tables.map((t) => () => validateTable(t)),
    VALIDATION_CONCURRENCY,
  );
  const issues: string[] = [];
  for (const result of results) {
    issues.push(...result.issues.map((i) => `${result.tableName}: ${i}`));
  }

  const summary: ValidationSummary = {
    totalTables: tables.length,
    passedTables: results.filter((r) => r.issues.length === 0).length,
    totalRows: results.reduce((sum, r) => sum + r.rowCount, 0),
    issues,
    results,
  };

  log.info("Validation complete", {
    totalTables: summary.totalTables,
    passedTables: summary.passedTables,
    totalRows: summary.totalRows,
    issues: summary.issues.length,
    stale: results.filter((r) => r.dateCoverage?.stale).length,
  });

  return summary;
}
