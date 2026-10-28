/**
 * Enrichment queries for deep metadata extraction.
 *
 * DESCRIBE DETAIL, DESCRIBE HISTORY, SHOW TBLPROPERTIES, tags, and
 * system table queries. All queries use the SQL Statement Execution API
 * and include graceful fallback on permission errors.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { validateIdentifier } from "@/lib/validation";
import { logger } from "@/lib/logger";
import type { TableDetail, TableHistorySummary, TableTag, ColumnTag } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// DESCRIBE DETAIL
// ---------------------------------------------------------------------------

/**
 * Run DESCRIBE DETAIL on a table and map to TableDetail.
 * Returns null on permission errors or if the table doesn't exist.
 */
export async function describeDetail(
  tableFqn: string,
  discoveredVia: "selected" | "lineage" = "selected",
): Promise<TableDetail | null> {
  const [catalog, schema, table] = splitFqn(tableFqn);
  const safeCat = validateIdentifier(catalog, "catalog");
  const safeSch = validateIdentifier(schema, "schema");
  const safeTbl = validateIdentifier(table, "table");
  const sql = `DESCRIBE DETAIL \`${safeCat}\`.\`${safeSch}\`.\`${safeTbl}\``;

  try {
    const result = await executeSQL(sql);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const col = (name: string): string | null => {
      const idx = result.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
      return idx >= 0 ? (row[idx] ?? null) : null;
    };

    const location = col("location");
    const partitionCols = col("partitionColumns") ?? col("partition_columns");
    const clusteringCols = col("clusteringColumns") ?? col("clustering_columns");

    return {
      catalog,
      schema,
      tableName: table,
      fqn: tableFqn,
      tableType: col("format") ?? "UNKNOWN",
      comment: null, // filled later from information_schema
      sizeInBytes: parseIntSafe(col("sizeInBytes") ?? col("size_in_bytes")),
      numFiles: parseIntSafe(col("numFiles") ?? col("num_files")),
      numRows: null, // populated later from DESCRIBE TABLE EXTENDED Statistics
      format: col("format"),
      partitionColumns: parseStringArray(partitionCols),
      clusteringColumns: parseStringArray(clusteringCols),
      location,
      owner: col("owner"),
      provider: col("provider"),
      isManaged: location
        ? !location.startsWith("s3://") &&
          !location.startsWith("gs://") &&
          !location.startsWith("abfss://")
        : true,
      deltaMinReaderVersion: parseIntSafe(col("minReaderVersion") ?? col("min_reader_version")),
      deltaMinWriterVersion: parseIntSafe(col("minWriterVersion") ?? col("min_writer_version")),
      createdAt: col("createdAt") ?? col("created_at"),
      lastModified: col("lastModified") ?? col("last_modified"),
      tableProperties: {},
      createdBy: null,
      lastAccess: null,
      isManagedLocation: null,
      discoveredVia,
      dataDomain: null,
      dataSubdomain: null,
      dataTier: null,
      generatedDescription: null,
      sensitivityLevel: null,
      governancePriority: null,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("EXPECT_TABLE_NOT_VIEW") || msg.includes("is a view")) {
      logger.debug("[metadata-detail] Skipping DESCRIBE DETAIL for view", { tableFqn });
      return null;
    }
    if (
      msg.includes("INSUFFICIENT_PERMISSIONS") ||
      msg.includes("does not exist") ||
      msg.includes("(403)") ||
      msg.includes("(404)")
    ) {
      logger.warn("[metadata-detail] Permission denied for DESCRIBE DETAIL", { tableFqn });
      return null;
    }
    logger.error("[metadata-detail] DESCRIBE DETAIL failed", { tableFqn, error: msg });
    return null;
  }
}

/**
 * Create a minimal TableDetail for a table/view where DESCRIBE DETAIL returned null.
 * Ensures views and inaccessible tables still appear in the estate.
 */
export function createFallbackDetail(
  fqn: string,
  discoveredVia: "selected" | "lineage",
  tableType = "VIEW",
): TableDetail {
  const [catalog, schema, tableName] = splitFqn(fqn);
  return {
    catalog,
    schema,
    tableName,
    fqn,
    tableType,
    comment: null,
    sizeInBytes: null,
    numFiles: null,
    numRows: null,
    format: null,
    partitionColumns: [],
    clusteringColumns: [],
    location: null,
    owner: null,
    provider: null,
    isManaged: true,
    deltaMinReaderVersion: null,
    deltaMinWriterVersion: null,
    createdAt: null,
    lastModified: null,
    tableProperties: {},
    createdBy: null,
    lastAccess: null,
    isManagedLocation: null,
    discoveredVia,
    dataDomain: null,
    dataSubdomain: null,
    dataTier: null,
    generatedDescription: null,
    sensitivityLevel: null,
    governancePriority: null,
  };
}

// ---------------------------------------------------------------------------
// DESCRIBE HISTORY
// ---------------------------------------------------------------------------

/**
 * Run DESCRIBE HISTORY and aggregate into TableHistorySummary.
 * Returns null on permission errors or for views (which don't support history).
 */
export async function describeHistory(
  tableFqn: string,
  limit = 100,
): Promise<TableHistorySummary | null> {
  const [catalog, schema, table] = splitFqn(tableFqn);
  const safeCat = validateIdentifier(catalog, "catalog");
  const safeSch = validateIdentifier(schema, "schema");
  const safeTbl = validateIdentifier(table, "table");
  const sql = `DESCRIBE HISTORY \`${safeCat}\`.\`${safeSch}\`.\`${safeTbl}\` LIMIT ${limit}`;

  try {
    const result = await executeSQL(sql);
    if (result.rows.length === 0) {
      return emptyHistory(tableFqn);
    }

    const colIdx = (name: string) =>
      result.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());

    const timestampIdx = colIdx("timestamp");
    const operationIdx = colIdx("operation");
    const operationParamsIdx =
      colIdx("operationParameters") >= 0
        ? colIdx("operationParameters")
        : colIdx("operation_parameters");
    const operationMetricsIdx =
      colIdx("operationMetrics") >= 0 ? colIdx("operationMetrics") : colIdx("operation_metrics");

    const opCounts: Record<string, number> = {};
    let lastWriteTimestamp: string | null = null;
    let lastWriteOperation: string | null = null;
    let lastWriteRows: number | null = null;
    let lastWriteBytes: number | null = null;
    let lastOptimize: string | null = null;
    let lastVacuum: string | null = null;
    let totalWrite = 0;
    let totalStreaming = 0;
    let totalOptimize = 0;
    let totalVacuum = 0;
    let totalMerge = 0;
    let earliestTimestamp: string | null = null;
    let latestTimestamp: string | null = null;

    for (const row of result.rows) {
      const ts = timestampIdx >= 0 ? row[timestampIdx] : null;
      const op = operationIdx >= 0 ? (row[operationIdx] ?? "") : "";
      const opParams = operationParamsIdx >= 0 ? (row[operationParamsIdx] ?? "") : "";
      const opMetrics = operationMetricsIdx >= 0 ? (row[operationMetricsIdx] ?? "") : "";

      opCounts[op] = (opCounts[op] ?? 0) + 1;

      if (ts) {
        if (!latestTimestamp || ts > latestTimestamp) latestTimestamp = ts;
        if (!earliestTimestamp || ts < earliestTimestamp) earliestTimestamp = ts;
      }

      const isWrite = [
        "WRITE",
        "APPEND",
        "OVERWRITE",
        "DELETE",
        "UPDATE",
        "MERGE",
        "CREATE TABLE",
        "REPLACE TABLE",
        "STREAMING UPDATE",
      ].includes(op);
      const isStreaming = op === "STREAMING UPDATE" || opParams.includes('"outputMode"');

      if (isWrite) {
        totalWrite++;
        if (!lastWriteTimestamp || (ts && ts > lastWriteTimestamp)) {
          lastWriteTimestamp = ts;
          lastWriteOperation = op;
          // Parse operationMetrics for row/byte counts
          if (opMetrics) {
            try {
              const metrics = typeof opMetrics === "string" ? JSON.parse(opMetrics) : opMetrics;
              lastWriteRows = parseIntSafe(
                metrics.numOutputRows ?? metrics.numTargetRowsInserted ?? null,
              );
              lastWriteBytes = parseIntSafe(
                metrics.numOutputBytes ?? metrics.numAddedBytes ?? null,
              );
            } catch {
              /* skip malformed metrics */
            }
          }
        }
      }

      if (isStreaming) totalStreaming++;
      if (op === "OPTIMIZE") {
        totalOptimize++;
        if (!lastOptimize || (ts && ts > lastOptimize)) lastOptimize = ts;
      }
      if (op === "VACUUM END" || op === "VACUUM START") {
        totalVacuum++;
        if (!lastVacuum || (ts && ts > lastVacuum)) lastVacuum = ts;
      }
      if (op === "MERGE") totalMerge++;
    }

    const historyDays =
      earliestTimestamp && latestTimestamp
        ? Math.max(
            1,
            Math.round(
              (new Date(latestTimestamp).getTime() - new Date(earliestTimestamp).getTime()) /
                86_400_000,
            ),
          )
        : 0;

    return {
      tableFqn,
      lastWriteTimestamp,
      lastWriteOperation,
      lastWriteRows,
      lastWriteBytes,
      totalWriteOps: totalWrite,
      totalStreamingOps: totalStreaming,
      totalOptimizeOps: totalOptimize,
      totalVacuumOps: totalVacuum,
      totalMergeOps: totalMerge,
      lastOptimizeTimestamp: lastOptimize,
      lastVacuumTimestamp: lastVacuum,
      hasStreamingWrites: totalStreaming > 0,
      historyDays,
      topOperations: opCounts,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("EXPECT_TABLE_NOT_VIEW") || msg.includes("is a view")) {
      logger.debug("[metadata-detail] Skipping DESCRIBE HISTORY for view", { tableFqn });
      return null;
    }
    if (msg.includes("DELTA_ONLY_OPERATION")) {
      logger.debug("[metadata-detail] Skipping DESCRIBE HISTORY for non-Delta table", { tableFqn });
      return null;
    }
    if (msg.includes("INSUFFICIENT_PERMISSIONS") || msg.includes("(403)")) {
      logger.warn("[metadata-detail] Permission denied for DESCRIBE HISTORY", { tableFqn });
      return null;
    }
    logger.error("[metadata-detail] DESCRIBE HISTORY failed", { tableFqn, error: msg });
    return null;
  }
}

// ---------------------------------------------------------------------------
// SHOW TBLPROPERTIES
// ---------------------------------------------------------------------------

/**
 * Run SHOW TBLPROPERTIES and return a key-value map.
 */
export async function getTableProperties(tableFqn: string): Promise<Record<string, string>> {
  const [catalog, schema, table] = splitFqn(tableFqn);
  const safeCat = validateIdentifier(catalog, "catalog");
  const safeSch = validateIdentifier(schema, "schema");
  const safeTbl = validateIdentifier(table, "table");
  const sql = `SHOW TBLPROPERTIES \`${safeCat}\`.\`${safeSch}\`.\`${safeTbl}\``;

  try {
    const result = await executeSQL(sql);
    const props: Record<string, string> = {};
    for (const row of result.rows) {
      const key = row[0]?.trim();
      const value = row[1]?.trim();
      if (key) props[key] = value ?? "";
    }
    return props;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// DESCRIBE TABLE EXTENDED
// ---------------------------------------------------------------------------

export interface ExtendedTableInfo {
  properties: Record<string, string>;
  numRows: number | null;
  sizeInBytes: number | null;
  comment: string | null;
  owner: string | null;
  tableType: string | null;
  createdTime: string | null;
  createdBy: string | null;
  lastAccess: string | null;
  isManagedLocation: boolean | null;
  provider: string | null;
  location: string | null;
}

const EMPTY_EXTENDED: ExtendedTableInfo = {
  properties: {},
  numRows: null,
  sizeInBytes: null,
  comment: null,
  owner: null,
  tableType: null,
  createdTime: null,
  createdBy: null,
  lastAccess: null,
  isManagedLocation: null,
  provider: null,
  location: null,
};

/**
 * Run DESCRIBE TABLE EXTENDED and parse the key-value metadata section.
 *
 * The result set has 3 columns (col_name, data_type, comment). The first
 * rows are column definitions; after a blank separator row and a
 * "# Detailed Table Information" marker, the remaining rows are key-value
 * metadata with the key in col_name and the value in data_type.
 *
 * Returns a structured `ExtendedTableInfo` with properties, statistics,
 * and additional metadata fields not available from DESCRIBE DETAIL.
 */
export async function describeTableExtended(tableFqn: string): Promise<ExtendedTableInfo> {
  const [catalog, schema, table] = splitFqn(tableFqn);
  const safeCat = validateIdentifier(catalog, "catalog");
  const safeSch = validateIdentifier(schema, "schema");
  const safeTbl = validateIdentifier(table, "table");
  const sql = `DESCRIBE TABLE EXTENDED \`${safeCat}\`.\`${safeSch}\`.\`${safeTbl}\``;

  try {
    const result = await executeSQL(sql);
    if (result.rows.length === 0) return { ...EMPTY_EXTENDED };

    const colIdx = (name: string) =>
      result.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    const nameIdx = colIdx("col_name");
    const valueIdx = colIdx("data_type");

    if (nameIdx < 0 || valueIdx < 0) return { ...EMPTY_EXTENDED };

    // Scan for the metadata section marker
    let metaStart = -1;
    for (let i = 0; i < result.rows.length; i++) {
      const key = result.rows[i][nameIdx]?.trim() ?? "";
      if (key.startsWith("# Detailed Table Information")) {
        metaStart = i + 1;
        break;
      }
    }

    if (metaStart < 0) return { ...EMPTY_EXTENDED };

    // Build key-value map from the metadata section
    const meta = new Map<string, string>();
    for (let i = metaStart; i < result.rows.length; i++) {
      const key = result.rows[i][nameIdx]?.trim() ?? "";
      const value = result.rows[i][valueIdx]?.trim() ?? "";
      if (key) meta.set(key, value);
    }

    // Parse Statistics: "26524 bytes, 204 rows" or "26524 bytes"
    let numRows: number | null = null;
    let sizeInBytes: number | null = null;
    const statsRaw = meta.get("Statistics") ?? "";
    const statsMatch = statsRaw.match(/(\d[\d,]*)\s+bytes(?:,\s*(\d[\d,]*)\s+rows)?/);
    if (statsMatch) {
      sizeInBytes = parseIntSafe(statsMatch[1].replace(/,/g, ""));
      if (statsMatch[2]) {
        numRows = parseIntSafe(statsMatch[2].replace(/,/g, ""));
      }
    }

    // Parse Table Properties: "[key1=val1,key2=val2,...]"
    const properties = parseTablePropertiesString(meta.get("Table Properties") ?? "");

    // Parse Is_managed_location
    let isManagedLocation: boolean | null = null;
    const managedRaw = meta.get("Is_managed_location") ?? "";
    if (managedRaw.toLowerCase() === "true") isManagedLocation = true;
    else if (managedRaw.toLowerCase() === "false") isManagedLocation = false;

    return {
      properties,
      numRows,
      sizeInBytes,
      comment: meta.get("Comment") || null,
      owner: meta.get("Owner") || null,
      tableType: meta.get("Type") || null,
      createdTime: meta.get("Created Time") || null,
      createdBy: meta.get("Created By") || null,
      lastAccess: meta.get("Last Access") || null,
      isManagedLocation,
      provider: meta.get("Provider") || null,
      location: meta.get("Location") || null,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes("INSUFFICIENT_PERMISSIONS") ||
      msg.includes("does not exist") ||
      msg.includes("(403)") ||
      msg.includes("(404)")
    ) {
      logger.warn("[metadata-detail] Permission denied for DESCRIBE TABLE EXTENDED", { tableFqn });
    } else {
      logger.error("[metadata-detail] DESCRIBE TABLE EXTENDED failed", { tableFqn, error: msg });
    }
    return { ...EMPTY_EXTENDED };
  }
}

/**
 * Parse the Table Properties string from DESCRIBE TABLE EXTENDED.
 * Format: "[key1=val1,key2=val2,...]"
 * Values may contain spaces and special characters but keys do not contain commas.
 */
function parseTablePropertiesString(raw: string): Record<string, string> {
  const props: Record<string, string> = {};
  const trimmed = raw.replace(/^\[/, "").replace(/]$/, "").trim();
  if (!trimmed) return props;

  // Split on comma followed by a key=value pattern to avoid splitting values that contain commas
  const entries = trimmed.split(/,(?=[\w.]+\s*=)/);
  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx > 0) {
      const key = entry.slice(0, eqIdx).trim();
      const value = entry.slice(eqIdx + 1).trim();
      if (key) props[key] = value;
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Query table tags from information_schema.table_tags.
 * Graceful fallback to empty array.
 */
export async function getTableTags(catalog: string, schema?: string): Promise<TableTag[]> {
  const safeCat = validateIdentifier(catalog, "catalog");
  try {
    let sql = `
      SELECT catalog_name || '.' || schema_name || '.' || table_name AS table_fqn,
             tag_name, tag_value
      FROM \`${safeCat}\`.information_schema.table_tags
      WHERE schema_name NOT IN ('information_schema', 'default')
    `;
    if (schema) {
      const safeSch = validateIdentifier(schema, "schema");
      sql += ` AND schema_name = '${safeSch}'`;
    }

    const result = await executeSQL(sql);
    return result.rows.map((row) => ({
      tableFqn: row[0] ?? "",
      tagName: row[1] ?? "",
      tagValue: row[2] ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Query column tags from information_schema.column_tags.
 * Graceful fallback to empty array.
 */
export async function getColumnTags(catalog: string, schema?: string): Promise<ColumnTag[]> {
  const safeCat = validateIdentifier(catalog, "catalog");
  try {
    let sql = `
      SELECT catalog_name || '.' || schema_name || '.' || table_name AS table_fqn,
             column_name, tag_name, tag_value
      FROM \`${safeCat}\`.information_schema.column_tags
      WHERE schema_name NOT IN ('information_schema', 'default')
    `;
    if (schema) {
      const safeSch = validateIdentifier(schema, "schema");
      sql += ` AND schema_name = '${safeSch}'`;
    }

    const result = await executeSQL(sql);
    return result.rows.map((row) => ({
      tableFqn: row[0] ?? "",
      columnName: row[1] ?? "",
      tagName: row[2] ?? "",
      tagValue: row[3] ?? "",
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Batch enrichment orchestrator
// ---------------------------------------------------------------------------

export interface EnrichmentResult {
  detail: TableDetail | null;
  history: TableHistorySummary | null;
  properties: Record<string, string>;
}

/**
 * Table types that are backed by Delta and support DESCRIBE DETAIL,
 * DESCRIBE TABLE EXTENDED, and DESCRIBE HISTORY.
 * Non-physical types (VIEW, FOREIGN, MATERIALIZED_VIEW) are skipped.
 *
 * @see https://docs.databricks.com/en/sql/language-manual/information-schema/tables.html
 */
const DELTA_TABLE_TYPES = new Set([
  "MANAGED",
  "EXTERNAL",
  "STREAMING_TABLE",
  "MANAGED_SHALLOW_CLONE",
  "EXTERNAL_SHALLOW_CLONE",
]);

/**
 * Enrich tables in parallel batches. Runs DESCRIBE DETAIL, DESCRIBE TABLE
 * EXTENDED, and DESCRIBE HISTORY for each eligible table.
 *
 * DESCRIBE DETAIL provides numFiles, partitionColumns, clusteringColumns,
 * and lastModified. DESCRIBE TABLE EXTENDED replaces SHOW TBLPROPERTIES
 * and adds numRows (from Statistics), createdBy, lastAccess, and
 * isManagedLocation.
 *
 * **Eligibility checks** (uses `tableType` and `dataSourceFormat` from
 * `information_schema.tables` to skip unnecessary operations):
 *
 * - DESCRIBE DETAIL and DESCRIBE TABLE EXTENDED are only run for
 *   Delta-backed physical table types (MANAGED, EXTERNAL, STREAMING_TABLE,
 *   MANAGED_SHALLOW_CLONE, EXTERNAL_SHALLOW_CLONE). Views, FOREIGN tables,
 *   and other non-physical types go straight to the fallback path.
 * - DESCRIBE HISTORY is additionally restricted to tables whose
 *   `dataSourceFormat` is DELTA (or unknown). Non-Delta physical tables
 *   (e.g. Parquet, CSV external tables) skip history.
 * - When `tableType` is unknown (e.g. lineage-discovered tables), all
 *   three operations are attempted as a safe default.
 *
 * When DESCRIBE DETAIL returns null (permission denied, etc.), a fallback
 * TableDetail is created so the table still appears in the estate.
 *
 * @param tables - array of { fqn, discoveredVia, tableType?, dataSourceFormat? }
 * @param concurrency - how many tables to process in parallel (default 5)
 * @param onProgress - optional callback for progress updates
 */
export async function enrichTablesInBatches(
  tables: Array<{
    fqn: string;
    discoveredVia: "selected" | "lineage";
    tableType?: string;
    dataSourceFormat?: string | null;
  }>,
  concurrency = 5,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, EnrichmentResult>> {
  const results = new Map<string, EnrichmentResult>();
  let completed = 0;
  let historySkipped = 0;
  let enrichmentSkipped = 0;

  for (let i = 0; i < tables.length; i += concurrency) {
    const batch = tables.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async (t) => {
        const knownType = t.tableType?.toUpperCase() ?? null;
        const knownFormat = t.dataSourceFormat?.toUpperCase() ?? null;

        // A table is eligible for DESCRIBE DETAIL / EXTENDED / HISTORY when
        // its type is a known Delta-backed physical type, or when the type
        // is unknown (lineage-discovered tables that haven't been resolved).
        const isPhysicalTable = knownType === null || DELTA_TABLE_TYPES.has(knownType);

        if (!isPhysicalTable) {
          enrichmentSkipped++;
          logger.debug("[metadata-detail] Skipping DESCRIBE ops for non-physical table", {
            tableFqn: t.fqn,
            tableType: knownType,
          });

          const fallback = createFallbackDetail(t.fqn, t.discoveredVia, t.tableType ?? "VIEW");
          return {
            fqn: t.fqn,
            detail: fallback,
            history: null as TableHistorySummary | null,
            properties: {} as Record<string, string>,
          };
        }

        const skipHistoryUpfront = knownFormat !== null && knownFormat !== "DELTA";

        const [detail, extended] = await Promise.all([
          describeDetail(t.fqn, t.discoveredVia),
          describeTableExtended(t.fqn),
        ]);
        const properties = extended.properties;

        const detailFormat = detail?.format?.toUpperCase() ?? null;
        const isDelta = skipHistoryUpfront
          ? false
          : detailFormat === null || detailFormat === "DELTA";

        let history: TableHistorySummary | null = null;
        if (isDelta) {
          history = await describeHistory(t.fqn);
        } else {
          historySkipped++;
          logger.debug("[metadata-detail] Skipping DESCRIBE HISTORY for non-Delta table", {
            tableFqn: t.fqn,
            format: knownFormat ?? detailFormat ?? "unknown",
          });
        }

        // If DESCRIBE DETAIL returned null (inaccessible), create a fallback
        const effectiveDetail =
          detail ?? createFallbackDetail(t.fqn, t.discoveredVia, t.tableType ?? "VIEW");

        // Merge EXTENDED metadata into detail
        if (properties && Object.keys(properties).length > 0) {
          effectiveDetail.tableProperties = properties;
        }

        // numRows: prefer Statistics from EXTENDED, fall back to spark.sql.statistics.numRows
        if (extended.numRows != null) {
          effectiveDetail.numRows = extended.numRows;
        } else if (effectiveDetail.numRows == null) {
          const statsNumRows = properties["spark.sql.statistics.numRows"];
          if (statsNumRows) {
            effectiveDetail.numRows = parseIntSafe(statsNumRows);
          }
        }

        // EXTENDED-only fields
        effectiveDetail.createdBy = extended.createdBy;
        effectiveDetail.lastAccess = extended.lastAccess;
        effectiveDetail.isManagedLocation = extended.isManagedLocation;
        if (!effectiveDetail.owner && extended.owner) {
          effectiveDetail.owner = extended.owner;
        }

        // Override isManaged heuristic with ground truth when available
        if (extended.isManagedLocation != null) {
          effectiveDetail.isManaged = extended.isManagedLocation;
        }

        // Backfill comment from EXTENDED if not already set
        if (!effectiveDetail.comment && extended.comment) {
          effectiveDetail.comment = extended.comment;
        }

        return { fqn: t.fqn, detail: effectiveDetail, history, properties };
      }),
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.set(r.value.fqn, {
          detail: r.value.detail,
          history: r.value.history,
          properties: r.value.properties,
        });
      }
      completed++;
    }

    if (onProgress) onProgress(completed, tables.length);

    logger.info("[metadata-detail] Enrichment progress", {
      completed,
      total: tables.length,
    });
  }

  if (enrichmentSkipped > 0) {
    logger.info("[metadata-detail] Skipped DESCRIBE ops for non-physical tables", {
      skipped: enrichmentSkipped,
      total: tables.length,
    });
  }

  if (historySkipped > 0) {
    logger.info("[metadata-detail] Skipped DESCRIBE HISTORY for non-Delta tables", {
      skipped: historySkipped,
      total: tables.length,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function splitFqn(fqn: string): [string, string, string] {
  const parts = fqn.split(".");
  if (parts.length < 3) {
    throw new Error(`Invalid table FQN: ${fqn} (expected catalog.schema.table)`);
  }
  return [parts[0], parts[1], parts[2]];
}

function parseIntSafe(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Try comma-separated fallback
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function emptyHistory(tableFqn: string): TableHistorySummary {
  return {
    tableFqn,
    lastWriteTimestamp: null,
    lastWriteOperation: null,
    lastWriteRows: null,
    lastWriteBytes: null,
    totalWriteOps: 0,
    totalStreamingOps: 0,
    totalOptimizeOps: 0,
    totalVacuumOps: 0,
    totalMergeOps: 0,
    lastOptimizeTimestamp: null,
    lastVacuumTimestamp: null,
    hasStreamingWrites: false,
    historyDays: 0,
    topOperations: {},
  };
}
