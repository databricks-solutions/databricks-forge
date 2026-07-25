/**
 * API: /api/runs/[runId]/dashboard-engine/[domain]/deploy
 *
 * POST -- Deploy a single domain's dashboard to Databricks.
 *         Creates (or updates) the dashboard via the Lakeview REST API
 *         and tracks the deployment in Lakebase.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { v4 as uuidv4 } from "uuid";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getConfig } from "@/lib/dbx/client";
import { DEFAULT_DASHBOARD_PARENT_PATH, getDashboard } from "@/lib/dbx/dashboards";
import {
  DashboardDraftReadBackDisabledError,
  DashboardMutationUntrackableError,
  DashboardReadBackValidationError,
  dashboardDeployDependencies,
  deployDashboardDraftAndVerify,
} from "@/lib/dashboard/deploy-lifecycle";
import {
  getDashboardRecommendationsByRunId,
  updateDashboardRecommendationPublication,
} from "@/lib/lakebase/dashboard-recommendations";
import {
  listTrackedDashboards,
  trackDashboardCreated,
  trackExactDashboardUpdate,
  trackDashboardUpdated,
} from "@/lib/lakebase/dashboards";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/lakebase/activity-log";
import { isDashboardValidationDeployable } from "@/lib/dashboard/deployability";
import {
  applyDashboardImproveDiff,
  fingerprintDashboardDesign,
  parseDashboardImproveDiff,
} from "@/lib/dashboard/improve-diff";
import { assembleLakeviewDashboard } from "@/lib/dashboard/assembler";
import { artifactFingerprint } from "@/lib/toolkit/artifact-fingerprint";
import { fingerprintSerializedDashboard } from "@/lib/dashboard/live-artifact";
import { isDashboardScopeUnsupportedError } from "@/lib/dbx/dashboard-capability";

function unsupportedScopeResponse(partial?: {
  dashboardId?: string;
  displayName?: string;
  validationEvidence?: unknown[];
}) {
  return NextResponse.json(
    {
      success: false,
      code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
      error:
        "Lakeview user operations are unavailable because Databricks Apps does not issue the required dashboards scope.",
      requiredScope: "dashboards",
      draftCreated: Boolean(partial?.dashboardId),
      publicationStatus: partial?.dashboardId ? "draft" : null,
      ...(partial?.dashboardId ? { dashboardId: partial.dashboardId } : {}),
      ...(partial?.displayName ? { displayName: partial.displayName } : {}),
      ...(partial?.validationEvidence ? { validationEvidence: partial.validationEvidence } : {}),
    },
    { status: 501 },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; domain: string }> },
) {
  try {
    const { runId, domain } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    const decodedDomain = decodeURIComponent(domain);

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const oboToken = guard.user.oboToken;
    const recs = await getDashboardRecommendationsByRunId(runId);
    const rec = recs.find((r) => r.domain.toLowerCase() === decodedDomain.toLowerCase());

    if (!rec) {
      return NextResponse.json(
        { error: `No dashboard recommendation found for domain "${decodedDomain}"` },
        { status: 404 },
      );
    }

    if (!isDashboardValidationDeployable(rec)) {
      return NextResponse.json(
        {
          error: "Dashboard deployment requires valid validation evidence",
          validationStatus: rec.validationStatus ?? "pending",
          validationEvidence: rec.validationEvidence ?? [],
        },
        { status: 422 },
      );
    }

    const isReuse = rec.classification === "reuse" || rec.recommendationType === "reuse";
    const isImprovement =
      rec.classification === "improve" || rec.recommendationType === "enhancement";
    if (isReuse || isImprovement) {
      try {
        const diff = parseDashboardImproveDiff(rec.improveDiff);
        if (
          !rec.existingAssetId ||
          !rec.improveBaseDesign ||
          diff.existingAssetId !== rec.existingAssetId
        ) {
          throw new Error("missing binding");
        }
        const recomputed = applyDashboardImproveDiff(rec.improveBaseDesign, diff);
        if (
          fingerprintDashboardDesign(recomputed) !== fingerprintDashboardDesign(rec.dashboardDesign)
        ) {
          throw new Error("design drift");
        }
        const canonicalSerialized = assembleLakeviewDashboard(recomputed);
        if (
          artifactFingerprint(canonicalSerialized) !==
          artifactFingerprint(JSON.parse(rec.serializedDashboard))
        ) {
          throw new Error("serialized drift");
        }
        const empty =
          diff.addDatasets.length === 0 &&
          diff.addWidgets.length === 0 &&
          diff.addFilters.length === 0;
        if (isReuse !== empty) throw new Error("classification drift");
      } catch (error) {
        if (isDashboardScopeUnsupportedError(error)) {
          return unsupportedScopeResponse();
        }
        return NextResponse.json(
          { error: "Dashboard improvement binding is missing, corrupt, or drifted" },
          { status: 422 },
        );
      }
    }

    if (isReuse) {
      if (!oboToken) {
        return NextResponse.json(
          { error: "User authorization is required to read an external dashboard" },
          { status: 401 },
        );
      }
      try {
        const live = await getDashboard(rec.existingAssetId!, {
          mode: "user",
          oboToken,
        });
        if (
          fingerprintSerializedDashboard(live.serialized_dashboard) !==
          rec.improveDiff!.liveBaseFingerprint
        ) {
          throw new Error("live dashboard changed");
        }
      } catch (error) {
        if (isDashboardScopeUnsupportedError(error)) {
          return unsupportedScopeResponse();
        }
        return NextResponse.json(
          { error: "The live dashboard base is missing, unreadable, or changed" },
          { status: 409 },
        );
      }
      return NextResponse.json({
        success: true,
        deployed: false,
        action: "reused",
        dashboardId: rec.existingAssetId,
        domain: rec.domain,
      });
    }

    if (
      isImprovement &&
      (!rec.existingAssetId ||
        !rec.improveDiff ||
        rec.improveDiff.existingAssetId !== rec.existingAssetId)
    ) {
      return NextResponse.json(
        { error: "Dashboard improvement requires a matching exact existing dashboard target" },
        { status: 422 },
      );
    }

    const config = getConfig();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const shouldPublish = body.publish === true;
    const embedCredentials = body.embedCredentials === true;
    const serializedDashboard = rec.serializedDashboard;

    // Check if there's already a tracked dashboard for this run+domain
    const tracked = await listTrackedDashboards(runId);
    const trackedForDomain = tracked.find(
      (t) => t.domain.toLowerCase() === decodedDomain.toLowerCase() && t.status !== "trashed",
    );
    const exactImprovementTarget = isImprovement ? rec.existingAssetId : undefined;
    const existing = exactImprovementTarget
      ? tracked.find((t) => t.dashboardId === exactImprovementTarget && t.status !== "trashed")
      : trackedForDomain;

    const mode = exactImprovementTarget || existing ? "update" : "create";
    const targetDashboardId = exactImprovementTarget ?? existing?.dashboardId;
    const action = mode === "update" ? "updated" : "created";
    if (isImprovement) {
      if (!oboToken) {
        return NextResponse.json(
          { error: "User authorization is required to read an external dashboard" },
          { status: 401 },
        );
      }
      try {
        const live = await getDashboard(rec.existingAssetId!, {
          mode: "user",
          oboToken,
        });
        if (
          fingerprintSerializedDashboard(live.serialized_dashboard) !==
          rec.improveDiff!.liveBaseFingerprint
        ) {
          throw new Error("live dashboard changed");
        }
      } catch (error) {
        if (isDashboardScopeUnsupportedError(error)) {
          return unsupportedScopeResponse();
        }
        return NextResponse.json(
          { error: "The live dashboard base is missing, unreadable, or changed" },
          { status: 409 },
        );
      }
    }
    let result;
    try {
      result = await deployDashboardDraftAndVerify(
        {
          mode,
          dashboardId: targetDashboardId,
          displayName: rec.title,
          serializedDashboard,
          warehouseId: config.warehouseId,
          parentPath: DEFAULT_DASHBOARD_PARENT_PATH,
          publish: shouldPublish,
          embedCredentials,
          auth: { mode: "app" },
        },
        dashboardDeployDependencies,
      );
      if (result.publicationStatus === "published" && !result.publishedAt) {
        const message = "Published dashboard result did not include observed publishedAt";
        throw new DashboardReadBackValidationError(
          result.dashboardId,
          result.displayName,
          message,
          [
            ...result.evidence,
            {
              stage: "dashboard_publication",
              status: "failed",
              code: "DASHBOARD_PUBLISHED_AT_MISSING",
              message,
              artifactRef: `dashboard:${result.dashboardId}`,
            },
          ],
        );
      }
    } catch (error) {
      if (error instanceof DashboardDraftReadBackDisabledError) {
        return NextResponse.json(
          {
            success: false,
            code: error.code,
            error: error.message,
          },
          { status: 409 },
        );
      }
      if (error instanceof DashboardMutationUntrackableError) {
        return NextResponse.json(
          {
            success: false,
            code: error.code,
            error: error.message,
            mutationObserved: error.mutationObserved,
            trackable: error.trackable,
          },
          { status: 502 },
        );
      }
      if (!(error instanceof DashboardReadBackValidationError)) throw error;
      const dashboardUrl = `${config.host}/sql/dashboardsv3/${error.dashboardId}`;
      const trackingOptions = {
        ownerEmail: guard.user.email,
        publicationStatus: "draft" as const,
        embedCredentials,
      };
      if (isImprovement && !existing) {
        await trackExactDashboardUpdate({
          id: uuidv4(),
          dashboardId: error.dashboardId,
          runId,
          domain: rec.domain,
          title: error.displayName,
          dashboardUrl,
          ...trackingOptions,
        });
      } else if (mode === "update") {
        await trackDashboardUpdated({
          id: existing!.id,
          title: error.displayName,
          publicationStatus: trackingOptions.publicationStatus,
          embedCredentials: trackingOptions.embedCredentials,
        });
      } else {
        await trackDashboardCreated(
          uuidv4(),
          error.dashboardId,
          runId,
          rec.domain,
          error.displayName,
          dashboardUrl,
          trackingOptions,
        );
      }
      await updateDashboardRecommendationPublication(runId, rec.domain, {
        publicationStatus: "draft",
        readBackEvidence: error.evidence,
      });
      await logActivity("dashboard_draft_deployed", {
        userId: guard.user.email,
        resourceId: runId,
        metadata: {
          domain: rec.domain,
          dashboardId: error.dashboardId,
          expectedDashboardId: error.expectedDashboardId,
          observedDashboardId: error.observedDashboardId,
          action,
          publicationStatus: "draft",
        },
      });
      await logActivity("dashboard_readback_failed", {
        userId: guard.user.email,
        resourceId: runId,
        metadata: {
          domain: rec.domain,
          dashboardId: error.dashboardId,
          expectedDashboardId: error.expectedDashboardId,
          observedDashboardId: error.observedDashboardId,
          stage: "dashboard_read_back",
        },
      });
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          dashboardId: error.dashboardId,
          expectedDashboardId: error.expectedDashboardId,
          observedDashboardId: error.observedDashboardId,
          displayName: error.displayName,
          action,
          publicationStatus: "draft",
          dashboardUrl,
          validationEvidence: error.evidence,
        },
        { status: 422 },
      );
    }

    const dashboardId = result.dashboardId;
    const dashboardUrl = `${config.host}/sql/dashboardsv3/${dashboardId}`;
    const publishedAt =
      result.publicationStatus === "published" && result.publishedAt
        ? new Date(result.publishedAt)
        : null;
    const trackingOptions = {
      ownerEmail: guard.user.email,
      publicationStatus: result.publicationStatus,
      publishedAt,
      embedCredentials,
    };

    if (isImprovement && !existing) {
      await trackExactDashboardUpdate({
        id: uuidv4(),
        dashboardId,
        runId,
        domain: rec.domain,
        title: result.displayName,
        dashboardUrl,
        ...trackingOptions,
      });
    } else if (mode === "update") {
      await trackDashboardUpdated({
        id: existing!.id,
        title: result.displayName,
        publicationStatus: trackingOptions.publicationStatus,
        publishedAt: trackingOptions.publishedAt,
        embedCredentials: trackingOptions.embedCredentials,
      });
    } else {
      await trackDashboardCreated(
        uuidv4(),
        dashboardId,
        runId,
        rec.domain,
        result.displayName,
        dashboardUrl,
        trackingOptions,
      );
    }
    await updateDashboardRecommendationPublication(runId, rec.domain, {
      publicationStatus: result.publicationStatus,
      publishedAt,
      readBackEvidence: result.evidence,
    });

    logger.info(`Dashboard ${action}`, {
      runId,
      domain: decodedDomain,
      dashboardId,
      publicationStatus: result.publicationStatus,
    });
    await logActivity("dashboard_draft_deployed", {
      userId: guard.user.email,
      resourceId: runId,
      metadata: {
        domain: rec.domain,
        dashboardId,
        action,
        publicationStatus: result.publicationStatus,
      },
    });
    if (isImprovement) {
      await logActivity("dashboard_improved", {
        userId: guard.user.email,
        resourceId: runId,
        metadata: {
          domain: rec.domain,
          dashboardId,
          publicationStatus: result.publicationStatus,
        },
      });
    }

    if (result.publicationStatus === "publish_failed") {
      await logActivity("dashboard_publish_failed", {
        userId: guard.user.email,
        resourceId: runId,
        metadata: { domain: rec.domain, dashboardId },
      });
      return NextResponse.json(
        {
          success: false,
          error: result.publishError ?? "Dashboard publication failed",
          dashboardId,
          displayName: result.displayName,
          action,
          domain: rec.domain,
          dashboardUrl,
          publicationStatus: result.publicationStatus,
          readBack: result.readBack,
          validationEvidence: result.evidence,
        },
        { status: 502 },
      );
    }

    if (result.publicationStatus === "published") {
      await logActivity("dashboard_published", {
        userId: guard.user.email,
        resourceId: runId,
        metadata: { domain: rec.domain, dashboardId },
      });
    }

    return NextResponse.json({
      success: true,
      dashboardId,
      displayName: result.displayName,
      action,
      domain: rec.domain,
      dashboardUrl,
      databricksHost: config.host,
      publicationStatus: result.publicationStatus,
      publishedAt: result.publishedAt ?? null,
      readBack: result.readBack,
      validationEvidence: result.evidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Dashboard deploy failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
