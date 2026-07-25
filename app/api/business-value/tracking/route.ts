/**
 * GET /api/business-value/tracking -- list all tracking entries
 * PATCH /api/business-value/tracking -- update a tracking entry
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  getTrackingForRun,
  upsertTracking,
  getTrackingByStage,
} from "@/lib/lakebase/use-case-tracking";
import { withPrisma } from "@/lib/prisma";
import type { TrackingStage } from "@/lib/domain/types";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const runId = req.nextUrl.searchParams.get("runId");

    if (runId) {
      const guard = await loadRunOrRespond(req, runId, "read");
      if (!guard.ok) return guard.response;
      const entries = await getTrackingForRun(runId);
      return NextResponse.json(entries, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const accessibleRunIds = await listAccessibleIds(user.email, "run");
    const userRuns = await withPrisma(async (prisma) =>
      prisma.forgeRun.findMany({
        where: {
          OR: [
            { ownerEmail: user.email },
            ...(accessibleRunIds.length > 0 ? [{ runId: { in: accessibleRunIds } }] : []),
          ],
        },
        select: { runId: true },
      }),
    );
    const userRunIds = userRuns.map((r) => r.runId);

    const byStage = await getTrackingByStage(userRunIds);

    const allEntries = await withPrisma(async (prisma) => {
      return prisma.forgeUseCaseTracking.findMany({
        where: userRunIds.length > 0 ? { runId: { in: userRunIds } } : { runId: "__no_run__" },
        orderBy: { updatedAt: "desc" },
        take: 500,
        include: {
          run: {
            select: { businessName: true },
          },
        },
      });
    });

    return NextResponse.json(
      { byStage, entries: allEntries },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logger.error("[api/business-value/tracking] GET failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to load tracking data" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { runId, useCaseId, stage, assignedOwner, notes } = body as {
      runId: string;
      useCaseId: string;
      stage?: TrackingStage;
      assignedOwner?: string;
      notes?: Array<{ text: string; author?: string; createdAt: string }>;
    };

    if (!runId || !useCaseId) {
      return NextResponse.json({ error: "runId and useCaseId required" }, { status: 400 });
    }

    const guard = await loadRunOrRespond(req, runId, "edit");
    if (!guard.ok) return guard.response;

    const entry = await upsertTracking(runId, useCaseId, { stage, assignedOwner, notes });
    return NextResponse.json(entry);
  } catch (err) {
    logger.error("[api/business-value/tracking] PATCH failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to update tracking" }, { status: 500 });
  }
}
