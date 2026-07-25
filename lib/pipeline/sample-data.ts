/**
 * Shared sample-data fetching for pipeline steps.
 *
 * Used by both use-case generation (Step 4) and SQL generation (Step 7) to
 * pull a small number of rows from each table and format them as markdown
 * for prompt injection. Helps the LLM understand actual data values, formats,
 * and cardinality.
 *
 * Gracefully falls back to metadata-only when the user lacks SELECT
 * permission on a table -- the table is skipped and a warning is logged.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import type { SampleDataCache, SampleDataEntry } from "@/lib/genie/types";
import type { ColumnInfo } from "@/lib/domain/types";
import { selectRepresentativeColumns, type ColumnScoreOptions } from "@/lib/toolkit/column-budget";

export interface SampleDataResult {
  /** Formatted markdown section ready for prompt injection (empty string if nothing sampled) */
  markdown: string;
  /** Structured raw data keyed by table FQN for downstream analysis (entity extraction, etc.) */
  structured: SampleDataCache;
  /** Number of tables successfully sampled */
  tablesSampled: number;
  /** Number of tables skipped (permission errors, empty tables) */
  tablesSkipped: number;
  /** Total rows fetched across all tables */
  totalRows: number;
}

export interface SampleAuditContext {
  runId?: string;
  userEmail?: string | null;
  step?: string;
}

export interface SampleDataOptions {
  /** Max columns to include in SELECT. 0 = unlimited (SELECT *). */
  maxSampleColumns?: number;
  /** Column metadata keyed by table FQN, used for intelligent column selection. */
  columnsByTable?: Map<string, ColumnInfo[]>;
  /** Scoring context for intelligent column selection. */
  columnScoreOptions?: ColumnScoreOptions;
}

/**
 * Fetch sample rows from each table and format as markdown tables for
 * prompt injection. Returns both the formatted markdown and stats about
 * what was sampled.
 *
 * When `maxSampleColumns` is set, selects only the most representative
 * columns instead of `SELECT *`, preventing token budget blowout on
 * wide tables (100-1200+ columns).
 */
export async function fetchSampleData(
  tableFqns: string[],
  rowLimit: number,
  auditContext?: SampleAuditContext,
  sampleOptions?: SampleDataOptions,
): Promise<SampleDataResult> {
  const sections: string[] = [
    "### SAMPLE DATA (real rows from the tables -- use this to understand data formats, values, and join keys)\n",
  ];
  const structured: SampleDataCache = new Map();

  let tablesSampled = 0;
  let tablesSkipped = 0;
  let totalRows = 0;

  const maxCols = sampleOptions?.maxSampleColumns ?? 0;

  const results = await Promise.allSettled(
    tableFqns.map(async (fqn) => {
      const cleanFqn = fqn.replace(/`/g, "");
      const escapedFqn = `\`${cleanFqn.split(".").join("\`.\`")}\``;

      let selectClause = "*";
      if (maxCols > 0 && sampleOptions?.columnsByTable) {
        const tableCols = sampleOptions.columnsByTable.get(cleanFqn);
        if (tableCols && tableCols.length > maxCols) {
          const { selected } = selectRepresentativeColumns(
            tableCols,
            maxCols,
            sampleOptions.columnScoreOptions,
          );
          selectClause = selected.map((c) => `\`${c.columnName}\``).join(", ");
        }
      }

      const result = await executeSQL(
        `SELECT ${selectClause} FROM ${escapedFqn} LIMIT ${rowLimit}`,
      );

      if (!result.columns || result.columns.length === 0 || result.rows.length === 0) {
        return {
          fqn: cleanFqn,
          markdown: `**${cleanFqn}**: (empty table)\n`,
          rowCount: 0,
          entry: null,
        };
      }

      const colNames = result.columns.map((c) => c.name);
      const colTypes = result.columns.map((c) => c.typeName ?? "STRING");
      const header = `| ${colNames.join(" | ")} |`;
      const separator = `| ${colNames.map(() => "---").join(" | ")} |`;
      const rows = result.rows.map((row) => {
        const cells = row.map((val) => {
          if (val === null || val === undefined) return "NULL";
          const s = String(val);
          return s.length > 60 ? s.substring(0, 57) + "..." : s;
        });
        return `| ${cells.join(" | ")} |`;
      });

      const markdown = `**${cleanFqn}** (${result.rows.length} sample rows):\n${header}\n${separator}\n${rows.join("\n")}\n`;

      const entry: SampleDataEntry = {
        columns: colNames,
        columnTypes: colTypes,
        rows: result.rows,
      };

      return { fqn: cleanFqn, markdown, rowCount: result.rows.length, entry };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      sections.push(r.value.markdown);
      if (r.value.rowCount > 0) {
        tablesSampled++;
        totalRows += r.value.rowCount;
        if (r.value.entry) {
          structured.set(r.value.fqn, r.value.entry);
        }
      } else {
        tablesSkipped++;
      }
    } else {
      tablesSkipped++;
      const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const isPermission =
        errMsg.includes("INSUFFICIENT_PERMISSIONS") ||
        errMsg.includes("does not have SELECT") ||
        errMsg.includes("ACCESS_DENIED");
      logger.warn("Data sampling failed for table, falling back to metadata only", {
        table: tableFqns[i],
        reason: isPermission ? "insufficient SELECT permission" : errMsg,
      });
    }
  }

  if (tablesSkipped > 0) {
    logger.info(
      `Data sampling: ${tablesSampled}/${tableFqns.length} tables sampled, ${tablesSkipped} skipped (falling back to metadata only for those)`,
    );
  }

  if (tablesSampled > 0) {
    const sampledFqns = [...structured.keys()];
    logger.info("Audit: tables sampled", {
      runId: auditContext?.runId ?? "unknown",
      userEmail: auditContext?.userEmail ?? "unknown",
      step: auditContext?.step ?? "unknown",
      tablesSampled,
      tablesSkipped,
      totalRows,
      tables: sampledFqns,
    });
  }

  return {
    markdown: sections.length > 1 ? sections.join("\n") : "",
    structured,
    tablesSampled,
    tablesSkipped,
    totalRows,
  };
}
