/**
 * API: /api/genie-spaces/[spaceId]/clone
 *
 * POST -- Clone a Genie Space (for "Clone + Fix" workflow on off-platform spaces).
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace, createGenieSpace } from "@/lib/dbx/genie";
import { getConfig } from "@/lib/dbx/client";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";

export async function POST(
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

    let serializedSpace = getSpaceCache(spaceId);
    let originalTitle = "Untitled";

    if (!serializedSpace) {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      originalTitle = spaceResponse.title ?? originalTitle;
      setSpaceCache(spaceId, serializedSpace);
    }

    const config = getConfig();
    const cloneTitle = `${originalTitle} (Forge Copy)`;

    const oboToken = request.headers.get("x-forwarded-access-token") ?? undefined;
    const result = await createGenieSpace({
      title: cloneTitle,
      description: `Cloned from space ${spaceId} for health check improvement.`,
      serializedSpace,
      warehouseId: config.warehouseId,
      oboToken,
    });

    logger.info("Space cloned for fix workflow", {
      originalSpaceId: spaceId,
      clonedSpaceId: result.space_id,
    });

    return NextResponse.json({
      clonedSpaceId: result.space_id,
      title: cloneTitle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Clone failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
