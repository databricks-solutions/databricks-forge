/**
 * API: /api/environment/[scanId]/data-gap
 *
 * GET  -- latest persisted estate data-gap (cached read only).
 * POST -- recompute + persist the estate data-gap.
 *
 * Industry is resolved from the request (body/query) or the scan's owning
 * estate (program). Owner-scoped via loadScanOrRespond.
 */

import { NextRequest, NextResponse } from "next/server";
import { toJsonSafe } from "@/lib/json-safe";
import { safeErrorMessage } from "@/lib/error-utils";
import { apiLogger } from "@/lib/logger";
import { loadScanOrRespond } from "@/lib/auth/route-guards";
import { getLatestDataGapAnalysisForScan } from "@/lib/lakebase/data-gap-analyses";
import { computeEstateDataGap } from "@/lib/engines/data-gap-analysis/estate-data-gap";
import { withPrisma } from "@/lib/prisma";
import { logActivity } from "@/lib/lakebase/activity-log";

async function resolveIndustry(scanId: string, explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  return withPrisma(async (prisma) => {
    const scan = await prisma.forgeEnvironmentScan.findUnique({
      where: { scanId },
      select: { program: { select: { industryId: true } } },
    });
    return scan?.program?.industryId ?? null;
  });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/data-gap`, "GET");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "read");
    if (!guarded.ok) return guarded.response;
    const { value } = guarded;
    if (!value.ownerEmail) {
      return NextResponse.json({ error: "Scan owner is unavailable" }, { status: 422 });
    }

    const cached = await getLatestDataGapAnalysisForScan(scanId, value.ownerEmail);
    if (cached) {
      return NextResponse.json(toJsonSafe(cached.result), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    return NextResponse.json(
      { error: "Data-gap analysis has not been generated", generated: false },
      {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/data-gap`, "POST");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "edit");
    if (!guarded.ok) return guarded.response;
    const { user, value } = guarded;
    if (!value.ownerEmail) {
      return NextResponse.json({ error: "Scan owner is unavailable" }, { status: 422 });
    }

    const body = await request.json().catch(() => ({}));
    const industryId = await resolveIndustry(
      scanId,
      typeof body.industryId === "string" ? body.industryId : null,
    );
    if (!industryId) {
      return NextResponse.json({ error: "industryId is required" }, { status: 400 });
    }
    const result = await computeEstateDataGap({
      scanId,
      industryId,
      ownerEmail: value.ownerEmail,
    });
    if (!result) {
      return NextResponse.json({ error: "Could not compute data gap" }, { status: 422 });
    }
    logActivity("estate_data_gap_computed", {
      userId: user.email,
      resourceId: scanId,
      metadata: { industryId, missingAssets: result.summary.missingAssets },
    }).catch(() => {});
    return NextResponse.json(toJsonSafe(result), { status: 201 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
