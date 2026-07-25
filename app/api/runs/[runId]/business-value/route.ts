/**
 * GET /api/runs/[runId]/business-value
 *
 * Returns all business value data for a specific run:
 * value estimates, roadmap phases, synthesis, stakeholder profiles, and tracking.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getValueEstimatesForRun, getValueSummaryForRun } from "@/lib/lakebase/value-estimates";
import { getRoadmapPhasesForRun } from "@/lib/lakebase/roadmap-phases";
import { getTrackingForRun } from "@/lib/lakebase/use-case-tracking";
import { getStakeholderProfilesForRun } from "@/lib/lakebase/stakeholder-profiles";
import { getValueCapturesForRun } from "@/lib/lakebase/value-captures";
import { withPrisma } from "@/lib/prisma";
import type { ExecutiveSynthesis } from "@/lib/domain/types";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const guard = await loadRunOrRespond(req, runId, "read");
    if (!guard.ok) return guard.response;

    const [
      estimates,
      valueSummary,
      roadmapPhases,
      tracking,
      stakeholders,
      valueCaptures,
      runMetadata,
    ] = await Promise.all([
      getValueEstimatesForRun(runId),
      getValueSummaryForRun(runId),
      getRoadmapPhasesForRun(runId),
      getTrackingForRun(runId),
      getStakeholderProfilesForRun(runId),
      getValueCapturesForRun(runId),
      withPrisma(async (prisma) => {
        const row = await prisma.forgeRun.findUnique({
          where: { runId },
          select: { synthesisJson: true, degradedStepsJson: true },
        });
        return row;
      }),
    ]);

    let synthesis: ExecutiveSynthesis | null = null;
    if (runMetadata?.synthesisJson) {
      try {
        synthesis = JSON.parse(runMetadata.synthesisJson) as ExecutiveSynthesis;
      } catch {
        synthesis = null;
      }
    }

    let degradedSteps: string[] = [];
    if (runMetadata?.degradedStepsJson) {
      try {
        const parsed = JSON.parse(runMetadata.degradedStepsJson) as unknown;
        if (Array.isArray(parsed)) {
          degradedSteps = parsed.filter((s): s is string => typeof s === "string");
        }
      } catch {
        degradedSteps = [];
      }
    }

    return NextResponse.json({
      estimates,
      valueSummary,
      roadmapPhases,
      tracking,
      stakeholders,
      valueCaptures,
      synthesis,
      degradedSteps,
    });
  } catch (err) {
    logger.error("[api/runs/business-value] GET failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to load business value data" }, { status: 500 });
  }
}
