/**
 * API: /api/export/executive-briefing
 *
 * GET ?scanId=xxx&runId=yyy -- download combined Executive Briefing PPTX
 *
 * scanId (required): environment scan to base the estate intelligence on
 * runId (optional): discovery run to include use case findings
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { getEnvironmentScan } from "@/lib/lakebase/environment-scans";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import {
  generateExecutiveBriefing,
  type BriefingEstateData,
  type BriefingDiscoveryData,
} from "@/lib/export/executive-briefing";
import { isValidUUID } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const scanId = request.nextUrl.searchParams.get("scanId");
    const runId = request.nextUrl.searchParams.get("runId");

    if (!scanId || !isValidUUID(scanId)) {
      logger.warn("[api/export/executive-briefing] Valid scanId is required", {
        scanId: scanId ?? null,
      });
      return NextResponse.json({ error: "Valid scanId is required" }, { status: 400 });
    }
    if (runId && !isValidUUID(runId)) {
      logger.warn("[api/export/executive-briefing] Invalid runId", { runId });
      return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
    }

    const scan = await getEnvironmentScan(scanId);
    if (!scan) {
      logger.warn("[api/export/executive-briefing] Scan not found", { scanId });
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    // Build estate data from scan
    const estate: BriefingEstateData = {
      ucPath: scan.ucPath,
      tableCount: scan.tableCount,
      totalSizeBytes: Number(scan.totalSizeBytes),
      totalRows: Number(scan.totalRows),
      domainCount: scan.domainCount,
      avgGovernanceScore: scan.avgGovernanceScore,
      piiTablesCount: scan.piiTablesCount,
      redundancyPairsCount: scan.redundancyPairsCount,
      dataProductCount: scan.dataProductCount,
      lineageEdgeCount: scan.lineage.length,
      lineageDiscoveredCount: scan.lineageDiscoveredCount,
      tablesNeedingOptimize: scan.tablesNeedingOptimize,
      tablesNeedingVacuum: scan.tablesNeedingVacuum,
      tablesWithStreaming: scan.tablesWithStreaming,
      tablesWithCDF: scan.tablesWithCDF,
      details: scan.details,
      histories: scan.histories,
      insights: scan.insights,
    };

    // Optionally include discovery data
    let discovery: BriefingDiscoveryData | null = null;
    if (runId) {
      const guard = await loadRunOrRespond(request, runId, "read");
      if (!guard.ok) return guard.response;
      const run = guard.value.run;
      const useCases = await getUseCasesByRunId(runId);
      discovery = {
        businessName: run.config.businessName,
        useCases,
        filteredTables: useCases.flatMap((uc) => uc.tablesInvolved),
      };
    }

    const buffer = await generateExecutiveBriefing(estate, discovery);
    const uint8 = new Uint8Array(buffer);

    const name = discovery?.businessName ?? scan.ucPath.replace(/[^a-zA-Z0-9]/g, "-");
    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="executive-briefing-${name}.pptx"`,
      },
    });
  } catch (error) {
    logger.error("[api/export/executive-briefing] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to generate executive briefing" }, { status: 500 });
  }
}
