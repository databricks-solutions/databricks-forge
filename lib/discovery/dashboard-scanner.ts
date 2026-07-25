/**
 * Discovers existing AI/BI (Lakeview) dashboards in the workspace
 * and extracts table references from their dataset SQL queries.
 */

import { getDashboard, listDashboardsAsUser } from "@/lib/dbx/dashboards";
import { isDashboardScopeUnsupportedError } from "@/lib/dbx/dashboard-capability";
import { logger } from "@/lib/logger";
import type { DiscoveredDashboard } from "./types";

/**
 * Scan all workspace dashboards and extract structured metadata.
 * Optionally filters to dashboards whose tables overlap with `scopeTables`.
 */
export async function scanDashboards(
  scopeTables?: Set<string>,
  oboToken?: string | null,
): Promise<DiscoveredDashboard[]> {
  const discovered: DiscoveredDashboard[] = [];
  if (!oboToken) {
    logger.info("[asset-discovery] Dashboard discovery omitted: no OBO token");
    return discovered;
  }

  try {
    const dashboards = await listDashboardsAsUser(oboToken);
    logger.info(`[asset-discovery] Found ${dashboards.length} dashboards in workspace`);

    for (const d of dashboards) {
      try {
        let serialized = d.serialized_dashboard;

        if (!serialized) {
          const detail = await getDashboard(d.dashboard_id, {
            mode: "user",
            oboToken,
          });
          serialized = (detail as unknown as Record<string, unknown>).serialized_dashboard as
            | string
            | undefined;
        }

        const { tables, datasetCount, widgetCount } = parseDashboardPayload(serialized);

        if (scopeTables && tables.length > 0) {
          const hasOverlap = tables.some((t) => scopeTables.has(t));
          if (!hasOverlap) continue;
        }

        discovered.push({
          dashboardId: d.dashboard_id,
          displayName: d.display_name,
          tables,
          isPublished: false,
          datasetCount,
          widgetCount,
          creatorEmail: d.creator_user_name,
          updatedAt: d.update_time,
          parentPath: d.parent_path,
        });
      } catch (err) {
        logger.warn(`[asset-discovery] Failed to parse dashboard ${d.dashboard_id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    if (isDashboardScopeUnsupportedError(err)) {
      logger.info("[asset-discovery] Dashboard discovery unsupported by Apps OBO scopes", {
        code: err.code,
        requiredScope: err.requiredScope,
      });
    } else {
      logger.error("[asset-discovery] Failed to list dashboards");
    }
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Parse Lakeview serialized_dashboard JSON to extract table references
// ---------------------------------------------------------------------------

const TABLE_REF_RE = /(?:FROM|JOIN)\s+`?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)`?/gi;

function parseDashboardPayload(serialized?: string): {
  tables: string[];
  datasetCount: number;
  widgetCount: number;
} {
  if (!serialized) return { tables: [], datasetCount: 0, widgetCount: 0 };

  try {
    const parsed = JSON.parse(serialized);
    const datasets = parsed.datasets ?? [];
    const pages = parsed.pages ?? [];
    let widgetCount = 0;
    for (const page of pages) {
      widgetCount += (page.layout ?? []).length;
    }

    const tableSet = new Set<string>();
    for (const ds of datasets) {
      const query = ds.query ?? "";
      let match: RegExpExecArray | null;
      TABLE_REF_RE.lastIndex = 0;
      while ((match = TABLE_REF_RE.exec(query)) !== null) {
        tableSet.add(`${match[1]}.${match[2]}.${match[3]}`);
      }
    }

    return {
      tables: Array.from(tableSet),
      datasetCount: datasets.length,
      widgetCount,
    };
  } catch {
    return { tables: [], datasetCount: 0, widgetCount: 0 };
  }
}
