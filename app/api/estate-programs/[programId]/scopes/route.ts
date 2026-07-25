/**
 * API: /api/estate-programs/[programId]/scopes
 *
 * POST -- add one or more scan scopes to a program's planned sequence.
 *         Accepts a single scope object or `{ scopes: [...] }`.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import {
  addProgramScope,
  addProgramScopes,
  DuplicateSequenceError,
  type ScopeInput,
} from "@/lib/lakebase/estate-programs";
import { normalizeScopeInput } from "@/lib/lakebase/estate-scope-input";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/scopes", "POST");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "edit");
    if (!guard.ok) return guard.response;
    const body = await request.json();

    const rawScopes: unknown[] = Array.isArray(body?.scopes) ? body.scopes : [body];
    const scopes: ScopeInput[] = [];
    for (const raw of rawScopes) {
      const result = normalizeScopeInput(raw);
      // Skip payloads that omit ucMetadata entirely; reject those that supply a
      // scope but fail validation (bad pattern / oversize provenance) so the
      // caller learns why instead of silently dropping the row.
      if (!result.ok) {
        const hasUc =
          raw &&
          typeof raw === "object" &&
          typeof (raw as Record<string, unknown>).ucMetadata === "string" &&
          ((raw as Record<string, unknown>).ucMetadata as string).trim();
        if (hasUc) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        continue;
      }
      scopes.push(result.scope!);
    }
    if (scopes.length === 0) {
      return NextResponse.json(
        { error: "At least one scope with a ucMetadata scope string is required" },
        { status: 400 },
      );
    }

    if (scopes.length === 1) {
      const scopeId = await addProgramScope(programId, scopes[0]);
      return NextResponse.json({ scopeId, added: 1 }, { status: 201 });
    }
    const added = await addProgramScopes(programId, scopes);
    return NextResponse.json({ added }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateSequenceError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
