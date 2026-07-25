/**
 * API: /api/estate-programs/[programId]/scopes/[scopeId]
 *
 * DELETE -- remove one non-active scope from a program's planned sequence.
 *           Queued/running scopes are rejected atomically with 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { deleteProgramScope } from "@/lib/lakebase/estate-programs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string; scopeId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/scopes/[scopeId]", "DELETE");
  try {
    await ensureMigrated();
    const { programId, scopeId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;

    const result = await deleteProgramScope(scopeId, programId);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Scope not found" }, { status: 404 });
    }
    if (result.status === "active") {
      return NextResponse.json(
        { error: "Queued or running scopes cannot be removed" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
