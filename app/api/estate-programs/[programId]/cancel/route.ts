/**
 * API: /api/estate-programs/[programId]/cancel
 *
 * POST -- cancel the estate's scan sequence. All not-yet-complete, not-running
 *         scopes are terminally cancelled; a running scope is left to finish.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { cancelEstateSequence } from "@/lib/pipeline/estate-sequence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/cancel", "POST");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    const { cancelled } = await cancelEstateSequence(programId, guard.user.email);
    return NextResponse.json({ status: "cancelled", cancelled }, { status: 200 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
