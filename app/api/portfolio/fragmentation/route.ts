/**
 * API: /api/portfolio/fragmentation (V2 — org-admin)
 *
 * GET -- cross-team fragmentation, federated opportunities, and the org uplift
 *        plan, produced by the portfolio synthesis engine. Gated by
 *        `requirePortfolioAccess`; logged as `portfolio_viewed`.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { toJsonSafe } from "@/lib/json-safe";
import { requirePortfolioAccess } from "@/lib/auth/portfolio-guard";
import { getPortfolioOverview, getPortfolioEntities } from "@/lib/lakebase/portfolio-estate";
import { runPortfolioSynthesis } from "@/lib/ai/portfolio-synthesis/engine";
import { generateEmbeddings } from "@/lib/embeddings/client";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function GET(request: NextRequest) {
  const log = apiLogger("/api/portfolio/fragmentation", "GET");
  try {
    const guard = await requirePortfolioAccess(request);
    if (!guard.ok) return guard.response;

    await ensureMigrated();
    const [overview, entities] = await Promise.all([
      getPortfolioOverview(),
      getPortfolioEntities(),
    ]);

    const synthesis = await runPortfolioSynthesis(
      { overview, entities },
      {
        // Use real embeddings when the endpoint is reachable; the engine falls
        // back to name-normalisation clustering automatically on failure.
        embed: async (texts) => generateEmbeddings(texts),
      },
    );

    logActivity("portfolio_viewed", {
      userId: guard.user.email,
      resourceId: null,
      metadata: { fragmentation: synthesis.fragmentation.length, view: "fragmentation" },
    });

    return NextResponse.json(
      { synthesis: toJsonSafe(synthesis) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("GET failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
