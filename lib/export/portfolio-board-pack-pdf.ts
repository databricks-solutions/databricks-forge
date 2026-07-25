/**
 * Portfolio Board Pack — a C-level (CDO) PDF for the cross-estate portfolio.
 *
 * Cover, portfolio at a glance + enterprise inventory, cross-estate
 * fragmentation + federated opportunities, and the org operating-model uplift
 * plan. Built with pdfkit, same brand styling as the estate board pack. Fed by
 * the guarded portfolio aggregation + synthesis (metadata only).
 */

import PDFDocument from "pdfkit";
import { PDF, today } from "./brand";
import type { PortfolioOverview } from "@/lib/lakebase/portfolio-estate";
import type { PortfolioSynthesisResult } from "@/lib/ai/portfolio-synthesis/types";

const PAGE_W = 842;
const PAGE_H = 595;
const M = 50;
const CW = PAGE_W - M * 2;

const DB_LOGO_PATH =
  "M40.1,31.1v-7.4l-0.8-0.5L20.1,33.7l-18.2-10l0-4.3l18.2,9.9l20.1-10.9v-7.3l-0.8-0.5L20.1,21.2L2.6,11.6L20.1,2l14.1,7.7l1.1-0.6V8.3L20.1,0L0,10.9V12L20.1,23l18.2-10v4.4l-18.2,10L0.8,16.8L0,17.3v7.4l20.1,10.9l18.2-9.9v4.3l-18.2,10L0.8,29.5L0,30v1.1L20.1,42L40.1,31.1z";
const DB_LOGO_VB_H = 42;

export interface PortfolioBoardPackData {
  overview: PortfolioOverview;
  synthesis: PortfolioSynthesisResult;
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(n);
}

function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, h: number, color: string = PDF.DB_RED) {
  const s = h / DB_LOGO_VB_H;
  doc.save().translate(x, y).scale(s).path(DB_LOGO_PATH).fill(color);
  doc.restore();
}

function footer(doc: PDFKit.PDFDocument) {
  drawLogo(doc, M, PAGE_H - 38, 14, PDF.FOOTER_COLOR);
  doc
    .fontSize(9)
    .fillColor(PDF.FOOTER_COLOR)
    .font("Helvetica")
    .text(`Databricks Forge — Portfolio Board Pack  |  ${today()}`, M + 20, PAGE_H - 35, {
      width: CW - 20,
      align: "right",
    });
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string, y: number): number {
  doc.fontSize(15).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(text, M, y);
  doc.moveTo(M, y + 22).lineTo(PAGE_W - M, y + 22).lineWidth(1).strokeColor(PDF.BORDER_COLOR).stroke();
  return y + 34;
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
  doc.save().roundedRect(x, y, w, h, 4).lineWidth(1).strokeColor(PDF.BORDER_COLOR).stroke().restore();
  doc.fontSize(18).fillColor(accent ? PDF.DB_RED : PDF.DB_DARK).font("Helvetica-Bold").text(value, x + 4, y + 10, {
    width: w - 8,
    align: "center",
  });
  doc.fontSize(8).fillColor(PDF.MID_GRAY).font("Helvetica").text(label, x + 4, y + 34, {
    width: w - 8,
    align: "center",
  });
}

function kpiRow(
  doc: PDFKit.PDFDocument,
  y: number,
  items: Array<{ value: string; label: string; accent?: boolean }>,
  h = 54,
): number {
  const gap = 12;
  const w = (CW - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => kpiBox(doc, M + i * (w + gap), y, w, h, it.value, it.label, it.accent));
  return y + h + 16;
}

export async function generatePortfolioBoardPackPdf(data: PortfolioBoardPackData): Promise<Buffer> {
  const { overview, synthesis } = data;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: { Title: "Portfolio Board Pack", Author: "Databricks Forge" },
    });
    doc.on("data", (c: Uint8Array) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---- Cover --------------------------------------------------------------
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(PDF.DB_DARK);
    drawLogo(doc, M, 60, 34, PDF.TEXT_LIGHT);
    doc.fontSize(13).fillColor(PDF.TEXT_LIGHT).font("Helvetica").text("DATABRICKS FORGE", M, 110);
    doc.fontSize(34).fillColor(PDF.TEXT_LIGHT).font("Helvetica-Bold").text("Data Estate Portfolio", M, 210, {
      width: CW,
    });
    doc.fontSize(20).fillColor(PDF.TEXT_LIGHT).font("Helvetica").text("CDO Board Pack", M, 256);
    doc
      .fontSize(11)
      .fillColor("#B0B8C4")
      .text(
        `${overview.totals.estates} estates · ${overview.totals.tables.toLocaleString()} tables · ${today()}`,
        M,
        PAGE_H - 70,
      );

    // ---- Portfolio at a glance ---------------------------------------------
    doc.addPage();
    let y = sectionTitle(doc, "Portfolio at a glance", M);
    y = kpiRow(doc, y, [
      { value: `${overview.totals.avgReadiness}`, label: "AVG READINESS", accent: true },
      { value: `${overview.totals.estates}`, label: "ESTATES" },
      { value: `${overview.totals.scans}`, label: "SCANS" },
      { value: overview.totals.tables.toLocaleString(), label: "TABLES" },
      { value: fmtUsd(overview.totals.totalValueAtRisk), label: "VALUE AT RISK", accent: true },
    ]);
    y = kpiRow(doc, y, [
      { value: `${overview.inventory.domains}`, label: "DOMAINS" },
      { value: `${overview.inventory.dataProducts}`, label: "DATA PRODUCTS" },
      { value: `${overview.inventory.workloads.model ?? 0}`, label: "AI MODELS" },
      { value: `${overview.inventory.piiTables}`, label: "PII TABLES" },
      { value: `${overview.inventory.workloads.genie_space ?? 0}`, label: "GENIE SPACES" },
      { value: `${overview.inventory.workloads.dashboard ?? 0}`, label: "DASHBOARDS" },
    ]);
    doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica").text(synthesis.headline, M, y, { width: CW });
    footer(doc);

    // ---- Fragmentation + opportunities -------------------------------------
    doc.addPage();
    y = sectionTitle(doc, "Cross-estate fragmentation", M);
    if (synthesis.fragmentation.length === 0) {
      doc.fontSize(10).fillColor(PDF.MID_GRAY).font("Helvetica").text("No cross-estate fragmentation detected.", M, y, {
        width: CW,
      });
      y = doc.y + 10;
    } else {
      doc.fontSize(10);
      for (const c of synthesis.fragmentation.slice(0, 8)) {
        if (y > PAGE_H - 80) {
          footer(doc);
          doc.addPage();
          y = sectionTitle(doc, "Cross-estate fragmentation (cont.)", M);
        }
        doc.font("Helvetica-Bold").fillColor(PDF.DB_DARK).fontSize(11).text(`"${c.label}" — ${c.estates.length} estates`, M, y, {
          width: CW,
        });
        y = doc.y + 2;
        doc
          .font("Helvetica")
          .fillColor(PDF.MID_GRAY)
          .fontSize(9)
          .text(`${c.estates.join(", ")} · ${c.totalTables} tables`, M, y, { width: CW });
        y = doc.y + 8;
      }
    }

    y = sectionTitle(doc, "Federated opportunities", y + 6);
    doc.fontSize(10);
    for (const o of synthesis.opportunities.slice(0, 6)) {
      if (y > PAGE_H - 80) {
        footer(doc);
        doc.addPage();
        y = sectionTitle(doc, "Federated opportunities (cont.)", M);
      }
      doc
        .font("Helvetica-Bold")
        .fillColor(PDF.DB_DARK)
        .fontSize(10)
        .text(`[${o.severity.toUpperCase()}] ${o.title} — ${fmtUsd(o.valueUsd)}`, M, y, { width: CW });
      y = doc.y + 2;
      doc.font("Helvetica").fillColor(PDF.MID_GRAY).fontSize(9).text(o.summary, M, y, { width: CW });
      y = doc.y + 8;
    }
    footer(doc);

    // ---- Uplift plan --------------------------------------------------------
    doc.addPage();
    y = sectionTitle(doc, "Org operating-model uplift plan", M);
    doc.fontSize(10);
    for (const a of synthesis.upliftPlan) {
      if (y > PAGE_H - 90) {
        footer(doc);
        doc.addPage();
        y = sectionTitle(doc, "Uplift plan (cont.)", M);
      }
      doc
        .font("Helvetica-Bold")
        .fillColor(PDF.DB_RED)
        .fontSize(11)
        .text(`Phase ${a.phase} · ${a.title}`, M, y, { width: CW });
      y = doc.y + 2;
      doc.font("Helvetica").fillColor(PDF.DB_DARK).fontSize(9).text(a.rationale, M, y, { width: CW });
      y = doc.y + 2;
      doc
        .font("Helvetica-Oblique")
        .fillColor(PDF.MID_GRAY)
        .fontSize(9)
        .text(
          `Owner: ${a.owner} · Effort: ${a.effort.toUpperCase()} · Cost: ${fmtUsd(a.costUsd)} · Value: ${fmtUsd(a.valueUsd)}`,
          M,
          y,
          { width: CW },
        );
      y = doc.y + 10;
    }
    footer(doc);

    doc.end();
  });
}
