/**
 * API: /api/estate-programs/[programId]/overrides
 *
 * GET -- list manual domain overrides aggregated across ALL completed member
 * scans of the program, annotated with the owning scanId + scan-recency rank so
 * the client can reason about "latest scan wins" precedence. Read-only: overrides
 * are still created/removed through the per-scan routes (which are unchanged).
 *
 * Guarded via loadEstateProgramOrRespond("read").
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { listProgramDomainOverrides } from "@/lib/lakebase/domain-overrides";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { programId } = await params;
  const log = apiLogger(`/api/estate-programs/${programId}/overrides`, "GET");
  try {
    await ensureMigrated();
    const guard = await loadEstateProgramOrRespond(request, programId, "read");
    if (!guard.ok) return guard.response;

    const overrides = await listProgramDomainOverrides(programId);
    return NextResponse.json({ overrides }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
