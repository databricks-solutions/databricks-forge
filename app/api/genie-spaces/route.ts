/**
 * API: /api/genie-spaces
 *
 * GET  -- List Genie spaces from Lakebase cache + tracking data (fast).
 *         With ?deployJobId=... : poll deploy job status.
 * POST -- Create a new Genie space (fire-and-forget with polling).
 *         Returns { jobId } immediately; client polls GET ?deployJobId=...
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "@/lib/dbx/client";
import { createGenieSpace } from "@/lib/dbx/genie";
import { listTrackedGenieSpaces, trackGenieSpaceCreated } from "@/lib/lakebase/genie-spaces";
import {
  listCachedSpaces,
  getCacheSyncTimestamp,
  upsertCachedSpaces,
} from "@/lib/lakebase/genie-space-cache";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import type { GenieAuthMode } from "@/lib/settings";
import { revalidateSerializedSpace } from "@/lib/genie/deploy-validation";
import { validateFqn } from "@/lib/validation";
import {
  deployMetricViews,
  patchSpaceWithMetricViews,
  type MetricViewDeployResult,
} from "@/lib/genie/deploy";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { checkQuota } from "@/lib/quotas";
import { recordUsage } from "@/lib/lakebase/usage";

// ---------------------------------------------------------------------------
// Deploy job tracker (in-memory, same pattern as generate route)
// ---------------------------------------------------------------------------

interface DeployJobStatus {
  jobId: string;
  status: "deploying" | "completed" | "failed";
  message: string;
  startedAt: number;
  completedAt: number | null;
  result: {
    spaceId: string;
    title: string;
    trackingId: string;
    metricViewResults?: MetricViewDeployResult[];
  } | null;
  error: string | null;
}

const deployJobs = new Map<string, DeployJobStatus>();
const DEPLOY_JOB_TTL_MS = 30 * 60 * 1000;

function evictStaleDeployJobs(): void {
  const now = Date.now();
  for (const [id, job] of deployJobs) {
    if (job.completedAt && now - job.completedAt > DEPLOY_JOB_TTL_MS) {
      deployJobs.delete(id);
    } else if (!job.completedAt && now - job.startedAt > DEPLOY_JOB_TTL_MS * 2) {
      deployJobs.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const deployJobId = request.nextUrl.searchParams.get("deployJobId");

  // Poll deploy job status
  if (deployJobId) {
    evictStaleDeployJobs();
    const job = deployJobs.get(deployJobId);
    if (!job) {
      return NextResponse.json({ error: "Deploy job not found or expired" }, { status: 404 });
    }
    return NextResponse.json({
      jobId: job.jobId,
      status: job.status,
      message: job.message,
      result: job.result,
      error: job.error,
    });
  }

  // Default: list from Lakebase cache (fast, no Databricks API calls).
  // Sync from Databricks is handled by POST /api/genie-spaces/sync.
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    // Workspace cache (`forge_genie_space_cache`) is shared because it
    // mirrors Databricks workspace state, not user-private Forge data.
    // Tracking rows are user-scoped (deployedBy / sharing).
    const [cached, tracked, sharedTrackingIds, lastSyncedAt] = await Promise.all([
      listCachedSpaces().catch(() => []),
      listTrackedGenieSpaces({ ownerEmail: user.email }).catch(() => []),
      listAccessibleIds(user.email, "genie_space").catch(() => []),
      getCacheSyncTimestamp().catch(() => null),
    ]);

    const sharedTracked = sharedTrackingIds.length
      ? await listTrackedGenieSpaces({ idsIn: sharedTrackingIds }).catch(() => [])
      : [];

    const merged = [...tracked, ...sharedTracked];
    const dedupedTracked = Array.from(new Map(merged.map((t) => [t.id, t])).values());
    const cachedIds = new Set(cached.map((c) => c.spaceId));

    const mergedSpaces = cached.map((c) => ({
      spaceId: c.spaceId,
      title: c.title,
      description: c.description,
      tableCount: c.tableCount,
      measureCount: c.measureCount,
      sampleQuestionCount: c.sampleQuestionCount,
      filterCount: c.filterCount,
      healthScore: c.healthScore,
      healthReportJson: c.healthReportJson,
      permissionDenied: c.permissionDenied,
      lastDiscoveredAt: c.lastDiscoveredAt,
    }));

    const liveTracked = dedupedTracked.filter(
      (t) => t.status === "trashed" || cachedIds.has(t.spaceId),
    );

    return NextResponse.json(
      {
        spaces: mergedSpaces,
        tracked: liveTracked,
        lastSyncedAt,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST handler (fire-and-forget)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const body = await request.json();
    const {
      title,
      description,
      serializedSpace,
      runId,
      domain,
      parentPath,
      authMode,
      quality,
      targetSchema,
      metricViews,
      resourcePrefix,
    } = body as {
      title: string;
      description: string;
      serializedSpace: string;
      runId?: string;
      domain: string;
      parentPath?: string;
      authMode?: GenieAuthMode;
      quality?: {
        gateDecision?: "allow" | "warn" | "block";
        promptVersion?: string;
      };
      targetSchema?: string;
      metricViews?: Array<{ name: string; ddl: string; description?: string }>;
      resourcePrefix?: string;
    };

    if (!title || !serializedSpace || !domain) {
      return NextResponse.json(
        { error: "Missing required fields: title, serializedSpace, domain" },
        { status: 400 },
      );
    }

    // Validate targetSchema format synchronously if provided
    if (targetSchema) {
      if (targetSchema.split(".").length !== 2) {
        return NextResponse.json(
          { error: "targetSchema must be in catalog.schema format" },
          { status: 400 },
        );
      }
      try {
        validateFqn(targetSchema, "targetSchema");
      } catch {
        return NextResponse.json(
          { error: "targetSchema contains invalid characters" },
          { status: 400 },
        );
      }
    }

    // Fire-and-forget: return jobId immediately, run deploy in background
    const jobId = uuidv4();

    deployJobs.set(jobId, {
      jobId,
      status: "deploying",
      message: "Starting deployment...",
      startedAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
    });

    recordUsage.genieDeploy(user.email).catch(() => {});

    const startDeploy = () =>
      runDeploy(jobId, {
        title,
        description,
        serializedSpace,
        runId,
        domain,
        parentPath,
        authMode,
        quality,
        targetSchema,
        metricViews,
        resourcePrefix,
        ownerEmail: user.email,
      }).catch((err) => {
        const job = deployJobs.get(jobId);
        if (job && job.status === "deploying") {
          job.status = "failed";
          job.message = "Deployment failed";
          job.error = safeErrorMessage(err);
          job.completedAt = Date.now();
        }
      });

    const quota = await checkQuota("genie_deploy", user.email, "reject");
    if (!quota.allowed) {
      const { enqueueDeferredJob } = await import("@/lib/scheduler/deferred-queue");
      const { position } = enqueueDeferredJob({
        kind: "genie_deploy",
        ownerEmail: user.email,
        run: startDeploy,
      });
      const job = deployJobs.get(jobId);
      if (job) {
        job.status = "deploying";
        job.message = `Queued (position ${position}) -- waiting for capacity.`;
      }
      return NextResponse.json({
        jobId,
        status: "queued",
        position,
        cap: quota.cap,
        active: quota.active,
      });
    }

    void startDeploy();
    return NextResponse.json({ jobId, status: "deploying" });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Background deploy logic
// ---------------------------------------------------------------------------

async function runDeploy(
  jobId: string,
  params: {
    title: string;
    description: string;
    serializedSpace: string;
    runId?: string;
    domain: string;
    parentPath?: string;
    authMode?: GenieAuthMode;
    quality?: { gateDecision?: "allow" | "warn" | "block"; promptVersion?: string };
    targetSchema?: string;
    metricViews?: Array<{ name: string; ddl: string; description?: string }>;
    resourcePrefix?: string;
    ownerEmail: string;
  },
): Promise<void> {
  const job = deployJobs.get(jobId);
  if (!job) return;

  // Step 1: Validate serialized space
  job.message = "Validating space configuration...";
  const validation = await revalidateSerializedSpace(params.serializedSpace);
  if (!validation.ok) {
    job.status = "failed";
    job.message = "Validation failed";
    job.error = validation.error;
    job.completedAt = Date.now();
    return;
  }

  // Step 2: Deploy metric views if provided
  let finalSerializedSpace = params.serializedSpace;
  const deployedMvFqns: string[] = [];
  let mvResults: MetricViewDeployResult[] = [];

  if (params.metricViews && params.metricViews.length > 0 && params.targetSchema) {
    job.message = `Deploying ${params.metricViews.length} metric view${params.metricViews.length !== 1 ? "s" : ""}...`;
    const mvDeploy = await deployMetricViews(
      params.metricViews,
      params.targetSchema,
      params.resourcePrefix,
    );
    mvResults = mvDeploy.results;
    deployedMvFqns.push(...mvDeploy.deployedFqns);
    finalSerializedSpace = patchSpaceWithMetricViews(params.serializedSpace, deployedMvFqns);
  }

  // Step 3: Create the Genie Space
  job.message = "Creating Genie Space in Databricks...";
  const config = getConfig();
  const result = await createGenieSpace({
    title: params.title,
    description: params.description || "",
    serializedSpace: finalSerializedSpace,
    warehouseId: config.warehouseId,
    parentPath: params.parentPath,
    authMode: params.authMode,
  });

  // Step 4: Track in Lakebase
  job.message = "Tracking space...";
  const trackingId = uuidv4();
  await trackGenieSpaceCreated(
    trackingId,
    result.space_id,
    params.runId ?? null,
    params.domain,
    params.title,
    {
      functions: [],
      metricViews: deployedMvFqns,
      metadata: {
        promptVersion: params.quality?.promptVersion ?? "genie-v2",
        gateDecision: params.quality?.gateDecision ?? "allow",
      },
    },
    params.authMode,
    params.ownerEmail,
  );

  // Step 5: Best-effort listing cache update -- space is already live,
  // so a transient cache failure must not flip the deploy job to failed.
  try {
    await upsertCachedSpaces([
      {
        spaceId: result.space_id,
        title: params.title,
        description: params.description ?? null,
      },
    ]);
  } catch (cacheErr) {
    logger.warn("Cache upsert failed after successful deploy; space will appear on next sync", {
      spaceId: result.space_id,
      error: safeErrorMessage(cacheErr),
    });
  }

  logger.info("Genie space created successfully", {
    spaceId: result.space_id,
    runId: params.runId,
    domain: params.domain,
    title: params.title,
    metricViewsDeployed: deployedMvFqns.length,
  });

  // Mark complete
  job.status = "completed";
  job.message = "Deployment complete";
  job.completedAt = Date.now();
  job.result = {
    spaceId: result.space_id,
    title: result.title,
    trackingId,
    metricViewResults: mvResults.length > 0 ? mvResults : undefined,
  };
}
