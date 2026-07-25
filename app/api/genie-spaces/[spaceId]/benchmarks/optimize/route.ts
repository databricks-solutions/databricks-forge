/**
 * API: /api/genie-spaces/[spaceId]/benchmarks/optimize
 *
 * POST -- Generate field-level optimization suggestions from benchmark feedback.
 *         Uses LLM to analyze the space config + labeled feedback and propose
 *         specific field-path changes with rationale.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { getBenchmarkRun } from "@/lib/lakebase/space-health";
import { generateOptimizations } from "@/lib/genie/optimize";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import type { FeedbackEntry } from "@/lib/genie/benchmark-feedback";

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
    const { benchmarkRunId } = body as { benchmarkRunId: string };

    if (!benchmarkRunId) {
      return NextResponse.json({ error: "benchmarkRunId is required" }, { status: 400 });
    }

    const run = await getBenchmarkRun(benchmarkRunId);
    if (!run) {
      return NextResponse.json({ error: "Benchmark run not found" }, { status: 404 });
    }

    const feedback: FeedbackEntry[] = run.feedbackJson ? JSON.parse(run.feedbackJson) : [];
    if (feedback.length === 0) {
      return NextResponse.json(
        { error: "No feedback has been submitted for this run" },
        { status: 400 },
      );
    }

    let serializedSpace = getSpaceCache(spaceId);
    if (!serializedSpace) {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      setSpaceCache(spaceId, serializedSpace);
    }

    const space = JSON.parse(serializedSpace);
    const result = await generateOptimizations(space, feedback);

    logger.info("Field-level optimization generated", {
      spaceId,
      suggestions: result.suggestions.length,
    });

    return NextResponse.json({
      suggestions: result.suggestions,
      summary: result.summary,
      originalSerializedSpace: serializedSpace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Field-level optimization failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
