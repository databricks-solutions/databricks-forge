/**
 * Discovers existing Unity Catalog metric views across catalogs in scope.
 *
 * Wraps the existing listMetricViews() query and converts to the
 * discovery type system.
 */

import { listMetricViews } from "@/lib/queries/metadata";
import { logger } from "@/lib/logger";
import type { DiscoveredMetricView } from "./types";

/**
 * Scan for metric views across the given catalog/schema pairs.
 * @param scope Array of "catalog" or "catalog.schema" strings
 */
export async function scanMetricViews(scope: string[]): Promise<DiscoveredMetricView[]> {
  const discovered: DiscoveredMetricView[] = [];
  const seen = new Set<string>();

  for (const entry of scope) {
    const parts = entry.split(".");
    const catalog = parts[0];
    const schema = parts.length > 1 ? parts[1] : undefined;

    try {
      const views = await listMetricViews(catalog, schema);
      for (const mv of views) {
        if (seen.has(mv.fqn)) continue;
        seen.add(mv.fqn);
        discovered.push({
          fqn: mv.fqn,
          catalog: mv.catalog,
          schema: mv.schema,
          name: mv.name,
          comment: mv.comment,
        });
      }
    } catch (err) {
      logger.warn(`[asset-discovery] Failed to list metric views for ${entry}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    `[asset-discovery] Found ${discovered.length} metric views across ${scope.length} scope entries`,
  );
  return discovered;
}
