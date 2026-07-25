/**
 * Schema Scanner -- scans a Unity Catalog schema, profiles data, and uses
 * LLM table selection to build the input for the ad-hoc Genie Engine.
 *
 * Powers the "Create from Schema" flow in Genie Studio.
 */

import { executeSQL, type SqlResult } from "@/lib/dbx/sql";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { parseLLMJson } from "@/lib/genie/passes/parse-llm-json";
import { resolveEndpoint } from "@/lib/dbx/client";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScannedTable {
  fqn: string;
  tableName: string;
  tableType: string;
  comment: string | null;
  columnCount: number;
  rowCount: number | null;
}

export interface ScannedColumn {
  tableFqn: string;
  columnName: string;
  dataType: string;
  comment: string | null;
  isNullable: boolean;
  ordinalPosition: number;
}

export interface DataProfile {
  tableFqn: string;
  columnName: string;
  distinctCount: number | null;
  nullRate: number | null;
  minValue: string | null;
  maxValue: string | null;
  sampleValues: string[];
}

export interface SchemaScanResult {
  catalog: string;
  schema: string;
  tables: ScannedTable[];
  columns: ScannedColumn[];
  profiles: DataProfile[];
  totalTableCount: number;
  totalColumnCount: number;
  scannedAt: string;
}

export interface TableSelectionResult {
  selectedTables: string[];
  reasoning: string;
  suggestedTitle: string;
  suggestedDomain: string;
  businessContext: string;
}

// ---------------------------------------------------------------------------
// Schema scanning
// ---------------------------------------------------------------------------

export async function scanSchema(
  catalog: string,
  schema: string,
  excludePatterns: string[] = [],
): Promise<SchemaScanResult> {
  logger.info("Scanning schema", { catalog, schema });

  const tablesSql = `
    SELECT table_name, table_type, comment
    FROM ${catalog}.information_schema.tables
    WHERE table_schema = '${schema}'
      AND table_catalog = '${catalog}'
    ORDER BY table_name
  `;
  const tablesResult = await executeSQL(tablesSql);

  let tables: ScannedTable[] = tablesResult.rows.map((row) => ({
    fqn: `${catalog}.${schema}.${row[0]}`,
    tableName: row[0],
    tableType: row[1] ?? "TABLE",
    comment: row[2] || null,
    columnCount: 0,
    rowCount: null,
  }));

  if (excludePatterns.length > 0) {
    tables = tables.filter((t) => {
      const name = t.tableName.toLowerCase();
      return !excludePatterns.some((p) => {
        const pattern = p.toLowerCase().replace(/%/g, ".*");
        return new RegExp(`^${pattern}$`).test(name);
      });
    });
  }

  // Phantom table filtering: cross-check information_schema with SHOW TABLES
  try {
    const showResult = await executeSQL(`SHOW TABLES IN ${catalog}.${schema}`);
    const liveNames = new Set(showResult.rows.map((r) => String(r[1] ?? r[0] ?? "").toLowerCase()));
    if (liveNames.size > 0) {
      const before = tables.length;
      tables = tables.filter((t) => liveNames.has(t.tableName.toLowerCase()));
      const removed = before - tables.length;
      if (removed > 0) {
        logger.info("Phantom table filtering removed stale entries", {
          removed,
          catalog,
          schema,
        });
      }
    }
  } catch (err) {
    logger.warn("Phantom table filtering skipped (SHOW TABLES failed)", {
      error: String(err),
    });
  }

  if (tables.length === 0) {
    return {
      catalog,
      schema,
      tables: [],
      columns: [],
      profiles: [],
      totalTableCount: 0,
      totalColumnCount: 0,
      scannedAt: new Date().toISOString(),
    };
  }

  const columnsSql = `
    SELECT table_name, column_name, full_data_type, comment, is_nullable, ordinal_position
    FROM ${catalog}.information_schema.columns
    WHERE table_schema = '${schema}'
      AND table_catalog = '${catalog}'
    ORDER BY table_name, ordinal_position
  `;
  const columnsResult = await executeSQL(columnsSql);

  const tableSet = new Set(tables.map((t) => t.tableName.toLowerCase()));
  const columns: ScannedColumn[] = columnsResult.rows
    .filter((row) => tableSet.has(row[0].toLowerCase()))
    .map((row) => ({
      tableFqn: `${catalog}.${schema}.${row[0]}`,
      columnName: row[1],
      dataType: row[2] ?? "STRING",
      comment: row[3] || null,
      isNullable: row[4] === "YES",
      ordinalPosition: parseInt(row[5]) || 0,
    }));

  const colCountByTable = new Map<string, number>();
  for (const col of columns) {
    colCountByTable.set(col.tableFqn, (colCountByTable.get(col.tableFqn) ?? 0) + 1);
  }
  for (const t of tables) {
    t.columnCount = colCountByTable.get(t.fqn) ?? 0;
  }

  logger.info("Schema scan complete", {
    catalog,
    schema,
    tableCount: tables.length,
    columnCount: columns.length,
  });

  return {
    catalog,
    schema,
    tables,
    columns,
    profiles: [],
    totalTableCount: tables.length,
    totalColumnCount: columns.length,
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Data profiling (lightweight -- samples key columns)
// ---------------------------------------------------------------------------

export async function profileKeyColumns(
  scan: SchemaScanResult,
  maxTablesForProfiling = 15,
): Promise<DataProfile[]> {
  const tablesToProfile = scan.tables.slice(0, maxTablesForProfiling);

  const tableProfiles = await mapWithConcurrency(
    tablesToProfile.map((table) => async (): Promise<DataProfile[]> => {
      const keyCols = scan.columns
        .filter((c) => c.tableFqn === table.fqn)
        .filter((c) => {
          const lower = c.columnName.toLowerCase();
          const type = c.dataType.toLowerCase();
          return (
            lower.endsWith("_status") ||
            lower.endsWith("_type") ||
            lower.endsWith("_code") ||
            lower.endsWith("_category") ||
            lower.endsWith("_name") ||
            lower === "status" ||
            lower === "type" ||
            lower === "category" ||
            type.includes("date") ||
            type.includes("timestamp")
          );
        })
        .slice(0, 5);

      if (keyCols.length === 0) return [];

      const profileClauses = keyCols.map((c) => {
        const col = `\`${c.columnName}\``;
        return `
        STRUCT(
          '${c.columnName}' AS column_name,
          CAST(APPROX_COUNT_DISTINCT(${col}) AS STRING) AS distinct_count,
          CAST(ROUND(SUM(CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS STRING) AS null_pct,
          CAST(MIN(${col}) AS STRING) AS min_val,
          CAST(MAX(${col}) AS STRING) AS max_val
        )`;
      });

      try {
        const sql = `
        SELECT ${profileClauses.join(",\n       ")}
        FROM ${table.fqn}
      `;
        const result: SqlResult = await executeSQL(sql, undefined, undefined, {
          waitTimeout: "15s",
          submitTimeoutMs: 20_000,
        });

        const out: DataProfile[] = [];
        if (result.rows.length > 0) {
          for (let ci = 0; ci < keyCols.length; ci++) {
            const raw = result.rows[0][ci];
            if (!raw) continue;

            let parsed: Record<string, string>;
            try {
              parsed = typeof raw === "string" ? JSON.parse(raw.replace(/'/g, '"')) : raw;
            } catch {
              continue;
            }

            out.push({
              tableFqn: table.fqn,
              columnName: keyCols[ci].columnName,
              distinctCount: parseInt(parsed.distinct_count) || null,
              nullRate: parseFloat(parsed.null_pct) || null,
              minValue: parsed.min_val || null,
              maxValue: parsed.max_val || null,
              sampleValues: [],
            });
          }
        }
        return out;
      } catch (err) {
        logger.warn("Profiling failed for table (non-fatal)", {
          table: table.fqn,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    }),
    5,
  );

  return tableProfiles.flat();
}

// ---------------------------------------------------------------------------
// LLM table selection
// ---------------------------------------------------------------------------

export async function selectTablesWithLLM(
  scan: SchemaScanResult,
  userHint?: string,
): Promise<TableSelectionResult> {
  const tableDescriptions = scan.tables
    .map((t) => {
      const cols = scan.columns
        .filter((c) => c.tableFqn === t.fqn)
        .slice(0, 15)
        .map((c) => `${c.columnName} (${c.dataType})${c.comment ? ` -- ${c.comment}` : ""}`)
        .join(", ");
      return `- ${t.fqn} [${t.columnCount} cols]${t.comment ? ` -- ${t.comment}` : ""}\n  Columns: ${cols}`;
    })
    .join("\n");

  const profileSummary =
    scan.profiles.length > 0
      ? `\n\nData Profile Highlights:\n${scan.profiles
          .filter((p) => p.distinctCount !== null && p.distinctCount <= 50)
          .slice(0, 20)
          .map(
            (p) =>
              `- ${p.tableFqn}.${p.columnName}: ${p.distinctCount} distinct values, range: ${p.minValue ?? "?"} to ${p.maxValue ?? "?"}`,
          )
          .join("\n")}`
      : "";

  const messages = [
    {
      role: "system" as const,
      content: `You are a data analytics expert. Select the 5-25 most analytically valuable tables from a Unity Catalog schema for a Databricks Genie Space.

Prioritize:
1. Fact/transaction tables (orders, events, sessions, transactions)
2. Key dimension tables (customers, products, locations, dates)
3. Tables with business-relevant columns (amounts, statuses, dates, categories)

Exclude:
- System/audit/log tables (unless analytics-relevant)
- Staging/temp tables
- Tables with <3 columns
- Duplicate/backup tables

Return JSON:
{
  "selectedTables": ["catalog.schema.table1", ...],
  "reasoning": "Brief explanation of selection strategy",
  "suggestedTitle": "Descriptive title for the Genie Space (max 60 chars)",
  "suggestedDomain": "Business domain (e.g., Sales, HR, Finance)",
  "businessContext": "2-3 sentence description of the business domain and analytics potential"
}`,
    },
    {
      role: "user" as const,
      content: `Schema: ${scan.catalog}.${scan.schema} (${scan.tables.length} tables, ${scan.totalColumnCount} columns)
${userHint ? `\nUser hint: ${userHint}` : ""}

Tables:
${tableDescriptions}${profileSummary}

Select the most valuable tables for analytics.`,
    },
  ];

  try {
    const result = await cachedChatCompletion({
      endpoint: resolveEndpoint("classification"),
      messages,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: "json_object",
    });

    const parsed = parseLLMJson(result.content ?? "", "schema-table-selection") as Record<
      string,
      unknown
    >;

    const selectedTables = Array.isArray(parsed.selectedTables)
      ? (parsed.selectedTables as string[]).filter((t) =>
          scan.tables.some((st) => st.fqn.toLowerCase() === t.toLowerCase()),
        )
      : scan.tables.slice(0, 10).map((t) => t.fqn);

    return {
      selectedTables,
      reasoning: String(parsed.reasoning ?? ""),
      suggestedTitle: String(parsed.suggestedTitle ?? `${scan.schema} Analytics`),
      suggestedDomain: String(parsed.suggestedDomain ?? "Analytics"),
      businessContext: String(parsed.businessContext ?? ""),
    };
  } catch (err) {
    logger.warn("LLM table selection failed, using heuristic fallback", {
      error: err instanceof Error ? err.message : String(err),
    });

    const selected = scan.tables
      .filter((t) => t.columnCount >= 3 && t.tableType !== "VIEW")
      .sort((a, b) => (b.columnCount ?? 0) - (a.columnCount ?? 0))
      .slice(0, 15)
      .map((t) => t.fqn);

    return {
      selectedTables: selected,
      reasoning: "Heuristic selection: largest tables with 3+ columns",
      suggestedTitle: `${scan.schema} Analytics`,
      suggestedDomain: "Analytics",
      businessContext: "",
    };
  }
}

// ---------------------------------------------------------------------------
// Sample Row Extraction (Gap 9)
// ---------------------------------------------------------------------------

export interface SampleRowResult {
  tableFqn: string;
  columns: string[];
  rows: string[][];
}

/**
 * Fetch sample rows from tables for LLM context enrichment.
 * This function respects the caller's decision to sample -- it should only
 * be called when `sampleRowsPerTable > 0` has been checked upstream.
 */
export async function sampleTableRows(
  tableFqns: string[],
  limit = 20,
  maxTables = 15,
): Promise<SampleRowResult[]> {
  const toSample = tableFqns.slice(0, maxTables);

  const results = await mapWithConcurrency(
    toSample.map((fqn) => async (): Promise<SampleRowResult | null> => {
      try {
        const sql = `SELECT * FROM ${fqn} LIMIT ${limit}`;
        const result = await executeSQL(sql, undefined, undefined, {
          waitTimeout: "10s",
          submitTimeoutMs: 15_000,
        });
        if (result.rows.length > 0) {
          return {
            tableFqn: fqn,
            columns: result.columns.map((c) => c.name),
            rows: result.rows.slice(0, limit),
          };
        }
      } catch (err) {
        logger.warn("Sample row fetch failed (non-fatal)", {
          table: fqn,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }),
    5,
  );

  return results.filter((r): r is SampleRowResult => r !== null);
}

/**
 * Build a compact markdown block of sample data for LLM prompt inclusion.
 * Truncates per-table to keep total within budget.
 */
export function buildSampleDataBlock(samples: SampleRowResult[], maxChars = 4000): string {
  if (samples.length === 0) return "";
  const perTable = Math.floor(maxChars / samples.length);
  const lines: string[] = ["### SAMPLE DATA VALUES\n"];

  for (const s of samples) {
    const tableLines: string[] = [`**${s.tableFqn}** (${s.rows.length} rows):`];
    tableLines.push(`| ${s.columns.join(" | ")} |`);
    tableLines.push(`| ${s.columns.map(() => "---").join(" | ")} |`);
    for (const row of s.rows.slice(0, 5)) {
      tableLines.push(`| ${row.join(" | ")} |`);
    }
    const tableBlock = tableLines.join("\n");
    if (tableBlock.length > perTable) {
      lines.push(tableBlock.slice(0, perTable) + "...\n");
    } else {
      lines.push(tableBlock + "\n");
    }
  }

  return lines.join("\n").slice(0, maxChars);
}
