/**
 * API: /api/estate-programs/[programId]/run
 *
 * POST -- start (or resume) the program's planned scan sequence. Enqueues the
 *         next planned scope; subsequent scopes chain automatically as each
 *         completes. Returns 202 with the scope that was started, or 200 with
 *         status "idle" when nothing remains.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { logActivity } from "@/lib/lakebase/activity-log";
import { runEstateSequence } from "@/lib/pipeline/estate-sequence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/run", "POST");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    const user = guard.user;

    const result = await runEstateSequence(programId, user.email, user.oboToken);
    if (result.status === "idle") {
      return NextResponse.json(
        { status: "idle", message: "No planned scopes remaining." },
        { status: 200 },
      );
    }
    logActivity("started_program_sequence", {
      userId: user.email,
      resourceId: programId,
      metadata: { scopeId: result.scopeId, scanId: result.scanId },
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
