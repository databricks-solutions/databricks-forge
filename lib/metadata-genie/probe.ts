/**
 * Probe system.information_schema access and fetch table/schema names
 * for industry detection.
 */

import { executeSQL, executeSQLMapped } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import type { ProbeResult } from "./types";

const EXCLUDED_CATALOGS = ["system", "__databricks_internal", "samples", "hive_metastore"];
const EXCLUDED_SCHEMAS = ["information_schema"];

/**
 * Check whether the current principal can query system.information_schema,
 * then fetch the list of catalogs and a sample of table names.
 */
export async function probeSystemInformationSchema(): Promise<ProbeResult> {
  try {
    await executeSQL("SELECT 1 FROM system.information_schema.catalogs LIMIT 1");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error probing access";
    logger.warn("system.information_schema access denied", { error: msg });
    return {
      accessible: false,
      lineageAccessible: false,
      error: `Cannot access system.information_schema. Ensure the service principal has USE CATALOG and SELECT grants on the system catalog. (${msg})`,
    };
  }

  // Check lineage access (non-blocking -- graceful fallback)
  let lineageAccessible = false;
  try {
    await executeSQL("SELECT 1 FROM system.access.table_lineage LIMIT 1");
    lineageAccessible = true;
  } catch {
    logger.info("system.access.table_lineage not accessible -- lineage will be excluded from MDG");
  }

  try {
    const catalogs = await executeSQLMapped<string>(
      "SELECT catalog_name FROM system.information_schema.catalogs ORDER BY catalog_name",
      (row) => row[0],
    );

    const excludedCatSet = new Set(EXCLUDED_CATALOGS);
    const filteredCatalogs = catalogs.filter((c) => !excludedCatSet.has(c));

    const catExclusion = EXCLUDED_CATALOGS.map((c) => `'${c}'`).join(", ");
    const schemaExclusion = EXCLUDED_SCHEMAS.map((s) => `'${s}'`).join(", ");
    const tableRows = await executeSQLMapped<string>(
      `SELECT DISTINCT CONCAT(table_catalog, '.', table_schema, '.', table_name)
       FROM system.information_schema.tables
       WHERE table_catalog NOT IN (${catExclusion})
         AND table_schema NOT IN (${schemaExclusion})
         AND table_name NOT LIKE '!_%' ESCAPE '!'
       LIMIT 2000`,
      (row) => row[0],
    );

    return {
      accessible: true,
      lineageAccessible,
      catalogs: filteredCatalogs,
      tableNames: tableRows,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error fetching metadata";
    logger.error("Failed to fetch catalogs/tables from system IS", {
      error: msg,
    });
    return {
      accessible: true,
      lineageAccessible,
      catalogs: [],
      tableNames: [],
      error: `Access confirmed but failed to list catalogs: ${msg}`,
    };
  }
}
