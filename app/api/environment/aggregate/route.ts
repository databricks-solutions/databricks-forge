/**
 * API: /api/environment/aggregate
 *
 * GET -- returns the aggregate estate view merging latest data per table
 *        across all environment scans (pipeline runs + standalone).
 */

import { NextResponse } from "next/server";
import { getAggregateEstateView } from "@/lib/lakebase/environment-scans";
import { logger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";

export async function GET() {
  try {
    const estate = await getAggregateEstateView();
    return NextResponse.json(toJsonSafe(estate), {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    logger.error("[api/environment/aggregate] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to build aggregate estate view" }, { status: 500 });
  }
}
