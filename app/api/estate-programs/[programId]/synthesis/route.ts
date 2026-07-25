/**
 * API: /api/estate-programs/[programId]/synthesis
 *
 * GET  -- latest persisted estate-level (roll-up) synthesis. READ-ONLY: returns
 *         the cached synthesis or 404. Never triggers a generation / write.
 * POST -- (re)generate the estate-level synthesis from ALL completed member
 *         scans + estate context, persist it against the estate (estateId =
 *         programId, ownerEmail = program root owner) and activity-log the caller.
 *
 * Guarded via loadEstateProgramOrRespond ("read" for GET, "edit" for POST).
 */

import { NextRequest, NextResponse } from "next/server";
import { toJsonSafe } from "@/lib/json-safe";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { getEstateProgramOwner } from "@/lib/lakebase/estate-programs";
import { getLatestSynthesisForEstate, saveEstateSynthesis } from "@/lib/lakebase/estate-synthesis";
import { buildSynthesisInputForProgram } from "@/lib/ai/estate-synthesis/build-input";
import { runEstateSynthesis } from "@/lib/ai/estate-synthesis/engine";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { programId } = await params;
  const log = apiLogger(`/api/estate-programs/${programId}/synthesis`, "GET");
  try {
    await ensureMigrated();
    const guard = await loadEstateProgramOrRespond(request, programId, "read");
    if (!guard.ok) return guard.response;

    // Read cached only — never generate on GET.
    const existing = await getLatestSynthesisForEstate(programId);
    if (existing) {
      return NextResponse.json(toJsonSafe(existing), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return NextResponse.json(
      { error: "Synthesis has not been generated", generated: false },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { programId } = await params;
  const log = apiLogger(`/api/estate-programs/${programId}/synthesis`, "POST");
  try {
    await ensureMigrated();
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;

    // Persist against the estate's ROOT owner (the program owner), not the caller.
    const rootOwner = await getEstateProgramOwner(programId);
    if (rootOwner === undefined) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    if (!rootOwner) {
      return NextResponse.json({ error: "Program owner is unavailable" }, { status: 422 });
    }

    const body = await request.json().catch(() => ({}));
    const industryId = typeof body.industryId === "string" ? body.industryId : null;

    const input = await buildSynthesisInputForProgram(programId, rootOwner, { industryId });
    if (!input) {
      return NextResponse.json(
        { error: "No completed scans attached to this program yet" },
        { status: 404 },
      );
    }

    const result = await runEstateSynthesis(input);
    const id = await saveEstateSynthesis({
      estateId: programId,
      ownerEmail: rootOwner,
      industryId: input.industryId ?? null,
      result,
    });

    logActivity("estate_synthesis_generated", {
      userId: guard.user.email,
      resourceId: programId,
      metadata: {
        synthesisId: id,
        estateId: programId,
        overall: result.scores.overall,
        band: result.scores.band,
      },
    }).catch(() => {});

    return NextResponse.json(toJsonSafe({ id, ...result }), { status: 201 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
