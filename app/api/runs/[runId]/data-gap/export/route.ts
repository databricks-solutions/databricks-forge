/**
 * GET /api/runs/[runId]/data-gap/export
 *
 * Stream a Databricks-branded .xlsx workbook of the Data Gap v2 analysis
 * for the given run, built from the latest persisted `DataGapResult`.
 *
 * Behaviour:
 *   - 200: returns the workbook with content-disposition `attachment`
 *   - 400: invalid runId or no industry configured
 *   - 403: caller has neither owner nor ACL access to the run
 *   - 404: no cached analysis available and the engine cannot compute one
 *
 * The route is read-only. It does NOT trigger a recompute on miss — when
 * a run has never run Data Gap, the caller should hit GET /data-gap
 * first (which auto-computes and caches) and then retry the export.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { isValidUUID } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getLatestDataGapAnalysisForRun } from "@/lib/lakebase/data-gap-analyses";
import { buildDataGapWorkbook } from "@/lib/export/data-gap-excel";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    await ensureMigrated();
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;
    const user = guard.user;

    if (!run.config.industry) {
      return NextResponse.json(
        { error: "No industry outcome map configured for this run" },
        { status: 400 },
      );
    }

    const cached = await getLatestDataGapAnalysisForRun(runId, user.email);
    if (!cached) {
      return NextResponse.json(
        {
          error:
            "No Data Gap analysis on file. Open the Data Asset Coverage card once to generate, then retry the export.",
        },
        { status: 404 },
      );
    }

    const buffer = await buildDataGapWorkbook(cached.result);
    const filename = `data-gap-onboarding-plan-${run.config.businessName.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("[data-gap export GET] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
