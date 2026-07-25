/**
 * API: /api/genie-spaces/health-batch
 *
 * POST -- Run health checks on multiple spaces in parallel (bounded concurrency).
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenieSpace } from "@/lib/dbx/genie";
import { runHealthCheck, enrichReportWithSqlQuality } from "@/lib/genie/space-health-check";
import { isReviewEnabled } from "@/lib/dbx/client";
import { getHealthCheckConfig } from "@/lib/lakebase/space-health";
import { getSpaceCache, setSpaceCache } from "@/lib/genie/space-cache";
import { isSafeId } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/error-utils";
import type { SpaceHealthReport } from "@/lib/genie/health-checks/types";

const MAX_BATCH_SIZE = 50;
const CONCURRENCY = 5;

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

    const tasks = spaceIds.map(
      (spaceId) => async (): Promise<[string, SpaceHealthReport | null]> => {
        try {
          let serializedSpace = getSpaceCache(spaceId);
          if (!serializedSpace) {
            const spaceResponse = await getGenieSpace(spaceId);
            serializedSpace = spaceResponse.serialized_space ?? "{}";
            setSpaceCache(spaceId, serializedSpace);
          }

          const space = JSON.parse(serializedSpace);
          let report = runHealthCheck(
            space,
            config.overrides.length > 0 ? config.overrides : undefined,
            config.customChecks.length > 0 ? config.customChecks : undefined,
            config.categoryWeights ?? undefined,
          );
          if (isReviewEnabled("health-check-sql-quality")) {
            report = await enrichReportWithSqlQuality(space, report);
          }
          return [spaceId, report];
        } catch (err) {
          logger.warn("Batch health check failed for space", { spaceId, error: String(err) });
          return [spaceId, null];
        }
      },
    );

    const results = await runBounded(tasks, CONCURRENCY);
    const reports: Record<string, SpaceHealthReport | null> = {};
    for (const [id, report] of results) {
      reports[id] = report;
    }

    return NextResponse.json(reports);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
