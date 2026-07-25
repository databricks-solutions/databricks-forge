/**
 * API: POST /api/assessment/dashboard
 *
 * Builds the Forge WAF Lakeview dashboard JSON, then creates or updates
 * a dashboard in the workspace under `/Shared/Forge Dashboards/`.
 * Idempotent: looks up an existing dashboard by display name; creates if
 * absent, updates the serialized payload if present. Optionally publishes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/dbx/client";
import { listDashboards, DEFAULT_DASHBOARD_PARENT_PATH } from "@/lib/dbx/dashboards";
import {
  dashboardDeployDependencies,
  deployDashboardDraftAndVerify,
} from "@/lib/dashboard/deploy-lifecycle";
import {
  WAF_DASHBOARD_DISPLAY_NAME,
  buildWafDashboardJson,
} from "@/lib/engines/waf-assessment/dashboard/builder";
import { handleApiError } from "@/lib/api-utils";
import { logger } from "@/lib/logger";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function POST(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const config = getConfig();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // The WAF dashboard is a workspace-shared asset; any user with the
    // app open can regenerate it. We deliberately do NOT honor a
    // client-supplied `parentPath` -- accepting one would let any
    // signed-in user write the dashboard into another user's private
    // workspace folder. Always use the canonical /Shared/... path.
    const parentPath = DEFAULT_DASHBOARD_PARENT_PATH;
    const shouldPublish = body.publish === true;
    const embedCredentials = body.embedCredentials === true;

    const serializedDashboard = await buildWafDashboardJson();

    const candidate = (await listDashboards()).find(
      (d) => d.display_name === WAF_DASHBOARD_DISPLAY_NAME,
    );
    const mode = candidate ? "update" : "create";
    const result = await deployDashboardDraftAndVerify(
      {
        mode,
        dashboardId: candidate?.dashboard_id,
        displayName: WAF_DASHBOARD_DISPLAY_NAME,
        serializedDashboard,
        warehouseId: config.warehouseId,
        parentPath,
        publish: shouldPublish,
        embedCredentials,
        auth: { mode: "app" },
      },
      dashboardDeployDependencies,
    );
    const dashboardId = result.dashboardId;
    const dashboardUrl = `${config.host}/sql/dashboardsv3/${dashboardId}`;

    logger.info(`WAF dashboard ${result.action}`, {
      dashboardId,
      by: user.email,
      publicationStatus: result.publicationStatus,
    });

    await logActivity("waf_dashboard_generated", {
      userId: user.email,
      resourceId: dashboardId,
      metadata: {
        action: result.action,
        publicationStatus: result.publicationStatus,
      },
    });

    const responseBody = {
      success: result.publicationStatus !== "publish_failed",
      action: result.action,
      dashboardId,
      displayName: result.displayName,
      dashboardUrl,
      publicationStatus: result.publicationStatus,
      publishedAt: result.publishedAt ?? null,
      readBack: result.readBack,
      validationEvidence: result.evidence,
      ...(result.publishError && { error: result.publishError }),
    };
    return NextResponse.json(
      responseBody,
      result.publicationStatus === "publish_failed" ? { status: 502 } : undefined,
    );
  } catch (error) {
    return handleApiError(error, "/api/assessment/dashboard");
  }
}
