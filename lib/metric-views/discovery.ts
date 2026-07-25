/**
 * Deep discovery for existing Unity Catalog metric views.
 *
 * Goes beyond simple enumeration: fetches the full YAML definition via
 * `SHOW CREATE TABLE`, parses it to extract dimensions, measures, joins,
 * and the source table, enabling the three-tier classification system
 * (reuse / improve / new).
 */

import { executeSQL } from "@/lib/dbx/sql";
import { listMetricViews } from "@/lib/queries/metadata";
import { validateFqn } from "@/lib/validation";
import { logger } from "@/lib/logger";
import type { ExistingMetricViewDetail } from "./types";

/**
 * Parse a YAML metric view definition to extract structural metadata.
 */
function parseMetricViewYaml(yaml: string): {
  sourceTable: string | null;
  dimensions: string[];
  measures: string[];
  joinTargets: string[];
} {
  const sourceMatch = yaml.match(/source:\s*(.+)/);
  const sourceTable = sourceMatch ? sourceMatch[1].trim() : null;

  const dimensions: string[] = [];
  const dimBlock = yaml.match(
    /dimensions:\s*\n((?:\s+-[\s\S]*?)?)(?=\n\w|\nmeasures:|\njoins:|\nfilter:|$)/,
  );
  if (dimBlock) {
    const nameMatches = dimBlock[1].matchAll(/- name:\s*(\S+)/g);
    for (const m of nameMatches) dimensions.push(m[1]);
  }

  const measures: string[] = [];
  const measBlock = yaml.match(
    /measures:\s*\n((?:\s+-[\s\S]*?)?)(?=\n\w|\ndimensions:|\njoins:|\nfilter:|$)/,
  );
  if (measBlock) {
    const nameMatches = measBlock[1].matchAll(/- name:\s*(\S+)/g);
    for (const m of nameMatches) measures.push(m[1]);
  }

  const joinTargets: string[] = [];
  const joinMatches = yaml.matchAll(/source:\s*(\S+\.\S+\.\S+)/g);
  for (const m of joinMatches) {
    if (m[1] !== sourceTable) joinTargets.push(m[1]);
  }

  return { sourceTable, dimensions, measures, joinTargets };
}

/**
 * Fetch the YAML definition of a single metric view via SHOW CREATE TABLE.
 * Returns null if the command fails (permissions, not found, etc.).
 */
async function fetchMetricViewYaml(fqn: string): Promise<string | null> {
  try {
    const safeFqn = validateFqn(fqn);
    const result = await executeSQL(`SHOW CREATE TABLE ${safeFqn}`);
    if (result.rows.length > 0 && result.rows[0][0]) {
      const ddl = result.rows[0][0];
      const yamlMatch = ddl.match(/\$\$([\s\S]*?)\$\$/);
      return yamlMatch ? yamlMatch[1].trim() : null;
    }
    return null;
  } catch (err) {
    logger.warn(`[metric-view-discovery] Failed to fetch YAML for ${fqn}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Discover and deeply inspect all existing metric views in the given scope.
 *
 * For each metric view found via information_schema:
 * 1. Fetches the full DDL via SHOW CREATE TABLE
 * 2. Extracts the YAML definition
 * 3. Parses dimensions, measures, joins, and source table
 *
 * @param scope Array of "catalog" or "catalog.schema" strings
 * @param concurrency Max parallel SHOW CREATE TABLE fetches (default 5)
 */
export async function discoverExistingMetricViews(
  scope: string[],
  concurrency = 5,
): Promise<ExistingMetricViewDetail[]> {
  const seen = new Set<string>();
  const viewList: Array<{ fqn: string; name: string; comment: string | null }> = [];

  for (const entry of scope) {
    const parts = entry.split(".");
    const catalog = parts[0];
    const schema = parts.length > 1 ? parts[1] : undefined;

    try {
      const views = await listMetricViews(catalog, schema);
      for (const mv of views) {
        if (seen.has(mv.fqn)) continue;
        seen.add(mv.fqn);
        viewList.push({ fqn: mv.fqn, name: mv.name, comment: mv.comment });
      }
    } catch (err) {
      logger.warn(`[metric-view-discovery] Failed to list metric views for ${entry}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (viewList.length === 0) return [];

  logger.info(
    `[metric-view-discovery] Found ${viewList.length} metric views, fetching YAML definitions`,
  );

  const results: ExistingMetricViewDetail[] = [];
  const queue = [...viewList];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const yaml = await fetchMetricViewYaml(item.fqn);
      const parsed = yaml ? parseMetricViewYaml(yaml) : null;

      results.push({
        fqn: item.fqn,
        name: item.name,
        comment: item.comment,
        yaml,
        sourceTable: parsed?.sourceTable ?? null,
        dimensions: parsed?.dimensions ?? [],
        measures: parsed?.measures ?? [],
        joinTargets: parsed?.joinTargets ?? [],
      });
    }
  });

  await Promise.all(workers);

  logger.info(
    `[metric-view-discovery] Completed deep discovery: ${results.filter((r) => r.yaml).length}/${results.length} with YAML`,
  );

  return results;
}

/**
 * Filter existing metric views to those relevant to a set of tables.
 * A view is relevant if its source table or any join target overlaps
 * with the provided table set.
 */
export function filterRelevantExistingViews(
  existing: ExistingMetricViewDetail[],
  tableFqns: string[],
): ExistingMetricViewDetail[] {
  const tableSet = new Set(tableFqns.map((t) => t.toLowerCase()));

  return existing.filter((mv) => {
    if (mv.sourceTable && tableSet.has(mv.sourceTable.toLowerCase())) return true;
    for (const jt of mv.joinTargets) {
      if (tableSet.has(jt.toLowerCase())) return true;
    }
    return false;
  });
}
