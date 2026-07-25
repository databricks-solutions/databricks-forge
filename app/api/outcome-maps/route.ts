/**
 * API: /api/outcome-maps
 *
 * GET  -- list all custom outcome maps (summaries)
 * POST -- create a new custom outcome map from parsed data
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { listOutcomeMaps, createOutcomeMap } from "@/lib/lakebase/outcome-maps";
import { getCurrentUserEmail } from "@/lib/dbx/client";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

export async function GET() {
  try {
    await ensureMigrated();
    const maps = await listOutcomeMaps();
    return NextResponse.json(maps, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list outcome maps" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureMigrated();

    const body = await request.json();
    const { rawMarkdown, parsedOutcome } = body as {
      rawMarkdown: string;
      parsedOutcome: IndustryOutcome;
    };

    if (!parsedOutcome?.id || !parsedOutcome?.name) {
      return NextResponse.json(
        { error: "parsedOutcome must include at least id and name" },
        { status: 400 },
      );
    }

    if (!rawMarkdown || typeof rawMarkdown !== "string") {
      return NextResponse.json({ error: "rawMarkdown is required" }, { status: 400 });
    }

    const userEmail = await getCurrentUserEmail();
    const record = await createOutcomeMap({
      industryId: parsedOutcome.id,
      name: parsedOutcome.name,
      rawMarkdown,
      parsedOutcome,
      createdBy: userEmail,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create outcome map";
    // Handle unique constraint violation on industryId
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        {
          error: `An outcome map with this industry ID already exists. Please use a different ID or delete the existing one first.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
