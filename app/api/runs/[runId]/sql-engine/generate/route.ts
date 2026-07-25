/**
 * API: /api/runs/[runId]/sql-engine/generate
 *
 * POST -- Run/re-run SQL generation for every use case in the run. Runs
 *         asynchronously; the client polls /generate/status for progress.
 *
 *         Mirrors /api/runs/[runId]/genie-engine/generate (dedup via 409,
 *         fire-and-forget .then/.catch, status module is the source of
 *         truth for polling).
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import { runSqlGeneration } from "@/lib/pipeline/steps/sql-generation";
import { PipelineCancelledError } from "@/lib/ai/agent";
import {
  startSqlJob,
  setSqlJobTotal,
  updateSqlJob,
  completeSqlJob,
  failSqlJob,
  cancelSqlJob,
  getSqlJobStatus,
  getSqlJobController,
} from "@/lib/pipeline/sql-engine-status";
import { logActivity } from "@/lib/lakebase/activity-log";
import { apiLogger } from "@/lib/logger";
import type { PipelineContext } from "@/lib/domain/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]/sql-engine/generate", "POST", { runId });
  try {
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;
    const user = guard.user;

    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Run must be completed to regenerate SQL" },
        { status: 400 },
      );
    }
    if (!run.businessContext) {
      return NextResponse.json(
        { error: "Run is missing business context (required for SQL generation)" },
        { status: 400 },
      );
    }

    const useCases = await getUseCasesByRunId(runId);
    if (useCases.length === 0) {
      return NextResponse.json({ error: "No use cases found" }, { status: 404 });
    }

    const metadata = await loadMetadataForRun(runId);
    if (!metadata) {
      return NextResponse.json({ error: "Metadata snapshot not found" }, { status: 404 });
    }

    const existing = await getSqlJobStatus(runId);
    if (existing?.status === "generating") {
      return NextResponse.json(
        { error: "SQL generation already in progress", status: "generating" },
        { status: 409 },
      );
    }

    await startSqlJob(runId);
    setSqlJobTotal(runId, useCases.length);
    const controller = getSqlJobController(runId);

    void logActivity("sql_engine_regenerated", {
      userId: user.email,
      resourceId: runId,
      metadata: { useCaseCount: useCases.length },
    });

    const ctx: PipelineContext = {
      run,
      metadata,
      filteredTables: [],
      useCases,
      lineageGraph: null,
      sampleData: null,
      discoveryResult: null,
      signal: controller?.signal,
      logger: undefined,
      ownerEmail: run.ownerEmail ?? user.email,
      oboToken: user.oboToken ?? null,
    };

    runSqlGeneration(ctx, runId, {
      signal: controller?.signal,
      streamPersistence: true,
      onProgress: (message, percent) => updateSqlJob(runId, message, percent),
    })
      .then(async (resultUcs) => {
        const generated = resultUcs.filter((uc) => uc.sqlStatus === "generated").length;
        const failed = resultUcs.filter((uc) => uc.sqlStatus === "failed").length;
        await completeSqlJob(runId, generated, failed);
        log.info("SQL Engine regeneration complete (async)", { generated, failed });
        void logActivity("sql_engine_completed", {
          userId: user.email,
          resourceId: runId,
          metadata: { generated, failed, total: resultUcs.length, manual: true },
        });

        // Recompute the `sql_generated_rate` quality metric so the run
        // quality baseline reflects the freshly regenerated SQL.
        try {
          const { insertQualityMetrics } = await import("@/lib/lakebase/quality-metrics");
          const rate = resultUcs.length > 0 ? generated / resultUcs.length : 0;
          await insertQualityMetrics([
            {
              metricType: "run",
              metricName: "sql_generated_rate",
              metricValue: rate,
              floorValue: 0.7,
              passed: rate >= 0.7,
              runId,
            },
          ]);
        } catch {
          /* non-fatal */
        }
      })
      .catch(async (err) => {
        if (err instanceof PipelineCancelledError) {
          log.info("SQL Engine regeneration cancelled (async)");
          await cancelSqlJob(runId);
          void logActivity("sql_engine_cancelled", { userId: user.email, resourceId: runId });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await failSqlJob(runId, msg);
        log.error("SQL Engine regeneration failed (async)", {
          error: msg,
          errorCategory: "engine_error",
        });
        void logActivity("sql_engine_failed", {
          userId: user.email,
          resourceId: runId,
          metadata: { error: msg.substring(0, 500), manual: true },
        });
      });

    return NextResponse.json({
      runId,
      status: "generating",
      total: useCases.length,
      message: "SQL generation started. Poll /generate/status for progress.",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("POST failed", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
