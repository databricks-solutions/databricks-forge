/**
 * API: /api/runs/[runId]/genie-engine/generate
 *
 * POST -- Run/re-run the Genie Engine with the current config.
 *         Runs asynchronously; the client polls /generate/status for progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import { getGenieEngineConfig } from "@/lib/lakebase/genie-engine-config";
import { saveGenieRecommendations } from "@/lib/lakebase/genie-recommendations";
import { runGenieEngine, EngineCancelledError } from "@/lib/genie/engine";
import {
  startJob,
  getJobController,
  updateJob,
  updateJobDomainProgress,
  addCompletedDomainName,
  initDomainList,
  updateDomainPhase,
  completeJob,
  failJob,
  getJobStatus,
} from "@/lib/genie/engine-status";
import { getDiscoveryResultsByRunId } from "@/lib/lakebase/discovered-assets";
import { apiLogger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]/genie-engine/generate", "POST", { runId });
  try {
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    // Parse optional domain filter from request body
    let domains: string[] | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body?.domains) && body.domains.length > 0) {
        domains = body.domains.filter((d: unknown) => typeof d === "string" && d.length > 0);
        if (domains!.length === 0) domains = undefined;
      }
    } catch {
      // No body or invalid JSON -- regenerate all domains
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;
    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Run must be completed to generate Genie spaces" },
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

    const existingJob = await getJobStatus(runId);
    if (existingJob?.status === "generating") {
      return NextResponse.json(
        { error: "Genie generation already in progress", status: "generating" },
        { status: 409 },
      );
    }

    const { config, version } = await getGenieEngineConfig(runId);

    // Load existing spaces from asset discovery (if available) for enhancement detection
    let existingSpaces: import("@/lib/discovery/types").DiscoveredGenieSpace[] | undefined;
    try {
      const discoveryData = await getDiscoveryResultsByRunId(runId);
      if (discoveryData?.genieSpaces?.length) {
        existingSpaces = discoveryData.genieSpaces.map((s) => ({
          spaceId: s.spaceId,
          title: s.title,
          description: null,
          tables: s.tables,
          metricViews: s.metricViews,
          sampleQuestionCount: s.sampleQuestionCount,
          measureCount: s.measureCount,
          filterCount: s.filterCount,
          instructionLength: 0,
        }));
      }
    } catch {
      /* non-critical */
    }

    await startJob(runId);
    const controller = getJobController(runId);

    runGenieEngine({
      run,
      useCases,
      metadata,
      config,
      sampleData: null,
      existingSpaces,
      domainFilter: domains,
      signal: controller?.signal,
      onProgress: (message, percent, completedDomains, totalDomains, completedDomainName) => {
        updateJob(runId, message, percent);
        updateJobDomainProgress(runId, completedDomains, totalDomains);
        if (completedDomainName) {
          addCompletedDomainName(runId, completedDomainName);
        }
      },
      onDomainsReady: (domains) => initDomainList(runId, domains),
      onDomainPhase: (domain, phase) => updateDomainPhase(runId, domain, phase),
    })
      .then(async (result) => {
        const job = await getJobStatus(runId);
        if (job?.status === "cancelled") {
          log.info("Genie Engine generation cancelled, skipping save");
          return;
        }
        await saveGenieRecommendations(
          runId,
          result.recommendations,
          result.passOutputs,
          version,
          domains,
        );
        await completeJob(runId, result.recommendations.length);
        if (result.failedDomains.length > 0) {
          log.warn("Genie Engine completed with domain failures", {
            failedDomains: result.failedDomains,
            errorCategory: "domain_processing",
          });
        }
        log.info("Genie Engine generation complete (async)", {
          recommendationCount: result.recommendations.length,
          failedDomainCount: result.failedDomains.length,
          configVersion: version,
          domainFilter: domains ?? "all",
        });
      })
      .catch(async (err) => {
        if (err instanceof EngineCancelledError) {
          log.info("Genie Engine generation cancelled (async)");
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        await failJob(runId, errMsg);
        log.error("Genie Engine generation failed (async)", {
          error: errMsg,
          errorCategory: "engine_error",
        });
      });

    return NextResponse.json({
      runId,
      status: "generating",
      configVersion: version,
      domains: domains ?? null,
      message: domains
        ? `Regenerating ${domains.length} domain${domains.length !== 1 ? "s" : ""}. Poll /generate/status for progress.`
        : "Genie Engine generation started. Poll /generate/status for progress.",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("POST failed", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
