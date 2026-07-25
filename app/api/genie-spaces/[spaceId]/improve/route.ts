/**
 * API: /api/genie-spaces/[spaceId]/improve
 *
 * POST -- Health-check-driven targeted improvement.  Diagnoses what the space
 *         is missing, then runs only the fix strategies needed.  Falls back
 *         to a full ad-hoc engine rebuild when mode: "full" is requested.
 *
 * GET  -- Poll improvement status for a space.
 *
 * DELETE -- Cancel a running improvement job.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace, sanitizeSerializedSpace } from "@/lib/dbx/genie";
import { runAdHocGenieEngine, type AdHocGenieConfig } from "@/lib/genie/adhoc-engine";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { parseSerializedSpace } from "@/lib/genie/space-metadata";
import { runHealthCheck } from "@/lib/genie/space-health-check";
import { runFixes } from "@/lib/genie/space-fixer";
import {
  startImproveJob,
  getImproveJob,
  updateImproveJob,
  completeImproveJob,
  failImproveJob,
  cancelImproveJob,
  dismissImproveJob,
  computeImproveStats,
  computeImproveChanges,
  type ImproveHealthDiagnostics,
} from "@/lib/genie/improve-jobs";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import type { GenieSpaceRecommendation } from "@/lib/genie/types";

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

    const existing = getImproveJob(spaceId);
    if (existing && existing.status === "generating") {
      return NextResponse.json(
        { error: "An improvement is already running for this space" },
        { status: 409 },
      );
    }

    let serializedSpace = getSpaceCache(spaceId);
    let title = "";
    let description = "";
    if (!serializedSpace) {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      title = spaceResponse.title ?? "";
      description = spaceResponse.description ?? "";
      setSpaceCache(spaceId, serializedSpace);
    } else {
      try {
        const spaceResponse = await getGenieSpace(spaceId);
        title = spaceResponse.title ?? "";
        description = spaceResponse.description ?? "";
      } catch {
        // proceed with cached space
      }
    }

    const parsed = parseSerializedSpace(serializedSpace);
    if (!parsed) {
      return NextResponse.json({ error: "Cannot parse space configuration" }, { status: 400 });
    }

    const tables = parsed.data_sources?.tables?.map((t) => t.identifier).filter(Boolean) ?? [];
    if (tables.length === 0) {
      return NextResponse.json({ error: "Space has no tables to improve" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const userConfig = (body as { config?: Partial<AdHocGenieConfig> }).config;
    const forceFullRebuild = userConfig?.mode === "full";

    const controller = startImproveJob(spaceId);

    if (forceFullRebuild) {
      runFullImprove(
        spaceId,
        tables,
        title,
        description,
        serializedSpace!,
        userConfig,
        controller,
        guard.value.ownerEmail,
      );
    } else {
      runTargetedImprove(spaceId, serializedSpace!, parsed, controller);
    }

    return NextResponse.json({ spaceId, status: "generating" });
  } catch (error) {
    logger.error("Improve endpoint error", { error: safeErrorMessage(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Targeted improve: run health check, identify gaps, fix only what's needed.
 */
function runTargetedImprove(
  spaceId: string,
  serializedSpace: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed: any,
  controller: AbortController,
): void {
  (async () => {
    try {
      updateImproveJob(spaceId, "Diagnosing space health...", 10);

      const report = runHealthCheck(parsed);

      const failedFixable = report.checks
        .filter((c) => !c.passed && c.fixable)
        .map((c) => ({ id: c.id, detail: c.detail }));

      const failedCheckIds = failedFixable.map((c) => c.id);

      logger.info("Improve: health check complete", {
        spaceId,
        score: report.overallScore,
        grade: report.grade,
        totalChecks: report.checks.length,
        failedFixable: failedCheckIds.length,
        failedCheckIds,
      });

      if (failedCheckIds.length === 0) {
        const stats = computeImproveStats(serializedSpace);
        const diagnostics: ImproveHealthDiagnostics = {
          healthScore: report.overallScore,
          grade: report.grade,
          failedChecks: [],
          strategiesRun: [],
          mode: "targeted",
        };
        completeImproveJob(spaceId, {
          originalSerializedSpace: serializedSpace,
          changes: [],
          statsBefore: stats,
          statsAfter: stats,
          diagnostics,
        });
        logger.info("Improve: space is healthy, no fixes needed", {
          spaceId,
          score: report.overallScore,
          grade: report.grade,
        });
        return;
      }

      updateImproveJob(
        spaceId,
        `Fixing ${failedCheckIds.length} issue${failedCheckIds.length !== 1 ? "s" : ""}...`,
        30,
      );

      const fixResult = await runFixes({
        checkIds: failedCheckIds,
        serializedSpace,
        spaceId,
      });

      const newSerializedSpace = JSON.stringify(fixResult.updatedSpace);
      const statsBefore = computeImproveStats(serializedSpace);
      const statsAfter = computeImproveStats(newSerializedSpace);
      const changes = computeImproveChanges(statsBefore, statsAfter);

      const diagnostics: ImproveHealthDiagnostics = {
        healthScore: report.overallScore,
        grade: report.grade,
        failedChecks: failedFixable,
        strategiesRun: fixResult.strategiesRun,
        mode: "targeted",
      };

      completeImproveJob(spaceId, {
        updatedSerializedSpace: newSerializedSpace,
        originalSerializedSpace: serializedSpace,
        changes: [
          ...fixResult.changes,
          ...changes.filter((c) => !fixResult.changes.some((fc) => fc.section === c.section)),
        ],
        statsBefore,
        statsAfter,
        diagnostics,
      });

      logger.info("Targeted improve complete", {
        spaceId,
        healthScore: report.overallScore,
        strategiesRun: fixResult.strategiesRun,
        changeCount: fixResult.changes.length,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Targeted improve failed", { spaceId, error: msg });
      failImproveJob(spaceId, msg);
    }
  })();
}

/**
 * Full rebuild: extract tables and run the full ad-hoc engine (legacy path).
 */
function runFullImprove(
  spaceId: string,
  tables: string[],
  title: string,
  description: string,
  serializedSpace: string,
  userConfig: Partial<AdHocGenieConfig> | undefined,
  controller: AbortController,
  ownerEmail: string | null | undefined,
): void {
  const config: AdHocGenieConfig = {
    mode: "full",
    title,
    description,
    generateBenchmarks: true,
    generateTrustedAssets: true,
    ...userConfig,
  };

  logger.info("Starting Genie Engine full improvement", {
    spaceId,
    tableCount: tables.length,
    title,
  });

  runAdHocGenieEngine({
    tables,
    ownerEmail,
    config,
    signal: controller.signal,
    onProgress: (message, percent) => {
      updateImproveJob(spaceId, message, percent);
    },
  })
    .then((engineResult) => {
      const newSerializedSpace = sanitizeSerializedSpace(
        engineResult.recommendation.serializedSpace,
      );

      const statsBefore = computeImproveStats(serializedSpace);
      const statsAfter = computeImproveStats(newSerializedSpace);
      const changes = computeImproveChanges(statsBefore, statsAfter);

      const recommendation: GenieSpaceRecommendation = {
        ...engineResult.recommendation,
        serializedSpace: newSerializedSpace,
      };

      completeImproveJob(spaceId, {
        recommendation,
        originalSerializedSpace: serializedSpace,
        changes,
        statsBefore,
        statsAfter,
        diagnostics: {
          healthScore: 0,
          grade: "?",
          failedChecks: [],
          strategiesRun: [],
          mode: "full",
        },
      });

      logger.info("Genie Engine full improvement completed", {
        spaceId,
        changeCount: changes.length,
      });
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Genie Engine full improvement failed", { spaceId, error: msg });
      failImproveJob(spaceId, msg);
    });
}

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

    const job = getImproveJob(spaceId);
    if (!job) {
      return NextResponse.json({ status: "idle" });
    }

    return NextResponse.json({
      spaceId: job.spaceId,
      status: job.status,
      message: job.message,
      percent: job.percent,
      error: job.error,
      result: job.status === "completed" ? job.result : null,
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
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

    const action = request.nextUrl.searchParams.get("action");

    if (action === "dismiss") {
      dismissImproveJob(spaceId);
      return NextResponse.json({ spaceId, status: "dismissed" });
    }

    cancelImproveJob(spaceId);
    return NextResponse.json({ spaceId, status: "cancelled" });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
