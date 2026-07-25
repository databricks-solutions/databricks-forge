/**
 * AI-generated descriptions for undocumented tables.
 *
 * During the MDG generate step, fetches tables without comments from
 * system.information_schema, batches them to the LLM, and returns a
 * map of table FQN → AI-generated description.
 *
 * At deploy time the descriptions are embedded into the view DDL as a
 * VALUES CTE so they appear as an `ai_comment` column.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { executeSQLMapped } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import { validateIdentifier } from "@/lib/validation";

const MAX_TABLES = 500;
const BATCH_SIZE = 50;

const EXCLUDED_CATALOGS = ["system", "__databricks_internal", "samples", "hive_metastore"];
const EXCLUDED_SCHEMAS = ["information_schema"];

interface UndocumentedTable {
  fqn: string;
  tableName: string;
  columns: string[];
}

/**
 * Fetch tables that have no comment, along with their column names for context.
 */
export async function fetchUndocumentedTables(
  catalogScope?: string[],
): Promise<UndocumentedTable[]> {
  const catFilter = catalogScope?.length
    ? `table_catalog IN (${catalogScope.map((c) => `'${validateIdentifier(c, "catalogScope")}'`).join(", ")})`
    : `table_catalog NOT IN (${EXCLUDED_CATALOGS.map((c) => `'${c}'`).join(", ")})`;

  const schemaFilter = `table_schema NOT IN (${EXCLUDED_SCHEMAS.map((s) => `'${s}'`).join(", ")})`;

  const rows = await executeSQLMapped<{ fqn: string; tableName: string }>(
    `SELECT DISTINCT
       CONCAT(table_catalog, '.', table_schema, '.', table_name) AS fqn,
       table_name
     FROM system.information_schema.tables
     WHERE ${catFilter}
       AND ${schemaFilter}
       AND table_name NOT LIKE '!_%' ESCAPE '!'
       AND (comment IS NULL OR TRIM(comment) = '')
     LIMIT ${MAX_TABLES}`,
    (row) => ({ fqn: String(row[0]), tableName: String(row[1]) }),
  );

  if (rows.length === 0) return [];

  const fqns = rows.map((r) => r.fqn);
  const safeFqns = fqns.map((f) => f.replace(/'/g, "''"));
  const fqnPlaceholders = safeFqns.map((f) => `'${f}'`).join(", ");

  const columnRows = await executeSQLMapped<{ fqn: string; col: string }>(
    `SELECT
       CONCAT(table_catalog, '.', table_schema, '.', table_name) AS fqn,
       column_name
     FROM system.information_schema.columns
     WHERE CONCAT(table_catalog, '.', table_schema, '.', table_name) IN (${fqnPlaceholders})
     ORDER BY fqn, ordinal_position`,
    (row) => ({ fqn: String(row[0]), col: String(row[1]) }),
  );

  const colsByFqn = new Map<string, string[]>();
  for (const r of columnRows) {
    const list = colsByFqn.get(r.fqn) ?? [];
    list.push(r.col);
    colsByFqn.set(r.fqn, list);
  }

  return rows.map((r) => ({
    fqn: r.fqn,
    tableName: r.tableName,
    columns: colsByFqn.get(r.fqn) ?? [],
  }));
}

/**
 * Generate AI descriptions for a list of undocumented tables.
 * Returns a map of table FQN → description.
 */
export async function generateTableDescriptions(
  tables: UndocumentedTable[],
): Promise<Map<string, string>> {
  const descriptions = new Map<string, string>();
  if (tables.length === 0) return descriptions;

  const batches: UndocumentedTable[][] = [];
  for (let i = 0; i < tables.length; i += BATCH_SIZE) {
    batches.push(tables.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    try {
      const tableList = batch
        .map((t) => {
          const cols = t.columns.slice(0, 20).join(", ");
          return `- ${t.fqn} [columns: ${cols}]`;
        })
        .join("\n");

      const result = await executeAIQuery({
        promptKey: "METADATA_GENIE_DESCRIBE_TABLES_PROMPT",
        variables: { table_list: tableList },
        modelEndpoint: resolveEndpoint("classification"),
        responseFormat: "json_object",
        temperature: 0.2,
        retries: 1,
        maxTokens: 65536,
      });

      const parsed = parseLLMJson(result.rawResponse, "metadata-genie:describe") as
        | { table_fqn: string; description: string }[]
        | { descriptions: { table_fqn: string; description: string }[] };
      const items: { table_fqn: string; description: string }[] = Array.isArray(parsed)
        ? parsed
        : (parsed.descriptions ?? []);

      for (const item of items) {
        if (item.table_fqn && item.description) {
          descriptions.set(item.table_fqn, item.description.slice(0, 200));
        }
      }
    } catch (err) {
      logger.warn("MDG description generation batch failed", {
        error: err instanceof Error ? err.message : String(err),
        batchSize: batch.length,
      });
    }
  }

  logger.info("MDG AI descriptions generated", {
    requested: tables.length,
    generated: descriptions.size,
  });

  return descriptions;
}
