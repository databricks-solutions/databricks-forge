/**
 * API: /api/portfolio/export (V2 — org-admin)
 *
 * POST -- generate the Portfolio (CDO) board-pack PDF across all estates.
 *         Gated by `requirePortfolioAccess`; logged as `portfolio_exported`.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { apiLogger } from "@/lib/logger";
import { requirePortfolioAccess } from "@/lib/auth/portfolio-guard";
import { getPortfolioOverview, getPortfolioEntities } from "@/lib/lakebase/portfolio-estate";
import { runPortfolioSynthesis } from "@/lib/ai/portfolio-synthesis/engine";
import { generatePortfolioBoardPackPdf } from "@/lib/export/portfolio-board-pack-pdf";
import { generateEmbeddings } from "@/lib/embeddings/client";
import { logActivity } from "@/lib/lakebase/activity-log";

export async function POST(request: NextRequest) {
  const log = apiLogger("/api/portfolio/export", "POST");
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
      { embed: async (texts) => generateEmbeddings(texts) },
    );

    const pdf = await generatePortfolioBoardPackPdf({ overview, synthesis });

    logActivity("portfolio_exported", {
      userId: guard.user.email,
      resourceId: null,
      metadata: { estates: overview.totals.estates, format: "pdf" },
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="forge-portfolio-board-pack.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    log.error("POST failed", {
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "internal_error",
    });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
