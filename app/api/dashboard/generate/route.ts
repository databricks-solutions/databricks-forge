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
import {
  DashboardDraftReadBackDisabledError,
  DashboardMutationUntrackableError,
  DashboardReadBackValidationError,
} from "@/lib/dashboard/deploy-lifecycle";
import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/auth/route-user";
import { logActivity } from "@/lib/lakebase/activity-log";
import { DEFAULT_DASHBOARD_PARENT_PATH } from "@/lib/dbx/dashboards";

function validateTables(tables: unknown): string[] | null {
  if (!Array.isArray(tables) || tables.length === 0) return null;
  const valid = (tables as string[]).filter(
    (t) => typeof t === "string" && t.split(".").length >= 3,
  );
  return valid.length > 0 ? valid : null;
}

export async function POST(request: NextRequest) {
  // Captured for the failure branches: an app-M2M draft can already exist in the
  // workspace when read-back rejects it, and that persisted outcome must be
  // audited against the caller who triggered it.
  let callerEmail: string | null = null;
  try {
    const user = await requireUser(request);
    callerEmail = user.email;
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
    });

    // Forge-owned app-M2M deployments follow the same persisted-outcome audit
    // semantics as the run-scoped deploy route: the verified draft is always
    // recorded, then the observed publication outcome is recorded separately.
    if (deploy === true && result.dashboardId) {
      await logActivity("dashboard_draft_deployed", {
        userId: user.email,
        resourceId: result.dashboardId,
        metadata: {
          displayName: result.displayName ?? result.recommendation.title,
          path: DEFAULT_DASHBOARD_PARENT_PATH,
          publicationStatus: result.publicationStatus ?? "draft",
        },
      });
      if (result.publicationStatus === "published") {
        await logActivity("dashboard_published", {
          userId: user.email,
          resourceId: result.dashboardId,
          metadata: {
            domain: result.recommendation.domain,
            dashboardId: result.dashboardId,
          },
        });
      } else if (result.publicationStatus === "publish_failed") {
        await logActivity("dashboard_publish_failed", {
          userId: user.email,
          resourceId: result.dashboardId,
          metadata: {
            domain: result.recommendation.domain,
            dashboardId: result.dashboardId,
          },
        });
      }
    }

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
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Ad-hoc dashboard generation failed", { error: message });
    if (error instanceof DashboardDraftReadBackDisabledError) {
      return NextResponse.json(
        { success: false, code: error.code, error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof DashboardMutationUntrackableError) {
      // No dashboard ID was observed, so there is nothing safe to audit: the
      // mutation cannot be attributed to a workspace asset.
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
    if (error instanceof DashboardReadBackValidationError) {
      // Mirrors the run-scoped deploy route: the app-M2M create/update already
      // landed, so the verified-draft outcome and the read-back rejection are
      // both recorded before the structured failure is returned.
      if (callerEmail && error.dashboardId) {
        const identity = {
          dashboardId: error.dashboardId,
          expectedDashboardId: error.expectedDashboardId,
          observedDashboardId: error.observedDashboardId,
        };
        await logActivity("dashboard_draft_deployed", {
          userId: callerEmail,
          resourceId: error.dashboardId,
          metadata: {
            displayName: error.displayName,
            path: DEFAULT_DASHBOARD_PARENT_PATH,
            publicationStatus: "draft",
            ...identity,
          },
        });
        await logActivity("dashboard_readback_failed", {
          userId: callerEmail,
          resourceId: error.dashboardId,
          metadata: {
            ...identity,
            stage: "dashboard_read_back",
            evidenceCodes: error.evidence
              .filter((item) => item.status === "failed")
              .map((item) => item.code),
          },
        });
      }
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          dashboardId: error.dashboardId,
          expectedDashboardId: error.expectedDashboardId,
          observedDashboardId: error.observedDashboardId,
          displayName: error.displayName,
          publicationStatus: "draft",
          validationEvidence: error.evidence,
        },
        { status: 422 },
      );
    }
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
