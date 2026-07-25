/**
 * API: /api/runs
 *
 * POST -- create a new pipeline run
 * GET  -- list all runs
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { apiLogger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { createRun, listRuns, listRunSummaries } from "@/lib/lakebase/runs";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { safeParseBody, CreateRunSchema } from "@/lib/validation";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { logActivity } from "@/lib/lakebase/activity-log";
import { loadScanOrRespond } from "@/lib/auth/route-guards";
import { getEnvironmentScan } from "@/lib/lakebase/environment-scans";
import type {
  PipelineRunConfig,
  Operation,
  BusinessPriority,
  GenerationOption,
  DiscoveryDepth,
} from "@/lib/domain/types";
import { DEFAULT_DEPTH_CONFIGS } from "@/lib/domain/types";

export async function POST(request: NextRequest) {
  const log = apiLogger("/api/runs", "POST");
  try {
    await ensureMigrated();

    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const parsed = await safeParseBody(request, CreateRunSchema);
    if (!parsed.success) {
      log.warn("Validation failed", { error: parsed.error, errorCategory: "validation_failed" });
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const body = parsed.data;
    let ucMetadata = body.ucMetadata;
    if (body.sourceScanId) {
      const guarded = await loadScanOrRespond(request, body.sourceScanId, "read");
      if (!guarded.ok) return guarded.response;

      const sourceScan = await getEnvironmentScan(body.sourceScanId);
      if (!sourceScan) {
        return NextResponse.json({ error: "Source scan not found" }, { status: 404 });
      }
      // Only a fully-saved scan can seed a decoupled-discovery run; a
      // `running`/`failed` checkpoint is incomplete and must be rejected.
      if (sourceScan.scanStatus && sourceScan.scanStatus !== "complete") {
        return NextResponse.json({ error: "Source scan is not complete" }, { status: 409 });
      }
      if (!sourceScan.details?.length) {
        return NextResponse.json({ error: "Source scan has no metadata details" }, { status: 400 });
      }
      ucMetadata = sourceScan.ucPath;
    }

    const runId = uuidv4();
    const config: PipelineRunConfig = {
      businessName: body.businessName,
      ucMetadata,
      excludedScope: body.excludedScope ?? "",
      exclusionPatterns: body.exclusionPatterns ?? "",
      operation: (body.operation ?? "Discover Usecases") as Operation,
      businessDomains: body.businessDomains ?? "",
      businessPriorities: (body.businessPriorities ?? ["Increase Revenue"]) as BusinessPriority[],
      strategicGoals: body.strategicGoals ?? "",
      additionalContext: body.additionalContext ?? "",
      customerMaturity: body.customerMaturity ?? "developing",
      riskPosture: body.riskPosture ?? "balanced",
      transformationHorizon: body.transformationHorizon ?? "half-year",
      generationOptions: (body.generationOptions ?? ["SQL Code"]) as GenerationOption[],
      generationPath: body.generationPath ?? "./forge_gen/",
      languages: ["English"],
      aiModel: body.aiModel,
      sampleRowsPerTable: body.sampleRowsPerTable ?? 0,
      industry: body.industry ?? "",
      discoveryDepth: (body.discoveryDepth ?? "balanced") as DiscoveryDepth,
      depthConfig:
        body.depthConfig ??
        DEFAULT_DEPTH_CONFIGS[(body.discoveryDepth ?? "balanced") as DiscoveryDepth],
      // When seeded from an estate scan (decoupled discovery), never re-run a
      // scan during the pipeline — metadata is reconstituted from the source.
      estateScanEnabled: body.sourceScanId ? false : (body.estateScanEnabled ?? false),
      assetDiscoveryEnabled: body.assetDiscoveryEnabled ?? false,
      fabricScanId: body.fabricScanId ?? null,
      sourceScanId: body.sourceScanId ?? null,
      businessValueEnabled: body.businessValueEnabled ?? true,
      outputLanguage: body.outputLanguage ?? "en",
    };

    await createRun(runId, config, user.email);

    // Fire-and-forget activity log
    logActivity("created_run", {
      userId: user.email,
      resourceId: runId,
      metadata: { businessName: config.businessName },
    });

    return NextResponse.json({ runId }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("POST failed", { error: msg, errorCategory: "internal_error" });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/runs", "GET");
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);
    const view = (searchParams.get("view") ?? "all") as "all" | "owned" | "shared";
    const summary = searchParams.get("fields") === "summary";

    await ensureMigrated();

    const sharedIds = view === "owned" ? [] : await listAccessibleIds(user.email, "run");
    // Summary mode returns only the columns the list UI renders. Avoids
    // ferrying heavy LLM-generated JSON (`businessContext`, `synthesisJson`,
    // `stepLog`, ...) that would otherwise be parsed, serialized, and
    // re-parsed every 5 s while the runs list is polling.
    const runs = summary
      ? await listRunSummaries(limit, offset, user.email, view, sharedIds)
      : await listRuns(limit, offset, user.email, view, sharedIds);

    return NextResponse.json(
      { runs },
      {
        headers: {
          // Per-user content -- must NOT be cached on shared CDN.
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
