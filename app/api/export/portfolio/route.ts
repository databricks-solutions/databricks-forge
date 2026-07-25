/**
 * API: /api/export/portfolio
 *
 * GET -- export portfolio-level Business Value data.
 *
 * Query params:
 *   ?format=excel|pptx|pdf|workshop
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { logger } from "@/lib/logger";
import { getPortfolioData, getPortfolioUseCases } from "@/lib/lakebase/portfolio";
import { getStakeholderProfilesForLatestRun } from "@/lib/lakebase/stakeholder-profiles";
import { generatePortfolioExcel } from "@/lib/export/portfolio-excel";
import { generatePortfolioPptx } from "@/lib/export/portfolio-pptx";
import { generateExecutivePdf } from "@/lib/export/executive-pdf";
import { generateWorkshopPptx } from "@/lib/export/workshop-pptx";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { logActivity } from "@/lib/lakebase/activity-log";
import { today } from "@/lib/export/brand";
import { requireUser, ForgeAuthError } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

const VALID_FORMATS = ["excel", "pptx", "pdf", "workshop"] as const;
type PortfolioFormat = (typeof VALID_FORMATS)[number];

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
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") as PortfolioFormat | null;

    if (!format || !VALID_FORMATS.includes(format)) {
      return NextResponse.json(
        { error: `format query param required: ${VALID_FORMATS.join(", ")}` },
        { status: 400 },
      );
    }

    const accessibleRunIds = await listAccessibleIds(user.email, "run");
    const [portfolio, useCases, { profiles: stakeholders }] = await Promise.all([
      getPortfolioData(user.email, accessibleRunIds),
      getPortfolioUseCases(user.email, accessibleRunIds),
      getStakeholderProfilesForLatestRun(user.email, accessibleRunIds),
    ]);

    if (portfolio.totalUseCases === 0) {
      return NextResponse.json(
        { error: "No portfolio data available. Complete a pipeline run first." },
        { status: 404 },
      );
    }

    const userEmail = user.email;
    const dateStamp = today().replace(/-/g, "_");

    switch (format) {
      case "excel": {
        const buffer = await generatePortfolioExcel(portfolio, useCases, stakeholders);
        logActivity("exported", {
          userId: userEmail,
          metadata: { format: "portfolio-excel" },
        });
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="forge_portfolio_${dateStamp}.xlsx"`,
          },
        });
      }

      case "pptx": {
        const buffer = await generatePortfolioPptx(portfolio, useCases, stakeholders);
        logActivity("exported", {
          userId: userEmail,
          metadata: { format: "portfolio-pptx" },
        });
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "Content-Disposition": `attachment; filename="forge_portfolio_${dateStamp}.pptx"`,
          },
        });
      }

      case "pdf": {
        const buffer = await generateExecutivePdf(portfolio);
        logActivity("exported", {
          userId: userEmail,
          metadata: { format: "portfolio-pdf" },
        });
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="forge_executive_brief_${dateStamp}.pdf"`,
          },
        });
      }

      case "workshop": {
        const buffer = await generateWorkshopPptx(portfolio, useCases, stakeholders);
        logActivity("exported", {
          userId: userEmail,
          metadata: { format: "workshop-pptx" },
        });
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "Content-Disposition": `attachment; filename="forge_d4b_workshop_${dateStamp}.pptx"`,
          },
        });
      }

      default:
        return NextResponse.json({ error: `Unsupported format: ${format}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/export/portfolio] GET failed", { error: msg });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
