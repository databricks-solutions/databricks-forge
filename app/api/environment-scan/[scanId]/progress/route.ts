/**
 * API: /api/environment-scan/[scanId]/progress
 *
 * GET -- returns the current scan progress (phase, counters, message).
 *        Returns 404 if the scan is not tracked (already completed and expired).
 */

import { NextResponse } from "next/server";
import { getScanProgress } from "@/lib/pipeline/scan-progress";
import { isValidUUID } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const { scanId } = await params;

    if (!isValidUUID(scanId)) {
      logger.warn("[api/environment-scan/progress] Invalid scan ID", { scanId });
      return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
    }

    const progress = getScanProgress(scanId);
    if (!progress) {
      logger.warn("[api/environment-scan/progress] No progress data found for this scan", {
        scanId,
      });
      return NextResponse.json({ error: "No progress data found for this scan" }, { status: 404 });
    }

    return NextResponse.json(progress);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/environment-scan/progress] GET failed", { error: msg });
    return NextResponse.json({ error: "Failed to retrieve scan progress" }, { status: 500 });
  }
}
