/**
 * API: /api/environment/[scanId]/synthesis
 *
 * GET  -- latest persisted consultant-grade synthesis (cached read only).
 * POST -- (re)generate the synthesis and persist it.
 *
 * Owner-scoped via loadScanOrRespond.
 */

import { NextRequest, NextResponse } from "next/server";
import { toJsonSafe } from "@/lib/json-safe";
import { safeErrorMessage } from "@/lib/error-utils";
import { apiLogger } from "@/lib/logger";
import { loadScanOrRespond } from "@/lib/auth/route-guards";
import { getLatestSynthesisForScan, saveEstateSynthesis } from "@/lib/lakebase/estate-synthesis";
import { buildSynthesisInputForScan } from "@/lib/ai/estate-synthesis/build-input";
import { runEstateSynthesis } from "@/lib/ai/estate-synthesis/engine";
import { logActivity } from "@/lib/lakebase/activity-log";

async function generate(
  scanId: string,
  ownerEmail: string,
  activityUserId: string,
  industryId?: string | null,
) {
  const input = await buildSynthesisInputForScan(scanId, ownerEmail, { industryId });
  if (!input) return null;
  const result = await runEstateSynthesis(input);
  const id = await saveEstateSynthesis({
    scanId,
    ownerEmail,
    industryId: input.industryId ?? null,
    result,
  });
  logActivity("estate_synthesis_generated", {
    userId: activityUserId,
    resourceId: scanId,
    metadata: { synthesisId: id, overall: result.scores.overall, band: result.scores.band },
  }).catch(() => {});
  return { id, ...result };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/synthesis`, "GET");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "read");
    if (!guarded.ok) return guarded.response;

    const existing = await getLatestSynthesisForScan(scanId);
    if (existing) {
      return NextResponse.json(toJsonSafe(existing), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return NextResponse.json(
      { error: "Synthesis has not been generated", generated: false },
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
  const log = apiLogger(`/api/environment/${scanId}/synthesis`, "POST");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "edit");
    if (!guarded.ok) return guarded.response;
    const { user, value } = guarded;
    if (!value.ownerEmail) {
      return NextResponse.json({ error: "Scan owner is unavailable" }, { status: 422 });
    }

    const body = await request.json().catch(() => ({}));
    const industryId = typeof body.industryId === "string" ? body.industryId : null;
    const generated = await generate(scanId, value.ownerEmail, user.email, industryId);
    if (!generated) {
      return NextResponse.json({ error: "Scan not found or empty" }, { status: 404 });
    }
    return NextResponse.json(toJsonSafe(generated), { status: 201 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
