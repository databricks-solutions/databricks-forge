/**
 * API: /api/benchmarks/status
 *
 * GET -- Returns whether the benchmark feature is enabled server-side.
 *
 * Used by UI components (settings page, sidebar) to decide whether
 * benchmark-dependent features should be available.
 */

import { NextResponse } from "next/server";
import { isBenchmarksEnabled } from "@/lib/benchmarks/config";

export async function GET() {
  return NextResponse.json({ enabled: isBenchmarksEnabled() });
}
