/**
 * API: /api/runs/compare
 *
 * GET -- compare two runs side by side, including prompt diffs,
 * metric comparison, token usage, and use case alignment.
 * Query params: ?runA=<uuid>&runB=<uuid>
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { compareRuns } from "@/lib/lakebase/run-comparison";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { isValidUUID } from "@/lib/validation";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    const { searchParams } = new URL(request.url);
    const runAId = searchParams.get("runA");
    const runBId = searchParams.get("runB");

    if (!runAId || !runBId || !isValidUUID(runAId) || !isValidUUID(runBId)) {
      logger.warn("Invalid or missing run IDs for compare", {
        runAId: runAId ?? null,
        runBId: runBId ?? null,
        route: "/api/runs/compare",
      });
      return NextResponse.json(
        { error: "Both runA and runB query params (valid UUIDs) are required" },
        { status: 400 },
      );
    }

    const guardA = await loadRunOrRespond(request, runAId, "read");
    if (!guardA.ok) return guardA.response;
    const guardB = await loadRunOrRespond(request, runBId, "read");
    if (!guardB.ok) return guardB.response;

    const result = await compareRuns(runAId, runBId);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    logger.error("Failed to compare runs", {
      error: error instanceof Error ? error.message : String(error),
      route: "/api/runs/compare",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
