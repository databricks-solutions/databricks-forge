/**
 * Estate Board Pack — a C-level PDF for an estate program.
 *
 * A short, board-readable deck (not a spreadsheet): cover, estate at a glance,
 * what's deployed today (models / Genie / dashboards / functions), domain &
 * readiness, and a plain-language path forward. Built with pdfkit (already a
 * dependency; same brand styling as the business-value executive brief).
 */

import PDFDocument from "pdfkit";
import { PDF, today } from "./brand";
import type { EstateSynthesisResult } from "@/lib/domain/estate-synthesis-types";

const PAGE_W = 842; // landscape A-ish
const PAGE_H = 595;
const M = 50;
const CW = PAGE_W - M * 2;

const DB_LOGO_PATH =
  "M40.1,31.1v-7.4l-0.8-0.5L20.1,33.7l-18.2-10l0-4.3l18.2,9.9l20.1-10.9v-7.3l-0.8-0.5L20.1,21.2L2.6,11.6L20.1,2l14.1,7.7l1.1-0.6V8.3L20.1,0L0,10.9V12L20.1,23l18.2-10v4.4l-18.2,10L0.8,16.8L0,17.3v7.4l20.1,10.9l18.2-9.9v4.3l-18.2,10L0.8,29.5L0,30v1.1L20.1,42L40.1,31.1z";
const DB_LOGO_VB_H = 42;

export interface BoardPackData {
  programName: string;
  industryName?: string | null;
  totalTables: number;
  totalSizeLabel: string; // pre-formatted (e.g. "12 TB")
  domainCount: number;
  entityCount: number;
  scanCount: number;
  readinessScore: number | null;
  readinessBand: "ready" | "needs_work" | "missing" | null;
  assets: {
    models: number;
    functions: number;
    genieSpaces: number;
    dashboards: number;
    metricViews: number;
  };
  tier: { bronze: number; silver: number; gold: number; system: number; unknown: number };
  coverage: {
    tablesWithCommentPct: number;
    tablesWithOwnerPct: number;
    tablesWithTierPct: number;
    tablesWithDomainPct: number;
  };
  /** Top domains by table count for the heatmap section. */
  topDomains: Array<{ domain: string; tableCount: number; entityCount: number }>;
  narrative: string[];
  pathForward: string[];
  /**
   * Optional consultant-grade synthesis. When present a "State of the Nation"
   * page (readiness sub-scores + exec brief + value-at-risk + key findings) is
   * rendered, aligning the board pack to the persisted ForgeEstateSynthesis.
   */
  synthesis?: EstateSynthesisResult | null;
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
    .text(`Databricks Forge — Estate Board Pack  |  ${today()}`, M + 20, PAGE_H - 35, {
      width: CW - 20,
      align: "right",
    });
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string, y: number): number {
  doc.fontSize(15).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(text, M, y);
  doc
    .moveTo(M, y + 22)
    .lineTo(PAGE_W - M, y + 22)
    .lineWidth(1)
    .strokeColor(PDF.BORDER_COLOR)
    .stroke();
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
  doc
    .fontSize(20)
    .fillColor(accent ? PDF.DB_RED : PDF.DB_DARK)
    .font("Helvetica-Bold")
    .text(value, x + 4, y + 10, { width: w - 8, align: "center" });
  doc
    .fontSize(8)
    .fillColor(PDF.MID_GRAY)
    .font("Helvetica")
    .text(label, x + 4, y + 36, { width: w - 8, align: "center" });
}

function readinessLabel(band: BoardPackData["readinessBand"]): string {
  if (band === "ready") return "Ready";
  if (band === "needs_work") return "Needs work";
  if (band === "missing") return "Early stage";
  return "—";
}

/** Render a row of KPI boxes evenly across the content width. */
function kpiRow(
  doc: PDFKit.PDFDocument,
  y: number,
  items: Array<{ value: string; label: string; accent?: boolean }>,
  h = 56,
): number {
  const gap = 12;
  const w = (CW - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => {
    kpiBox(doc, M + i * (w + gap), y, w, h, it.value, it.label, it.accent);
  });
  return y + h + 16;
}

function briefBlock(doc: PDFKit.PDFDocument, label: string, body: string, y: number): number {
  if (!body || !body.trim()) return y;
  doc.fontSize(10).fillColor(PDF.DB_RED).font("Helvetica-Bold").text(label.toUpperCase(), M, y);
  y = doc.y + 2;
  doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica").text(body, M, y, { width: CW });
  return doc.y + 10;
}

function renderSynthesisPage(doc: PDFKit.PDFDocument, synthesis: EstateSynthesisResult): void {
  const { scores, valueAtRisk, brief, findings } = synthesis;
  doc.addPage();
  let y = sectionTitle(doc, "State of the Nation", M);

  // Readiness sub-scores
  y = kpiRow(
    doc,
    y,
    [
      { value: `${scores.overall}`, label: `READINESS · ${String(scores.band).toUpperCase()}`, accent: true },
      { value: `${scores.governance}`, label: "GOVERNANCE" },
      { value: `${scores.quality}`, label: "QUALITY" },
      { value: `${scores.freshness}`, label: "FRESHNESS" },
      { value: `${scores.documentation}`, label: "DOCUMENTATION" },
      { value: `${scores.analyticsMaturity}`, label: "ANALYTICS" },
      { value: `${scores.cost}`, label: "COST" },
    ],
    52,
  );

  if (valueAtRisk) {
    const fmt = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: valueAtRisk.currency || "USD",
        maximumFractionDigits: 0,
        notation: "compact",
      }).format(n);
    doc
      .fontSize(11)
      .fillColor(PDF.DB_DARK)
      .font("Helvetica-Bold")
      .text(
        `Value at risk: ${fmt(valueAtRisk.low)} – ${fmt(valueAtRisk.mid)} – ${fmt(valueAtRisk.high)} (low / mid / high)`,
        M,
        y,
        { width: CW },
      );
    y = doc.y + 12;
  }

  // Executive brief (situation / complication / resolution is on the glance page narrative)
  y = briefBlock(doc, "Estate shape", brief.estateShape, y);
  y = briefBlock(doc, "Critical risks", brief.criticalRisks, y);
  y = briefBlock(doc, "Quick wins", brief.quickWins, y);
  footer(doc);

  // Key findings page
  if (findings.length > 0) {
    doc.addPage();
    y = sectionTitle(doc, "Key findings", M);
    doc.fontSize(10);
    for (const f of findings.slice(0, 8)) {
      if (y > PAGE_H - 90) {
        footer(doc);
        doc.addPage();
        y = sectionTitle(doc, "Key findings (cont.)", M);
      }
      const sev = String(f.severity).toUpperCase();
      doc.font("Helvetica-Bold").fillColor(PDF.DB_DARK).fontSize(11).text(`[${sev}] ${f.title}`, M, y, {
        width: CW,
      });
      y = doc.y + 2;
      doc.font("Helvetica").fillColor(PDF.MID_GRAY).fontSize(10).text(f.summary, M, y, { width: CW });
      y = doc.y + 4;
      if (f.action?.label) {
        doc
          .font("Helvetica-Oblique")
          .fillColor(PDF.DB_RED)
          .fontSize(9)
          .text(`→ ${f.action.label}`, M, y, { width: CW });
        y = doc.y + 10;
      } else {
        y += 6;
      }
    }
    footer(doc);
  }
}

export async function generateEstateBoardPackPdf(data: BoardPackData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: { Title: `${data.programName} — Estate Board Pack`, Author: "Databricks Forge" },
    });
    doc.on("data", (c: Uint8Array) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---- Cover --------------------------------------------------------------
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(PDF.DB_DARK);
    drawLogo(doc, M, 60, 34, PDF.TEXT_LIGHT);
    doc
      .fontSize(13)
      .fillColor(PDF.TEXT_LIGHT)
      .font("Helvetica")
      .text("DATABRICKS FORGE", M, 110);
    doc
      .fontSize(34)
      .fillColor(PDF.TEXT_LIGHT)
      .font("Helvetica-Bold")
      .text(`${data.programName}`, M, 210, { width: CW });
    doc
      .fontSize(20)
      .fillColor(PDF.TEXT_LIGHT)
      .font("Helvetica")
      .text("Data Estate Board Pack", M, 256);
    if (data.industryName) {
      doc.fontSize(13).fillColor("#B0B8C4").text(data.industryName, M, 292);
    }
    doc
      .fontSize(11)
      .fillColor("#B0B8C4")
      .text(
        `${data.scanCount} scanned area${data.scanCount === 1 ? "" : "s"}  ·  ${today()}`,
        M,
        PAGE_H - 70,
      );

    // ---- Page 2 (optional): State of the Nation (synthesis) -----------------
    if (data.synthesis) renderSynthesisPage(doc, data.synthesis);

    // ---- Page: Estate at a glance + narrative -------------------------------
    doc.addPage();
    let y = sectionTitle(doc, "Estate at a glance", M);
    y = kpiRow(doc, y, [
      { value: data.totalTables.toLocaleString(), label: "TABLES" },
      { value: data.totalSizeLabel, label: "DATA SIZE" },
      { value: String(data.domainCount), label: "BUSINESS DOMAINS" },
      { value: String(data.entityCount), label: "CANONICAL ENTITIES" },
      {
        value: data.readinessScore != null ? String(data.readinessScore) : "—",
        label: `READINESS · ${readinessLabel(data.readinessBand).toUpperCase()}`,
        accent: true,
      },
    ]);

    // Narrative
    doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica");
    for (const line of data.narrative) {
      doc.text(`•  ${line}`, M, y, { width: CW });
      y = doc.y + 6;
    }
    footer(doc);

    // ---- Page 3: What's deployed today --------------------------------------
    doc.addPage();
    y = sectionTitle(doc, "What's deployed today", M);
    doc
      .fontSize(10)
      .fillColor(PDF.MID_GRAY)
      .font("Helvetica")
      .text(
        "The analytics and AI assets currently live on this estate — a measure of how actively the data is being used.",
        M,
        y,
        { width: CW },
      );
    y = doc.y + 14;
    y = kpiRow(doc, y, [
      { value: String(data.assets.models), label: "ML MODELS", accent: data.assets.models > 0 },
      { value: String(data.assets.genieSpaces), label: "GENIE SPACES" },
      { value: String(data.assets.dashboards), label: "DASHBOARDS" },
      { value: String(data.assets.metricViews), label: "METRIC VIEWS" },
      { value: String(data.assets.functions), label: "UC FUNCTIONS" },
    ]);

    // Tier mix + governance coverage
    y = sectionTitle(doc, "Maturity & governance", y + 6);
    doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Medallion tier mix", M, y);
    y = doc.y + 6;
    doc.fontSize(10).fillColor(PDF.MID_GRAY).font("Helvetica");
    doc.text(
      `Gold ${data.tier.gold}   ·   Silver ${data.tier.silver}   ·   Bronze ${data.tier.bronze}   ·   System ${data.tier.system}   ·   Untiered ${data.tier.unknown}`,
      M,
      y,
      { width: CW },
    );
    y = doc.y + 14;
    y = kpiRow(
      doc,
      y,
      [
        { value: `${data.coverage.tablesWithCommentPct}%`, label: "DOCUMENTED" },
        { value: `${data.coverage.tablesWithOwnerPct}%`, label: "OWNED" },
        { value: `${data.coverage.tablesWithTierPct}%`, label: "TIERED" },
        { value: `${data.coverage.tablesWithDomainPct}%`, label: "DOMAIN-ASSIGNED" },
      ],
      52,
    );
    footer(doc);

    // ---- Page 4: Domains + path forward -------------------------------------
    doc.addPage();
    y = sectionTitle(doc, "Largest business domains", M);
    doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica");
    const maxTables = Math.max(1, ...data.topDomains.map((d) => d.tableCount));
    for (const d of data.topDomains.slice(0, 8)) {
      const barW = Math.round((d.tableCount / maxTables) * (CW - 220));
      doc.font("Helvetica-Bold").fillColor(PDF.DB_DARK).fontSize(10).text(d.domain, M, y, {
        width: 200,
        ellipsis: true,
      });
      doc.save().rect(M + 210, y + 1, barW, 10).fill(PDF.DB_RED).restore();
      doc
        .font("Helvetica")
        .fillColor(PDF.MID_GRAY)
        .fontSize(9)
        .text(`${d.tableCount} tables · ${d.entityCount} entities`, M + 210 + barW + 6, y);
      y += 22;
    }

    y = sectionTitle(doc, "Path forward", y + 10);
    doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica");
    for (const line of data.pathForward) {
      doc.text(`•  ${line}`, M, y, { width: CW });
      y = doc.y + 6;
    }
    footer(doc);

    doc.end();
  });
}
