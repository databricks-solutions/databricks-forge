/**
 * Portfolio-level PPTX export -- standalone Business Value slide deck.
 *
 * Generates a Databricks-branded executive deck:
 *   1. Title slide
 *   2. Value Summary (KPI layout)
 *   3. Key Findings
 *   4. Strategic Recommendations
 *   5. Risk Callouts
 *   6. Delivery Pipeline
 *   7. Domain Performance
 *   8. Stakeholder Summary
 */

import PptxGenJS from "pptxgenjs";
import type { BusinessValuePortfolio, StakeholderProfile } from "@/lib/domain/types";
import type { PortfolioUseCase } from "@/lib/lakebase/portfolio";
import { PPTX, today, formatCompactCurrency, scoreColor } from "./brand";
import {
  addFooter,
  addAccentBar,
  addRedSeparator,
  addTitleSlide,
  headerCell,
  bodyCell,
} from "./pptx-helpers";

// ---------------------------------------------------------------------------
// KPI box helper
// ---------------------------------------------------------------------------

function addKpiBoxes(
  slide: PptxGenJS.Slide,
  kpis: Array<{ label: string; value: string; accent?: boolean }>,
  y: number,
): void {
  const boxW = 2.7;
  const boxH = 1.0;
  const gap = 0.25;
  const totalW = kpis.length * boxW + (kpis.length - 1) * gap;
  const startX = (PPTX.SLIDE_W - totalW) / 2;

  kpis.forEach((kpi, i) => {
    const x = startX + i * (boxW + gap);
    slide.addShape("rect", {
      x,
      y,
      w: boxW,
      h: boxH,
      fill: { color: PPTX.WARM_WHITE },
      line: { color: PPTX.BORDER_COLOR, width: 0.5 },
      rectRadius: 0.08,
    });
    slide.addText(kpi.value, {
      x,
      y: y + 0.12,
      w: boxW,
      fontSize: 22,
      bold: true,
      color: kpi.accent ? PPTX.DB_RED : PPTX.DB_DARK,
      fontFace: "Calibri",
      align: "center",
    });
    slide.addText(kpi.label, {
      x,
      y: y + 0.55,
      w: boxW,
      fontSize: 11,
      color: PPTX.MID_GRAY,
      fontFace: "Calibri",
      align: "center",
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generatePortfolioPptx(
  portfolio: BusinessValuePortfolio,
  useCases: PortfolioUseCase[],
  stakeholders: StakeholderProfile[],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Databricks Forge";
  pptx.title = "Business Value Portfolio";

  const syn = portfolio.latestSynthesis;
  const topDomain = syn?.topDomain ?? portfolio.byDomain[0]?.domain ?? "";

  // =====================================================================
  // 1. TITLE SLIDE
  // =====================================================================
  addTitleSlide(pptx, "Business Value Portfolio", today(), topDomain || "Portfolio Overview");

  // =====================================================================
  // 2. VALUE SUMMARY
  // =====================================================================
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

    addKpiBoxes(
      slide,
      [
        {
          label: "Total Estimated Value",
          value: formatCompactCurrency(portfolio.totalEstimatedValue.mid),
          accent: true,
        },
        {
          label: "Value Range",
          value: `${formatCompactCurrency(portfolio.totalEstimatedValue.low)} – ${formatCompactCurrency(portfolio.totalEstimatedValue.high)}`,
        },
        { label: "Quick Wins", value: String(portfolio.byPhase.quick_wins.count) },
        { label: "Delivered Value", value: formatCompactCurrency(portfolio.deliveredValue) },
      ],
      1.5,
    );

    addKpiBoxes(
      slide,
      [
        { label: "Total Use Cases", value: String(portfolio.totalUseCases) },
        { label: "Domains", value: String(portfolio.byDomain.length) },
        {
          label: "Delivered",
          value: String(portfolio.byStage.delivered),
        },
        {
          label: "In Progress",
          value: String(portfolio.byStage.in_progress),
        },
      ],
      3.0,
    );

    // Conversion funnel text
    const convRate =
      portfolio.totalUseCases > 0
        ? Math.round(
            ((portfolio.byStage.delivered + portfolio.byStage.measured) / portfolio.totalUseCases) *
              100,
          )
        : 0;
    slide.addText(`Discovery → Delivered conversion rate: ${convRate}%`, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 4.6,
      w: PPTX.CONTENT_W - 0.6,
      fontSize: 14,
      color: PPTX.MID_GRAY,
      fontFace: "Calibri",
    });

    addFooter(slide);
  }

  // =====================================================================
  // 3. KEY FINDINGS
  // =====================================================================
  if (syn && syn.keyFindings.length > 0) {
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
        text: `${f.title}`,
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

  // =====================================================================
  // 4. STRATEGIC RECOMMENDATIONS
  // =====================================================================
  if (syn && syn.strategicRecommendations.length > 0) {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Strategic Recommendations", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const items: PptxGenJS.TextProps[] = syn.strategicRecommendations
      .slice(0, 5)
      .flatMap((r, i) => [
        {
          text: `${i + 1}. ${r.title} [${r.priority.toUpperCase()}]`,
          options: {
            fontSize: 14,
            bold: true,
            color: PPTX.DB_DARK,
            breakLine: true,
            paraSpaceAfter: 2,
          } as PptxGenJS.TextPropsOptions,
        },
        {
          text: r.description,
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

  // =====================================================================
  // 5. RISK CALLOUTS
  // =====================================================================
  if (syn && syn.riskCallouts.length > 0) {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Risk Callouts", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const items: PptxGenJS.TextProps[] = syn.riskCallouts.slice(0, 5).flatMap((r) => [
      {
        text: `${r.title} [${r.impact.toUpperCase()} impact]`,
        options: {
          fontSize: 14,
          bold: true,
          color: PPTX.DB_RED,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 2,
        } as PptxGenJS.TextPropsOptions,
      },
      {
        text: r.description,
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

  // =====================================================================
  // 6. DELIVERY PIPELINE
  // =====================================================================
  {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Delivery Pipeline", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const phaseData: PptxGenJS.TableRow[] = [
      [headerCell("Phase"), headerCell("Use Cases"), headerCell("Est. Value")],
      ...[
        { label: "Quick Wins", key: "quick_wins" as const },
        { label: "Foundation", key: "foundation" as const },
        { label: "Transformation", key: "transformation" as const },
      ].map(
        (p): PptxGenJS.TableRow => [
          bodyCell(p.label, { bold: true }),
          bodyCell(String(portfolio.byPhase[p.key].count), { align: "center" }),
          bodyCell(formatCompactCurrency(portfolio.byPhase[p.key].valueMid), {
            align: "right",
          }),
        ],
      ),
    ];

    slide.addTable(phaseData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.3,
      w: 8,
      colW: [4, 2, 2],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.3,
      autoPageCharWeight: -0.5,
    });

    // Quick wins call-out
    const quickWins = useCases
      .filter((uc) => uc.phase === "quick_wins")
      .sort((a, b) => b.valueMid - a.valueMid)
      .slice(0, 5);

    if (quickWins.length > 0) {
      slide.addText("Top Quick Wins", {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 3.5,
        w: PPTX.CONTENT_W - 0.6,
        fontSize: 18,
        bold: true,
        color: PPTX.DB_DARK,
        fontFace: "Calibri",
      });

      const qwData: PptxGenJS.TableRow[] = [
        [headerCell("Use Case"), headerCell("Domain"), headerCell("Value"), headerCell("Effort")],
        ...quickWins.map(
          (uc): PptxGenJS.TableRow => [
            bodyCell(uc.name, { bold: true }),
            bodyCell(uc.domain),
            bodyCell(formatCompactCurrency(uc.valueMid), { align: "right" }),
            bodyCell(uc.effortEstimate?.toUpperCase() ?? "—", { align: "center" }),
          ],
        ),
      ];

      slide.addTable(qwData, {
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
  // 7. DOMAIN PERFORMANCE
  // =====================================================================
  if (portfolio.byDomain.length > 0) {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Domain Performance", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const topDomains = [...portfolio.byDomain].sort((a, b) => b.valueMid - a.valueMid).slice(0, 10);

    const domData: PptxGenJS.TableRow[] = [
      [
        headerCell("Domain"),
        headerCell("Use Cases"),
        headerCell("Est. Value"),
        headerCell("Avg Score"),
      ],
      ...topDomains.map(
        (d): PptxGenJS.TableRow => [
          bodyCell(d.domain, { bold: true }),
          bodyCell(String(d.useCaseCount), { align: "center" }),
          bodyCell(formatCompactCurrency(d.valueMid), { align: "right" }),
          bodyCell(`${Math.round(d.avgScore * 100)}%`, {
            align: "center",
            color: scoreColor(d.avgScore),
            bold: true,
          }),
        ],
      ),
    ];

    slide.addTable(domData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.3,
      w: PPTX.CONTENT_W - 0.6,
      colW: [5, 1.5, 2.5, 2],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 12,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.3,
      autoPageCharWeight: -0.5,
    });

    addFooter(slide);
  }

  // =====================================================================
  // 8. STAKEHOLDER SUMMARY
  // =====================================================================
  if (stakeholders.length > 0) {
    const slide = pptx.addSlide();
    addAccentBar(slide, PPTX.DB_RED, 0, 0.8, 0.1, 3.0);
    slide.addText("Stakeholder Summary", {
      x: PPTX.CONTENT_MARGIN,
      y: 0.3,
      w: PPTX.CONTENT_W,
      fontSize: 36,
      bold: true,
      color: PPTX.DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(slide, PPTX.CONTENT_MARGIN, 0.95, 4);

    const champions = stakeholders.filter((s) => s.isChampion);
    const departments = [...new Set(stakeholders.map((s) => s.department))];

    addKpiBoxes(
      slide,
      [
        { label: "Stakeholders", value: String(stakeholders.length) },
        { label: "Champions", value: String(champions.length), accent: true },
        { label: "Departments", value: String(departments.length) },
        {
          label: "High Change Complexity",
          value: String(stakeholders.filter((s) => s.changeComplexity === "high").length),
        },
      ],
      1.3,
    );

    const topStake: PptxGenJS.TableRow[] = [
      [
        headerCell("Role"),
        headerCell("Department"),
        headerCell("Use Cases"),
        headerCell("Value"),
        headerCell("Champion"),
      ],
      ...stakeholders
        .sort((a, b) => b.totalValue - a.totalValue)
        .slice(0, 8)
        .map(
          (s): PptxGenJS.TableRow => [
            bodyCell(s.role, { bold: true }),
            bodyCell(s.department),
            bodyCell(String(s.useCaseCount), { align: "center" }),
            bodyCell(formatCompactCurrency(s.totalValue), { align: "right" }),
            bodyCell(s.isChampion ? "Yes" : "", { align: "center" }),
          ],
        ),
    ];

    slide.addTable(topStake, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 2.8,
      w: PPTX.CONTENT_W - 0.6,
      colW: [3.5, 2.5, 1.5, 2, 1.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 11,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.3,
      autoPageCharWeight: -0.5,
    });

    addFooter(slide);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(output as ArrayBuffer);
}
