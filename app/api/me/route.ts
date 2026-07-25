/**
 * /api/me -- returns the current user's email (best-effort).
 *
 * Used by client UI bits that need to gate owner-only affordances (e.g. the
 * "Share" button on a run). Does not return the OBO token.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { isUserIsolationEnabled } from "@/lib/config/isolation-flag";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(
      {
        email: user.email,
        isolationEnabled: isUserIsolationEnabled(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof ForgeAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load user" },
      { status: 500 },
    );
  }
}
