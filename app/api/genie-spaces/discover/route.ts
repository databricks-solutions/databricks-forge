/**
 * API: /api/genie-spaces/discover
 *
 * POST -- Discover metadata and health scores for multiple spaces in one pass.
 *         Uses OBO auth (via getGenieSpace) so the logged-in user's permissions apply.
 *         Replaces the separate health-batch call by returning both metadata and health.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { runHealthCheck, enrichReportWithSqlQuality } from "@/lib/genie/space-health-check";
import { isReviewEnabled } from "@/lib/dbx/client";
import { getHealthCheckConfig } from "@/lib/lakebase/space-health";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { extractSpaceMetadata } from "@/lib/genie/space-metadata";
import { updateCachedSpaceDiscovery } from "@/lib/lakebase/genie-space-cache";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import type { SpaceHealthReport } from "@/lib/genie/health-checks/types";
import type { SpaceMetadata } from "@/lib/genie/space-metadata";

const MAX_BATCH_SIZE = 50;
const CONCURRENCY = 5;

interface DiscoverResult {
  metadata: SpaceMetadata | null;
  healthReport: SpaceHealthReport | null;
  permissionDenied?: boolean;
}

async function runBounded<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function runNext(): Promise<void> {
    while (idx < tasks.length) {
      const current = idx++;
      results[current] = await tasks[current]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext()));
  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const spaceIds = body.spaceIds as string[];

    if (!Array.isArray(spaceIds) || spaceIds.length === 0) {
      return NextResponse.json({ error: "spaceIds array is required" }, { status: 400 });
    }

    if (spaceIds.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` },
        { status: 400 },
      );
    }

    for (const id of spaceIds) {
      if (!isSafeId(id)) {
        return NextResponse.json({ error: `Invalid spaceId: ${id}` }, { status: 400 });
      }
    }

    const config = await getHealthCheckConfig().catch(() => ({
      overrides: [],
      customChecks: [],
      categoryWeights: null,
    }));

    const tasks = spaceIds.map((spaceId) => async (): Promise<[string, DiscoverResult]> => {
      try {
        let serializedSpace = getSpaceCache(spaceId);
        if (!serializedSpace) {
          const spaceResponse = await getGenieSpace(spaceId);
          serializedSpace = spaceResponse.serialized_space ?? "{}";
          setSpaceCache(spaceId, serializedSpace);
        }

        const metadata = extractSpaceMetadata(serializedSpace);

        const space = JSON.parse(serializedSpace);
        let healthReport = runHealthCheck(
          space,
          config.overrides.length > 0 ? config.overrides : undefined,
          config.customChecks.length > 0 ? config.customChecks : undefined,
          config.categoryWeights ?? undefined,
        );
        if (isReviewEnabled("health-check-sql-quality")) {
          healthReport = await enrichReportWithSqlQuality(space, healthReport);
        }

        updateCachedSpaceDiscovery(spaceId, {
          tableCount: metadata?.tableCount ?? null,
          measureCount: metadata?.measureCount ?? null,
          sampleQuestionCount: metadata?.sampleQuestionCount ?? null,
          filterCount: metadata?.filterCount ?? null,
          healthScore: healthReport?.overallScore ?? null,
          healthReportJson: healthReport ? JSON.stringify(healthReport) : null,
          permissionDenied: false,
        }).catch(() => {});

        return [spaceId, { metadata, healthReport }];
      } catch (err) {
        const errStr = String(err);
        const denied = errStr.includes("(403)") || errStr.includes("PERMISSION_DENIED");
        if (!denied) {
          logger.warn("Discover failed for space", { spaceId, error: errStr });
        }
        if (denied) {
          updateCachedSpaceDiscovery(spaceId, { permissionDenied: true }).catch(() => {});
        }
        return [
          spaceId,
          { metadata: null, healthReport: null, permissionDenied: denied || undefined },
        ];
      }
    });

    const results = await runBounded(tasks, CONCURRENCY);
    const output: Record<string, DiscoverResult> = {};
    for (const [id, result] of results) {
      output[id] = result;
    }

    return NextResponse.json(output);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
