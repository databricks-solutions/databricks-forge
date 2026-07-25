/**
 * API: /api/genie-spaces/[spaceId]/detail
 *
 * GET -- Returns the full space detail: serialized_space, parsed metadata,
 *        health report, and tracking info, in one call. Used by the space
 *        detail page to avoid multiple round-trips.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { runHealthCheck, enrichReportWithSqlQuality } from "@/lib/genie/space-health-check";
import { isReviewEnabled } from "@/lib/dbx/client";
import { getHealthCheckConfig } from "@/lib/lakebase/space-health";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { getTrackedBySpaceId } from "@/lib/lakebase/genie-spaces";
import { updateCachedSpaceDiscovery } from "@/lib/lakebase/genie-space-cache";
import { extractSpaceMetadata, parseSerializedSpace } from "@/lib/genie/space-metadata";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }
    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "read");
    if (!guard.ok) return guard.response;

    // Fetch space detail (OBO auth) and tracking info in parallel
    let serializedSpace = getSpaceCache(spaceId);
    let title = "";
    let description = "";

    if (!serializedSpace) {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      title = spaceResponse.title ?? "";
      description = spaceResponse.description ?? "";
      setSpaceCache(spaceId, serializedSpace);
    } else {
      // Still need basic info -- fetch without serialized_space
      try {
        const spaceResponse = await getGenieSpace(spaceId);
        title = spaceResponse.title ?? "";
        description = spaceResponse.description ?? "";
      } catch {
        // Use cached space only
      }
    }

    const [tracked, healthConfig] = await Promise.all([
      getTrackedBySpaceId(spaceId).catch(() => null),
      getHealthCheckConfig().catch(() => ({
        overrides: [],
        customChecks: [],
        categoryWeights: null,
      })),
    ]);

    const metadata = extractSpaceMetadata(serializedSpace);

    const parsed = parseSerializedSpace(serializedSpace);
    let healthReport = null;
    if (parsed) {
      healthReport = runHealthCheck(
        parsed,
        healthConfig.overrides.length > 0 ? healthConfig.overrides : undefined,
        healthConfig.customChecks.length > 0 ? healthConfig.customChecks : undefined,
        healthConfig.categoryWeights ?? undefined,
      );
      if (isReviewEnabled("health-check-sql-quality")) {
        healthReport = await enrichReportWithSqlQuality(parsed, healthReport);
      }
    }

    // Write back to Lakebase cache so listing page stays fresh
    updateCachedSpaceDiscovery(spaceId, {
      tableCount: metadata?.tableCount ?? null,
      measureCount: metadata?.measureCount ?? null,
      sampleQuestionCount: metadata?.sampleQuestionCount ?? null,
      filterCount: metadata?.filterCount ?? null,
      healthScore: healthReport?.overallScore ?? null,
      healthReportJson: healthReport ? JSON.stringify(healthReport) : null,
      permissionDenied: false,
    }).catch(() => {});

    return NextResponse.json({
      spaceId,
      // Forge tracking-row id (null for off-platform / untracked spaces).
      // The Share dialog and any other ACL helper must use this id, not
      // the Databricks `spaceId`, because `/api/share` resolves
      // `genie_space` ownership by tracking-row id.
      trackingId: tracked?.id ?? null,
      title: tracked?.title ?? title,
      description,
      domain: tracked?.domain ?? null,
      runId: tracked?.runId ?? null,
      status: tracked?.status ?? "active",
      source: tracked ? "pipeline" : "workspace",
      serializedSpace,
      metadata,
      healthReport,
      ownerEmail: tracked?.ownerEmail ?? null,
    });
  } catch (error) {
    const { spaceId: sid } = await params;
    const message = error instanceof Error ? error.message : "Unknown error";
    const isPermissionDenied = message.includes("(403)") || message.includes("PERMISSION_DENIED");
    logger.error("Space detail fetch failed", {
      error: message,
      permissionDenied: isPermissionDenied,
    });

    if (isPermissionDenied && isSafeId(sid)) {
      updateCachedSpaceDiscovery(sid, { permissionDenied: true }).catch(() => {});
    }

    return NextResponse.json(
      {
        error: isPermissionDenied
          ? "Permission denied — you do not have access to this space's underlying tables."
          : safeErrorMessage(error),
      },
      { status: isPermissionDenied ? 403 : 500 },
    );
  }
}
