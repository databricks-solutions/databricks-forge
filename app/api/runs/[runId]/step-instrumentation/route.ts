/**
 * GET /api/runs/[runId]/step-instrumentation
 *
 * Returns per-step rate-limit waiting / throttle counters for a single
 * pipeline run. Used by the run-detail UI to show "currently throttled"
 * or "waiting on rate limit" indicators.
 *
 * Counters live in process memory only (see
 * `lib/pipeline/step-instrumentation.ts`) so this endpoint is fast.
 * Authorization mirrors the run-detail route.
 */

import { NextRequest, NextResponse } from "next/server";
import { isValidUUID } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/error-utils";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { getStepCounters } from "@/lib/pipeline/step-instrumentation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;

    const counters = getStepCounters(runId);
    return NextResponse.json({ runId, counters });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
