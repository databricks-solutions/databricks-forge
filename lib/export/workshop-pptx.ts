/**
 * D4B Workshop Pack PPTX -- a single deck for Databricks-for-Business workshop
 * facilitation.
 *
 * Sections:
 *   1. The Case for Change (D4B statistics + estate context)
 *   2. Executive Findings (synthesis slides)
 *   3. Delivery Roadmap (phase breakdown + quick wins)
 *   4. Recommended Genie Spaces (if available)
 *   5. Workshop Agenda (static template)
 */

import PptxGenJS from "pptxgenjs";
import type { BusinessValuePortfolio, StakeholderProfile } from "@/lib/domain/types";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";
import { PPTX, today, formatCompactCurrency } from "./brand";
import {
  addFooter,
  addAccentBar,
  addRedSeparator,
  addBrandShapes,
  addTitleSlide,
  headerCell,
  bodyCell,
  getLogoBase64,
} from "./pptx-helpers";

export interface WorkshopContext {
  estateTablesCount?: number;
  estateSchemasCount?: number;
  estateCatalogsCount?: number;
  genieSpaces?: Array<{ name: string; tableCount: number; domain: string }>;
}

export async function generateWorkshopPptx(
  portfolio: BusinessValuePortfolio,
  useCases: PortfolioUseCase[],
  stakeholders: StakeholderProfile[],
  ctx?: WorkshopContext,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Databricks Forge";
  pptx.title = "D4B Workshop Pack";

  const syn = portfolio.latestSynthesis;

  // =====================================================================
  // TITLE
  // =====================================================================
  addTitleSlide(pptx, "Databricks for Business Workshop", today(), "Discovery to Delivery");

  // =====================================================================
  // SECTION 1: THE CASE FOR CHANGE
  // =====================================================================
  {
    const slide = pptx.addSlide();
    slide.background = { color: PPTX.DB_DARK };
    addBrandShapes(slide);
    addRedSeparator(slide, 1.5, 2.0, 3);

    slide.addText("The Case for Change", {
      x: 1.5,
      y: 2.3,
      w: 10,
      fontSize: 44,
      bold: true,
      color: PPTX.WHITE,
      fontFace: "Calibri",
    });
    slide.addText("Why data-driven self-service matters now", {
      x: 1.5,
      y: 3.5,
      w: 10,
      fontSize: 22,
      color: PPTX.DB_RED,
      fontFace: "Calibri",
    });
    addFooter(slide, "dark");
  }

  // "Why Now?" slide with D4B statistics
  {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Why Now?", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const stats: PptxGenJS.TextProps[] = [
      {
        text: "Less than 15% of business users have self-service access to analytics today",
        options: {
          fontSize: 16,
          bold: true,
          color: PPTX.DB_RED,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 8,
        },
      },
      {
        text: "Ad-hoc analyst reports cost $1,200–$3,500 each and take 3–7 days",
        options: {
          fontSize: 16,
          bold: true,
          color: PPTX.DB_RED,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 8,
        },
      },
      {
        text: "BI tool consolidation on a unified platform typically saves 15–30% of analytics spend",
        options: {
          fontSize: 14,
          color: PPTX.TEXT_COLOR,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 6,
        },
      },
      {
        text: "Centralised governance reduces compliance audit preparation by 50–70%",
        options: {
          fontSize: 14,
          color: PPTX.TEXT_COLOR,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 6,
        },
      },
    ];

    if (ctx?.estateTablesCount) {
      stats.push({
        text: `Your data estate: ${ctx.estateCatalogsCount ?? "?"} catalogs, ${ctx.estateSchemasCount ?? "?"} schemas, ${ctx.estateTablesCount} tables`,
        options: {
          fontSize: 14,
          bold: true,
          color: PPTX.DB_DARK,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 6,
        },
      });
    }

    stats.push({
      text: `Forge discovered ${portfolio.totalUseCases} use cases worth ${formatCompactCurrency(portfolio.totalEstimatedValue.mid)} in estimated value`,
      options: {
        fontSize: 16,
        bold: true,
        color: PPTX.DB_DARK,
        bullet: true,
        breakLine: true,
        paraSpaceAfter: 6,
      },
    });

    slide.addText(stats, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      h: 5.5,
      valign: "top",
      fontFace: "Calibri",
    });
    addFooter(slide);
  }

  // =====================================================================
  // SECTION 2: EXECUTIVE FINDINGS
  // =====================================================================
  if (syn) {
    // Key Findings
    if (syn.keyFindings.length > 0) {
      const slide = pptx.addSlide();
      addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
      slide.addText("Key Findings", {
        x: PPTX.CONTENT_MARGIN,
        y: 0.3,
        w: PPTX.CONTENT_W,
        fontSize: 36,
        bold: true,
        color: PPTX.DB_DARK,
        fontFace: "Calibri",
      });
      addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

      const items: PptxGenJS.TextProps[] = syn.keyFindings.slice(0, 6).flatMap((f) => [
        {
          text: f.title,
          options: {
            fontSize: 14,
            bold: true,
            color: PPTX.DB_DARK,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 2,
          } as PptxGenJS.TextPropsOptions,
        },
        {
          text: f.description,
          options: {
            fontSize: 12,
            color: PPTX.TEXT_COLOR,
            breakLine: true,
            paraSpaceAfter: 10,
            indentLevel: 1,
          } as PptxGenJS.TextPropsOptions,
        },
      ]);

      slide.addText(items, {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: PPTX.CONTENT_W - 0.6,
        h: 5.5,
        valign: "top",
        fontFace: "Calibri",
      });
      addFooter(slide);
    }

    // Value Summary
    {
      const slide = pptx.addSlide();
      addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
      slide.addText("Value Summary", {
        x: PPTX.CONTENT_MARGIN,
        y: 0.3,
        w: PPTX.CONTENT_W,
        fontSize: 36,
        bold: true,
        color: PPTX.DB_DARK,
        fontFace: "Calibri",
      });
      addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

      const valueBullets: PptxGenJS.TextProps[] = [
        {
          text: `Total estimated annual value: ${formatCompactCurrency(portfolio.totalEstimatedValue.mid)} (range: ${formatCompactCurrency(portfolio.totalEstimatedValue.low)} – ${formatCompactCurrency(portfolio.totalEstimatedValue.high)})`,
          options: {
            fontSize: 18,
            bold: true,
            color: PPTX.DB_RED,
            breakLine: true,
            paraSpaceAfter: 12,
          },
        },
        {
          text: `${syn.quickWinCount ?? portfolio.byPhase.quick_wins.count} quick wins identified for immediate value`,
          options: {
            fontSize: 16,
            color: PPTX.DB_DARK,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 8,
          },
        },
        {
          text: `Top domain: ${syn.topDomain ?? portfolio.byDomain[0]?.domain ?? "N/A"}`,
          options: {
            fontSize: 16,
            color: PPTX.DB_DARK,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 8,
          },
        },
        {
          text: `${portfolio.byDomain.length} business domains covered across ${portfolio.totalUseCases} use cases`,
          options: {
            fontSize: 14,
            color: PPTX.TEXT_COLOR,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 6,
          },
        },
      ];

      slide.addText(valueBullets, {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: PPTX.CONTENT_W - 0.6,
        h: 4.0,
        valign: "top",
        fontFace: "Calibri",
      });
      addFooter(slide);
    }
  }

  // =====================================================================
  // SECTION 3: DELIVERY ROADMAP
  // =====================================================================
  {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Delivery Roadmap", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const phaseTable: PptxGenJS.TableRow[] = [
      [
        headerCell("Phase"),
        headerCell("Use Cases"),
        headerCell("Est. Value"),
        headerCell("Timeframe"),
      ],
      ...[
        { label: "Quick Wins", key: "quick_wins" as const, time: "0–3 months" },
        { label: "Foundation", key: "foundation" as const, time: "3–9 months" },
        { label: "Transformation", key: "transformation" as const, time: "9–18 months" },
      ].map(
        (p): PptxGenJS.TableRow => [
          bodyCell(p.label, { bold: true }),
          bodyCell(String(portfolio.byPhase[p.key].count), { align: "center" }),
          bodyCell(formatCompactCurrency(portfolio.byPhase[p.key].valueMid), { align: "right" }),
          bodyCell(p.time, { align: "center", color: PPTX.MID_GRAY }),
        ],
      ),
    ];

    slide.addTable(phaseTable, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.3,
      w: 10,
      colW: [3, 2, 2.5, 2.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.3,
      autoPageCharWeight: -0.5,
    });

    // Top quick wins
    const qw = useCases
      .filter((uc) => uc.phase === "quick_wins")
      .sort((a, b) => b.valueMid - a.valueMid)
      .slice(0, 5);

    if (qw.length > 0) {
      slide.addText("Top Quick Wins to Prioritise", {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 3.5,
        w: PPTX.CONTENT_W - 0.6,
        fontSize: 18,
        bold: true,
        color: PPTX.DB_DARK,
        fontFace: "Calibri",
      });

      const qwTable: PptxGenJS.TableRow[] = [
        [
          headerCell("Use Case"),
          headerCell("Domain"),
          headerCell("Est. Value"),
          headerCell("Effort"),
        ],
        ...qw.map(
          (uc): PptxGenJS.TableRow => [
            bodyCell(uc.name, { bold: true }),
            bodyCell(uc.domain),
            bodyCell(formatCompactCurrency(uc.valueMid), { align: "right" }),
            bodyCell(uc.effortEstimate?.toUpperCase() ?? "—", { align: "center" }),
          ],
        ),
      ];

      slide.addTable(qwTable, {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 3.9,
        w: PPTX.CONTENT_W - 0.6,
        colW: [5, 2.5, 2, 1.5],
        border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
        fontSize: 11,
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageSlideStartY: 1.3,
        autoPageCharWeight: -0.5,
      });
    }

    addFooter(slide);
  }

  // =====================================================================
  // SECTION 4: RECOMMENDED GENIE SPACES
  // =====================================================================
  if (ctx?.genieSpaces && ctx.genieSpaces.length > 0) {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Recommended Genie Spaces", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    slide.addText(
      "These Genie Spaces bridge the morning discovery into the afternoon hands-on build session.",
      {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 1.15,
        w: PPTX.CONTENT_W - 0.6,
        fontSize: 13,
        color: PPTX.MID_GRAY,
        fontFace: "Calibri",
      },
    );

    const gsTable: PptxGenJS.TableRow[] = [
      [headerCell("Genie Space"), headerCell("Domain"), headerCell("Tables")],
      ...ctx.genieSpaces
        .slice(0, 8)
        .map(
          (gs): PptxGenJS.TableRow => [
            bodyCell(gs.name, { bold: true }),
            bodyCell(gs.domain),
            bodyCell(String(gs.tableCount), { align: "center" }),
          ],
        ),
    ];

    slide.addTable(gsTable, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.6,
      w: 8,
      colW: [4, 2.5, 1.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.6,
      autoPageCharWeight: -0.5,
    });

    addFooter(slide);
  }

  // =====================================================================
  // SECTION 5: WORKSHOP AGENDA
  // =====================================================================
  {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Workshop Agenda", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const agenda: PptxGenJS.TextProps[] = [
      {
        text: "MORNING — Discovery & Alignment",
        options: {
          fontSize: 18,
          bold: true,
          color: PPTX.DB_RED,
          breakLine: true,
          paraSpaceAfter: 8,
        },
      },
      {
        text: "• Review discovered use cases and value estimates",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
      {
        text: "• Stakeholder prioritisation and voting",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
      {
        text: "• Quick wins identification and roadmap alignment",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
      {
        text: "• Business questions capture for Genie Spaces",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 14 },
      },

      {
        text: "AFTERNOON — Build & Benchmark",
        options: {
          fontSize: 18,
          bold: true,
          color: PPTX.DB_RED,
          breakLine: true,
          paraSpaceAfter: 8,
        },
      },
      {
        text: "• Hands-on Genie Space build (guided by Forge recommendations)",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
      {
        text: "• Benchmark and health check review",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
      {
        text: "• Value realisation tracking setup",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
      {
        text: "• Next steps and ownership assignment",
        options: { fontSize: 14, color: PPTX.TEXT_COLOR, breakLine: true, paraSpaceAfter: 4 },
      },
    ];

    slide.addText(agenda, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      h: 5.5,
      valign: "top",
      fontFace: "Calibri",
    });
    addFooter(slide);
  }

  // =====================================================================
  // CLOSING
  // =====================================================================
  {
    const slide = pptx.addSlide();
    slide.background = { color: PPTX.DB_DARK };
    addBrandShapes(slide);

    const logo = getLogoBase64();
    if (logo) {
      slide.addImage({ data: logo, x: 5.9, y: 2.0, w: 1.0, h: 1.05 });
    }

    slide.addText("Let's build it together.", {
      x: 1.5,
      y: 3.5,
      w: 10,
      fontSize: 36,
      bold: true,
      color: PPTX.WHITE,
      fontFace: "Calibri",
      align: "center",
    });

    slide.addText("Powered by Databricks Forge", {
      x: 1.5,
      y: 4.5,
      w: 10,
      fontSize: 16,
      color: PPTX.TEXT_LIGHT,
      fontFace: "Calibri",
      align: "center",
    });

    addFooter(slide, "dark");
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(output as ArrayBuffer);
}
