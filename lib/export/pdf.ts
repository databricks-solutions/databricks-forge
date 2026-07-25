/**
 * PDF export using PDFKit.
 *
 * Generates a Databricks-branded executive PDF catalog matching the PPTX
 * output structure:
 *
 *  1. Cover page (decorative shapes, brand colours)
 *  2. Executive summary (narrative bullets from business context)
 *  3. Table of contents (paginated domain/count table)
 *  4. Per-domain sequence:
 *     a. Domain divider (full-bleed branded page)
 *     b. Domain summary (bullet points)
 *     c. Individual use case pages (one per use case)
 */

import PDFDocument from "pdfkit";
import type { PipelineRun, UseCase } from "@/lib/domain/types";
import { groupByDomain, computeDomainStats, effectiveScores } from "@/lib/domain/scoring";

// ---------------------------------------------------------------------------
// Official Databricks brand constants (hex for PDFKit)
// ---------------------------------------------------------------------------

const DB_DARK = "#1B3139"; // Brand Dark — dark teal-charcoal
const DB_RED = "#FF3621"; // Databricks Red — primary accent
const WHITE = "#FFFFFF";
const WARM_WHITE = "#FAFAFA";
const TEXT_COLOR = "#2D3E50"; // Charcoal for body text on light pages
const TEXT_LIGHT = "#BECBD2"; // De-saturated light text on dark pages
const FOOTER_COLOR = "#8899A6";
const BORDER_COLOR = "#D1D5DB";
const MID_GRAY = "#5E6E7D";
const SCORE_GREEN = "#2EA44F";
const SCORE_AMBER = "#E8912D";

// Page dimensions (A4 landscape for a presentation-style feel)
const PAGE_W = 842; // A4 landscape width in points
const PAGE_H = 595; // A4 landscape height in points
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ---------------------------------------------------------------------------
// Databricks logo — SVG path from public/databricks-icon.svg
// viewBox: 0 0 40.1 42, fill: DB_RED
// ---------------------------------------------------------------------------

const DB_LOGO_PATH =
  "M40.1,31.1v-7.4l-0.8-0.5L20.1,33.7l-18.2-10l0-4.3l18.2,9.9l20.1-10.9v-7.3l-0.8-0.5L20.1,21.2L2.6,11.6L20.1,2l14.1,7.7l1.1-0.6V8.3L20.1,0L0,10.9V12L20.1,23l18.2-10v4.4l-18.2,10L0.8,16.8L0,17.3v7.4l20.1,10.9l18.2-9.9v4.3l-18.2,10L0.8,29.5L0,30v1.1L20.1,42L40.1,31.1z";
const DB_LOGO_VB_H = 42;

/** Draw the Databricks logo at given position and height */
function drawLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  height: number,
  color: string = DB_RED,
): void {
  const scale = height / DB_LOGO_VB_H;
  doc.save().translate(x, y).scale(scale).path(DB_LOGO_PATH).fill(color);
  doc.restore();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Add branded footer to a page (light or dark variant) */
function addFooter(doc: PDFKit.PDFDocument, variant: "light" | "dark" = "light"): void {
  const logoColor = variant === "dark" ? TEXT_LIGHT : FOOTER_COLOR;
  drawLogo(doc, MARGIN, PAGE_H - 38, 14, logoColor);
  doc
    .fontSize(9)
    .fillColor(variant === "dark" ? TEXT_LIGHT : FOOTER_COLOR)
    .text(`Databricks Forge  |  ${today()}`, MARGIN + 20, PAGE_H - 35, {
      width: CONTENT_W - 20,
      align: "right",
    });
}

/** Add a coloured accent bar (rectangle) */
function addAccentBar(
  doc: PDFKit.PDFDocument,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.save().rect(x, y, w, h).fill(color).restore();
}

/** Draw a red separator line (brand element from official template) */
function addRedSeparator(doc: PDFKit.PDFDocument, x: number, y: number, w: number): void {
  doc
    .save()
    .moveTo(x, y)
    .lineTo(x + w, y)
    .lineWidth(3)
    .strokeColor(DB_RED)
    .stroke()
    .restore();
}

/** Draw Databricks brand geometric shapes (circle, square, triangle) */
function addBrandShapes(
  doc: PDFKit.PDFDocument,
  region: { x: number; y: number; w: number; h: number },
  opacity: number = 0.9,
): void {
  const { x, y, w, h } = region;
  doc.save().opacity(opacity);

  // Large red circle (top-right area)
  doc.circle(x + w * 0.55, y + h * 0.35, w * 0.22).fill(DB_RED);

  // Red square (bottom-left of shape group)
  const sqSize = w * 0.28;
  doc.rect(x + w * 0.08, y + h * 0.55, sqSize, sqSize).fill(DB_RED);

  // Red triangle (bottom-right)
  const triBase = w * 0.32;
  const triCx = x + w * 0.72;
  const triCy = y + h * 0.85;
  doc
    .polygon(
      [triCx, triCy - triBase * 0.75],
      [triCx - triBase / 2, triCy + triBase * 0.25],
      [triCx + triBase / 2, triCy + triBase * 0.25],
    )
    .fill(DB_RED);

  doc.restore();
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

/** Draw a simple table with header row. Paginates across pages when rows overflow. */
function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  x: number,
  y: number,
  colWidths: number[],
  options?: { maxRows?: number },
): number {
  const rowH = 28;
  const headerH = 32;
  const fontSize = 10;
  const headerFontSize = 11;
  const cellPadding = 8;
  const maxRows = options?.maxRows ?? rows.length;
  const tableW = colWidths.reduce((a, b) => a + b, 0);
  const displayRows = rows.slice(0, maxRows);

  const drawHeader = (startY: number) => {
    doc.save().rect(x, startY, tableW, headerH).fill(DB_DARK).restore();
    let cx = x;
    for (let i = 0; i < headers.length; i++) {
      doc
        .fontSize(headerFontSize)
        .fillColor(WHITE)
        .font("Helvetica-Bold")
        .text(headers[i], cx + cellPadding, startY + 9, {
          width: colWidths[i] - cellPadding * 2,
          align: i === 0 ? "left" : "center",
        });
      cx += colWidths[i];
    }
    return startY + headerH;
  };

  let ry = drawHeader(y);

  for (let r = 0; r < displayRows.length; r++) {
    if (ry + rowH > PAGE_H - MARGIN - 30) {
      addFooter(doc);
      doc.addPage();
      ry = drawHeader(MARGIN);
    }

    if (r % 2 === 1) {
      doc.save().rect(x, ry, tableW, rowH).fill(WARM_WHITE).restore();
    }
    doc
      .save()
      .moveTo(x, ry + rowH)
      .lineTo(x + tableW, ry + rowH)
      .strokeColor(BORDER_COLOR)
      .lineWidth(0.5)
      .stroke()
      .restore();

    let cx = x;
    for (let c = 0; c < displayRows[r].length; c++) {
      doc
        .fontSize(fontSize)
        .fillColor(TEXT_COLOR)
        .font(c === 0 ? "Helvetica-Bold" : "Helvetica")
        .text(displayRows[r][c], cx + cellPadding, ry + 8, {
          width: colWidths[c] - cellPadding * 2,
          align: c === 0 ? "left" : "center",
        });
      cx += colWidths[c];
    }
    ry += rowH;
  }

  return ry;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

function annotateTableFqn(fqn: string, lineageFqns: Set<string>): string {
  return lineageFqns.has(fqn) ? `${fqn} (via lineage)` : fqn;
}

export async function generatePdf(
  run: PipelineRun,
  useCases: UseCase[],
  lineageDiscoveredFqns: string[] = [],
  summaries?: { executiveSummary: string; domainSummaries: Record<string, string> } | null,
): Promise<Buffer> {
  const lineageFqnSet = new Set(lineageDiscoveredFqns);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H], // A4 landscape
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `${run.config.businessName} - Use Case Catalog`,
        Author: "Databricks Forge",
        Subject: "AI Use Case Discovery Report",
      },
    });

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

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

    // ===================================================================
    // 1. COVER PAGE — matches official Databricks brand template
    // ===================================================================

    // Dark charcoal background
    doc.save().rect(0, 0, PAGE_W, PAGE_H).fill(DB_DARK).restore();

    // Brand geometric shapes (right half)
    addBrandShapes(doc, { x: PAGE_W * 0.48, y: 40, w: PAGE_W * 0.48, h: PAGE_H * 0.75 });

    // Databricks logo (top-left)
    drawLogo(doc, MARGIN, MARGIN, 28);

    // Main title
    doc
      .fontSize(38)
      .fillColor(WHITE)
      .font("Helvetica-Bold")
      .text("Databricks Forge", MARGIN, 130, {
        width: PAGE_W * 0.48,
      });

    // Subtitle
    doc
      .fontSize(18)
      .fillColor(TEXT_LIGHT)
      .font("Helvetica")
      .text("Strategic AI Use Case Discovery", MARGIN, 220, {
        width: PAGE_W * 0.48,
      });

    // Red separator line
    addRedSeparator(doc, MARGIN, 310, 60);

    // Business name
    doc
      .fontSize(16)
      .fillColor(WHITE)
      .font("Helvetica-Bold")
      .text(run.config.businessName, MARGIN, 325, { width: PAGE_W * 0.48 });

    // Date and stats
    doc
      .fontSize(12)
      .fillColor(TEXT_LIGHT)
      .font("Helvetica")
      .text(today(), MARGIN, 355, { width: PAGE_W * 0.48 });

    doc
      .fontSize(11)
      .fillColor(TEXT_LIGHT)
      .font("Helvetica")
      .text(`${useCases.length} use cases  |  ${domainStats.length} domains`, MARGIN, 375, {
        width: PAGE_W * 0.48,
      });

    addFooter(doc, "dark");

    // ===================================================================
    // 2. EXECUTIVE SUMMARY
    // ===================================================================
    doc.addPage();

    // Red accent bar
    addAccentBar(doc, DB_RED, 0, 55, 6, 200);

    doc
      .fontSize(30)
      .fillColor(DB_DARK)
      .font("Helvetica-Bold")
      .text("Executive Summary", MARGIN, MARGIN, { width: CONTENT_W });

    addRedSeparator(doc, MARGIN, MARGIN + 42, 50);

    let yPos = MARGIN + 50;

    // LLM-generated narrative summary (when available)
    if (summaries?.executiveSummary) {
      doc
        .fontSize(12)
        .fillColor(TEXT_COLOR)
        .font("Helvetica")
        .text(summaries.executiveSummary, MARGIN + 10, yPos, {
          width: CONTENT_W - 20,
          lineGap: 5,
        });
      yPos = doc.y + 18;
      addRedSeparator(doc, MARGIN, yPos, 30);
      yPos += 12;
    }

    // Business context bullets
    const bc = run.businessContext;
    const summaryItems: string[] = [];

    if (bc) {
      if (bc.industries) summaryItems.push(`Industry: ${bc.industries}`);
      if (bc.strategicGoals) summaryItems.push(`Strategic Goals: ${bc.strategicGoals}`);
      if (bc.valueChain) summaryItems.push(`Value Chain: ${bc.valueChain}`);
      if (bc.revenueModel) summaryItems.push(`Revenue Model: ${bc.revenueModel}`);
    }
    summaryItems.push(
      `${useCases.length} use cases discovered across ${domainStats.length} domains`,
    );
    summaryItems.push(`${aiCount} AI use cases, ${statsCount} Statistical use cases`);
    summaryItems.push(`Average overall score: ${avgScore}%`);
    summaryItems.push(`Business Priorities: ${run.config.businessPriorities.join(", ")}`);

    for (const item of summaryItems) {
      doc
        .fontSize(13)
        .fillColor(TEXT_COLOR)
        .font("Helvetica")
        .text(`•  ${item}`, MARGIN + 20, yPos, {
          width: CONTENT_W - 40,
          lineGap: 4,
        });
      yPos = doc.y + 10;
    }

    // Disclaimer
    doc
      .fontSize(9)
      .fillColor(FOOTER_COLOR)
      .font("Helvetica-Oblique")
      .text(
        "Disclaimer: This analysis is based on Unity Catalog metadata only. No actual data was accessed or read during this process.",
        MARGIN,
        PAGE_H - 60,
        { width: CONTENT_W },
      );

    addFooter(doc);

    // ===================================================================
    // 3. TABLE OF CONTENTS (paginated)
    // ===================================================================
    const ROWS_PER_TOC = 12;
    const tocPages = Math.ceil(domainStats.length / ROWS_PER_TOC);

    for (let page = 0; page < tocPages; page++) {
      doc.addPage();

      // Red accent bar
      addAccentBar(doc, DB_RED, 0, 55, 6, 160);

      const pageLabel = tocPages > 1 ? ` (${page + 1}/${tocPages})` : "";
      doc
        .fontSize(30)
        .fillColor(DB_DARK)
        .font("Helvetica-Bold")
        .text(`Table of Contents${pageLabel}`, MARGIN, MARGIN, {
          width: CONTENT_W,
        });

      addRedSeparator(doc, MARGIN, MARGIN + 42, 50);

      const pageStats = domainStats.slice(page * ROWS_PER_TOC, (page + 1) * ROWS_PER_TOC);

      const headers = ["Domain", "Use Cases", "Avg Score", "AI", "Statistical"];
      const rows = pageStats.map((ds) => [
        ds.domain,
        String(ds.count),
        `${Math.round(ds.avgScore * 100)}%`,
        String(ds.aiCount),
        String(ds.statsCount),
      ]);

      drawTable(doc, headers, rows, MARGIN + 10, MARGIN + 55, [280, 80, 90, 80, 90]);

      addFooter(doc);
    }

    // ===================================================================
    // 4. PER-DOMAIN SEQUENCE
    // ===================================================================
    for (const domain of domainOrder) {
      const cases = (domainGroups[domain] ?? []).sort(
        (a, b) => effectiveScores(b).overall - effectiveScores(a).overall,
      );
      if (cases.length === 0) continue;

      // ── 4a. Domain Divider ────────────────────────────────────────
      doc.addPage();
      doc.save().rect(0, 0, PAGE_W, PAGE_H).fill(DB_DARK).restore();

      // Red accent bar on left
      addAccentBar(doc, DB_RED, 0, 0, 6, PAGE_H);

      doc
        .fontSize(12)
        .fillColor(TEXT_LIGHT)
        .font("Helvetica")
        .text("databricks", MARGIN + 10, MARGIN);

      // Red separator before domain title
      addRedSeparator(doc, MARGIN + 10, 170, 50);

      doc
        .fontSize(38)
        .fillColor(WHITE)
        .font("Helvetica-Bold")
        .text(domain, MARGIN + 10, 185, { width: CONTENT_W - 20 });

      doc
        .fontSize(20)
        .fillColor(TEXT_LIGHT)
        .font("Helvetica")
        .text(`${cases.length} Use Cases`, MARGIN + 10, doc.y + 12, {
          width: CONTENT_W - 20,
        });

      addFooter(doc, "dark");

      // ── 4b. Domain Summary ────────────────────────────────────────
      doc.addPage();
      addAccentBar(doc, DB_RED, 0, 55, 6, 300);

      doc
        .fontSize(28)
        .fillColor(DB_DARK)
        .font("Helvetica-Bold")
        .text(domain, MARGIN, MARGIN, { width: CONTENT_W });

      doc
        .fontSize(14)
        .fillColor(DB_RED)
        .font("Helvetica")
        .text("Domain Summary", MARGIN, MARGIN + 38, { width: CONTENT_W });

      addRedSeparator(doc, MARGIN, MARGIN + 58, 40);

      yPos = MARGIN + 70;

      // Use LLM domain summary if available; otherwise fall back to static bullets
      const llmDomainSummary = summaries?.domainSummaries?.[domain];
      if (llmDomainSummary) {
        doc
          .fontSize(12)
          .fillColor(TEXT_COLOR)
          .font("Helvetica")
          .text(llmDomainSummary, MARGIN + 10, yPos, {
            width: CONTENT_W - 20,
            lineGap: 5,
          });
        yPos = doc.y + 10;
      } else {
        const bullets = buildDomainSummary(domain, cases);
        for (const bullet of bullets) {
          doc
            .fontSize(13)
            .fillColor(TEXT_COLOR)
            .font("Helvetica")
            .text(`•  ${bullet}`, MARGIN + 20, yPos, {
              width: CONTENT_W - 40,
              lineGap: 4,
            });
          yPos = doc.y + 10;
        }
      }

      // Quick stats grid
      yPos += 15;
      const statBoxW = 150;
      const statBoxH = 55;
      const statsData = [
        { label: "Use Cases", value: String(cases.length) },
        {
          label: "AI Cases",
          value: String(cases.filter((c) => c.type === "AI").length),
        },
        {
          label: "Avg Score",
          value: `${Math.round(
            (cases.reduce((s, c) => s + effectiveScores(c).overall, 0) / cases.length) * 100,
          )}%`,
        },
        {
          label: "Top Score",
          value: `${Math.round(Math.max(...cases.map((c) => effectiveScores(c).overall)) * 100)}%`,
        },
      ];

      for (let i = 0; i < statsData.length; i++) {
        const bx = MARGIN + 20 + i * (statBoxW + 15);
        doc
          .save()
          .roundedRect(bx, yPos, statBoxW, statBoxH, 4)
          .lineWidth(1)
          .strokeColor(BORDER_COLOR)
          .stroke()
          .restore();

        doc
          .fontSize(20)
          .fillColor(DB_RED)
          .font("Helvetica-Bold")
          .text(statsData[i].value, bx + 10, yPos + 10, {
            width: statBoxW - 20,
            align: "center",
          });

        doc
          .fontSize(9)
          .fillColor(MID_GRAY)
          .font("Helvetica")
          .text(statsData[i].label, bx + 10, yPos + 35, {
            width: statBoxW - 20,
            align: "center",
          });
      }

      addFooter(doc);

      // ── 4c. Individual Use Case Pages ─────────────────────────────
      for (const uc of cases) {
        doc.addPage();
        addAccentBar(doc, DB_RED, 0, 55, 6, 400);

        // Title
        doc
          .fontSize(22)
          .fillColor(DB_DARK)
          .font("Helvetica-Bold")
          .text(`${uc.id}: ${uc.name}`, MARGIN, MARGIN - 5, {
            width: CONTENT_W,
          });

        // Red separator between title and subtitle
        const sepY = doc.y + 6;
        addRedSeparator(doc, MARGIN, sepY, 50);

        // Subtitle: Subdomain | Type | Technique
        const subtitleParts = [uc.subdomain, uc.type, uc.analyticsTechnique].filter(Boolean);
        doc
          .fontSize(12)
          .fillColor(DB_RED)
          .font("Helvetica-Bold")
          .text(subtitleParts.join("  |  "), MARGIN, sepY + 8, {
            width: CONTENT_W,
          });

        yPos = doc.y + 16;

        // Detail fields
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

        for (const field of fields) {
          if (!field.value) continue;

          if (yPos > PAGE_H - 100) {
            addFooter(doc);
            doc.addPage();
            addAccentBar(doc, DB_RED, 0, 55, 6, 400);
            doc
              .fontSize(14)
              .fillColor(MID_GRAY)
              .font("Helvetica")
              .text(`${uc.id} (continued)`, MARGIN, MARGIN, { width: CONTENT_W });
            yPos = MARGIN + 25;
          }

          doc
            .fontSize(11)
            .fillColor(DB_DARK)
            .font("Helvetica-Bold")
            .text(`${field.label}:`, MARGIN + 15, yPos, {
              width: CONTENT_W - 30,
              continued: false,
            });

          doc
            .fontSize(11)
            .fillColor(TEXT_COLOR)
            .font("Helvetica")
            .text(field.value, MARGIN + 15, doc.y + 2, {
              width: CONTENT_W - 30,
              lineGap: 3,
            });

          yPos = doc.y + 12;
        }

        // Score bar at bottom
        const scoreBarY = Math.max(yPos + 10, PAGE_H - 80);
        if (scoreBarY < PAGE_H - 50) {
          // Score background strip
          doc
            .save()
            .roundedRect(MARGIN + 15, scoreBarY - 5, CONTENT_W - 30, 30, 3)
            .fill("#E8EDF1")
            .restore();

          const hasUserScores =
            uc.userPriorityScore != null ||
            uc.userFeasibilityScore != null ||
            uc.userImpactScore != null ||
            uc.userOverallScore != null;

          const scores = [
            {
              label: "Priority",
              value: Math.round(
                (hasUserScores ? (uc.userPriorityScore ?? uc.priorityScore) : uc.priorityScore) *
                  100,
              ),
              system: hasUserScores ? Math.round(uc.priorityScore * 100) : null,
            },
            {
              label: "Feasibility",
              value: Math.round(
                (hasUserScores
                  ? (uc.userFeasibilityScore ?? uc.feasibilityScore)
                  : uc.feasibilityScore) * 100,
              ),
              system: hasUserScores ? Math.round(uc.feasibilityScore * 100) : null,
            },
            {
              label: "Impact",
              value: Math.round(
                (hasUserScores ? (uc.userImpactScore ?? uc.impactScore) : uc.impactScore) * 100,
              ),
              system: hasUserScores ? Math.round(uc.impactScore * 100) : null,
            },
            {
              label: "Overall",
              value: Math.round(
                (hasUserScores ? (uc.userOverallScore ?? uc.overallScore) : uc.overallScore) * 100,
              ),
              system: hasUserScores ? Math.round(uc.overallScore * 100) : null,
            },
          ];

          const scoreBlockW = (CONTENT_W - 30) / 4;
          for (let i = 0; i < scores.length; i++) {
            const sx = MARGIN + 15 + i * scoreBlockW;
            const scoreColor =
              scores[i].value >= 70 ? SCORE_GREEN : scores[i].value >= 40 ? SCORE_AMBER : DB_RED;

            doc
              .fontSize(10)
              .fillColor(MID_GRAY)
              .font("Helvetica")
              .text(scores[i].label, sx + 5, scoreBarY, {
                width: scoreBlockW - 10,
                align: "center",
                continued: false,
              });

            doc
              .fontSize(12)
              .fillColor(scoreColor)
              .font("Helvetica-Bold")
              .text(`${scores[i].value}%`, sx + 5, scoreBarY + 13, {
                width: scoreBlockW - 10,
                align: "center",
              });
          }

          // Score rationale (if available)
          if (uc.scoreRationale) {
            const rationaleY = scoreBarY + 32;
            if (rationaleY < PAGE_H - 30) {
              const rationales = [
                uc.scoreRationale.priority.rationale,
                uc.scoreRationale.feasibility.rationale,
                uc.scoreRationale.impact.rationale,
              ].filter(Boolean);
              if (rationales.length > 0) {
                doc
                  .fontSize(7)
                  .fillColor(MID_GRAY)
                  .font("Helvetica-Oblique")
                  .text(rationales.join(" | "), MARGIN + 20, rationaleY, {
                    width: CONTENT_W - 40,
                    lineGap: 1,
                  });
              }
            }
          }
        }

        addFooter(doc);
      }
    }

    // ===================================================================
    // Finalize
    // ===================================================================
    doc.end();
  });
}
