/**
 * API: /api/environment-scan
 *
 * POST -- start a new standalone environment scan
 * GET  -- list recent scans
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { safeErrorMessage } from "@/lib/error-utils";
import { listEnvironmentScans } from "@/lib/lakebase/environment-scans";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { checkQuota } from "@/lib/quotas";
import { recordUsage } from "@/lib/lakebase/usage";

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/environment-scan", "GET");
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
    const view = (new URL(request.url).searchParams.get("view") ?? "all") as
      | "all"
      | "owned"
      | "shared";
    await ensureMigrated();
    const sharedIds = view === "owned" ? [] : await listAccessibleIds(user.email, "scan");
    const scans = await listEnvironmentScans(50, 0, user.email, view, sharedIds);

    return NextResponse.json(
      { scans: toJsonSafe(scans) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const log = apiLogger("/api/environment-scan", "POST");
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

    const body = await request.json();
    const ucMetadata = body.ucMetadata;
    const lineageDepth =
      typeof body.lineageDepth === "number"
        ? Math.min(Math.max(Math.round(body.lineageDepth), 1), 10)
        : undefined;
    const lineageEnabled =
      typeof body.lineageEnabled === "boolean" ? body.lineageEnabled : undefined;
    const expandLineageTables =
      typeof body.expandLineageTables === "boolean" ? body.expandLineageTables : undefined;
    const lineageDirection =
      body.lineageDirection === "upstream" ||
      body.lineageDirection === "both" ||
      body.lineageDirection === "downstream"
        ? body.lineageDirection
        : undefined;
    // Asset discovery defaults ON for manual scans so the analytics-maturity
    // pass runs; callers must explicitly pass false to skip it.
    const assetDiscoveryEnabled = body.assetDiscoveryEnabled !== false;
    const excludedScope = typeof body.excludedScope === "string" ? body.excludedScope : undefined;
    const exclusionPatterns =
      typeof body.exclusionPatterns === "string" ? body.exclusionPatterns : undefined;
    const inclusionPatterns =
      typeof body.inclusionPatterns === "string" ? body.inclusionPatterns : undefined;
    const industryId = typeof body.industryId === "string" ? body.industryId : undefined;
    const subVertical = typeof body.subVertical === "string" ? body.subVertical : undefined;

    if (!ucMetadata || typeof ucMetadata !== "string") {
      log.warn("ucMetadata is required", {
        hasUcMetadata: !!ucMetadata,
        ucMetadataType: typeof ucMetadata,
        errorCategory: "validation_failed",
      });
      return NextResponse.json({ error: "ucMetadata is required" }, { status: 400 });
    }

    const scanId = uuidv4();
    const { runStandaloneEnrichment } = await import("@/lib/pipeline/standalone-scan");

    const startScan = () =>
      runStandaloneEnrichment(
        scanId,
        ucMetadata,
        lineageDepth,
        assetDiscoveryEnabled,
        excludedScope,
        exclusionPatterns,
        user.email,
        user.oboToken,
        {
          industryId,
          subVertical,
          inclusionPatterns,
          lineageEnabled,
          lineageDirection,
          expandLineageTables,
        },
      ).catch((error) => {
        log.error("Standalone scan failed", {
          scanId,
          error: error instanceof Error ? error.message : String(error),
          errorCategory: "scan_failed",
        });
      });

    const quota = await checkQuota("scan", user.email, "reject");
    if (!quota.allowed) {
      // Cap reached: enqueue rather than reject. The deferred queue
      // promotes the scan as soon as the user's active count drops.
      const { enqueueDeferredJob } = await import("@/lib/scheduler/deferred-queue");
      const { jobId, position } = enqueueDeferredJob({
        kind: "scan",
        ownerEmail: user.email,
        run: startScan,
      });
      log.info("Estate scan queued (cap reached)", {
        cap: quota.cap,
        active: quota.active,
        position,
        jobId,
        userEmail: user.email,
      });
      recordUsage.scan(user.email).catch(() => {});
      return NextResponse.json(
        { scanId, status: "queued", position, jobId, cap: quota.cap, active: quota.active },
        { status: 202 },
      );
    }

    void startScan();
    recordUsage.scan(user.email).catch(() => {});
    return NextResponse.json({ scanId }, { status: 201 });
  } catch (error) {
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
