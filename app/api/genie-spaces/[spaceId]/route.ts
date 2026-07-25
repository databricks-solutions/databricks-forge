/**
 * API: /api/genie-spaces/[spaceId]
 *
 * PATCH  -- Update a Genie space
 * DELETE -- Trash a Genie space, optionally dropping deployed assets from UC
 */

import { NextRequest, NextResponse } from "next/server";
import { updateGenieSpace, trashGenieSpace } from "@/lib/dbx/genie";
import { executeSQL } from "@/lib/dbx/sql";
import {
  trackGenieSpaceUpdated,
  trackGenieSpaceTrashed,
  getSpaceAuthMode,
} from "@/lib/lakebase/genie-spaces";
import { deleteCachedSpace } from "@/lib/lakebase/genie-space-cache";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { isSafeId, validateFqn } from "@/lib/validation";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }
    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
    if (!guard.ok) return guard.response;
    const body = await request.json();
    const { title, description, serializedSpace } = body as {
      title?: string;
      description?: string;
      serializedSpace?: string;
    };

    const authMode = await getSpaceAuthMode(spaceId);
    const result = await updateGenieSpace(spaceId, {
      title,
      description,
      serializedSpace,
      authMode,
    });

    await trackGenieSpaceUpdated(spaceId, title);

    return NextResponse.json({
      spaceId: result.space_id,
      title: result.title,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }
    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
    if (!guard.ok) return guard.response;
    if (!guard.value.offPlatform && guard.permission !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can delete a Genie space." },
        { status: 403 },
      );
    }

    // Parse optional body for asset cleanup
    let dropAssets = false;
    let assetsToDelete: { functions: string[]; metricViews: string[] } | undefined;
    try {
      const body = await request.json();
      dropAssets = body.dropAssets === true;
      if (body.assetsToDelete) {
        assetsToDelete = body.assetsToDelete as { functions: string[]; metricViews: string[] };
      }
    } catch {
      // No body or invalid JSON -- proceed without asset cleanup
    }

    // Drop assets from Unity Catalog before trashing the space
    const dropResults: { fqn: string; type: string; success: boolean; error?: string }[] = [];
    if (dropAssets && assetsToDelete) {
      for (const fqn of assetsToDelete.metricViews) {
        try {
          validateFqn(fqn, "metric view to drop");
          await executeSQL(`DROP VIEW IF EXISTS ${fqn}`);
          dropResults.push({ fqn, type: "metric_view", success: true });
          logger.info("Dropped metric view during space cleanup", { spaceId, fqn });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dropResults.push({ fqn, type: "metric_view", success: false, error: msg });
          logger.warn("Failed to drop metric view during space cleanup", {
            spaceId,
            fqn,
            error: msg,
          });
        }
      }
    }

    const authMode = await getSpaceAuthMode(spaceId);
    await trashGenieSpace(spaceId, authMode);
    await Promise.all([trackGenieSpaceTrashed(spaceId), deleteCachedSpace(spaceId)]);

    return NextResponse.json({
      success: true,
      ...(dropResults.length > 0 ? { dropResults } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
