/**
 * Executive PDF brief -- 2-page one-pager for senior stakeholders.
 *
 * Page 1: Value summary KPIs, key findings, strategic recommendations
 * Page 2: Delivery pipeline, domain heatmap, risk callouts
 */

import PDFDocument from "pdfkit";
import type { BusinessValuePortfolio } from "@/lib/domain/types";
import { PDF, today, formatCompactCurrency, scoreColor } from "./brand";

const PAGE_W = 842;
const PAGE_H = 595;
const M = 50;
const CW = PAGE_W - M * 2;

const DB_LOGO_PATH =
  "M40.1,31.1v-7.4l-0.8-0.5L20.1,33.7l-18.2-10l0-4.3l18.2,9.9l20.1-10.9v-7.3l-0.8-0.5L20.1,21.2L2.6,11.6L20.1,2l14.1,7.7l1.1-0.6V8.3L20.1,0L0,10.9V12L20.1,23l18.2-10v4.4l-18.2,10L0.8,16.8L0,17.3v7.4l20.1,10.9l18.2-9.9v4.3l-18.2,10L0.8,29.5L0,30v1.1L20.1,42L40.1,31.1z";
const DB_LOGO_VB_H = 42;

function drawLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  h: number,
  color: string = PDF.DB_RED,
) {
  const s = h / DB_LOGO_VB_H;
  doc.save().translate(x, y).scale(s).path(DB_LOGO_PATH).fill(color);
  doc.restore();
}

function footer(doc: PDFKit.PDFDocument, variant: "light" | "dark" = "light") {
  const c = variant === "dark" ? PDF.TEXT_LIGHT : PDF.FOOTER_COLOR;
  drawLogo(doc, M, PAGE_H - 38, 14, c);
  doc
    .fontSize(9)
    .fillColor(c)
    .text(`Databricks Forge  |  ${today()}`, M + 20, PAGE_H - 35, {
      width: CW - 20,
      align: "right",
    });
}

function kpiBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  label: string,
  accent = false,
) {
  doc
    .save()
    .roundedRect(x, y, w, h, 4)
    .lineWidth(1)
    .strokeColor(PDF.BORDER_COLOR)
    .stroke()
    .restore();

  doc
    .fontSize(18)
    .fillColor(accent ? PDF.DB_RED : PDF.DB_DARK)
    .font("Helvetica-Bold")
    .text(value, x + 5, y + 8, { width: w - 10, align: "center" });

  doc
    .fontSize(8)
    .fillColor(PDF.MID_GRAY)
    .font("Helvetica")
    .text(label, x + 5, y + 30, { width: w - 10, align: "center" });
}

export async function generateExecutivePdf(portfolio: BusinessValuePortfolio): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: {
        Title: "Business Value Executive Brief",
        Author: "Databricks Forge",
      },
    });

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const syn = portfolio.latestSynthesis;

    // =================================================================
    // PAGE 1 -- Value Summary + Key Findings + Recommendations
    // =================================================================

    // Header bar
    doc.save().rect(0, 0, PAGE_W, 45).fill(PDF.DB_DARK).restore();
    drawLogo(doc, M, 10, 22, PDF.DB_RED);
    doc
      .fontSize(16)
      .fillColor(PDF.WHITE)
      .font("Helvetica-Bold")
      .text("Business Value Executive Brief", M + 30, 14, { width: CW - 30 });

    doc
      .fontSize(10)
      .fillColor(PDF.TEXT_LIGHT)
      .font("Helvetica")
      .text(today(), PAGE_W - M - 80, 17, { width: 80, align: "right" });

    // KPI strip
    const kpiY = 60;
    const kpiW = CW / 4 - 8;
    const kpiH = 46;
    kpiBox(
      doc,
      M,
      kpiY,
      kpiW,
      kpiH,
      formatCompactCurrency(portfolio.totalEstimatedValue.mid),
      "Total Est. Value",
      true,
    );
    kpiBox(doc, M + kpiW + 10, kpiY, kpiW, kpiH, String(portfolio.totalUseCases), "Use Cases");
    kpiBox(
      doc,
      M + (kpiW + 10) * 2,
      kpiY,
      kpiW,
      kpiH,
      String(portfolio.byPhase.quick_wins.count),
      "Quick Wins",
    );
    kpiBox(
      doc,
      M + (kpiW + 10) * 3,
      kpiY,
      kpiW,
      kpiH,
      formatCompactCurrency(portfolio.deliveredValue),
      "Delivered Value",
    );

    let y = kpiY + kpiH + 18;

    // Key Findings
    if (syn && syn.keyFindings.length > 0) {
      doc.save().rect(0, y, 5, 100).fill(PDF.DB_RED).restore();

      doc.fontSize(13).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Key Findings", M, y);
      y = doc.y + 6;

      for (const f of syn.keyFindings.slice(0, 4)) {
        doc
          .fontSize(10)
          .fillColor(PDF.DB_DARK)
          .font("Helvetica-Bold")
          .text(`• ${f.title}`, M + 10, y, { width: CW - 20 });
        y = doc.y + 1;
        doc
          .fontSize(9)
          .fillColor(PDF.TEXT_COLOR)
          .font("Helvetica")
          .text(f.description, M + 20, y, { width: CW - 30, lineGap: 2 });
        y = doc.y + 6;
      }
    }

    y += 8;

    // Recommendations
    if (syn && syn.strategicRecommendations.length > 0) {
      doc
        .fontSize(13)
        .fillColor(PDF.DB_DARK)
        .font("Helvetica-Bold")
        .text("Strategic Recommendations", M, y);
      y = doc.y + 6;

      for (const r of syn.strategicRecommendations.slice(0, 3)) {
        doc
          .fontSize(10)
          .fillColor(PDF.DB_DARK)
          .font("Helvetica-Bold")
          .text(`• ${r.title} [${r.priority.toUpperCase()}]`, M + 10, y, { width: CW - 20 });
        y = doc.y + 1;
        doc
          .fontSize(9)
          .fillColor(PDF.TEXT_COLOR)
          .font("Helvetica")
          .text(r.description, M + 20, y, { width: CW - 30, lineGap: 2 });
        y = doc.y + 6;
      }
    }

    footer(doc);

    // =================================================================
    // PAGE 2 -- Pipeline + Domains + Risks
    // =================================================================
    doc.addPage();

    // Header bar
    doc.save().rect(0, 0, PAGE_W, 45).fill(PDF.DB_DARK).restore();
    doc
      .fontSize(16)
      .fillColor(PDF.WHITE)
      .font("Helvetica-Bold")
      .text("Delivery Pipeline & Risk Assessment", M, 14, { width: CW });

    y = 60;

    // Delivery pipeline
    const phases = [
      { label: "Quick Wins", data: portfolio.byPhase.quick_wins },
      { label: "Foundation", data: portfolio.byPhase.foundation },
      { label: "Transformation", data: portfolio.byPhase.transformation },
    ];

    const phaseW = CW / 3 - 8;
    phases.forEach((p, i) => {
      const px = M + i * (phaseW + 12);
      doc
        .save()
        .roundedRect(px, y, phaseW, 52, 4)
        .lineWidth(1)
        .strokeColor(PDF.BORDER_COLOR)
        .stroke()
        .restore();

      doc
        .fontSize(11)
        .fillColor(PDF.DB_DARK)
        .font("Helvetica-Bold")
        .text(p.label, px + 8, y + 8, { width: phaseW - 16 });

      doc
        .fontSize(10)
        .fillColor(PDF.TEXT_COLOR)
        .font("Helvetica")
        .text(
          `${p.data.count} use cases  |  ${formatCompactCurrency(p.data.valueMid)}`,
          px + 8,
          y + 26,
          {
            width: phaseW - 16,
          },
        );
    });

    y += 72;

    // Domain performance (compact table)
    const topDomains = [...portfolio.byDomain].sort((a, b) => b.valueMid - a.valueMid).slice(0, 8);

    if (topDomains.length > 0) {
      doc
        .fontSize(13)
        .fillColor(PDF.DB_DARK)
        .font("Helvetica-Bold")
        .text("Top Domains by Value", M, y);
      y = doc.y + 6;

      // Header
      doc.save().rect(M, y, CW, 22).fill(PDF.DB_DARK).restore();
      doc.fontSize(9).fillColor(PDF.WHITE).font("Helvetica-Bold");
      doc.text("Domain", M + 8, y + 6, { width: 200 });
      doc.text("UCs", M + 250, y + 6, { width: 50, align: "center" });
      doc.text("Est. Value", M + 340, y + 6, { width: 100, align: "right" });
      doc.text("Avg Score", M + 480, y + 6, { width: 80, align: "center" });
      y += 22;

      topDomains.forEach((d, i) => {
        if (i % 2 === 1) {
          doc.save().rect(M, y, CW, 20).fill(PDF.WARM_WHITE).restore();
        }
        doc
          .save()
          .moveTo(M, y + 20)
          .lineTo(M + CW, y + 20)
          .strokeColor(PDF.BORDER_COLOR)
          .lineWidth(0.5)
          .stroke()
          .restore();

        doc
          .fontSize(9)
          .fillColor(PDF.TEXT_COLOR)
          .font("Helvetica-Bold")
          .text(d.domain, M + 8, y + 5, { width: 200 });
        doc
          .font("Helvetica")
          .text(String(d.useCaseCount), M + 250, y + 5, { width: 50, align: "center" });
        doc.text(formatCompactCurrency(d.valueMid), M + 340, y + 5, { width: 100, align: "right" });
        doc
          .fillColor(scoreColor(d.avgScore, "pdf"))
          .font("Helvetica-Bold")
          .text(`${Math.round(d.avgScore * 100)}%`, M + 480, y + 5, { width: 80, align: "center" });
        y += 20;
      });
    }

    y += 14;

    // Risk Callouts
    if (syn && syn.riskCallouts.length > 0) {
      doc.fontSize(13).fillColor(PDF.DB_RED).font("Helvetica-Bold").text("Risk Callouts", M, y);
      y = doc.y + 6;

      for (const r of syn.riskCallouts.slice(0, 3)) {
        doc
          .fontSize(10)
          .fillColor(PDF.DB_RED)
          .font("Helvetica-Bold")
          .text(`• ${r.title} [${r.impact.toUpperCase()}]`, M + 10, y, { width: CW - 20 });
        y = doc.y + 1;
        doc
          .fontSize(9)
          .fillColor(PDF.TEXT_COLOR)
          .font("Helvetica")
          .text(r.description, M + 20, y, { width: CW - 30, lineGap: 2 });
        y = doc.y + 6;
      }
    }

    footer(doc);
    doc.end();
  });
}
