/**
 * API: /api/genie-spaces/analyze-import
 *
 * POST -- Analyze a pasted/imported Genie Space JSON without API access.
 *         Runs the health check engine against the provided config.
 */

import { NextRequest, NextResponse } from "next/server";
import { runHealthCheck, enrichReportWithSqlQuality } from "@/lib/genie/space-health-check";
import { isReviewEnabled } from "@/lib/dbx/client";
import { extractSpaceMetadata } from "@/lib/genie/space-metadata";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { json } = body as { json: string };

    if (!json || typeof json !== "string") {
      return NextResponse.json({ error: "json string is required" }, { status: 400 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Support both raw serialized_space and the API response wrapper
    let space: Record<string, unknown>;
    if (typeof parsed.serialized_space === "string") {
      try {
        space = JSON.parse(parsed.serialized_space);
      } catch {
        return NextResponse.json(
          { error: "Failed to parse serialized_space field" },
          { status: 400 },
        );
      }
    } else if (parsed.data_sources || parsed.instructions || parsed.benchmarks) {
      space = parsed;
    } else {
      return NextResponse.json(
        {
          error:
            "JSON must be either a serialized_space object or an API response containing serialized_space",
        },
        { status: 400 },
      );
    }

    let healthReport = runHealthCheck(space);
    if (isReviewEnabled("health-check-sql-quality")) {
      healthReport = await enrichReportWithSqlQuality(space, healthReport);
    }
    const metadata = extractSpaceMetadata(JSON.stringify(space));

    // Extract title/description if present in config
    const title = (space as Record<string, unknown>).config
      ? (((space as Record<string, Record<string, unknown>>).config.title as string) ??
        "Imported Space")
      : "Imported Space";

    logger.info("Imported space analyzed", {
      grade: healthReport.grade,
      score: healthReport.overallScore,
    });

    return NextResponse.json({
      title,
      serializedSpace: JSON.stringify(space),
      metadata,
      healthReport,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Import analysis failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
