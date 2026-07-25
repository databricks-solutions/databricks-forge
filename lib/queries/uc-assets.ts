/**
 * Unity Catalog asset queries beyond tables: UC functions and registered ML
 * models. Used by the estate scan to inventory what a customer actually has
 * deployed (a key C-level signal), alongside the analytics assets that
 * `lib/discovery` already covers (Genie spaces, dashboards, metric views).
 *
 * All queries are best-effort and per-scope: a catalog/schema that errors
 * (permissions, unsupported metastore) yields an empty list rather than
 * failing the scan.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { validateIdentifier } from "@/lib/validation";
import { logger } from "@/lib/logger";

export interface UCFunction {
  fqn: string;
  catalog: string;
  schema: string;
  name: string;
  dataType: string | null; // return type
  comment: string | null;
}

export interface UCModel {
  fqn: string;
  catalog: string;
  schema: string;
  name: string;
  comment: string | null;
}

/**
 * List UC functions in a catalog (optionally a single schema) via
 * information_schema.routines. Returns [] on any error.
 */
export async function listFunctions(catalog: string, schema?: string): Promise<UCFunction[]> {
  const safeCatalog = validateIdentifier(catalog, "catalog");
  const where = schema
    ? `WHERE routine_schema = '${validateIdentifier(schema, "schema")}'`
    : "";
  try {
    const result = await executeSQL(
      `SELECT routine_catalog, routine_schema, routine_name, data_type, comment
       FROM \`${safeCatalog}\`.information_schema.routines ${where}`,
      undefined,
      undefined,
      { submitTimeoutMs: 15_000 },
    );
    return result.rows.map((r) => {
      const cat = String(r[0] ?? catalog);
      const sch = String(r[1] ?? "");
      const name = String(r[2] ?? "");
      return {
        fqn: `${cat}.${sch}.${name}`,
        catalog: cat,
        schema: sch,
        name,
        dataType: r[3] != null ? String(r[3]) : null,
        comment: r[4] != null ? String(r[4]) : null,
      };
    });
  } catch (error) {
    logger.info("[uc-assets] functions not available for scope", {
      scope: schema ? `${catalog}.${schema}` : catalog,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * List UC registered (ML) models in a catalog (optionally a single schema).
 * Uses the system information schema view when available; returns [] on error.
 */
export async function listRegisteredModels(catalog: string, schema?: string): Promise<UCModel[]> {
  const safeCatalog = validateIdentifier(catalog, "catalog");
  const where = schema
    ? `WHERE model_schema = '${validateIdentifier(schema, "schema")}'`
    : "";
  try {
    const result = await executeSQL(
      `SELECT model_catalog, model_schema, model_name, comment
       FROM \`${safeCatalog}\`.information_schema.models ${where}`,
      undefined,
      undefined,
      { submitTimeoutMs: 15_000 },
    );
    return result.rows.map((r) => {
      const cat = String(r[0] ?? catalog);
      const sch = String(r[1] ?? "");
      const name = String(r[2] ?? "");
      return {
        fqn: `${cat}.${sch}.${name}`,
        catalog: cat,
        schema: sch,
        name,
        comment: r[3] != null ? String(r[3]) : null,
      };
    });
  } catch (error) {
    logger.info("[uc-assets] registered models not available for scope", {
      scope: schema ? `${catalog}.${schema}` : catalog,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
