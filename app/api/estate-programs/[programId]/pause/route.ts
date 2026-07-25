/**
 * API: /api/estate-programs/[programId]/pause
 *
 * POST -- pause the estate's scan sequence. Not-yet-running scopes are held;
 *         a currently running scope finishes. Idempotent.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { pauseEstateSequence } from "@/lib/pipeline/estate-sequence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/pause", "POST");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    const { paused } = await pauseEstateSequence(programId, guard.user.email);
    return NextResponse.json({ status: "paused", paused }, { status: 200 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
