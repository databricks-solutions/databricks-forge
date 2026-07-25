/**
 * API: /api/runs/[runId]/dashboard-engine/generate
 *
 * POST -- Run/re-run the Dashboard Engine.
 *         Runs asynchronously; the client polls /generate/status for progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import { getGenieRecommendationsByRunId } from "@/lib/lakebase/genie-recommendations";
import { saveDashboardRecommendations } from "@/lib/lakebase/dashboard-recommendations";
import { runDashboardEngine } from "@/lib/dashboard/engine";
import { getDiscoveryResultsByRunId } from "@/lib/lakebase/discovered-assets";
import {
  startDashboardJob,
  updateDashboardJob,
  completeDashboardJob,
  failDashboardJob,
  getDashboardJobStatus,
} from "@/lib/dashboard/engine-status";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/lakebase/activity-log";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import {
  missingDashboardManifestDomains,
  normalizeDashboardDomain,
  selectDashboardDomainGroups,
} from "@/lib/dashboard/domain-groups";
import { enrichDiscoveredDashboardsWithDesigns } from "@/lib/dashboard/existing-designs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    let domains: string[] | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body?.domains) && body.domains.length > 0) {
        domains = body.domains.filter((d: unknown) => typeof d === "string" && d.length > 0);
        if (domains!.length === 0) domains = undefined;
      }
    } catch {
      // No body or invalid JSON -- regenerate all domains
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;
    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Run must be completed to generate dashboards" },
        { status: 400 },
      );
    }

    const useCases = await getUseCasesByRunId(runId);
    if (useCases.length === 0) {
      return NextResponse.json({ error: "No use cases found" }, { status: 404 });
    }

    const metadata = await loadMetadataForRun(runId);
    if (!metadata) {
      return NextResponse.json({ error: "Metadata snapshot not found" }, { status: 404 });
    }

    const existingJob = await getDashboardJobStatus(runId);
    if (existingJob?.status === "generating") {
      return NextResponse.json(
        { error: "Dashboard generation already in progress", status: "generating" },
        { status: 409 },
      );
    }

    const genieRecommendations = await getGenieRecommendationsByRunId(
      runId,
      run.ownerEmail ?? null,
    );
    const semanticManifests: Record<string, SemanticAssetManifest> = {};
    for (const recommendation of genieRecommendations) {
      if (!recommendation.semanticAssetManifest) continue;
      try {
        const manifest = JSON.parse(recommendation.semanticAssetManifest) as SemanticAssetManifest;
        if (
          manifest.version === "1" &&
          normalizeDashboardDomain(manifest.domain) ===
            normalizeDashboardDomain(recommendation.domain)
        ) {
          semanticManifests[recommendation.domain] = manifest;
        }
      } catch {
        logger.warn("Ignoring malformed persisted semantic manifest", {
          runId,
          domain: recommendation.domain,
        });
      }
    }
    const requiredDomainGroups = selectDashboardDomainGroups(useCases, domains);
    const missingManifestDomains = missingDashboardManifestDomains(
      requiredDomainGroups,
      semanticManifests,
    );
    if (missingManifestDomains.length > 0) {
      return NextResponse.json(
        {
          error: `No persisted Genie semantic manifests are available for dashboard domains: ${missingManifestDomains.join(", ")}`,
        },
        { status: 422 },
      );
    }

    // Load existing dashboards from asset discovery (if available)
    let existingDashboards: import("@/lib/discovery/types").DiscoveredDashboard[] | undefined;
    try {
      const discoveryData = await getDiscoveryResultsByRunId(runId);
      if (discoveryData?.dashboards?.length) {
        const discoveredDashboards = discoveryData.dashboards.map((d) => ({
          dashboardId: d.dashboardId,
          displayName: d.displayName,
          tables: d.tables,
          isPublished: d.isPublished,
          datasetCount: d.datasetCount,
          widgetCount: d.widgetCount,
        }));
        existingDashboards = await enrichDiscoveredDashboardsWithDesigns(
          discoveredDashboards,
          run.ownerEmail ?? guard.user.email,
          guard.user.oboToken,
        );
      }
    } catch {
      /* non-critical */
    }

    await startDashboardJob(runId);

    runDashboardEngine({
      run,
      useCases,
      metadata,
      genieRecommendations,
      semanticManifests,
      existingDashboards,
      domainFilter: domains,
      onProgress: (message, percent) => updateDashboardJob(runId, message, percent),
    })
      .then(async (result) => {
        if (result.recommendations.length > 0) {
          await saveDashboardRecommendations(
            runId,
            result.recommendations,
            domains,
            run.ownerEmail,
          );
        }
        if (result.validationFailures.length > 0) {
          const count = result.validationFailures.length;
          const message = `Dashboard validation failed for ${count} domain${count === 1 ? "" : "s"}`;
          await logActivity("dashboard_validation_failed", {
            userId: guard.user.email,
            resourceId: runId,
            metadata: { validationFailureCount: count, domains: domains ?? null },
          });
          logger.warn("Dashboard Engine generation failed validation (async)", {
            runId,
            recommendationCount: result.recommendations.length,
            validationFailureCount: count,
            domainFilter: domains ?? "all",
          });
          if (result.recommendations.length === 0) {
            await failDashboardJob(runId, message, result.validationFailures);
            return;
          }
        }
        await logActivity("dashboard_validated", {
          userId: guard.user.email,
          resourceId: runId,
          metadata: {
            recommendationCount: result.recommendations.length,
            domains: domains ?? null,
          },
        });
        await completeDashboardJob(runId, result.recommendations.length, result.validationFailures);
        logger.info("Dashboard Engine generation complete (async)", {
          runId,
          recommendationCount: result.recommendations.length,
          domainFilter: domains ?? "all",
        });
      })
      .catch(async (err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        await failDashboardJob(runId, errMsg);
        logger.error("Dashboard Engine generation failed (async)", {
          runId,
          error: errMsg,
        });
      });

    return NextResponse.json({
      runId,
      status: "generating",
      domains: domains ?? null,
      message: domains
        ? `Regenerating ${domains.length} dashboard${domains.length !== 1 ? "s" : ""}. Poll /generate/status for progress.`
        : "Dashboard Engine generation started. Poll /generate/status for progress.",
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
