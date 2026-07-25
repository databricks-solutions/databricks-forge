/**
 * API: /api/genie-spaces/[spaceId]/benchmarks/feedback
 *
 * POST -- Save labeled results (correct/incorrect + optional feedback text).
 */

import { NextRequest, NextResponse } from "next/server";
import { updateBenchmarkFeedback } from "@/lib/lakebase/space-health";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
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
    const { benchmarkRunId, feedback } = body as {
      benchmarkRunId: string;
      feedback: Array<{
        question: string;
        isCorrect: boolean;
        feedbackText?: string;
        expectedSql?: string;
      }>;
    };

    if (!benchmarkRunId || !Array.isArray(feedback)) {
      return NextResponse.json(
        { error: "benchmarkRunId and feedback array are required" },
        { status: 400 },
      );
    }

    await updateBenchmarkFeedback(benchmarkRunId, JSON.stringify(feedback));

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
