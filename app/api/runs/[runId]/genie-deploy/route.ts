/**
 * API: /api/runs/[runId]/genie-deploy
 *
 * POST -- Start pipeline Genie deployment (fire-and-forget, returns jobId).
 * GET  -- Poll deployment progress by jobId.
 *
 * Orchestrates the full Genie deployment flow:
 *   1. Validate pre-existing metric views from metadata
 *   2. Rewrite metric view / function DDLs to the chosen target schema
 *   3. Execute each DDL (with auto-fix for common errors)
 *   4. Prepare a clean serializedSpace: strip undeployed/failed refs, add deployed FQNs
 *   5. Create or update Genie spaces via the Databricks API
 *   6. Track each space in Lakebase
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "@/lib/dbx/client";
import { createGenieSpace, updateGenieSpace } from "@/lib/dbx/genie";
import { executeSQLWithToken } from "@/lib/dbx/sql";
import {
  trackGenieSpaceCreated,
  trackGenieSpaceUpdated as trackSpaceUpdated,
} from "@/lib/lakebase/genie-spaces";
import { apiLogger } from "@/lib/logger";
import { isSafeId, validateFqn } from "@/lib/validation";
import type { GenieAuthMode } from "@/lib/settings";
import {
  type DeployAsset,
  type AssetResult,
  type StrippedRef,
  deployAsset,
  validatePreExistingMetricViews,
  prepareSerializedSpace,
  validateFinalSpace,
  normalizeIdentifiersToFqn,
  extractPreExistingMvFqns,
} from "@/lib/genie/deploy";
import {
  getMetricViewProposalsByRunDomain,
  promoteMetricViewDeployment,
} from "@/lib/lakebase/metric-view-proposals";
import { rewriteDashboardMetricViewFqns } from "@/lib/genie/metric-view-dependencies";
import { isMetricViewsEnabled } from "@/lib/genie/metric-views-config";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

interface DomainDeployRequest {
  domain: string;
  title: string;
  description: string;
  serializedSpace: string;
  metricViews: DeployAsset[];
  existingSpaceId?: string;
}

interface RequestBody {
  domains: DomainDeployRequest[];
  targetSchema: string;
  authMode?: GenieAuthMode;
  fqnRewrites?: Record<string, string>;
  resourcePrefix?: string;
}

interface DomainResult {
  domain: string;
  assets: AssetResult[];
  spaceId?: string;
  spaceError?: string;
  orphanedAssets?: { metricViews: string[] };
  patchedSpace?: string;
  strippedRefs?: StrippedRef[];
}

// ---------------------------------------------------------------------------
// Job tracker
// ---------------------------------------------------------------------------

interface PipelineDeployJob {
  jobId: string;
  runId: string;
  status: "deploying" | "completed" | "failed";
  message: string;
  completedDomains: number;
  totalDomains: number;
  startedAt: number;
  completedAt: number | null;
  results: DomainResult[];
  error: string | null;
}

const deployJobs = new Map<string, PipelineDeployJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function evictStale(): void {
  const now = Date.now();
  for (const [id, job] of deployJobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      deployJobs.delete(id);
    } else if (!job.completedAt && now - job.startedAt > JOB_TTL_MS * 2) {
      deployJobs.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// GET handler (poll)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  await params;
  evictStale();

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query parameter required" }, { status: 400 });
  }

  const job = deployJobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found or expired" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    message: job.message,
    completedDomains: job.completedDomains,
    totalDomains: job.totalDomains,
    results: job.results,
    error: job.error,
  });
}

// ---------------------------------------------------------------------------
// POST handler (fire-and-forget)
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const log = apiLogger("/api/runs/[runId]/genie-deploy", "POST", { runId });

  if (!isSafeId(runId)) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  const guard = await loadRunOrRespond(request, runId, "edit");
  if (!guard.ok) return guard.response;
  const ownerEmail = guard.user.email;
  const oboToken = guard.user.oboToken;
  if (!oboToken) {
    return NextResponse.json(
      { error: "User authorization is required for Genie deployment" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as RequestBody;

    if (!body.domains || !Array.isArray(body.domains) || body.domains.length === 0) {
      return NextResponse.json({ error: "Missing required field: domains" }, { status: 400 });
    }

    if (!body.targetSchema || body.targetSchema.split(".").length !== 2) {
      return NextResponse.json(
        { error: "targetSchema must be in catalog.schema format" },
        { status: 400 },
      );
    }

    try {
      validateFqn(body.targetSchema, "targetSchema");
    } catch {
      return NextResponse.json(
        { error: "targetSchema contains invalid characters" },
        { status: 400 },
      );
    }

    const jobId = uuidv4();

    deployJobs.set(jobId, {
      jobId,
      runId,
      status: "deploying",
      message: `Deploying ${body.domains.length} domain${body.domains.length !== 1 ? "s" : ""}...`,
      completedDomains: 0,
      totalDomains: body.domains.length,
      startedAt: Date.now(),
      completedAt: null,
      results: [],
      error: null,
    });

    runPipelineDeploy(jobId, runId, body, log, ownerEmail, oboToken).catch((err) => {
      const job = deployJobs.get(jobId);
      if (job && job.status === "deploying") {
        job.status = "failed";
        job.message = "Deployment failed";
        job.error = safeErrorMessage(err);
        job.completedAt = Date.now();
      }
    });

    return NextResponse.json({ jobId, status: "deploying" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("Genie deploy failed", { error: message, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Background deploy logic
// ---------------------------------------------------------------------------

async function runPipelineDeploy(
  jobId: string,
  runId: string,
  body: RequestBody,
  log: ReturnType<typeof apiLogger>,
  ownerEmail: string | null,
  oboToken: string,
): Promise<void> {
  const job = deployJobs.get(jobId);
  if (!job) return;

  const config = getConfig();
  const fqnRewrites = body.fqnRewrites ?? {};
  const deploySql = (sql: string) => executeSQLWithToken(sql, oboToken);

  for (const domainReq of body.domains) {
    if (Object.keys(fqnRewrites).length > 0) {
      domainReq.serializedSpace = rewriteDashboardMetricViewFqns(
        domainReq.serializedSpace,
        fqnRewrites,
      );
    }

    const currentJob = deployJobs.get(jobId);
    if (!currentJob || currentJob.status !== "deploying") return;
    currentJob.message = `Deploying "${domainReq.domain}"...`;

    const assets: AssetResult[] = [];
    const deployedMvs: { fqn: string; description?: string }[] = [];

    if (isMetricViewsEnabled()) {
      let mvProposals: Awaited<ReturnType<typeof getMetricViewProposalsByRunDomain>> = [];
      try {
        mvProposals = await getMetricViewProposalsByRunDomain(runId, domainReq.domain);
      } catch {
        // Non-fatal
      }

      for (const mv of domainReq.metricViews) {
        const result = await deployAsset(mv, body.targetSchema, body.resourcePrefix, deploySql);
        if (result.deployed) {
          deployedMvs.push({ fqn: result.fqn, description: mv.description });
          log.info("Metric view deployed", {
            runId,
            domain: domainReq.domain,
            fqn: result.fqn,
          });

          const matchingProposal = mvProposals.find(
            (p) => p.name.toLowerCase() === mv.name.toLowerCase(),
          );
          if (matchingProposal) {
            try {
              await promoteMetricViewDeployment(matchingProposal.id, result.fqn);
            } catch (err) {
              const message = `Metric view SQL succeeded but semantic manifest promotion failed: ${
                err instanceof Error ? err.message : String(err)
              }`;
              assets.push({
                ...result,
                success: false,
                error: message,
                errorCategory: "manifest_promotion",
                manifestPromoted: false,
              });
              log.warn("Metric view deployment remained partially persisted", {
                proposalId: matchingProposal.id,
                error: message,
                errorCategory: "db",
              });
              continue;
            }
          }
        }
        assets.push(result);
      }
    }

    const isFqn = (id: string) => id.replace(/`/g, "").split(".").length >= 3;
    const preExistingMvFqns = extractPreExistingMvFqns(domainReq.serializedSpace).filter(isFqn);
    const { valid: validPreExistingMvs, stripped: mvValidationStripped } =
      await validatePreExistingMetricViews(preExistingMvFqns);

    const { json: preparedSpace, strippedRefs } = prepareSerializedSpace(
      domainReq.serializedSpace,
      deployedMvs,
      validPreExistingMvs,
    );

    const { json: validatedSpace, stripped: finalStripped } =
      await validateFinalSpace(preparedSpace);

    const finalSpace = normalizeIdentifiersToFqn(validatedSpace, body.targetSchema);
    const allStripped = [...mvValidationStripped, ...strippedRefs, ...finalStripped];

    if (allStripped.length > 0) {
      log.info("Stripped references from serialized space", {
        domain: domainReq.domain,
        stripped: allStripped.map((s) => `${s.type}:${s.identifier}`),
      });
    }

    const deployedAssetsPayload = {
      functions: [] as string[],
      metricViews: deployedMvs.map((m) => m.fqn),
    };

    try {
      let spaceId: string;

      if (domainReq.existingSpaceId) {
        const result = await updateGenieSpace(domainReq.existingSpaceId, {
          serializedSpace: finalSpace,
          authMode: body.authMode,
        });
        spaceId = result.space_id;
        try {
          await trackSpaceUpdated(spaceId, undefined, deployedAssetsPayload);
        } catch (trackErr) {
          log.error("Lakebase tracking failed after space update", {
            spaceId,
            domain: domainReq.domain,
            error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            errorCategory: "db",
          });
          try {
            await trackSpaceUpdated(spaceId, undefined, deployedAssetsPayload);
          } catch {
            /* exhausted retry */
          }
        }
        log.info("Genie space updated", { domain: domainReq.domain, spaceId });
      } else {
        const result = await createGenieSpace({
          title: domainReq.title,
          description: domainReq.description || "",
          serializedSpace: finalSpace,
          warehouseId: config.warehouseId,
          authMode: body.authMode,
        });
        spaceId = result.space_id;

        const trackingId = uuidv4();
        try {
          await trackGenieSpaceCreated(
            trackingId,
            spaceId,
            runId,
            domainReq.domain,
            domainReq.title,
            deployedAssetsPayload,
            body.authMode,
            ownerEmail,
          );
        } catch (trackErr) {
          log.error("Lakebase tracking failed after space creation", {
            spaceId,
            domain: domainReq.domain,
            error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            errorCategory: "db",
          });
          try {
            await trackGenieSpaceCreated(
              trackingId,
              spaceId,
              runId,
              domainReq.domain,
              domainReq.title,
              deployedAssetsPayload,
              body.authMode,
              ownerEmail,
            );
          } catch {
            /* exhausted retry */
          }
        }
      }

      currentJob.results.push({
        domain: domainReq.domain,
        assets,
        spaceId,
        patchedSpace: finalSpace,
        strippedRefs: allStripped.length > 0 ? allStripped : undefined,
      });

      log.info("Genie space deployed", {
        runId,
        domain: domainReq.domain,
        spaceId,
        metricViews: deployedMvs.length,
        strippedRefs: allStripped.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const orphanedAssets = {
        metricViews: deployedMvs.map((m) => m.fqn),
      };
      if (orphanedAssets.metricViews.length > 0) {
        log.warn(
          "Genie space creation failed -- UC assets deployed but not attached to any space",
          { domain: domainReq.domain, orphanedAssets, errorCategory: "deploy_orphaned" },
        );
      }
      currentJob.results.push({
        domain: domainReq.domain,
        assets,
        spaceError: msg,
        orphanedAssets: orphanedAssets.metricViews.length > 0 ? orphanedAssets : undefined,
        patchedSpace: finalSpace,
        strippedRefs: allStripped.length > 0 ? allStripped : undefined,
      });
      log.error("Genie space creation failed during deploy", {
        domain: domainReq.domain,
        error: msg,
        errorCategory: "deploy_failed",
      });
    }

    currentJob.completedDomains += 1;
  }

  const finalJob = deployJobs.get(jobId);
  if (finalJob) {
    finalJob.status = "completed";
    finalJob.message = "Deployment complete";
    finalJob.completedAt = Date.now();
  }
}
