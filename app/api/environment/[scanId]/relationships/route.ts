/**
 * API: /api/environment/[scanId]/relationships
 *
 * GET -- table-to-table relationships for a scan: lineage edges plus
 * ontology-inferred entity relationships, each tagged with cross-catalog /
 * cross-schema / cross-domain flags and summarised. The domain map reflects
 * any manual overrides so cross-domain counts stay accurate after a remap.
 *
 * Owner-scoped via loadScanOrRespond("read").
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { apiLogger } from "@/lib/logger";
import { loadScanOrRespond } from "@/lib/auth/route-guards";
import { withPrisma } from "@/lib/prisma";
import { listDomainOverrides } from "@/lib/lakebase/domain-overrides";
import { resolveOverride } from "@/lib/environment/domain-overrides";
import {
  deriveEdges,
  summarize,
  dedupeEdges,
  type RawEdge,
  type EdgeVia,
} from "@/lib/environment/relationships";

const MAX_EDGES = 1000;

function normalizeVia(via: unknown): EdgeVia {
  if (via === "foreign_key" || via === "inferred" || via === "relationship") return via;
  return "lineage";
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await ctx.params;
  const log = apiLogger(`/api/environment/${scanId}/relationships`, "GET");
  try {
    const guarded = await loadScanOrRespond(request, scanId, "read");
    if (!guarded.ok) return guarded.response;

    const [lineage, details, entityRelInsights, entityInsights, overrides] = await withPrisma(
      async (prisma) =>
        Promise.all([
          prisma.forgeTableLineage.findMany({ where: { scanId } }),
          prisma.forgeTableDetail.findMany({
            where: { scanId },
            select: { tableFqn: true, dataDomain: true },
          }),
          prisma.forgeTableInsight.findMany({
            where: { scanId, insightType: "entity_relationship" },
            select: { payloadJson: true },
          }),
          prisma.forgeTableInsight.findMany({
            where: { scanId, insightType: "canonical_entity" },
            select: { payloadJson: true },
          }),
          listDomainOverrides(scanId),
        ]),
    );

    // Domain map with overrides applied (evicted tables fall out of the map).
    const domainByFqn = new Map<string, string | null>();
    for (const d of details) {
      const o = resolveOverride(d.tableFqn, overrides);
      if (o?.action === "evict") continue;
      domainByFqn.set(d.tableFqn, o?.action === "remap" ? (o.newDomain ?? d.dataDomain) : d.dataDomain);
    }

    // Lineage edges (table → table).
    const rawEdges: RawEdge[] = lineage.map((l) => ({
      source: l.sourceTableFqn,
      target: l.targetTableFqn,
      via: "lineage" as EdgeVia,
      weight: l.eventCount,
    }));

    // Ontology entity relationships → representative table edges.
    const entityTables = new Map<string, string[]>();
    for (const e of entityInsights) {
      try {
        const ent = JSON.parse(e.payloadJson);
        if (ent?.name && Array.isArray(ent.tables)) entityTables.set(ent.name, ent.tables);
      } catch {
        /* skip malformed */
      }
    }
    for (const r of entityRelInsights) {
      try {
        const rel = JSON.parse(r.payloadJson);
        const src = entityTables.get(rel?.sourceEntity)?.[0];
        const tgt = entityTables.get(rel?.targetEntity)?.[0];
        if (src && tgt) {
          rawEdges.push({
            source: src,
            target: tgt,
            via: normalizeVia(rel?.via),
            weight: typeof rel?.edgeCount === "number" ? rel.edgeCount : 1,
          });
        }
      } catch {
        /* skip malformed */
      }
    }

    const deduped = dedupeEdges(rawEdges);
    const derived = deriveEdges(deduped, domainByFqn);
    const summary = summarize(derived);

    // Most-interesting first: cross-domain, then cross-catalog, then weight.
    derived.sort((a, b) => {
      const score = (e: typeof a) =>
        (e.crossDomain ? 4 : 0) + (e.crossCatalog ? 2 : 0) + (e.crossSchema ? 1 : 0);
      return score(b) - score(a) || (b.weight ?? 0) - (a.weight ?? 0);
    });

    return NextResponse.json(
      { summary, edges: derived.slice(0, MAX_EDGES), truncated: derived.length > MAX_EDGES },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
