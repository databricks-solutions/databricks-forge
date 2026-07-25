/**
 * Asset discovery orchestrator.
 *
 * Runs all three scanners (Genie spaces, dashboards, metric views)
 * and returns a unified DiscoveryResult. All operations are read-only.
 */

import { logger } from "@/lib/logger";
import { scanGenieSpaces } from "./genie-space-scanner";
import { scanDashboards } from "./dashboard-scanner";
import { scanMetricViews } from "./metric-view-scanner";
import type { DiscoveryResult } from "./types";

export interface AssetScanOptions {
  /** Table FQNs in scope -- when provided, results are filtered to assets overlapping these tables */
  scopeTables?: string[];
  /** Catalog/schema strings used to query metric views (e.g. ["main", "main.finance"]) */
  metricViewScope?: string[];
  /** Captured user token for external dashboard reads; no SP fallback is allowed. */
  oboToken?: string | null;
}

/**
 * Run a full asset discovery scan across the workspace.
 *
 * Scans Genie spaces, AI/BI dashboards, and metric views concurrently.
 * When `scopeTables` is provided, only assets referencing those tables
 * are included.
 */
export async function discoverExistingAssets(
  options: AssetScanOptions = {},
): Promise<DiscoveryResult> {
  const startMs = Date.now();
  const scopeSet = options.scopeTables ? new Set(options.scopeTables) : undefined;

  logger.info("[asset-discovery] Starting asset discovery scan", {
    scopeTableCount: scopeSet?.size ?? "all",
    metricViewScopeCount: options.metricViewScope?.length ?? 0,
  });

  const [genieSpaces, dashboards, metricViews] = await Promise.all([
    scanGenieSpaces(scopeSet),
    scanDashboards(scopeSet, options.oboToken),
    options.metricViewScope?.length
      ? scanMetricViews(options.metricViewScope)
      : Promise.resolve([]),
  ]);

  const durationMs = Date.now() - startMs;
  logger.info("[asset-discovery] Asset discovery complete", {
    genieSpaces: genieSpaces.length,
    dashboards: dashboards.length,
    metricViews: metricViews.length,
    durationMs,
  });

  return {
    genieSpaces,
    dashboards,
    metricViews,
    discoveredAt: new Date().toISOString(),
  };
}
