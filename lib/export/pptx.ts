/**
 * PowerPoint export using pptxgenjs.
 *
 * Generates a Databricks-branded executive slide deck matching the original
 * notebook output:
 *
 *  1. Title slide (decorative shapes, brand colours)
 *  2. Executive summary (narrative bullets from business context)
 *  3. Table of contents (paginated domain/count table)
 *  4. Per-domain sequence:
 *     a. Domain divider (full-bleed branded slide)
 *     b. Domain summary (bullet points)
 *     c. Individual use case slides (one per use case)
 */

import PptxGenJS from "pptxgenjs";
import fs from "fs";
import path from "path";
import type { PipelineRun, UseCase, ExecutiveSynthesis } from "@/lib/domain/types";
import { groupByDomain, computeDomainStats, effectiveScores } from "@/lib/domain/scoring";
import {
  buildExecutiveSummaryItems,
  paginateSummaryItems,
  type ExecutiveSummaryLine,
} from "@/lib/export/pptx-exec-summary";
import { formatCompactCurrency } from "@/lib/export/brand";

// ---------------------------------------------------------------------------
// Databricks logo — loaded once from public/databricks-icon.svg as base64 PNG
// pptxgenjs needs the image as a base64 data URI.
// ---------------------------------------------------------------------------

let _logoBase64: string | null = null;

function getLogoBase64(): string | null {
  if (_logoBase64 !== null) return _logoBase64;
  try {
    const svgPath = path.join(process.cwd(), "public", "databricks-icon.svg");
    const svgContent = fs.readFileSync(svgPath, "utf-8");
    _logoBase64 = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
    return _logoBase64;
  } catch {
    _logoBase64 = "";
    return null;
  }
}

// ---------------------------------------------------------------------------
// Official Databricks brand constants (hex without # for pptxgenjs)
// ---------------------------------------------------------------------------

const DB_DARK = "1B3139"; // Brand Dark — dark teal-charcoal
const DB_RED = "FF3621"; // Databricks Red — primary accent
const TEXT_COLOR = "2D3E50"; // Charcoal for body text on light slides
const TEXT_LIGHT = "BECBD2"; // De-saturated light text on dark slides
const WARM_WHITE = "FAFAFA";
const WHITE = "FFFFFF";
const FOOTER_COLOR = "8899A6";
const BORDER_COLOR = "D1D5DB";
const MID_GRAY = "5E6E7D";
const SCORE_GREEN = "2EA44F";
const SCORE_AMBER = "E8912D";

// Slide dimensions (widescreen 13.33 x 7.5 in)
const SLIDE_W = 13.33;
const CONTENT_MARGIN = 0.6;
const CONTENT_W = SLIDE_W - CONTENT_MARGIN * 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Add branded footer with logo to a slide */
function addFooter(slide: PptxGenJS.Slide, variant: "light" | "dark" = "light"): void {
  const logo = getLogoBase64();
  if (logo) {
    slide.addImage({ data: logo, x: CONTENT_MARGIN, y: 6.98, w: 0.25, h: 0.26 });
  }
  slide.addText(`Databricks Forge  |  ${today()}`, {
    x: CONTENT_MARGIN + 0.35,
    y: 7.0,
    w: CONTENT_W - 0.35,
    fontSize: 10,
    color: variant === "dark" ? TEXT_LIGHT : FOOTER_COLOR,
    align: "right",
  });
}

/** Add a coloured rectangle accent bar */
function addAccentBar(
  slide: PptxGenJS.Slide,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  slide.addShape("rect", {
    x,
    y,
    w,
    h,
    fill: { color },
  });
}

/** Add red separator line across a slide */
function addRedSeparator(slide: PptxGenJS.Slide, x: number, y: number, w: number): void {
  slide.addShape("rect", { x, y, w, h: 0.04, fill: { color: DB_RED } });
}

/** Add subtle geometric brand shapes to dark slides */
function addBrandShapes(slide: PptxGenJS.Slide): void {
  // Top-right subtle circle
  slide.addShape("ellipse", {
    x: 11.3,
    y: -0.3,
    w: 2.5,
    h: 2.5,
    fill: { color: WHITE, transparency: 92 },
  });
  // Bottom-left subtle circle
  slide.addShape("ellipse", {
    x: -0.5,
    y: 5.8,
    w: 2.0,
    h: 2.0,
    fill: { color: WHITE, transparency: 92 },
  });
  // Small red accent dot
  slide.addShape("ellipse", {
    x: 12.0,
    y: 6.5,
    w: 0.6,
    h: 0.6,
    fill: { color: DB_RED, transparency: 50 },
  });
}

/** Build domain summary bullet points from data (no AI call) */
function buildDomainSummary(domain: string, cases: UseCase[]): string[] {
  const aiCount = cases.filter((c) => c.type === "AI").length;
  const statsCount = cases.length - aiCount;
  const avgScore = Math.round(
    (cases.reduce((s, c) => s + effectiveScores(c).overall, 0) / cases.length) * 100,
  );
  const top = [...cases].sort((a, b) => effectiveScores(b).overall - effectiveScores(a).overall)[0];
  const subdomains = [...new Set(cases.map((c) => c.subdomain).filter(Boolean))];
  const techniques = [...new Set(cases.map((c) => c.analyticsTechnique).filter(Boolean))].slice(
    0,
    5,
  );

  const bullets: string[] = [];
  bullets.push(`${cases.length} use cases (${aiCount} AI, ${statsCount} Statistical)`);
  if (subdomains.length > 0) {
    bullets.push(`Subdomains: ${subdomains.slice(0, 5).join(", ")}`);
  }
  bullets.push(`Average score: ${avgScore}%`);
  if (top) {
    bullets.push(
      `Highest-scoring: ${top.name} (${Math.round(effectiveScores(top).overall * 100)}%)`,
    );
  }
  if (techniques.length > 0) {
    bullets.push(`Key techniques: ${techniques.join(", ")}`);
  }
  return bullets;
}

/** Standard header row styling for tables */
function headerCell(text: string): PptxGenJS.TableCell {
  return {
    text,
    options: {
      bold: true,
      color: WHITE,
      fill: { color: DB_DARK },
      fontSize: 14,
      align: "left",
      valign: "middle",
    },
  };
}

function bodyCell(text: string, opts?: Partial<PptxGenJS.TextPropsOptions>): PptxGenJS.TableCell {
  return {
    text,
    options: {
      fontSize: 12,
      color: TEXT_COLOR,
      valign: "middle",
      ...opts,
    },
  };
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

function annotateTableFqn(fqn: string, lineageFqns: Set<string>): string {
  return lineageFqns.has(fqn) ? `${fqn} (via lineage)` : fqn;
}

export async function generatePptx(
  run: PipelineRun,
  useCases: UseCase[],
  lineageDiscoveredFqns: string[] = [],
  summaries?: { executiveSummary: string; domainSummaries: Record<string, string> } | null,
  synthesis?: ExecutiveSynthesis | null,
): Promise<Buffer> {
  const lineageFqnSet = new Set(lineageDiscoveredFqns);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Databricks Forge";
  pptx.title = `${run.config.businessName} - Use Case Catalog`;

  const domainStats = computeDomainStats(useCases);
  const domainGroups = groupByDomain(useCases);
  const domainOrder = domainStats.map((ds) => ds.domain);
  const aiCount = useCases.filter((uc) => uc.type === "AI").length;
  const statsCount = useCases.length - aiCount;
  const avgScore = useCases.length
    ? Math.round(
        (useCases.reduce((s, uc) => s + effectiveScores(uc).overall, 0) / useCases.length) * 100,
      )
    : 0;

  // =====================================================================
  // 1. TITLE SLIDE
  // =====================================================================
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: DB_DARK };
  addBrandShapes(titleSlide);

  // Databricks logo (top-left)
  const logo = getLogoBase64();
  if (logo) {
    titleSlide.addImage({ data: logo, x: 0.6, y: 0.5, w: 0.55, h: 0.58 });
  }

  // Red separator above the title
  addRedSeparator(titleSlide, 1.5, 1.3, 3.5);

  titleSlide.addText("Databricks Forge", {
    x: 1.5,
    y: 1.6,
    w: 10,
    fontSize: 44,
    bold: true,
    color: WHITE,
    fontFace: "Calibri",
  });
  titleSlide.addText("Strategic AI Use Case Discovery", {
    x: 1.5,
    y: 2.6,
    w: 10,
    fontSize: 24,
    color: TEXT_LIGHT,
    fontFace: "Calibri",
  });

  // Red separator above the business name
  addRedSeparator(titleSlide, 1.5, 3.6, 2.5);

  titleSlide.addText(`For ${run.config.businessName}`, {
    x: 1.5,
    y: 3.9,
    w: 10,
    fontSize: 32,
    bold: true,
    color: DB_RED,
    fontFace: "Calibri",
  });
  titleSlide.addText(today(), {
    x: 1.5,
    y: 5.2,
    w: 10,
    fontSize: 20,
    color: TEXT_LIGHT,
    fontFace: "Calibri",
  });
  addFooter(titleSlide, "dark");

  // =====================================================================
  // 2. EXECUTIVE SUMMARY (paginated across multiple slides when long)
  // =====================================================================

  const summaryLines = buildExecutiveSummaryItems({
    executiveSummary: summaries?.executiveSummary,
    businessContext: run.businessContext,
    useCaseCount: useCases.length,
    domainCount: domainStats.length,
    aiCount,
    statsCount,
    avgScore,
    businessPriorities: run.config.businessPriorities,
  });

  // Paginate content across slides using per-line style-aware estimates.
  const EXEC_CONTENT_Y = 1.2;
  const EXEC_MAX_Y = 6.7;
  const EXEC_AVAILABLE_H = EXEC_MAX_Y - EXEC_CONTENT_Y;
  const EXEC_CONTENT_W = CONTENT_W - 0.6;

  const execPages = paginateSummaryItems(summaryLines, {
    availableHeight: EXEC_AVAILABLE_H,
    contentWidth: EXEC_CONTENT_W,
  });

  function toPptxLine(line: ExecutiveSummaryLine): PptxGenJS.TextProps {
    const isNarrative = line.kind === "narrative";
    return {
      text: line.text,
      options: {
        fontSize: line.kind === "sub-bullet" ? 13 : isNarrative ? 13 : 14,
        color: TEXT_COLOR,
        bullet: isNarrative ? false : true,
        breakLine: true,
        paraSpaceAfter: isNarrative ? 10 : line.kind === "sub-bullet" ? 4 : 6,
        bold: isNarrative ? false : line.keepWithNext === true,
      },
    };
  }

  for (let ep = 0; ep < execPages.length; ep++) {
    const execSlide = pptx.addSlide();

    addAccentBar(execSlide, DB_RED, 0, 0.8, 0.1, 3.0);

    const pageLabel = execPages.length > 1 ? ` (${ep + 1}/${execPages.length})` : "";
    execSlide.addText(`Executive Summary${pageLabel}`, {
      x: CONTENT_MARGIN,
      y: 0.3,
      w: CONTENT_W,
      fontSize: 36,
      bold: true,
      color: DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(execSlide, CONTENT_MARGIN, 0.95, 4);

    execSlide.addText(execPages[ep].map(toPptxLine), {
      x: CONTENT_MARGIN + 0.3,
      y: EXEC_CONTENT_Y,
      w: EXEC_CONTENT_W,
      h: EXEC_AVAILABLE_H,
      valign: "top",
      fontFace: "Calibri",
    });

    addFooter(execSlide);
  }

  // =====================================================================
  // 2b. SYNTHESIS SLIDES (when BV data available)
  // =====================================================================
  if (synthesis) {
    // Key Findings
    if (synthesis.keyFindings.length > 0) {
      const kfSlide = pptx.addSlide();
      addAccentBar(kfSlide, DB_RED, 0, 0.8, 0.1, 3.0);
      kfSlide.addText("Key Findings", {
        x: CONTENT_MARGIN,
        y: 0.3,
        w: CONTENT_W,
        fontSize: 36,
        bold: true,
        color: DB_DARK,
        fontFace: "Calibri",
      });
      addRedSeparator(kfSlide, CONTENT_MARGIN, 0.95, 4);

      const kfItems: PptxGenJS.TextProps[] = synthesis.keyFindings.slice(0, 6).flatMap((f) => [
        {
          text: f.title,
          options: {
            fontSize: 14,
            bold: true,
            color: DB_DARK,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 2,
          } as PptxGenJS.TextPropsOptions,
        },
        {
          text: f.description,
          options: {
            fontSize: 12,
            color: TEXT_COLOR,
            breakLine: true,
            paraSpaceAfter: 10,
            indentLevel: 1,
          } as PptxGenJS.TextPropsOptions,
        },
      ]);

      kfSlide.addText(kfItems, {
        x: CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: CONTENT_W - 0.6,
        h: 5.5,
        valign: "top",
        fontFace: "Calibri",
      });
      addFooter(kfSlide);
    }

    // Strategic Recommendations
    if (synthesis.strategicRecommendations.length > 0) {
      const srSlide = pptx.addSlide();
      addAccentBar(srSlide, DB_RED, 0, 0.8, 0.1, 3.0);
      srSlide.addText("Strategic Recommendations", {
        x: CONTENT_MARGIN,
        y: 0.3,
        w: CONTENT_W,
        fontSize: 36,
        bold: true,
        color: DB_DARK,
        fontFace: "Calibri",
      });
      addRedSeparator(srSlide, CONTENT_MARGIN, 0.95, 4);

      const srItems: PptxGenJS.TextProps[] = synthesis.strategicRecommendations
        .slice(0, 5)
        .flatMap((r, i) => [
          {
            text: `${i + 1}. ${r.title} [${r.priority.toUpperCase()}]`,
            options: {
              fontSize: 14,
              bold: true,
              color: DB_DARK,
              breakLine: true,
              paraSpaceAfter: 2,
            } as PptxGenJS.TextPropsOptions,
          },
          {
            text: r.description,
            options: {
              fontSize: 12,
              color: TEXT_COLOR,
              breakLine: true,
              paraSpaceAfter: 10,
              indentLevel: 1,
            } as PptxGenJS.TextPropsOptions,
          },
        ]);

      srSlide.addText(srItems, {
        x: CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: CONTENT_W - 0.6,
        h: 5.5,
        valign: "top",
        fontFace: "Calibri",
      });
      addFooter(srSlide);
    }

    // Risk Callouts
    if (synthesis.riskCallouts.length > 0) {
      const rcSlide = pptx.addSlide();
      addAccentBar(rcSlide, DB_RED, 0, 0.8, 0.1, 3.0);
      rcSlide.addText("Risk Callouts", {
        x: CONTENT_MARGIN,
        y: 0.3,
        w: CONTENT_W,
        fontSize: 36,
        bold: true,
        color: DB_DARK,
        fontFace: "Calibri",
      });
      addRedSeparator(rcSlide, CONTENT_MARGIN, 0.95, 4);

      const rcItems: PptxGenJS.TextProps[] = synthesis.riskCallouts.slice(0, 5).flatMap((r) => [
        {
          text: `${r.title} [${r.impact.toUpperCase()} impact]`,
          options: {
            fontSize: 14,
            bold: true,
            color: DB_RED,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 2,
          } as PptxGenJS.TextPropsOptions,
        },
        {
          text: r.description,
          options: {
            fontSize: 12,
            color: TEXT_COLOR,
            breakLine: true,
            paraSpaceAfter: 10,
            indentLevel: 1,
          } as PptxGenJS.TextPropsOptions,
        },
      ]);

      rcSlide.addText(rcItems, {
        x: CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: CONTENT_W - 0.6,
        h: 5.5,
        valign: "top",
        fontFace: "Calibri",
      });
      addFooter(rcSlide);
    }

    // Value Summary
    {
      const vsSlide = pptx.addSlide();
      addAccentBar(vsSlide, DB_RED, 0, 0.8, 0.1, 3.0);
      vsSlide.addText("Value Summary", {
        x: CONTENT_MARGIN,
        y: 0.3,
        w: CONTENT_W,
        fontSize: 36,
        bold: true,
        color: DB_DARK,
        fontFace: "Calibri",
      });
      addRedSeparator(vsSlide, CONTENT_MARGIN, 0.95, 4);

      const tv = synthesis.totalEstimatedValue;
      const vsBullets: PptxGenJS.TextProps[] = [
        {
          text: `Total estimated annual value: ${formatCompactCurrency(tv.mid)} (${formatCompactCurrency(tv.low)} – ${formatCompactCurrency(tv.high)})`,
          options: { fontSize: 18, bold: true, color: DB_RED, breakLine: true, paraSpaceAfter: 12 },
        },
        {
          text: `${synthesis.quickWinCount} quick wins identified for immediate value`,
          options: {
            fontSize: 16,
            color: DB_DARK,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 8,
          },
        },
        {
          text: `Top domain: ${synthesis.topDomain ?? "N/A"}`,
          options: {
            fontSize: 16,
            color: DB_DARK,
            bullet: true,
            breakLine: true,
            paraSpaceAfter: 8,
          },
        },
      ];

      vsSlide.addText(vsBullets, {
        x: CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: CONTENT_W - 0.6,
        h: 4.0,
        valign: "top",
        fontFace: "Calibri",
      });
      addFooter(vsSlide);
    }
  }

  // =====================================================================
  // 3. TABLE OF CONTENTS (paginated)
  // =====================================================================
  const ROWS_PER_TOC = 10;
  const tocPages = Math.ceil(domainStats.length / ROWS_PER_TOC);

  for (let page = 0; page < tocPages; page++) {
    const tocSlide = pptx.addSlide();

    // Brand accent bar
    addAccentBar(tocSlide, DB_RED, 0, 0.8, 0.1, 3.0);

    const pageLabel = tocPages > 1 ? ` (${page + 1}/${tocPages})` : "";
    tocSlide.addText(`Table of Contents${pageLabel}`, {
      x: CONTENT_MARGIN,
      y: 0.3,
      w: CONTENT_W,
      fontSize: 36,
      bold: true,
      color: DB_DARK,
      fontFace: "Calibri",
    });
    addRedSeparator(tocSlide, CONTENT_MARGIN, 0.95, 4);

    const pageStats = domainStats.slice(page * ROWS_PER_TOC, (page + 1) * ROWS_PER_TOC);

    const tocData: PptxGenJS.TableRow[] = [
      [headerCell("Domain"), headerCell("Use Cases"), headerCell("Avg Score")],
      ...pageStats.map(
        (ds): PptxGenJS.TableRow => [
          bodyCell(ds.domain, { bold: true }),
          bodyCell(String(ds.count), { align: "center" }),
          bodyCell(`${Math.round(ds.avgScore * 100)}%`, { align: "center" }),
        ],
      ),
    ];

    tocSlide.addTable(tocData, {
      x: CONTENT_MARGIN + 0.3,
      y: 1.3,
      w: 8,
      fontSize: 14,
      colW: [4.5, 1.5, 2],
      border: { type: "solid", pt: 0.5, color: BORDER_COLOR },
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.3,
      autoPageCharWeight: -0.5,
    });

    addFooter(tocSlide);
  }

  // =====================================================================
  // 4. PER-DOMAIN SEQUENCE
  // =====================================================================
  for (const domain of domainOrder) {
    const cases = (domainGroups[domain] ?? []).sort(
      (a, b) => effectiveScores(b).overall - effectiveScores(a).overall,
    );
    if (cases.length === 0) continue;

    // ── 4a. Domain Divider ────────────────────────────────────────────
    const divSlide = pptx.addSlide();
    divSlide.background = { color: DB_DARK };
    addBrandShapes(divSlide);

    addRedSeparator(divSlide, 1.5, 2.0, 3);

    const domainFontSize = domain.length > 40 ? 30 : domain.length > 25 ? 36 : 44;
    divSlide.addText(domain, {
      x: 1.5,
      y: 2.3,
      w: 10,
      h: 1.2,
      fontSize: domainFontSize,
      bold: true,
      color: WHITE,
      fontFace: "Calibri",
      wrap: true,
    });
    divSlide.addText(`${cases.length} Use Cases`, {
      x: 1.5,
      y: 3.6,
      w: 10,
      fontSize: 28,
      color: DB_RED,
      fontFace: "Calibri",
    });
    addFooter(divSlide, "dark");

    // ── 4b. Domain Summary ────────────────────────────────────────────
    const sumSlide = pptx.addSlide();
    addAccentBar(sumSlide, DB_RED, 0, 0.8, 0.1, 3.0);

    const sumFontSize = domain.length > 40 ? 24 : domain.length > 25 ? 28 : 32;
    sumSlide.addText(domain, {
      x: CONTENT_MARGIN,
      y: 0.3,
      w: CONTENT_W,
      h: 0.7,
      fontSize: sumFontSize,
      bold: true,
      color: DB_DARK,
      fontFace: "Calibri",
      wrap: true,
    });
    addRedSeparator(sumSlide, CONTENT_MARGIN, 1.05, 4);

    const llmDomainSummary = summaries?.domainSummaries?.[domain];
    const bulletTexts: Array<{ text: string; options: PptxGenJS.TextPropsOptions }> = [];
    if (llmDomainSummary) {
      bulletTexts.push({
        text: llmDomainSummary,
        options: { fontSize: 14, color: TEXT_COLOR, breakLine: true, paraSpaceAfter: 8 },
      });
    }
    const bullets = buildDomainSummary(domain, cases);
    for (const b of bullets) {
      bulletTexts.push({
        text: b,
        options: { fontSize: 18, color: TEXT_COLOR, bullet: true, breakLine: true },
      });
    }

    sumSlide.addText(bulletTexts, {
      x: CONTENT_MARGIN + 0.3,
      y: 1.3,
      w: CONTENT_W - 0.6,
      h: 4.5,
      valign: "top",
      fontFace: "Calibri",
    });

    addFooter(sumSlide);

    // ── 4c. Individual Use Case Slides ────────────────────────────────
    for (const uc of cases) {
      const ucSlide = pptx.addSlide();
      addAccentBar(ucSlide, DB_RED, 0, 0.4, 0.1, 6.0);

      // Title — shrink font for long names so they fit
      const titleText = `${uc.id}: ${uc.name}`;
      const titleLen = titleText.length;
      const titleFontSize = titleLen > 80 ? 18 : titleLen > 55 ? 20 : 22;
      const titleH = titleLen > 80 ? 0.8 : titleLen > 55 ? 0.65 : 0.5;

      ucSlide.addText(titleText, {
        x: CONTENT_MARGIN,
        y: 0.2,
        w: CONTENT_W,
        h: titleH,
        fontSize: titleFontSize,
        bold: true,
        color: DB_DARK,
        fontFace: "Calibri",
        valign: "top",
        wrap: true,
      });

      // Red separator under title
      const sepY = 0.2 + titleH + 0.05;
      addRedSeparator(ucSlide, CONTENT_MARGIN, sepY, 5);

      // Subtitle line: Subdomain | Type | Technique
      const subtitleParts = [uc.subdomain, uc.type, uc.analyticsTechnique].filter(Boolean);
      ucSlide.addText(subtitleParts.join("  |  "), {
        x: CONTENT_MARGIN,
        y: sepY + 0.08,
        w: CONTENT_W,
        fontSize: 13,
        bold: true,
        color: DB_RED,
        fontFace: "Calibri",
      });

      // Detail fields
      let yPos = sepY + 0.45;
      const lineH = 0.18;
      const fieldGap = 0.08;

      const fields: Array<{ label: string; value: string }> = [
        { label: "Statement", value: uc.statement },
        { label: "Solution", value: uc.solution },
        { label: "Business Value", value: uc.businessValue },
        { label: "Beneficiary", value: uc.beneficiary },
        { label: "Sponsor", value: uc.sponsor },
      ];

      if (uc.tablesInvolved.length > 0) {
        fields.push({
          label: "Tables Involved",
          value: uc.tablesInvolved.map((t) => annotateTableFqn(t, lineageFqnSet)).join(", "),
        });
      }

      if (uc.enrichmentTags && uc.enrichmentTags.length > 0) {
        fields.push({
          label: "Enrichment",
          value: uc.enrichmentTags.join(", "),
        });
      }

      let currentSlide = ucSlide;

      for (const field of fields) {
        if (!field.value) continue;

        const estLines = Math.ceil(field.value.length / 100);
        const fieldH = Math.max(0.3, estLines * lineH + 0.12);

        if (yPos + fieldH > 6.3) {
          addFooter(currentSlide);
          currentSlide = pptx.addSlide();
          addAccentBar(currentSlide, DB_RED, 0, 0.4, 0.1, 6.0);
          currentSlide.addText(`${uc.id} (continued)`, {
            x: CONTENT_MARGIN,
            y: 0.25,
            w: CONTENT_W,
            fontSize: 16,
            color: MID_GRAY,
            fontFace: "Calibri",
          });
          yPos = 0.65;
        }

        currentSlide.addText(
          [
            {
              text: `${field.label}: `,
              options: {
                bold: true,
                fontSize: 12,
                color: DB_DARK,
              },
            },
            {
              text: field.value,
              options: {
                fontSize: 12,
                color: TEXT_COLOR,
              },
            },
          ],
          {
            x: CONTENT_MARGIN + 0.3,
            y: yPos,
            w: CONTENT_W - 0.6,
            h: fieldH,
            valign: "top",
            fontFace: "Calibri",
            paraSpaceAfter: 4,
          },
        );
        yPos += fieldH + fieldGap;
      }

      // Score bar at bottom
      const scoreY = Math.max(yPos + 0.1, 6.0);
      if (scoreY < 6.8) {
        currentSlide.addShape("rect", {
          x: CONTENT_MARGIN + 0.2,
          y: scoreY - 0.05,
          w: CONTENT_W - 0.4,
          h: 0.4,
          fill: { color: WARM_WHITE },
          rectRadius: 0.05,
        });

        const hasUserScores =
          uc.userPriorityScore != null ||
          uc.userFeasibilityScore != null ||
          uc.userImpactScore != null ||
          uc.userOverallScore != null;

        const scores = [
          {
            label: hasUserScores ? "Priority (adj)" : "Priority",
            value: Math.round(
              (hasUserScores ? (uc.userPriorityScore ?? uc.priorityScore) : uc.priorityScore) * 100,
            ),
          },
          {
            label: hasUserScores ? "Feasibility (adj)" : "Feasibility",
            value: Math.round(
              (hasUserScores
                ? (uc.userFeasibilityScore ?? uc.feasibilityScore)
                : uc.feasibilityScore) * 100,
            ),
          },
          {
            label: hasUserScores ? "Impact (adj)" : "Impact",
            value: Math.round(
              (hasUserScores ? (uc.userImpactScore ?? uc.impactScore) : uc.impactScore) * 100,
            ),
          },
          {
            label: hasUserScores ? "Overall (adj)" : "Overall",
            value: Math.round(
              (hasUserScores ? (uc.userOverallScore ?? uc.overallScore) : uc.overallScore) * 100,
            ),
          },
        ];

        const scoreSegments: PptxGenJS.TextProps[] = [];
        scores.forEach((s, i) => {
          const scoreColor = s.value >= 70 ? SCORE_GREEN : s.value >= 40 ? SCORE_AMBER : DB_RED;
          scoreSegments.push({
            text: `${s.label}: `,
            options: { bold: true, fontSize: 13, color: DB_DARK },
          });
          scoreSegments.push({
            text: `${s.value}%`,
            options: { bold: true, fontSize: 13, color: scoreColor },
          });
          if (i < scores.length - 1) {
            scoreSegments.push({
              text: "    |    ",
              options: { fontSize: 13, color: MID_GRAY },
            });
          }
        });

        currentSlide.addText(scoreSegments, {
          x: CONTENT_MARGIN + 0.3,
          y: scoreY,
          w: CONTENT_W - 0.6,
          fontFace: "Calibri",
        });

        if (uc.scoreRationale) {
          const rationales = [
            uc.scoreRationale.priority.rationale,
            uc.scoreRationale.feasibility.rationale,
            uc.scoreRationale.impact.rationale,
          ].filter(Boolean);
          if (rationales.length > 0 && scoreY + 0.35 < 7.0) {
            currentSlide.addText(rationales.join("  |  "), {
              x: CONTENT_MARGIN + 0.3,
              y: scoreY + 0.3,
              w: CONTENT_W - 0.6,
              fontSize: 8,
              italic: true,
              color: MID_GRAY,
              fontFace: "Calibri",
            });
          }
        }
      }

      addFooter(currentSlide);
    }
  }

  // =====================================================================
  // Generate buffer
  // =====================================================================
  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(output as ArrayBuffer);
}
