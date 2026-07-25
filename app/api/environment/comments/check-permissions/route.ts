/**
 * API: /api/environment/comments/check-permissions
 *
 * POST -- Check MODIFY permission on a list of tables
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ForgeAuthError,
  requireUser,
} from "@/lib/auth/route-user";
import { safeErrorMessage } from "@/lib/error-utils";
import { checkPermissions } from "@/lib/ai/comment-applier";

export async function POST(request: NextRequest) {
  try {
    try {
      await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const body = await request.json();
    const { tableFqns } = body as { tableFqns: string[] };

    if (!Array.isArray(tableFqns) || tableFqns.length === 0) {
      return NextResponse.json({ error: "tableFqns array is required" }, { status: 400 });
    }

    const results = await checkPermissions(tableFqns);
    return NextResponse.json({ permissions: results });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
