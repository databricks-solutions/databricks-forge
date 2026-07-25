/**
 * API: /api/runs/[runId]/genie-engine/[domain]/functions
 *
 * DEPRECATED — SQL function creation is no longer supported in Genie spaces.
 * This endpoint returns 410 Gone for any requests.
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "SQL function creation is no longer supported. Functions have been removed from Genie space deployment.",
    },
    { status: 410 },
  );
}
