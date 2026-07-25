/**
 * API: /api/environment-scan/active
 *
 * GET -- returns all environment scans that are currently in progress.
 *        The frontend calls this on mount to resume polling for any scan
 *        that was started before the user navigated away.
 */

import { NextResponse } from "next/server";
import { getActiveScans } from "@/lib/pipeline/scan-progress";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const scans = getActiveScans();
    return NextResponse.json({ scans });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/environment-scan/active] GET failed", { error: msg });
    return NextResponse.json({ error: "Failed to retrieve active scans" }, { status: 500 });
  }
}
