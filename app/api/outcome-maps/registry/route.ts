/**
 * API: /api/outcome-maps/registry
 *
 * GET -- returns all industry outcomes (built-in + custom) merged.
 * Used by client components (config-form, outcomes page) that need
 * the full list but can't access the DB directly.
 */

import { NextResponse } from "next/server";
import { getAllIndustryOutcomes } from "@/lib/domain/industry-outcomes-server";

export async function GET() {
  try {
    const outcomes = await getAllIndustryOutcomes();
    return NextResponse.json(outcomes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load outcomes" },
      { status: 500 },
    );
  }
}
