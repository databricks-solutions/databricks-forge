/**
 * API: /api/genie-spaces/[spaceId]/benchmarks/merge
 *
 * POST -- Merge selected optimization suggestions into a space config.
 *         Deterministic field-path merge (no LLM call).
 */

import { NextRequest, NextResponse } from "next/server";
import { mergeOptimizations, type OptimizationSuggestion } from "@/lib/genie/optimize";
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
    const { serializedSpace, suggestions } = body as {
      serializedSpace: string;
      suggestions: OptimizationSuggestion[];
    };

    if (!serializedSpace || !Array.isArray(suggestions)) {
      return NextResponse.json(
        { error: "serializedSpace and suggestions array are required" },
        { status: 400 },
      );
    }

    let space: Record<string, unknown>;
    try {
      space = JSON.parse(serializedSpace);
    } catch {
      return NextResponse.json({ error: "Invalid JSON in serializedSpace" }, { status: 400 });
    }
    const { mergedSpace, appliedCount, failedPaths } = mergeOptimizations(space, suggestions);

    logger.info("Config merge completed", { spaceId, appliedCount, failedPaths });

    return NextResponse.json({
      mergedSerializedSpace: JSON.stringify(mergedSpace),
      appliedCount,
      failedPaths,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Config merge failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
