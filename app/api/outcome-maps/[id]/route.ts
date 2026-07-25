/**
 * API: /api/outcome-maps/[id]
 *
 * GET    -- get a single custom outcome map by record ID
 * DELETE -- delete a custom outcome map
 * PATCH  -- update a custom outcome map (name, parsedOutcome)
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getOutcomeMap, deleteOutcomeMap, updateOutcomeMap } from "@/lib/lakebase/outcome-maps";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureMigrated();
    const { id } = await params;
    const record = await getOutcomeMap(id);
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch outcome map" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureMigrated();
    const { id } = await params;
    const deleted = await deleteOutcomeMap(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete outcome map" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureMigrated();
    const { id } = await params;
    const body = await request.json();
    const { name, industryId, rawMarkdown, parsedOutcome } = body as {
      name?: string;
      industryId?: string;
      rawMarkdown?: string;
      parsedOutcome?: IndustryOutcome;
    };

    const record = await updateOutcomeMap(id, {
      name,
      industryId,
      rawMarkdown,
      parsedOutcome,
    });

    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update outcome map" },
      { status: 500 },
    );
  }
}
