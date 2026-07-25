/**
 * API: /api/master-repo/[industryId]
 *
 * Returns the Master Repository v2 enrichment payload (reference data assets +
 * mapped use cases) for a given industry. Used by the outcomes browser to
 * display the asset family taxonomy beside an industry's strategic objectives.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMasterRepoEnrichmentAsync } from "@/lib/domain/industry-outcomes/master-repo-registry";
import { resolveIndustryId } from "@/lib/domain/industry-outcomes";
import { getCustomEnrichmentProvenance } from "@/lib/lakebase/outcome-maps";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ industryId: string }> },
) {
  try {
    const { industryId } = await params;
    const resolved = resolveIndustryId(industryId) ?? industryId;
    const enrichment = await getMasterRepoEnrichmentAsync(resolved);
    if (!enrichment) {
      return NextResponse.json({ error: "No enrichment for this industry" }, { status: 404 });
    }
    // Best-effort provenance lookup; built-in enrichments have no row in
    // ForgeOutcomeMap, so this returns { null, null } and the client just
    // hides the footer.
    const provenance = await getCustomEnrichmentProvenance(resolved).catch(() => ({
      generatedByModel: null,
      generatedAt: null,
    }));
    return NextResponse.json({
      industryId: resolved,
      ...enrichment,
      provenance: {
        generatedByModel: provenance.generatedByModel,
        generatedAt: provenance.generatedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch master repo enrichment" },
      { status: 500 },
    );
  }
}
