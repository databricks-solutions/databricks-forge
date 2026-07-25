/**
 * API: GET /api/assessment
 *
 * Returns the latest completed assessment (with per-control results)
 * and the list of recent runs for the history panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/lakebase/schema";
import {
  getLatestAssessment,
  listAssessments,
  listControls,
  listIgnoredResources,
  listQualitativeResponses,
} from "@/lib/engines/waf-assessment/service";
import { handleApiError } from "@/lib/api-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export async function GET(request: NextRequest) {
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
    const sharedIds = await listAccessibleIds(user.email, "waf_assessment");
    const [latest, history, controls, qualitativeResponses, ignored] = await Promise.all([
      getLatestAssessment(user.email, sharedIds),
      listAssessments(user.email, 20, sharedIds),
      listControls(),
      listQualitativeResponses(),
      listIgnoredResources(),
    ]);
    const qualitativeControls = controls.filter((c) => c.evaluationType === "qualitative");
    return NextResponse.json({
      latest,
      history,
      qualitativeControls,
      qualitativeResponses,
      ignored,
    });
  } catch (error) {
    return handleApiError(error, "/api/assessment");
  }
}
