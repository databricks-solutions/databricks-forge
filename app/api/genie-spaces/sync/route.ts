/**
 * API: /api/genie-spaces/sync
 *
 * POST -- Start a background sync of workspace Genie spaces into Lakebase cache.
 *         Returns { jobId } immediately (fire-and-forget).
 *         If a sync is already running, returns the existing job's ID.
 * GET  -- Poll sync job status by ?jobId=...
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { listGenieSpaces } from "@/lib/dbx/genie";
import {
  upsertCachedSpaces,
  pruneStaleCacheEntries,
  type SpaceCacheUpsertInput,
} from "@/lib/lakebase/genie-space-cache";
import {
  getActiveSyncJob,
  startSyncJob,
  getSyncJob,
  updateSyncJob,
  completeSyncJob,
  failSyncJob,
} from "@/lib/genie/sync-jobs";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

// ---------------------------------------------------------------------------
// GET -- poll sync job status
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query parameter is required" }, { status: 400 });
  }

  const job = getSyncJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Sync job not found or expired" }, { status: 404 });
  }

  return NextResponse.json(
    {
      jobId: job.jobId,
      status: job.status,
      message: job.message,
      percent: job.percent,
      spacesFound: job.spacesFound,
      error: job.error,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

// ---------------------------------------------------------------------------
// POST -- start background sync
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const active = getActiveSyncJob();
  if (active) {
    return NextResponse.json({
      jobId: active.jobId,
      status: active.status,
      message: active.message,
      percent: active.percent,
      spacesFound: active.spacesFound,
      alreadyRunning: true,
    });
  }

  const jobId = uuidv4();
  startSyncJob(jobId);

  runSync(jobId, user.email).catch((err) => {
    failSyncJob(jobId, safeErrorMessage(err));
  });

  return NextResponse.json({ jobId, status: "syncing" });
}

// ---------------------------------------------------------------------------
// Background sync logic
// ---------------------------------------------------------------------------

async function runSync(jobId: string, userEmail: string): Promise<void> {
  try {
    updateSyncJob(jobId, { message: "Fetching workspace spaces..." });

    const allSpaces: SpaceCacheUpsertInput[] = [];
    let pageToken: string | undefined;
    let pageNum = 0;

    do {
      const page = await listGenieSpaces(100, pageToken);
      for (const s of page.spaces ?? []) {
        allSpaces.push({
          spaceId: s.space_id,
          title: s.title ?? "Untitled",
          description: s.description ?? null,
        });
      }

      pageNum++;
      pageToken = page.next_page_token;

      updateSyncJob(jobId, {
        message: `Fetched ${allSpaces.length} spaces (page ${pageNum})...`,
        percent: pageToken ? Math.min(60, pageNum * 5) : 70,
        spacesFound: allSpaces.length,
      });
    } while (pageToken);

    logger.info("[genie-sync] Fetched all workspace spaces", { count: allSpaces.length });

    // Upsert into Lakebase cache
    updateSyncJob(jobId, {
      message: `Saving ${allSpaces.length} spaces to cache...`,
      percent: 75,
    });
    await upsertCachedSpaces(allSpaces);

    // Prune stale entries
    updateSyncJob(jobId, { message: "Pruning stale entries...", percent: 90 });
    const liveIds = new Set(allSpaces.map((s) => s.spaceId));
    const pruned = await pruneStaleCacheEntries(liveIds);
    if (pruned > 0) {
      logger.info("[genie-sync] Pruned stale cache entries", { pruned });
    }

    completeSyncJob(jobId, allSpaces.length);

    logActivity("synced_genie_spaces", {
      userId: userEmail,
      metadata: { spacesFound: allSpaces.length, pruned },
    }).catch(() => {});
  } catch (err) {
    logger.error("[genie-sync] Sync failed", { error: safeErrorMessage(err) });
    failSyncJob(jobId, safeErrorMessage(err));
  }
}
