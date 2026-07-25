/**
 * API: /api/estate-programs/[programId]/resume
 *
 * POST -- resume a paused estate scan sequence. Paused scopes return to the
 *         planned queue and the next one is enqueued. Returns 202 with the
 *         started scope, or 200 idle when nothing remains.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { logActivity } from "@/lib/lakebase/activity-log";
import { resumeEstateSequence } from "@/lib/pipeline/estate-sequence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/resume", "POST");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    const user = guard.user;
    const result = await resumeEstateSequence(programId, user.email, user.oboToken);
    if (result.status === "idle") {
      return NextResponse.json(
        { status: "idle", message: "No planned scopes remaining." },
        { status: 200 },
      );
    }
    logActivity("estate_sequence_resumed", {
      userId: user.email,
      resourceId: programId,
      metadata: { scopeId: result.scopeId, scanId: result.scanId },
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    log.error("POST failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
