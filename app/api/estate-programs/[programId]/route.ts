/**
 * API: /api/estate-programs/[programId]
 *
 * GET    -- fetch a program with its ordered scopes
 * PATCH  -- update program metadata
 * DELETE -- delete a program (scopes cascade; member scans are detached)
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { logActivity } from "@/lib/lakebase/activity-log";
import { clearAggregateEstateCache } from "@/lib/lakebase/environment-scans";
import { getIndustryOutcome } from "@/lib/domain/industry-outcomes";
import {
  normalizeEstateProgramInput,
  type EstateProgramPatchInput,
} from "@/lib/domain/estate-program-input";
import {
  getEstateProgram,
  updateEstateProgram,
  deleteEstateProgram,
  countActiveProgramScopes,
} from "@/lib/lakebase/estate-programs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]", "GET");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "read");
    if (!guard.ok) return guard.response;

    const program = await getEstateProgram(programId);
    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    return NextResponse.json(
      { program: toJsonSafe(program), permission: guard.permission },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]", "PATCH");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const normalized = normalizeEstateProgramInput(body, {
      mode: "patch",
      isRegisteredIndustry: (id) => Boolean(getIndustryOutcome(id)),
    });
    if (!normalized.success) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    await updateEstateProgram(programId, normalized.data as EstateProgramPatchInput);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("PATCH failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]", "DELETE");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    if (guard.permission !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Server-enforced guard (mirrors the client-side block): a program cannot be
    // deleted while any scope is mid-flight, so an in-progress scan sequence is
    // never orphaned. This is authoritative regardless of the UI.
    const active = await countActiveProgramScopes(programId);
    if (active > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete a program while a scan is queued or running. Cancel the sequence first.",
          reason: "active_work",
        },
        { status: 409 },
      );
    }

    await deleteEstateProgram(programId);
    // Member scans were detached (programId -> null), which changes both the
    // program-scoped and the global aggregate; refresh both cache entries.
    clearAggregateEstateCache(programId);
    logActivity("deleted_program", { userId: guard.user.email, resourceId: programId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
