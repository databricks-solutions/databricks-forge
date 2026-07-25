/**
 * API: /api/runs/[runId]/prompt-logs
 *
 * GET -- get all prompt log entries for a run, with optional stats summary.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { getPromptLogsByRunId, getPromptLogStats } from "@/lib/lakebase/prompt-logs";
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
      logger.warn("Invalid run ID format for prompt-logs", {
        runId,
        route: "/api/runs/[runId]/prompt-logs",
      });
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;

    const [logs, stats] = await Promise.all([
      getPromptLogsByRunId(runId),
      getPromptLogStats(runId),
    ]);

    return NextResponse.json({ logs, stats });
  } catch (error) {
    logger.error("Failed to fetch prompt logs", {
      error: error instanceof Error ? error.message : String(error),
      route: "/api/runs/[runId]/prompt-logs",
      runId,
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
