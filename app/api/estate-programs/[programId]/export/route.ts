/**
 * API: /api/estate-programs/[programId]/export
 *
 * GET ?format=pdf   (default) -- the C-level Estate Board Pack PDF.
 * GET ?format=excel           -- the detailed per-table workbook.
 *
 * Both are built from the program-scoped aggregate estate view (latest-per-
 * table across the program's member scans).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAggregateForExcel,
  getAggregateEstateView,
} from "@/lib/lakebase/environment-scans";
import { getEstateProgram } from "@/lib/lakebase/estate-programs";
import { getLatestSynthesisForEstate } from "@/lib/lakebase/estate-synthesis";
import { generateEnvironmentExcel } from "@/lib/export/environment-excel";
import {
  generateEstateBoardPackPdf,
  type BoardPackData,
} from "@/lib/export/estate-board-pack-pdf";
import {
  buildEstateTree,
  parseCanonicalEntities,
  type AggregateDetailRow,
  type AggregateInsightRow,
} from "@/lib/domain/estate-tree";
import { computeTierDistribution } from "@/lib/domain/estate-readiness";
import { getIndustryOutcome } from "@/lib/domain/industry-outcomes";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { logger } from "@/lib/logger";
import type { TableDetail } from "@/lib/domain/types";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  try {
    const { programId } = await params;
    const guard = await loadEstateProgramOrRespond(request, programId, "read");
    if (!guard.ok) return guard.response;

    const format = request.nextUrl.searchParams.get("format") ?? "pdf";
    const program = await getEstateProgram(programId);
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const safeName = program.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
    const synthesis = await getLatestSynthesisForEstate(programId).catch(() => null);

    // ---- Detailed Excel workbook --------------------------------------------
    if (format === "excel") {
      const aggregate = await getAggregateForExcel(programId);
      if (!aggregate) {
        return NextResponse.json({ error: "No scans attached to this program yet" }, { status: 404 });
      }
      aggregate.ucPath = `${program.name} — Estate Detail`;
      const buffer = await generateEnvironmentExcel(aggregate, synthesis);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="estate-detail-${safeName}.xlsx"`,
        },
      });
    }

    // ---- C-level board-pack PDF (default) -----------------------------------
    const aggregate = await getAggregateEstateView(programId);
    if (aggregate.stats.totalScans === 0) {
      return NextResponse.json({ error: "No scans attached to this program yet" }, { status: 404 });
    }

    const details = (aggregate.details as unknown as AggregateDetailRow[]) ?? [];
    const insights = (aggregate.insights as unknown as AggregateInsightRow[]) ?? [];
    const tree = buildEstateTree(details, parseCanonicalEntities(insights));

    const detailLite = details.map(
      (d) =>
        ({
          fqn: (d.tableFqn ?? d.fqn ?? "") as string,
          comment: d.comment ?? null,
          generatedDescription: d.generatedDescription ?? null,
          owner: d.owner ?? null,
          dataTier: (d.dataTier ?? null) as TableDetail["dataTier"],
          dataDomain: d.dataDomain ?? null,
        }) as Pick<
          TableDetail,
          "fqn" | "comment" | "generatedDescription" | "owner" | "dataTier" | "dataDomain"
        >,
    );
    // Metadata coverage is server-computed on the aggregate (tags + column
    // comments) — consume exactly that value so the board pack matches the UI.
    const coverage = aggregate.stats.metadataCoverage;
    const tier = computeTierDistribution(detailLite);
    const a = aggregate.stats.assetInventory;
    const total = aggregate.stats.totalTables || 1;
    const goldShare = tier.gold / total;
    // Prefer the consultant-grade synthesis readiness when available so the
    // board-pack glance KPI matches the State-of-the-Nation page; otherwise fall
    // back to the deterministic governance-coverage proxy.
    const readinessScore = synthesis
      ? synthesis.scores.overall
      : Math.round((goldShare * 100 + coverage.tablesWithOwnerPct + coverage.tablesWithCommentPct) / 3);
    const readinessBand: BoardPackData["readinessBand"] = synthesis
      ? synthesis.scores.band === "leading" || synthesis.scores.band === "established"
        ? "ready"
        : synthesis.scores.band === "developing"
          ? "needs_work"
          : "missing"
      : readinessScore >= 70
        ? "ready"
        : readinessScore >= 40
          ? "needs_work"
          : "missing";

    const topDomains = tree.domains
      .map((d) => ({
        domain: d.domain,
        tableCount: d.tableCount,
        entityCount: d.entities.filter((e) => e.name !== "Ungrouped tables").length,
      }))
      .slice(0, 8);

    const aiBits: string[] = [];
    if (a.models > 0) aiBits.push(`${a.models} ML model${a.models === 1 ? "" : "s"}`);
    if (a.genieSpaces > 0)
      aiBits.push(`${a.genieSpaces} Genie space${a.genieSpaces === 1 ? "" : "s"}`);
    if (a.dashboards > 0) aiBits.push(`${a.dashboards} dashboard${a.dashboards === 1 ? "" : "s"}`);

    const narrative = [
      `Across ${aggregate.stats.totalScans} scanned area${aggregate.stats.totalScans === 1 ? "" : "s"}, the estate holds ${aggregate.stats.totalTables.toLocaleString()} tables organised into ${aggregate.stats.domainCount} business domain${aggregate.stats.domainCount === 1 ? "" : "s"} and ${tree.entityCount} canonical entities.`,
      aiBits.length > 0
        ? `Active analytics & AI footprint: ${aiBits.join(", ")}.`
        : "No models, Genie spaces, or dashboards were discovered in scope — an opportunity to activate analytics on this data.",
      `${Math.round(goldShare * 100)}% of tables are curated to gold tier; ${coverage.tablesWithOwnerPct}% have an assigned owner and ${coverage.tablesWithCommentPct}% are documented.`,
    ];

    const pathForward: string[] = [];
    if (coverage.tablesWithOwnerPct < 80)
      pathForward.push(
        `Assign data owners — only ${coverage.tablesWithOwnerPct}% of tables have one today, a prerequisite for trusted governance.`,
      );
    if (coverage.tablesWithCommentPct < 70)
      pathForward.push(
        `Improve documentation: ${coverage.tablesWithCommentPct}% of tables are described. Forge can auto-generate the rest.`,
      );
    if (a.models === 0)
      pathForward.push(
        "No ML models are deployed in scope — a clear opportunity to move from reporting to prediction on this data.",
      );
    if (tier.unknown > tier.gold)
      pathForward.push(
        "Most tables are untiered. Establishing a bronze/silver/gold medallion structure will clarify what is production-ready.",
      );
    if (pathForward.length === 0)
      pathForward.push(
        "The estate is well-governed. Focus next on activating use cases against the gold-tier data products.",
      );

    const data: BoardPackData = {
      programName: program.name,
      industryName: program.industryId
        ? (getIndustryOutcome(program.industryId)?.name ?? program.industryId)
        : null,
      totalTables: aggregate.stats.totalTables,
      totalSizeLabel: formatBytes(Number(aggregate.stats.totalSizeBytes)),
      domainCount: aggregate.stats.domainCount,
      entityCount: tree.entityCount,
      scanCount: aggregate.stats.totalScans,
      readinessScore,
      readinessBand,
      assets: a,
      tier: { ...tier, system: tier.system ?? 0 },
      coverage,
      topDomains,
      narrative,
      pathForward,
      synthesis,
    };

    const buffer = await generateEstateBoardPackPdf(data);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="estate-board-pack-${safeName}.pdf"`,
      },
    });
  } catch (error) {
    logger.error("[api/estate-programs/export] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to export estate board pack" }, { status: 500 });
  }
}
