/**
 * API: /api/genie-spaces/[spaceId]/health
 *
 * GET -- Run a deterministic health check on a Genie Space and return the report.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import {
  runHealthCheck,
  enrichReportWithSqlQuality,
  enrichSpaceWithUcMetadata,
} from "@/lib/genie/space-health-check";
import { isReviewEnabled } from "@/lib/dbx/client";
import { getHealthCheckConfig, saveHealthScore } from "@/lib/lakebase/space-health";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import { loadGenieSpaceBySpaceIdOrRespond } from "@/lib/auth/route-guards";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await params;
    if (!isSafeId(spaceId)) {
      return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
    }
    const guard = await loadGenieSpaceBySpaceIdOrRespond(request, spaceId, "read");
    if (!guard.ok) return guard.response;

    let serializedSpace: string;

    const cached = getSpaceCache(spaceId);
    if (cached) {
      serializedSpace = cached;
    } else {
      const spaceResponse = await getGenieSpace(spaceId);
      serializedSpace = spaceResponse.serialized_space ?? "{}";
      setSpaceCache(spaceId, serializedSpace);
    }

    const space = JSON.parse(serializedSpace);

    // Enrich a *scoring-only* copy of the space with UC table/column comments
    // so well-described UC tables aren't penalized for an empty space-level
    // description. The persisted serialized_space is never mutated.
    let scoringSpace = space;
    try {
      const enriched = await enrichSpaceWithUcMetadata(space, guard.user.oboToken ?? undefined);
      scoringSpace = enriched.space;
      if (enriched.tablesEnriched > 0 || enriched.columnsEnriched > 0) {
        logger.info("[health] enriched scoring copy with UC metadata", {
          spaceId,
          tablesEnriched: enriched.tablesEnriched,
          columnsEnriched: enriched.columnsEnriched,
        });
      }
    } catch (err) {
      logger.warn("[health] UC enrichment failed, scoring against raw space", {
        spaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const config = await getHealthCheckConfig().catch(() => ({
      overrides: [],
      customChecks: [],
      categoryWeights: null,
    }));

    let report = runHealthCheck(
      scoringSpace,
      config.overrides.length > 0 ? config.overrides : undefined,
      config.customChecks.length > 0 ? config.customChecks : undefined,
      config.categoryWeights ?? undefined,
    );

    if (isReviewEnabled("health-check-sql-quality")) {
      report = await enrichReportWithSqlQuality(scoringSpace, report);
    }

    // Best-effort persist the score for trending
    saveHealthScore(spaceId, report, "manual").catch((err) => {
      logger.warn("Failed to persist health score", { spaceId, error: String(err) });
    });

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Health check failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
