/**
 * GET /api/system-load
 *
 * Returns a snapshot of cross-system load for the SystemLoadBanner. Per-user
 * fields (`yourInflight`, `yourQueued`) require an authenticated request.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSystemLoad } from "@/lib/dbx/system-load";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const snapshot = await getSystemLoad(user.email);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof ForgeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load system load" },
      { status: 500 },
    );
  }
}
