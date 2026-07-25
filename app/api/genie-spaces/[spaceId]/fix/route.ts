/**
 * API: /api/genie-spaces/[spaceId]/fix
 *
 * POST -- Run fix strategies for failed health checks and return diff preview.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { runFixes } from "@/lib/genie/space-fixer";
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

    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { checks } = body as { checks: string[] };

    if (!Array.isArray(checks) || checks.length === 0) {
      return NextResponse.json({ error: "checks array is required" }, { status: 400 });
    }

    let serializedSpace = getSpaceCache(spaceId);
    if (!serializedSpace) {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      setSpaceCache(spaceId, serializedSpace);
    }

    const result = await runFixes({ checkIds: checks, serializedSpace, spaceId });

    return NextResponse.json({
      updatedSerializedSpace: JSON.stringify(result.updatedSpace),
      changes: result.changes,
      strategiesRun: result.strategiesRun,
      originalSerializedSpace: serializedSpace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Fix workflow failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
