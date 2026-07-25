/**
 * Pipeline Step: Asset Discovery
 *
 * Discovers existing analytics assets (Genie spaces, AI/BI dashboards,
 * metric views) in the workspace. Results feed into downstream steps
 * (use case generation, scoring, Genie/Dashboard engines) to avoid
 * duplicate recommendations and identify gaps.
 *
 * This step is conditional -- it only runs when `assetDiscoveryEnabled`
 * is true in the run config. The pipeline engine skips it otherwise.
 */

import type { PipelineContext } from "@/lib/domain/types";
import type { DiscoveryResult } from "@/lib/discovery/types";
import { discoverExistingAssets } from "@/lib/discovery/asset-scanner";
import { computeCoverage } from "@/lib/discovery/coverage";
import { saveDiscoveryResults } from "@/lib/lakebase/discovered-assets";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { logger as fallbackLogger } from "@/lib/logger";

export async function runAssetDiscovery(
  ctx: PipelineContext,
  runId?: string,
): Promise<DiscoveryResult | null> {
  const log = ctx.logger ?? fallbackLogger;
  if (!ctx.run.config.assetDiscoveryEnabled) {
    log.info("Disabled -- skipping");
    return null;
  }

  if (!ctx.metadata) {
    log.warn("No metadata snapshot available -- skipping", { fn: "runAssetDiscovery" });
    return null;
  }

  if (runId) {
    await updateRunMessage(
      runId,
      "Discovering existing Genie spaces, dashboards, and metric views...",
    );
  }

  const tableFqns = ctx.metadata.tables.map((t) => t.fqn);

  const scopeStrings = [...new Set(ctx.metadata.tables.map((t) => `${t.catalog}.${t.schema}`))];

  const discoveryResult = await discoverExistingAssets({
    scopeTables: tableFqns,
    metricViewScope: scopeStrings,
    oboToken: ctx.oboToken,
  });

  const coverage = computeCoverage(tableFqns, discoveryResult);

  if (runId) {
    await saveDiscoveryResults(runId, discoveryResult, coverage);
  }

  const summary = [
    `${discoveryResult.genieSpaces.length} Genie spaces`,
    `${discoveryResult.dashboards.length} dashboards`,
    `${discoveryResult.metricViews.length} metric views`,
    `${coverage.coveragePercent}% table coverage`,
  ].join(", ");

  if (runId) {
    await updateRunMessage(runId, `Asset discovery complete: ${summary}`);
  }

  log.info("Complete", {
    genieSpaces: discoveryResult.genieSpaces.length,
    dashboards: discoveryResult.dashboards.length,
    metricViews: discoveryResult.metricViews.length,
    coveragePercent: coverage.coveragePercent,
  });

  return discoveryResult;
}
