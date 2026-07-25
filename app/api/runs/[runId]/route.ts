/**
 * API: /api/runs/[runId]
 *
 * GET    -- get run details including status, progress, and use cases
 * PATCH  -- update run metadata (e.g. retrospective industry assignment)
 * DELETE -- delete a run and all associated data
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getRunById,
  deleteRun,
  updateRunIndustry,
  failOrphanedRunningRun,
} from "@/lib/lakebase/runs";
import { getUseCasesByRunId, getUseCaseSummariesByRunId } from "@/lib/lakebase/usecases";
import { loadLineageFqnsForRun } from "@/lib/lakebase/metadata-cache";
import { getLatestScanIdForRun } from "@/lib/lakebase/environment-scans";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { isValidUUID } from "@/lib/validation";
import { logActivity } from "@/lib/lakebase/activity-log";
import { getAllIndustryOutcomes } from "@/lib/domain/industry-outcomes-server";
import { apiLogger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { getActivePipelineRunIds } from "@/lib/pipeline/engine";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { clearAclForResource } from "@/lib/lakebase/acl";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]", "GET", { runId });
  try {
    await ensureMigrated();
    const summary = new URL(request.url).searchParams.get("fields") === "summary";

    if (!isValidUUID(runId)) {
      log.warn("Invalid run ID", { errorCategory: "validation_failed" });
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    await failOrphanedRunningRun(runId, getActivePipelineRunIds());

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;
    const { run } = guard.value;

    // Only fetch use cases if the run is completed
    let useCases = undefined;
    let lineageDiscoveredFqns: string[] = [];
    let scanId: string | null = null;
    if (run.status === "completed") {
      const ucFetcher = summary ? getUseCaseSummariesByRunId(runId) : getUseCasesByRunId(runId);
      const [ucResult, fqnsResult, scanIdResult] = await Promise.allSettled([
        ucFetcher,
        loadLineageFqnsForRun(runId),
        getLatestScanIdForRun(runId, run.config.ucMetadata),
      ]);
      useCases = ucResult.status === "fulfilled" ? ucResult.value : undefined;
      lineageDiscoveredFqns = fqnsResult.status === "fulfilled" ? fqnsResult.value : [];
      scanId = scanIdResult.status === "fulfilled" ? scanIdResult.value : null;
    }

    return NextResponse.json(
      { run, useCases, lineageDiscoveredFqns, scanId, permission: guard.permission },
      {
        headers: {
          // Per-user content -- never cached on shared CDN.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("GET failed", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]", "PATCH", { runId });
  try {
    await ensureMigrated();

    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const { value, user } = guard;
    const runRow = value.run;

    if (runRow.status === "running") {
      return NextResponse.json({ error: "Cannot modify a running pipeline." }, { status: 409 });
    }

    const body = await request.json();
    const { industry } = body as { industry?: string | null };

    if (industry === undefined) {
      return NextResponse.json(
        { error: "No updatable field provided. Supported: industry" },
        { status: 400 },
      );
    }

    if (industry !== null && industry !== "") {
      const allOutcomes = await getAllIndustryOutcomes();
      const valid = allOutcomes.some((o) => o.id === industry);
      if (!valid) {
        return NextResponse.json(
          { error: `Unknown industry outcome map: ${industry}` },
          { status: 400 },
        );
      }
      await updateRunIndustry(runId, industry, false);
      log.info("Industry assigned retrospectively", { industry });
    } else {
      await updateRunIndustry(runId, "", false);
      log.info("Industry cleared");
    }

    logActivity("updated_run_industry", {
      userId: user.email,
      resourceId: runId,
      metadata: { industry: industry ?? "(cleared)" },
    });

    const updated = await getRunById(runId);
    return NextResponse.json({ run: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("PATCH failed", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]", "DELETE", { runId });
  try {
    await ensureMigrated();

    if (!isValidUUID(runId)) {
      log.warn("Invalid run ID", { errorCategory: "validation_failed" });
      return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
    }

    // Delete is owner-only. We use "edit" mode and additionally enforce
    // that the caller is the actual owner -- non-owner editors can re-run
    // but cannot delete.
    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const { value, user, permission } = guard;
    if (permission !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can delete a run." },
        { status: 403 },
      );
    }

    if (value.run.status === "running") {
      log.warn("Delete blocked -- run still in progress", { errorCategory: "conflict" });
      return NextResponse.json(
        { error: "Cannot delete a running pipeline. Wait for it to complete or fail." },
        { status: 409 },
      );
    }

    await deleteRun(runId);
    await clearAclForResource("run", runId);

    logActivity("deleted_run", {
      userId: user.email,
      resourceId: runId,
      metadata: { businessName: value.run.config.businessName },
    });

    log.info("Run deleted");
    return NextResponse.json({ deleted: true, runId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("DELETE failed", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
