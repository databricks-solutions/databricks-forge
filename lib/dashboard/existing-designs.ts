import { requireDashboardDesignV2, type DashboardDesignV2 } from "./design-ir";
import type { DiscoveredDashboard } from "@/lib/discovery/types";
import { getDashboard } from "@/lib/dbx/dashboards";
import { listOwnedTrackedDashboardsByIds } from "@/lib/lakebase/dashboards";
import { getDashboardRecommendationsByRunId } from "@/lib/lakebase/dashboard-recommendations";
import { logger } from "@/lib/logger";
import { assembleLakeviewDashboard } from "./assembler";
import { fingerprintSerializedDashboard } from "./live-artifact";

export function invertTrustedDashboardDesign(
  serialized: string | undefined,
): DashboardDesignV2 | null {
  if (!serialized) return null;
  try {
    const payload: unknown = JSON.parse(serialized);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const embedded = (payload as Record<string, unknown>).forgeDesignV2;
    return requireDashboardDesignV2(embedded);
  } catch {
    return null;
  }
}

export async function enrichDiscoveredDashboardsWithDesigns(
  discovered: DiscoveredDashboard[],
  ownerEmail: string,
  oboToken: string | null,
): Promise<DiscoveredDashboard[]> {
  const tracked = await listOwnedTrackedDashboardsByIds(
    discovered.map((dashboard) => dashboard.dashboardId),
    ownerEmail,
  );
  const trustedById = new Map<string, DashboardDesignV2>();
  for (const dashboard of tracked) {
    const recommendations = await getDashboardRecommendationsByRunId(dashboard.runId);
    const recommendation = recommendations.find(
      (candidate) => candidate.domain.toLowerCase() === dashboard.domain.toLowerCase(),
    );
    if (recommendation) trustedById.set(dashboard.dashboardId, recommendation.dashboardDesign);
  }

  if (!oboToken) return [];
  const verified = await Promise.all(
    discovered.map(async (dashboard) => {
      try {
        const live = await getDashboard(dashboard.dashboardId, {
          mode: "user",
          oboToken,
        });
        const liveSerializedFingerprint = fingerprintSerializedDashboard(live.serialized_dashboard);
        const trackedDesign = trustedById.get(dashboard.dashboardId);
        if (
          trackedDesign &&
          fingerprintSerializedDashboard(assembleLakeviewDashboard(trackedDesign)) ===
            liveSerializedFingerprint
        ) {
          return { ...dashboard, dashboardDesign: trackedDesign, liveSerializedFingerprint };
        }
        const externalDesign = invertTrustedDashboardDesign(live.serialized_dashboard);
        if (
          externalDesign &&
          fingerprintSerializedDashboard(assembleLakeviewDashboard(externalDesign)) ===
            liveSerializedFingerprint
        ) {
          return {
            ...dashboard,
            dashboardDesign: externalDesign,
            liveSerializedFingerprint,
          };
        }
        return null;
      } catch (error) {
        logger.warn("Unable to read external dashboard as the current user", {
          dashboardId: dashboard.dashboardId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }),
  );
  return verified.filter(
    (dashboard): dashboard is NonNullable<typeof dashboard> => dashboard !== null,
  );
}
