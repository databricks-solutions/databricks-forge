/**
 * API: GET /api/assessment/:assessmentId
 *
 * Returns full per-control detail for a single assessment, joined to
 * the catalog (recommendations + fix-action engine bindings).
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getAssessmentDetail } from "@/lib/engines/waf-assessment/service";
import { handleApiError, requireSafeId } from "@/lib/api-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assessmentId: string }> },
) {
  try {
    await ensureMigrated();
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const { assessmentId } = await context.params;
    const invalid = requireSafeId(assessmentId, "assessment ID");
    if (invalid) return invalid;

    const sharedIds = await listAccessibleIds(user.email, "waf_assessment");
    const detail = await getAssessmentDetail(assessmentId, user.email, sharedIds);
    if (!detail) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return handleApiError(error, "/api/assessment/[id]");
  }
}
