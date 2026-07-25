/**
 * API: /api/environment/[scanId]/summary
 *
 * GET -- authorized, lightweight source-scan summary for the decoupled
 *        discovery flow (`/configure?fromScan=<uuid>`). Unlike the legacy
 *        `/api/environment-scan/[scanId]` detail route, this endpoint is ACL-
 *        guarded via `loadScanOrRespond` so a caller can only read a scan they
 *        own or that is shared with them. It returns just the fields the
 *        configure page needs to gate the flow and lock the UC scope — the
 *        authoritative `ucPath`, the table count, and completeness signals —
 *        never row-level data.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { apiLogger } from "@/lib/logger";
import { loadScanOrRespond } from "@/lib/auth/route-guards";
import { getEnvironmentScan } from "@/lib/lakebase/environment-scans";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const log = apiLogger("/api/environment/[scanId]/summary", "GET");
  try {
    const { scanId } = await params;
    const guard = await loadScanOrRespond(request, scanId, "read");
    if (!guard.ok) return guard.response;

    const scan = await getEnvironmentScan(scanId);
    if (!scan) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    // Legacy rows have no scanStatus and are treated as complete.
    const complete = !scan.scanStatus || scan.scanStatus === "complete";
    const hasDetails = Boolean(scan.details?.length);

    return NextResponse.json(
      {
        scanId,
        ucPath: scan.ucPath,
        tableCount: scan.tableCount ?? scan.details?.length ?? 0,
        scanStatus: scan.scanStatus ?? null,
        complete,
        hasDetails,
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
