/**
 * API: /api/stats
 *
 * GET -- aggregate stats across all runs and use cases for the dashboard.
 *
 * Optional `?runId=<id>` narrows the use-case-related aggregates to a single
 * run (so the landing-page widgets can be scoped via the run dropdown). The
 * `recentRuns` list and the global status totals stay cross-run.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDatabaseReady } from "@/lib/prisma";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { logger } from "@/lib/logger";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { getDashboardStats } from "@/lib/dashboard/stats";

export async function GET(request: NextRequest) {
  try {
    if (!isDatabaseReady()) {
      return NextResponse.json(
        { error: "Database is warming up. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }

    await ensureMigrated();
    const user = await requireUser(request);
    const sharedRunIds = await listAccessibleIds(user.email, "run");

    const url = new URL(request.url);
    const runIdParam = url.searchParams.get("runId");
    const runId = runIdParam && runIdParam.trim() ? runIdParam.trim() : null;

    const stats = await getDashboardStats({
      userEmail: user.email,
      sharedRunIds,
      runId,
    });

    if (!stats) {
      // Run id was supplied but the caller has no read access (or it doesn't
      // exist). 404 keeps the API consistent with the run-detail guard.
      return NextResponse.json(
        { error: "Run not found or not accessible" },
        { status: 404 },
      );
    }

    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForgeAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/stats] GET failed", { error: msg });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
