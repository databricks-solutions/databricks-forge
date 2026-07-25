/**
 * API: /api/estate-programs/[programId]/relationships
 *
 * GET -- table-to-table relationships for an ENTIRE estate program: lineage +
 * ontology entity relationships aggregated across ALL completed member scans,
 * each tagged with cross-catalog / cross-schema / cross-domain flags. The domain
 * map reflects manual overrides from every member scan (latest scan wins), so
 * cross-domain counts stay accurate. Never scoped to a single diagnosis/latest
 * scan.
 *
 * Guarded via loadEstateProgramOrRespond("read"). Scan routes are unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { getProgramRelationshipInputs } from "@/lib/lakebase/environment-scans";
import { listProgramDomainOverrides } from "@/lib/lakebase/domain-overrides";
import { buildProgramDomainMap } from "@/lib/environment/domain-overrides";
import { buildRelationshipGraph } from "@/lib/environment/relationships";

const MAX_EDGES = 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { programId } = await params;
  const log = apiLogger(`/api/estate-programs/${programId}/relationships`, "GET");
  try {
    await ensureMigrated();
    const guard = await loadEstateProgramOrRespond(request, programId, "read");
    if (!guard.ok) return guard.response;

    const [inputs, overrides] = await Promise.all([
      getProgramRelationshipInputs(programId),
      listProgramDomainOverrides(programId),
    ]);

    const domainByFqn = buildProgramDomainMap(inputs.details, overrides);
    const { summary, edges, truncated } = buildRelationshipGraph({
      lineage: inputs.lineage,
      canonicalEntities: inputs.canonicalEntities,
      entityRelationships: inputs.entityRelationships,
      domainByFqn,
      maxEdges: MAX_EDGES,
    });

    return NextResponse.json(
      { summary, edges, truncated },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
