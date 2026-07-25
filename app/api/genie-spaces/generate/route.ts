/**
 * API: /api/genie-spaces/generate
 *
 * POST   -- Start Genie Space generation from a table list.
 *           mode=fast (default): synchronous unless async=true.
 *           mode=fast + async=true: fire-and-forget, returns jobId.
 *           mode=full: async, returns jobId; the client polls GET for progress.
 * GET    -- Poll generation status by jobId.
 *           Without jobId: returns all non-evicted generate jobs (for dashboard tiles).
 * PATCH  -- Update a job (e.g. write deployedSpaceId after deploy).
 * DELETE -- Cancel a running generate job by jobId.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  runAdHocGenieEngine,
  runFastGenieEngine,
  type AdHocGenieConfig,
} from "@/lib/genie/adhoc-engine";
import type { GenieBuilderStep } from "@/lib/genie/builder-steps";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

interface AdHocJobStatus {
  jobId: string;
  ownerEmail: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  currentStep: GenieBuilderStep | null;
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  result: {
    recommendation: import("@/lib/genie/types").GenieSpaceRecommendation;
    mode: "fast" | "full";
  } | null;
  title?: string;
  domain?: string;
  tableCount?: number;
  source?: string;
  deployedSpaceId?: string;
  conversationSummary?: string;
  abortController?: AbortController;
}

const jobs = new Map<string, AdHocJobStatus>();
const JOB_TTL_MS = 30 * 60 * 1000;

function evictStale(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(id);
    } else if (!job.completedAt && now - job.startedAt > JOB_TTL_MS * 2) {
      jobs.delete(id);
    }
  }
}

function validateTables(tables: unknown): string[] | null {
  if (!Array.isArray(tables) || tables.length === 0) return null;
  const invalid = (tables as string[]).filter(
    (t) => typeof t !== "string" || t.split(".").length < 3,
  );
  if (invalid.length > 0) return null;
  return tables as string[];
}

function jobToResponse(job: AdHocJobStatus) {
  return {
    jobId: job.jobId,
    status: job.status,
    currentStep: job.currentStep,
    message: job.message,
    percent: job.percent,
    error: job.error,
    result: job.result,
    title: job.title,
    domain: job.domain,
    tableCount: job.tableCount,
    source: job.source,
    deployedSpaceId: job.deployedSpaceId,
    conversationSummary: job.conversationSummary,
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const {
      tables: rawTables,
      config,
      source,
      async: asyncMode,
    } = body as {
      tables: unknown;
      config?: AdHocGenieConfig;
      source?: string;
      async?: boolean;
    };

    const tables = validateTables(rawTables);
    if (!tables) {
      return NextResponse.json(
        { error: "At least one valid table FQN (catalog.schema.table) is required" },
        { status: 400 },
      );
    }

    const mode = config?.mode ?? "fast";

    if (mode === "fast" && !asyncMode) {
      evictStale();
      const jobId = uuidv4();
      jobs.set(jobId, {
        jobId,
        ownerEmail: user.email,
        status: "generating",
        currentStep: null,
        message: "Quick build in progress...",
        percent: 50,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        result: null,
        title: config?.title ?? undefined,
        domain: config?.domain ?? undefined,
        tableCount: tables.length,
        source: source ?? undefined,
        conversationSummary: config?.conversationSummary ?? undefined,
      });
      try {
        const result = await runFastGenieEngine({ tables, config });
        const quality = result.recommendation.quality;
        const job = jobs.get(jobId);
        if (job) {
          job.status = "completed";
          job.percent = 100;
          job.completedAt = Date.now();
          job.message = "Generation complete";
          job.result = { recommendation: result.recommendation, mode: "fast" };
          if (!job.title && result.recommendation.title) job.title = result.recommendation.title;
          if (!job.domain && result.recommendation.domain)
            job.domain = result.recommendation.domain;
        }
        return NextResponse.json({
          jobId,
          status: "completed",
          mode: "fast",
          quality,
          gateDecision: quality?.gateDecision ?? "allow",
          result: { recommendation: result.recommendation, mode: "fast" },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Fast Genie generation failed", { error: msg });
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.message = "Generation failed";
          job.error = msg;
          job.completedAt = Date.now();
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // -----------------------------------------------------------------------
    // Async mode: fire-and-forget for both fast+async and full mode
    // -----------------------------------------------------------------------
    const jobId = uuidv4();
    const now = Date.now();
    const abortController = new AbortController();
    const effectiveMode = mode === "fast" && asyncMode ? "fast" : "full";

    jobs.set(jobId, {
      jobId,
      ownerEmail: user.email,
      status: "generating",
      currentStep: null,
      message:
        effectiveMode === "fast" ? "Starting quick build..." : "Starting full Genie Engine...",
      percent: 0,
      startedAt: now,
      completedAt: null,
      error: null,
      result: null,
      title: config?.title ?? undefined,
      domain: config?.domain ?? undefined,
      tableCount: tables.length,
      source: source ?? undefined,
      conversationSummary: config?.conversationSummary ?? undefined,
      abortController,
    });

    const engineFn = effectiveMode === "fast" ? runFastGenieEngine : runAdHocGenieEngine;

    engineFn({
      tables,
      config,
      onProgress: (message, percent, step) => {
        const job = jobs.get(jobId);
        if (job && job.status === "generating") {
          job.message = message;
          job.percent = Math.min(99, percent);
          if (step) job.currentStep = step;
        }
      },
      signal: abortController.signal,
    })
      .then((result) => {
        const job = jobs.get(jobId);
        if (job && job.status === "generating") {
          job.status = "completed";
          const gateDecision = result.recommendation.quality?.gateDecision ?? "allow";
          const qualityWarnings = result.recommendation.quality?.degradedReasons.length ?? 0;
          job.message =
            gateDecision === "block"
              ? "Generation complete: deployment blocked by quality gate"
              : qualityWarnings > 0
                ? `Generation complete with ${qualityWarnings} warning${qualityWarnings === 1 ? "" : "s"}`
                : "Generation complete";
          job.percent = 100;
          job.currentStep = null;
          job.completedAt = Date.now();
          job.result = { recommendation: result.recommendation, mode: effectiveMode };
          if (!job.title && result.recommendation.title) job.title = result.recommendation.title;
          if (!job.domain && result.recommendation.domain)
            job.domain = result.recommendation.domain;
        }
      })
      .catch((err) => {
        const job = jobs.get(jobId);
        if (job && job.status === "generating") {
          const msg = err instanceof Error ? err.message : String(err);
          if (abortController.signal.aborted) {
            job.status = "cancelled";
            job.message = "Generation cancelled";
          } else {
            logger.error("Genie generation failed", { jobId, mode: effectiveMode, error: msg });
            job.status = "failed";
            job.message = "Generation failed";
            job.error = msg;
          }
          job.completedAt = Date.now();
        }
      });

    return NextResponse.json({ jobId, mode: effectiveMode });
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  evictStale();

  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const jobId = request.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    const allJobs = [...jobs.values()]
      .filter((j) => j.ownerEmail === user.email)
      .map(jobToResponse);
    return NextResponse.json(
      { jobs: allJobs },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const job = jobs.get(jobId);
  if (!job || job.ownerEmail !== user.email) {
    return NextResponse.json({ error: "Job not found or expired" }, { status: 404 });
  }

  return NextResponse.json(jobToResponse(job), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const { jobId, deployedSpaceId } = body as {
      jobId?: string;
      deployedSpaceId?: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const job = jobs.get(jobId);
    if (!job || job.ownerEmail !== user.email) {
      return NextResponse.json({ error: "Job not found or expired" }, { status: 404 });
    }

    if (deployedSpaceId) {
      job.deployedSpaceId = deployedSpaceId;
    }

    return NextResponse.json({ success: true, ...jobToResponse(job) });
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query parameter required" }, { status: 400 });
  }

  const job = jobs.get(jobId);
  if (!job || job.ownerEmail !== user.email) {
    return NextResponse.json({ error: "Job not found or expired" }, { status: 404 });
  }

  if (job.status !== "generating") {
    return NextResponse.json({ error: "Job is not running" }, { status: 409 });
  }

  job.abortController?.abort();
  job.status = "cancelled";
  job.message = "Generation cancelled";
  job.completedAt = Date.now();

  logger.info("Generate job cancelled", { jobId });
  return NextResponse.json({ success: true });
}
