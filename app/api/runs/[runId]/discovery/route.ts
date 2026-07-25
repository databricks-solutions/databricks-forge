/**
 * API: /api/runs/[runId]/discovery
 *
 * GET -- fetch discovered analytics assets for a run
 */

import { NextRequest, NextResponse } from "next/server";
import { isValidUUID } from "@/lib/validation";
import { safeErrorMessage } from "@/lib/error-utils";
import { getDiscoveryResultsByRunId } from "@/lib/lakebase/discovered-assets";
import { getConfig } from "@/lib/dbx/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const data = await getDiscoveryResultsByRunId(runId);

    let databricksHost: string | null = null;
    try {
      databricksHost = getConfig().host;
    } catch {
      /* host unavailable in some dev environments */
    }

    if (!data) {
      return NextResponse.json({
        genieSpaces: [],
        dashboards: [],
        coverage: null,
        databricksHost,
      });
    }

    return NextResponse.json({ ...data, databricksHost });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
