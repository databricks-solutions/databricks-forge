/**
 * API: /api/runs/[runId]/exports
 *
 * GET -- get export history for a run.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { getExportsByRunId } from "@/lib/lakebase/exports";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { isValidUUID } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  let runId: string | undefined;
  try {
    await ensureMigrated();
    const resolved = await params;
    runId = resolved.runId;

    if (!isValidUUID(runId)) {
      logger.warn("Invalid run ID format for exports", {
        runId,
        route: "/api/runs/[runId]/exports",
      });
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;

    const exports = await getExportsByRunId(runId);

    return NextResponse.json({ exports });
  } catch (error) {
    logger.error("Failed to fetch exports", {
      error: error instanceof Error ? error.message : String(error),
      route: "/api/runs/[runId]/exports",
      runId,
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
