/**
 * API: /api/estate-programs/[programId]/aggregate
 *
 * GET -- the program-scoped aggregate estate view (latest-per-table merge
 *        across the program's member scans) plus the program + its scopes,
 *        so the Estate Overview can render the company-level tree and the
 *        scan-coverage panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { getEstateProgram } from "@/lib/lakebase/estate-programs";
import { getAggregateEstateView } from "@/lib/lakebase/environment-scans";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const log = apiLogger("/api/estate-programs/[programId]/aggregate", "GET");
  try {
    await ensureMigrated();
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "read");
    if (!guard.ok) return guard.response;

    const program = await getEstateProgram(programId);
    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    const aggregate = await getAggregateEstateView(programId);

    return NextResponse.json(
      {
        program: toJsonSafe(program),
        aggregate: toJsonSafe(aggregate),
        permission: guard.permission,
      },
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
