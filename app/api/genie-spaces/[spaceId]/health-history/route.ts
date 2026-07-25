/**
 * API: /api/genie-spaces/[spaceId]/health-history
 *
 * GET -- Retrieve health score history for trending/sparkline display.
 */

import { NextRequest, NextResponse } from "next/server";
import { getHealthScoreHistory } from "@/lib/lakebase/space-health";
import { isSafeId } from "@/lib/validation";
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

    const scores = await getHealthScoreHistory(spaceId);

    const history = scores.map((s) => ({
      id: s.id,
      score: s.score,
      grade: s.grade,
      triggeredBy: s.triggeredBy,
      measuredAt: s.measuredAt,
    }));

    const trend =
      history.length >= 2
        ? history[0].score > history[history.length - 1].score
          ? "improving"
          : history[0].score < history[history.length - 1].score
            ? "declining"
            : "stable"
        : "insufficient_data";

    return NextResponse.json({ history, trend });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
