/**
 * API: /api/outcome-maps/parse
 *
 * POST -- parse a markdown outcome map document using AI
 *
 * Accepts: { markdown: string, aiModel?: string }
 * Returns: { success: boolean, outcome: IndustryOutcome | null, error?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { parseOutcomeMapWithAI } from "@/lib/domain/outcome-map-parser";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { markdown, aiModel } = body as {
      markdown: string;
      aiModel?: string;
    };

    if (!markdown || typeof markdown !== "string") {
      return NextResponse.json({ error: "markdown field is required" }, { status: 400 });
    }

    if (markdown.length < 100) {
      return NextResponse.json(
        { error: "Document is too short to be a valid outcome map" },
        { status: 400 },
      );
    }

    const result = await parseOutcomeMapWithAI(markdown, aiModel);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        outcome: null,
        error: err instanceof Error ? err.message : "Parse request failed",
      },
      { status: 500 },
    );
  }
}
