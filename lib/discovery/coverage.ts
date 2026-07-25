/**
 * Computes analytics asset coverage across tables in scope.
 *
 * Determines which tables are covered by existing Genie spaces,
 * dashboards, and metric views -- and which are uncovered.
 */

import type { DiscoveryResult, AssetCoverage } from "./types";

/**
 * Compute table-level coverage from discovered assets.
 * @param allTables All table FQNs in scope (normalised to lowercase)
 * @param discovery The discovery scan result
 */
export function computeCoverage(allTables: string[], discovery: DiscoveryResult): AssetCoverage {
  const tableSet = new Set(allTables.map((t) => t.toLowerCase()));

  const coveredByGenieSpaces: Record<string, string[]> = {};
  const coveredByDashboards: Record<string, string[]> = {};
  const coveredByMetricViews: Record<string, string[]> = {};

  for (const space of discovery.genieSpaces) {
    for (const t of space.tables) {
      const key = t.toLowerCase();
      if (tableSet.has(key)) {
        (coveredByGenieSpaces[key] ??= []).push(space.spaceId);
      }
    }
  }

  for (const dash of discovery.dashboards) {
    for (const t of dash.tables) {
      const key = t.toLowerCase();
      if (tableSet.has(key)) {
        (coveredByDashboards[key] ??= []).push(dash.dashboardId);
      }
    }
  }

  for (const mv of discovery.metricViews) {
    const key = mv.fqn.toLowerCase();
    if (tableSet.has(key)) {
      (coveredByMetricViews[key] ??= []).push(mv.fqn);
    }
  }

  const coveredSet = new Set([
    ...Object.keys(coveredByGenieSpaces),
    ...Object.keys(coveredByDashboards),
    ...Object.keys(coveredByMetricViews),
  ]);

  const uncoveredTables = allTables.filter((t) => !coveredSet.has(t.toLowerCase()));

  const coveragePercent =
    allTables.length > 0 ? Math.round((coveredSet.size / allTables.length) * 100) : 0;

  return {
    allTables,
    coveredByGenieSpaces,
    coveredByDashboards,
    coveredByMetricViews,
    uncoveredTables,
    coveragePercent,
    genieSpaceCount: discovery.genieSpaces.length,
    dashboardCount: discovery.dashboards.length,
    metricViewCount: discovery.metricViews.length,
  };
}
