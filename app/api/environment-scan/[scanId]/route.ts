/**
 * API: /api/environment-scan/[scanId]
 *
 * GET    -- get scan results with all related data
 * DELETE -- delete a scan and all related data (cascade)
 */

import { NextRequest, NextResponse } from "next/server";
import { getEnvironmentScan, deleteEnvironmentScan } from "@/lib/lakebase/environment-scans";
import { getScanProgress } from "@/lib/pipeline/scan-progress";
import { isValidUUID } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const { scanId } = await params;

    if (!isValidUUID(scanId)) {
      logger.warn("[api/environment-scan/detail] Invalid scan ID", { scanId });
      return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
    }

    const scan = await getEnvironmentScan(scanId);
    if (!scan) {
      logger.warn("[api/environment-scan/detail] Scan not found", { scanId });
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    return NextResponse.json(toJsonSafe(scan));
  } catch (error) {
    logger.error("[api/environment-scan/detail] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to get scan details" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const { scanId } = await params;

    if (!isValidUUID(scanId)) {
      logger.warn("[api/environment-scan/detail] Invalid scan ID for delete", { scanId });
      return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
    }

    const scan = await getEnvironmentScan(scanId);
    if (!scan) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    const progress = getScanProgress(scanId);
    if (progress && progress.phase !== "complete" && progress.phase !== "failed") {
      return NextResponse.json(
        { error: "Cannot delete a scan that is still in progress" },
        { status: 409 },
      );
    }

    await deleteEnvironmentScan(scanId);

    return NextResponse.json({ deleted: scanId });
  } catch (error) {
    logger.error("[api/environment-scan/detail] DELETE failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to delete scan" }, { status: 500 });
  }
}
