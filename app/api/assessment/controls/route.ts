/**
 * API: GET /api/assessment/controls
 *
 * Returns the seeded WAF controls catalog (no run required).
 * Used by the catalog browser tab on /assessment.
 *
 * Requires an authenticated user (any signed-in caller can read).
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { listControls } from "@/lib/engines/waf-assessment/service";
import { handleApiError } from "@/lib/api-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

export async function GET(request: NextRequest) {
  try {
    await ensureMigrated();
    try {
      await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const controls = await listControls();
    return NextResponse.json({ controls });
  } catch (error) {
    return handleApiError(error, "/api/assessment/controls");
  }
}
