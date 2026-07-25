/**
 * API: /api/estate-programs/[programId]/retry
 *
 * POST -- explicitly retry ONE failed scope. Moves a single `failed` scope back
 *         to `planned` (only when nothing is queued/running for the program and
 *         the scope still has attempts left under MAX_SCOPE_ATTEMPTS), then
 *         advances the sequence. Owner/edit-guarded.
 *
 *         Optional JSON body: { scopeId?: string } to target a specific
 *         failure; otherwise the lowest-sequence failed scope is retried.
 *         The program detail UI always sends scopeId for its per-row action.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { retryEstateFailedScope } from "@/lib/pipeline/estate-sequence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/retry", "POST");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    const user = guard.user;

    let scopeId: string | undefined;
    try {
      const body = (await request.json()) as { scopeId?: string } | null;
      if (body && typeof body.scopeId === "string") scopeId = body.scopeId;
    } catch {
      // No body / invalid JSON: retry the lowest-sequence failed scope.
    }

    const { retry, run } = await retryEstateFailedScope(
      programId,
      user.email,
      user.oboToken,
      scopeId,
    );

    if (!retry.ok) {
      // Map the rejection reason to a precise status code.
      const status =
        retry.reason === "no_failed_scope"
          ? 404
          : retry.reason === "active_work"
            ? 409
            : /* max_attempts */ 422;
      return NextResponse.json({ status: "rejected", reason: retry.reason }, { status });
    }

    return NextResponse.json({ status: "retried", scopeId: retry.scopeId, run }, { status: 202 });
  } catch (error) {
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
