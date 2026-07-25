/**
 * API: /api/dashboard/generate
 *
 * POST -- Generate (and optionally deploy) a Lakeview dashboard from a table
 *         list and Ask Forge conversation context.
 *
 *         Uses the ad-hoc dashboard engine which reuses the same LLM-powered
 *         pipeline as the run-based dashboard engine.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { DashboardValidationError, runAdHocDashboardEngine } from "@/lib/dashboard/adhoc-engine";
import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/auth/route-user";
import { DashboardScopeUnsupportedError } from "@/lib/dashboard/deploy-lifecycle";
import { isDashboardScopeUnsupportedError } from "@/lib/dbx/dashboard-capability";

function validateTables(tables: unknown): string[] | null {
  if (!Array.isArray(tables) || tables.length === 0) return null;
  const valid = (tables as string[]).filter(
    (t) => typeof t === "string" && t.split(".").length >= 3,
  );
  return valid.length > 0 ? valid : null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const {
      tables: rawTables,
      sqlBlocks,
      conversationSummary,
      widgetDescriptions,
      domainHint,
      title,
      deploy,
      publish,
      embedCredentials,
    } = body as {
      tables: unknown;
      sqlBlocks?: string[];
      conversationSummary?: string;
      widgetDescriptions?: string[];
      domainHint?: string;
      title?: string;
      deploy?: boolean;
      publish?: boolean;
      embedCredentials?: boolean;
    };

    const tables = validateTables(rawTables);
    if (!tables) {
      return NextResponse.json(
        { error: "At least one valid table FQN (catalog.schema.table) is required" },
        { status: 400 },
      );
    }
    if (deploy === true && !user.oboToken) {
      return NextResponse.json(
        { error: "User authorization is required for dashboard deployment" },
        { status: 401 },
      );
    }

    const result = await runAdHocDashboardEngine({
      tables,
      sqlBlocks: Array.isArray(sqlBlocks)
        ? sqlBlocks.filter((s): s is string => typeof s === "string" && s.length > 0)
        : undefined,
      conversationSummary:
        typeof conversationSummary === "string" ? conversationSummary : undefined,
      widgetDescriptions: Array.isArray(widgetDescriptions)
        ? widgetDescriptions.filter((s): s is string => typeof s === "string")
        : undefined,
      domainHint: typeof domainHint === "string" ? domainHint : undefined,
      title: typeof title === "string" ? title : undefined,
      deploy: deploy === true,
      publish: publish === true,
      embedCredentials: embedCredentials === true,
      oboToken: deploy === true ? (user.oboToken ?? undefined) : undefined,
    });

    const responseBody = {
      success: result.publicationStatus !== "publish_failed",
      recommendation: {
        title: result.recommendation.title,
        description: result.recommendation.description,
        domain: result.recommendation.domain,
        datasetCount: result.recommendation.datasetCount,
        widgetCount: result.recommendation.widgetCount,
      },
      dashboardId: result.dashboardId ?? null,
      displayName: result.displayName ?? null,
      dashboardUrl: result.dashboardUrl ?? null,
      publicationStatus: result.publicationStatus ?? null,
      ...(result.publishError && { error: result.publishError }),
    };
    return NextResponse.json(
      responseBody,
      result.publicationStatus === "publish_failed" ? { status: 502 } : undefined,
    );
  } catch (error) {
    if (isDashboardScopeUnsupportedError(error)) {
      const partial =
        error instanceof DashboardScopeUnsupportedError
          ? {
              draftCreated: true,
              dashboardId: error.dashboardId,
              displayName: error.displayName,
              publicationStatus: "draft",
              validationEvidence: error.evidence,
            }
          : { draftCreated: false };
      return NextResponse.json(
        {
          success: false,
          code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
          error:
            "Lakeview user operations are unavailable because Databricks Apps does not issue the required dashboards scope.",
          requiredScope: "dashboards",
          ...partial,
        },
        { status: 501 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Ad-hoc dashboard generation failed", { error: message });
    if (error instanceof DashboardValidationError) {
      return NextResponse.json(
        {
          error: message,
          validationStatus: "invalid",
          validationEvidence: error.evidence,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
