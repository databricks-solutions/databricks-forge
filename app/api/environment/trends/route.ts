/**
 * API: /api/environment/trends
 *
 * GET -- returns scan-over-scan trend analysis comparing the two most recent
 *        scans. When `?estateId=` is supplied the comparison is scoped to that
 *        estate (program); otherwise it spans the caller's whole estate view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withPrisma } from "@/lib/prisma";
import { computeScanTrends, type ScanSnapshot } from "@/lib/domain/scan-trends";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { loadEstateProgramOrRespond } from "@/lib/auth/route-guards";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { safeErrorMessage } from "@/lib/error-utils";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (error) {
      if (error instanceof ForgeAuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    const estateId =
      request.nextUrl.searchParams.get("estateId") ??
      request.nextUrl.searchParams.get("programId");

    let scanWhere;
    if (estateId) {
      const guarded = await loadEstateProgramOrRespond(request, estateId, "read");
      if (!guarded.ok) return guarded.response;
      scanWhere = { programId: estateId };
    } else {
      const sharedScanIds = await listAccessibleIds(user.email, "scan");
      scanWhere = {
        OR: [
          { ownerEmail: user.email },
          { scanId: { in: sharedScanIds } },
        ],
      };
    }

    const data = await withPrisma(async (prisma) => {
      const scans = await prisma.forgeEnvironmentScan.findMany({
        where: scanWhere,
        orderBy: { createdAt: "desc" },
        take: 2,
        include: {
          details: { select: { tableFqn: true } },
        },
      });

      if (scans.length < 2) {
        return { hasTrends: false as const, message: "Need at least 2 scans for trend analysis" };
      }

      const [currentScan, previousScan] = scans;

      function toSnapshot(scan: typeof currentScan): ScanSnapshot {
        return {
          scanId: scan.scanId,
          createdAt: scan.createdAt.toISOString(),
          ucPath: scan.ucPath,
          tableCount: scan.tableCount,
          totalSizeBytes: Number(scan.totalSizeBytes),
          totalRows: Number(scan.totalRows),
          domainCount: scan.domainCount,
          avgGovernanceScore: scan.avgGovernanceScore,
          piiTablesCount: scan.piiTablesCount,
          redundancyPairsCount: scan.redundancyPairsCount,
          dataProductCount: scan.dataProductCount,
          tablesWithStreaming: scan.tablesWithStreaming,
          tablesWithCDF: scan.tablesWithCDF,
          tablesNeedingOptimize: scan.tablesNeedingOptimize,
          tablesNeedingVacuum: scan.tablesNeedingVacuum,
          tableFqns: scan.details.map((d) => d.tableFqn),
        };
      }

      const trends = computeScanTrends(toSnapshot(previousScan), toSnapshot(currentScan));

      return { hasTrends: true as const, trends };
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error("[api/environment/trends] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
