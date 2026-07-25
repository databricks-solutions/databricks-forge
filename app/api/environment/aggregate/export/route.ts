/**
 * API: /api/environment/aggregate/export
 *
 * GET ?format=excel -- download the aggregate Environment Report Excel,
 *     merging latest data per table across all environment scans.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAggregateForExcel } from "@/lib/lakebase/environment-scans";
import { generateEnvironmentExcel } from "@/lib/export/environment-excel";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format") ?? "excel";

    if (format !== "excel") {
      return NextResponse.json({ error: "Only excel format is supported" }, { status: 400 });
    }

    const aggregate = await getAggregateForExcel();
    if (!aggregate) {
      return NextResponse.json({ error: "No environment scans found" }, { status: 404 });
    }

    const buffer = await generateEnvironmentExcel(aggregate);
    const uint8 = new Uint8Array(buffer);

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="estate-report-aggregate.xlsx"`,
      },
    });
  } catch (error) {
    logger.error("[api/environment/aggregate/export] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to export aggregate environment report" },
      { status: 500 },
    );
  }
}
