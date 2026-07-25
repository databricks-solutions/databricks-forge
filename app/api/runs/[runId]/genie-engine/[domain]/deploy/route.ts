/**
 * API: /api/runs/[runId]/genie-engine/[domain]/deploy
 *
 * POST -- Deploy a single domain's Genie space to Databricks.
 *         Creates (or updates) the space via the Genie REST API and
 *         tracks the deployment in Lakebase.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "@/lib/dbx/client";
import { createGenieSpace, updateGenieSpace, DEFAULT_GENIE_PARENT_PATH } from "@/lib/dbx/genie";
import { getGenieRecommendationsByRunId } from "@/lib/lakebase/genie-recommendations";
import {
  listTrackedGenieSpaces,
  trackGenieSpaceCreated,
  trackGenieSpaceUpdated,
} from "@/lib/lakebase/genie-spaces";
import { logger } from "@/lib/logger";
import type { GenieAuthMode } from "@/lib/settings";
import { revalidateSerializedSpace } from "@/lib/genie/deploy-validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

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

    const recs = await getGenieRecommendationsByRunId(runId);
    const rec = recs.find((r) => r.domain.toLowerCase() === decodedDomain.toLowerCase());

    if (!rec) {
      return NextResponse.json(
        { error: `No recommendation found for domain "${decodedDomain}"` },
        { status: 404 },
      );
    }

    const config = getConfig();
    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    const authMode = (body.authMode as GenieAuthMode) || undefined;
    const validation = await revalidateSerializedSpace(rec.serializedSpace);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.error,
          code: validation.code,
          diagnostics: validation.diagnostics ?? null,
        },
        { status: 409 },
      );
    }

    // Check if there's already a tracked space for this run+domain
    const tracked = await listTrackedGenieSpaces({ runId });
    const existing = tracked.find(
      (t) => t.domain.toLowerCase() === decodedDomain.toLowerCase() && t.status !== "trashed",
    );

    let spaceId: string;
    let action: "created" | "updated";

    if (existing) {
      // Update existing space
      const result = await updateGenieSpace(existing.spaceId, {
        title: rec.title,
        description: rec.description,
        serializedSpace: rec.serializedSpace,
        authMode,
      });
      spaceId = result.space_id;
      action = "updated";

      await trackGenieSpaceUpdated(existing.spaceId, rec.title);
    } else {
      // Create new space
      const parentPath = body.parentPath ?? DEFAULT_GENIE_PARENT_PATH;

      const result = await createGenieSpace({
        title: rec.title,
        description: rec.description,
        serializedSpace: rec.serializedSpace,
        warehouseId: config.warehouseId,
        parentPath,
        authMode,
      });
      spaceId = result.space_id;
      action = "created";

      await trackGenieSpaceCreated(
        uuidv4(),
        spaceId,
        runId,
        rec.domain,
        rec.title,
        undefined,
        authMode,
        guard.user.email,
      );
    }

    logger.info(`Genie space ${action}`, {
      runId,
      domain: decodedDomain,
      spaceId,
    });

    return NextResponse.json({
      success: true,
      spaceId,
      action,
      domain: rec.domain,
      databricksHost: config.host,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Genie space deploy failed", {
      error: message,
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
