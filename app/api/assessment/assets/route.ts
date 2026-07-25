/**
 * API: GET /api/assessment/assets
 *
 * Reports whether the Forge WAF dashboard and Genie space currently exist
 * in the workspace, plus their URLs. Drives the "Generate" -> "Open"
 * button toggle on the assessment page.
 *
 * Requires an authenticated user (any signed-in caller can read).
 */

import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/dbx/client";
import { getDashboard, listDashboards } from "@/lib/dbx/dashboards";
import { getGenieSpace, listGenieSpaces } from "@/lib/dbx/genie";
import { WAF_DASHBOARD_DISPLAY_NAME } from "@/lib/engines/waf-assessment/dashboard/builder";
import { WAF_GENIE_TITLE } from "@/lib/engines/waf-assessment/genie/builder";
import { handleApiError } from "@/lib/api-utils";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";

export async function GET(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof ForgeAuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    const config = getConfig();

    const [dashboards, genieFirstPage] = await Promise.all([
      listDashboards().catch(() => []),
      listGenieSpaces(100).catch(() => ({ spaces: [], next_page_token: undefined })),
    ]);

    const dashboardCandidate = dashboards.find(
      (d) => d.display_name === WAF_DASHBOARD_DISPLAY_NAME,
    );
    let dashboard: { id: string; url: string } | null = null;
    if (dashboardCandidate) {
      try {
        const fetched = await getDashboard(dashboardCandidate.dashboard_id, { mode: "app" });
        if (fetched && fetched.lifecycle_state !== "TRASHED") {
          dashboard = {
            id: fetched.dashboard_id,
            url: `${config.host}/dashboardsv3/${fetched.dashboard_id}/published`,
          };
        }
      } catch {
        // Listed but not retrievable -- treat as missing so UI offers Generate.
      }
    }

    let geniePage = genieFirstPage;
    let genieMatch = (geniePage.spaces ?? []).find((s) => s.title === WAF_GENIE_TITLE);
    while (!genieMatch && geniePage.next_page_token) {
      geniePage = await listGenieSpaces(100, geniePage.next_page_token);
      genieMatch = (geniePage.spaces ?? []).find((s) => s.title === WAF_GENIE_TITLE);
    }

    let genie: { id: string; url: string } | null = null;
    if (genieMatch) {
      try {
        const fetched = await getGenieSpace(genieMatch.space_id);
        if (fetched && fetched.space_id) {
          genie = {
            id: fetched.space_id,
            url: `${config.host}/genie/rooms/${fetched.space_id}`,
          };
        }
      } catch {
        // Listed but not retrievable -- treat as missing so UI offers Generate.
      }
    }

    return NextResponse.json({ dashboard, genie });
  } catch (error) {
    return handleApiError(error, "/api/assessment/assets");
  }
}
