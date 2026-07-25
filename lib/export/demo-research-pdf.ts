import PDFDocument from "pdfkit";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import { PDF, today } from "./brand";

const PAGE_W = 842;
const PAGE_H = 595;
const M = 50;
const CW = PAGE_W - M * 2;

function sectionHeading(doc: PDFKit.PDFDocument, y: number, title: string): number {
  if (y > PAGE_H - 80) {
    doc.addPage();
    y = M;
  }
  doc.save().rect(0, y, 5, 24).fill(PDF.DB_RED).restore();
  doc.fontSize(16).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(title, M, y + 2, {
    width: CW - 10,
  });
  return doc.y + 12;
}

const ROW_PADDING_Y = 5;
const ROW_MIN_H = 20;
const HEADER_H = 22;
const PAGE_BOTTOM_MARGIN = 60;

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  headers: string[],
  widths: number[],
): number {
  doc.save().rect(M, y, CW, HEADER_H).fill(PDF.DB_DARK).restore();
  doc.fontSize(9).fillColor(PDF.WHITE).font("Helvetica-Bold");
  let x = M + 8;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y + 6, { width: widths[i] - 16 });
    x += widths[i];
  }
  return y + HEADER_H;
}

function tableRow(
  doc: PDFKit.PDFDocument,
  y: number,
  cells: string[],
  widths: number[],
  altRow: boolean,
  context?: { headers: string[] },
): number {
  doc.fontSize(9).font("Helvetica");
  let maxTextH = 0;
  for (let i = 0; i < cells.length; i++) {
    const h = doc.heightOfString(cells[i] ?? "", { width: widths[i] - 16 });
    if (h > maxTextH) maxTextH = h;
  }
  const rowH = Math.max(ROW_MIN_H, Math.ceil(maxTextH + ROW_PADDING_Y * 2));

  if (y + rowH > PAGE_H - PAGE_BOTTOM_MARGIN) {
    doc.addPage();
    y = M;
    if (context) {
      y = drawTableHeader(doc, y, context.headers, widths);
    }
  }

  if (altRow) {
    doc.save().rect(M, y, CW, rowH).fill(PDF.WARM_WHITE).restore();
  }
  doc
    .save()
    .moveTo(M, y + rowH)
    .lineTo(M + CW, y + rowH)
    .strokeColor(PDF.BORDER_COLOR)
    .lineWidth(0.5)
    .stroke()
    .restore();
  let x = M + 8;
  doc.fontSize(9).fillColor(PDF.TEXT_COLOR).font("Helvetica");
  for (let i = 0; i < cells.length; i++) {
    doc.text(cells[i] ?? "", x, y + ROW_PADDING_Y, { width: widths[i] - 16 });
    x += widths[i];
  }
  return y + rowH;
}

export async function generateDemoResearchPdf(
  research: ResearchEngineResult,
  customerName: string,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: {
        Title: `${customerName} Demo Preparation`,
        Author: "Databricks Forge",
      },
    });

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.save().rect(0, 0, PAGE_W, 55).fill(PDF.DB_DARK).restore();
    doc
      .fontSize(24)
      .fillColor(PDF.WHITE)
      .font("Helvetica-Bold")
      .text(`${customerName} Demo Preparation`, M, 18, { width: CW });
    doc
      .fontSize(12)
      .fillColor(PDF.TEXT_LIGHT)
      .font("Helvetica")
      .text(`${research.industryId}  |  ${today()}`, M, 42, { width: CW });

    let y = 70;

    // --- Executive Brief --------------------------------------------------
    const brief = research.executiveBrief;
    if (brief) {
      y = sectionHeading(doc, y, "Executive Brief");
      const sections: Array<[string, string | undefined]> = [
        ["Who they are", brief.whoTheyAre],
        ["What they care about", brief.whatTheyCareAbout],
        ["What's likely broken", brief.whatsLikelyBroken],
        ["Why now", brief.whyNow],
        ["Where we win first", brief.whereWeWin],
      ];
      for (const [label, value] of sections) {
        if (!value) continue;
        doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(label, M, y, { width: CW });
        y = doc.y + 2;
        doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(value, M + 10, y, { width: CW - 20, lineGap: 2 });
        y = doc.y + 6;
      }
      const scr = brief.situationComplicationResolution;
      if (scr && (scr.situation || scr.complication || scr.resolution)) {
        doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Situation -> Complication -> Resolution", M, y, { width: CW });
        y = doc.y + 2;
        const parts = [
          scr.situation ? `Situation. ${scr.situation}` : null,
          scr.complication ? `Complication. ${scr.complication}` : null,
          scr.resolution ? `Resolution. ${scr.resolution}` : null,
        ].filter((x): x is string => Boolean(x));
        doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica-Oblique").text(parts.join(" "), M + 10, y, { width: CW - 20, lineGap: 2 });
        y = doc.y + 10;
      }
      y += 4;
    }

    const companyProfile = research.companyProfile;
    if (companyProfile) {
      y = sectionHeading(doc, y, "Company Overview");
      if (companyProfile.statedPriorities?.length) {
        doc.fontSize(12).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Stated Priorities", M, y);
        y = doc.y + 4;
        for (const p of companyProfile.statedPriorities) {
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${p.priority} (${p.source})`, M + 10, y, { width: CW - 20 });
          y = doc.y + 4;
        }
        y += 4;
      }
      if (companyProfile.inferredPriorities?.length) {
        doc.fontSize(12).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Inferred Priorities", M, y);
        y = doc.y + 4;
        for (const p of companyProfile.inferredPriorities) {
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${p.priority}: ${p.evidence}`, M + 10, y, { width: CW - 20 });
          y = doc.y + 4;
        }
        y += 4;
      }
      if (companyProfile.urgencySignals?.length) {
        doc.fontSize(12).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Urgency Signals", M, y);
        y = doc.y + 4;
        for (const s of companyProfile.urgencySignals) {
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${s.signal} (${s.type}${s.date ? `, ${s.date}` : ""})`, M + 10, y, { width: CW - 20 });
          y = doc.y + 4;
        }
        y += 4;
      }
      y += 8;
    }

    if (companyProfile?.swotSummary) {
      const swot = companyProfile.swotSummary;
      y = sectionHeading(doc, y, "SWOT Analysis");
      doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica");
      doc.text(`Strengths: ${(swot.strengths ?? []).join("; ")}`, M, y, { width: CW / 2 - 10 });
      doc.text(`Weaknesses: ${(swot.weaknesses ?? []).join("; ")}`, M + CW / 2 + 5, y, { width: CW / 2 - 10 });
      y = doc.y + 8;
      doc.text(`Opportunities: ${(swot.opportunities ?? []).join("; ")}`, M, y, { width: CW / 2 - 10 });
      doc.text(`Threats: ${(swot.threats ?? []).join("; ")}`, M + CW / 2 + 5, y, { width: CW / 2 - 10 });
      y = doc.y + 12;
    }

    const industryLandscape = research.industryLandscape;
    if (industryLandscape) {
      y = sectionHeading(doc, y, "Industry Landscape");
      if (industryLandscape.marketForces?.length) {
        const w = [CW * 0.25, CW * 0.55, CW * 0.2];
        const headers = ["Force", "Description", "Urgency"];
        y = drawTableHeader(doc, y, headers, w);
        industryLandscape.marketForces.forEach((f, i) => {
          y = tableRow(doc, y, [f.force, f.description, f.urgency], w, i % 2 === 1, {
            headers,
          });
        });
        y += 8;
      }
      if (industryLandscape.competitiveDynamics) {
        doc.fontSize(12).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Competitive Dynamics", M, y);
        y = doc.y + 4;
        doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(industryLandscape.competitiveDynamics, M, y, { width: CW, lineGap: 2 });
        y = doc.y + 12;
      }
    }

    if (industryLandscape?.keyBenchmarks?.length) {
      y = sectionHeading(doc, y, "Key Benchmarks");
      const w = [CW / 3, CW / 3, CW / 3];
      const headers = ["Metric", "Impact", "Source"];
      y = drawTableHeader(doc, y, headers, w);
      industryLandscape.keyBenchmarks.forEach((b, i) => {
        y = tableRow(doc, y, [b.metric, b.impact, b.source], w, i % 2 === 1, {
          headers,
        });
      });
      y += 8;
    }

    const dataStrategy = research.dataStrategy;
    if (dataStrategy?.assetDetails?.length) {
      y = sectionHeading(doc, y, "Data Strategy");
      const w = [CW * 0.15, CW * 0.15, CW * 0.5, CW * 0.2];
      const headers = ["ID", "Relevance", "Rationale", "Quick Win"];
      y = drawTableHeader(doc, y, headers, w);
      dataStrategy.assetDetails.forEach((a, i) => {
        y = tableRow(
          doc,
          y,
          [a.id, String(a.relevance), a.rationale, a.quickWin ? "Yes" : "No"],
          w,
          i % 2 === 1,
          { headers },
        );
      });
      y += 8;
    }

    const demoNarrative = research.demoNarrative;
    if (demoNarrative?.demoFlow && demoNarrative.demoFlow.length > 0) {
      y = sectionHeading(doc, y, "Demo Flow");
      for (const step of demoNarrative.demoFlow) {
        doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(`${step.step}. ${step.moment} (${step.assetId})`, M, y);
        y = doc.y + 2;
        doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(step.talkingPoint, M + 15, y, { width: CW - 25 });
        y = doc.y + 8;
      }
      y += 4;
    }

    if (demoNarrative?.killerMoments && demoNarrative.killerMoments.length > 0) {
      for (const m of demoNarrative.killerMoments.slice(0, 6)) {
        if (y > PAGE_H - 120) {
          doc.addPage();
          y = M;
        }
        y = sectionHeading(doc, y, m.title);

        const writeLine = (label: string, value: string) => {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(label, M, y);
          y = doc.y + 2;
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(value, M + 10, y, { width: CW - 20, lineGap: 1 });
          y = doc.y + 6;
        };

        writeLine("Problem", m.problemStatement ?? m.scenario);
        writeLine("Value Hypothesis", m.insightStatement);

        if (m.quantifiedImpact) {
          writeLine(
            `Quantified Impact (${m.quantifiedImpact.unit})`,
            `Low ${m.quantifiedImpact.low} · Mid ${m.quantifiedImpact.mid} · High ${m.quantifiedImpact.high}`,
          );
        }
        if (m.kpiDelta) writeLine("KPI Delta", m.kpiDelta);

        if (m.hypothesisTree && m.hypothesisTree.length > 0) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Hypothesis Tree", M, y);
          y = doc.y + 2;
          for (const h of m.hypothesisTree) {
            doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${h}`, M + 10, y, { width: CW - 20 });
            y = doc.y + 2;
          }
          y += 4;
        }

        if (m.discoveryQuestions && m.discoveryQuestions.length > 0) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Discovery Questions", M, y);
          y = doc.y + 2;
          for (const q of m.discoveryQuestions) {
            doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${q}`, M + 10, y, { width: CW - 20 });
            y = doc.y + 2;
          }
          y += 4;
        }

        if (m.riskOfInaction) writeLine("Risk of Inaction", m.riskOfInaction);
        if (m.measureOfSuccess) writeLine("Measure of Success", m.measureOfSuccess);

        if (m.evidence && m.evidence.length > 0) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Evidence", M, y);
          y = doc.y + 2;
          for (const e of m.evidence) {
            const line =
              e.tier === "sourced"
                ? `[Sourced] ${e.quote ?? e.claim ?? ""}${e.sourceTitle ? ` — ${e.sourceTitle}` : ""}`
                : e.tier === "benchmark"
                  ? `[Benchmark] ${e.benchmarkLabel ?? ""} ${e.benchmarkRange ?? ""}`
                  : `[Inferred] ${e.rationale ?? e.claim ?? ""}`;
            doc.fontSize(9).fillColor(PDF.TEXT_COLOR).font("Helvetica-Oblique").text(line, M + 10, y, { width: CW - 20 });
            y = doc.y + 2;
          }
          y += 4;
        }

        y += 8;
      }
    }

    const talkTracks = research.personaTalkTracks ?? [];
    if (talkTracks.length > 0) {
      for (const track of talkTracks) {
        if (y > PAGE_H - 150) {
          doc.addPage();
          y = M;
        }
        y = sectionHeading(doc, y, `Talk Track: ${track.label}`);

        if (track.caresAbout.length > 0) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Cares about", M, y);
          y = doc.y + 2;
          for (const c of track.caresAbout) {
            doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${c}`, M + 10, y, { width: CW - 20 });
            y = doc.y + 2;
          }
          y += 4;
        }
        if (track.provocativeOpening) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Provocative opening", M, y);
          y = doc.y + 2;
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica-Oblique").text(track.provocativeOpening, M + 10, y, { width: CW - 20 });
          y = doc.y + 6;
        }
        if (track.whatToSay) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("What to say", M, y);
          y = doc.y + 2;
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(track.whatToSay, M + 10, y, { width: CW - 20 });
          y = doc.y + 6;
        }
        if (track.threeObjections.length > 0) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Objections + responses", M, y);
          y = doc.y + 2;
          for (const o of track.threeObjections) {
            doc
              .fontSize(10)
              .fillColor(PDF.TEXT_COLOR)
              .font("Helvetica")
              .text(`"${o.objection}"  ->  ${o.response}`, M + 10, y, { width: CW - 20 });
            y = doc.y + 4;
          }
          y += 4;
        }
        if (track.discoveryTrack.length > 0) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Discovery ladder", M, y);
          y = doc.y + 2;
          for (const q of track.discoveryTrack) {
            doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(`• ${q}`, M + 10, y, { width: CW - 20 });
            y = doc.y + 2;
          }
          y += 4;
        }
        if (track.closeSignal) {
          doc.fontSize(10).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text("Close signal", M, y);
          y = doc.y + 2;
          doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(track.closeSignal, M + 10, y, { width: CW - 20 });
          y = doc.y + 8;
        }
      }
    }

    if (demoNarrative?.competitorAngles && demoNarrative.competitorAngles.length > 0) {
      y = sectionHeading(doc, y, "Competitive Positioning");
      const w = [CW * 0.25, CW * 0.375, CW * 0.375];
      const headers = ["Competitor", "Their Move", "Your Opportunity"];
      y = drawTableHeader(doc, y, headers, w);
      demoNarrative.competitorAngles.forEach((c, i) => {
        y = tableRow(doc, y, [c.competitor, c.theirMove, c.yourOpportunity], w, i % 2 === 1, {
          headers,
        });
      });
      y += 8;
    }

    if (demoNarrative?.executiveTalkingPoints && demoNarrative.executiveTalkingPoints.length > 0) {
      y = sectionHeading(doc, y, "Executive Talking Points");
      for (const tp of demoNarrative.executiveTalkingPoints) {
        doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(`${tp.assetId}: ${tp.headline}`, M, y);
        y = doc.y + 2;
        doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(tp.benchmarkTieIn, M + 15, y, { width: CW - 25 });
        y = doc.y + 8;
      }
      y += 4;
    }

    if (research.dataNarratives && research.dataNarratives.length > 0) {
      y = sectionHeading(doc, y, "Data Narratives");
      for (const n of research.dataNarratives) {
        doc.fontSize(11).fillColor(PDF.DB_DARK).font("Helvetica-Bold").text(n.title, M, y);
        y = doc.y + 2;
        doc.fontSize(10).fillColor(PDF.TEXT_COLOR).font("Helvetica").text(n.description, M, y, { width: CW });
        y = doc.y + 2;
        doc.fontSize(9).fillColor(PDF.MID_GRAY).font("Helvetica").text(`Pattern: ${n.pattern}`, M, y);
        y = doc.y + 10;
      }
      y += 4;
    }

    // --- Evidence Register -----------------------------------------------
    const evidenceRows: Array<{ tier: string; claim: string; detail: string; source: string }> = [];
    for (const e of research.executiveBrief?.evidence ?? []) {
      evidenceRows.push({
        tier: e.tier,
        claim: e.claim ?? "Executive brief",
        detail:
          e.tier === "sourced"
            ? (e.quote ?? "")
            : e.tier === "benchmark"
              ? `${e.benchmarkLabel ?? ""} ${e.benchmarkRange ?? ""}`.trim()
              : (e.rationale ?? ""),
        source: e.sourceTitle ?? e.sourceUrl ?? "",
      });
    }
    for (const m of research.demoNarrative?.killerMoments ?? []) {
      for (const e of m.evidence ?? []) {
        evidenceRows.push({
          tier: e.tier,
          claim: e.claim ?? m.title,
          detail:
            e.tier === "sourced"
              ? (e.quote ?? "")
              : e.tier === "benchmark"
                ? `${e.benchmarkLabel ?? ""} ${e.benchmarkRange ?? ""}`.trim()
                : (e.rationale ?? ""),
          source: e.sourceTitle ?? e.sourceUrl ?? "",
        });
      }
    }
    if (evidenceRows.length > 0) {
      y = sectionHeading(doc, y, "Evidence Register");
      const w = [CW * 0.12, CW * 0.28, CW * 0.45, CW * 0.15];
      const headers = ["Tier", "Claim", "Evidence", "Source"];
      y = drawTableHeader(doc, y, headers, w);
      evidenceRows.slice(0, 25).forEach((r, i) => {
        y = tableRow(doc, y, [r.tier, r.claim, r.detail, r.source], w, i % 2 === 1, {
          headers,
        });
      });
      y += 8;
    }

    if (research.sources && research.sources.length > 0) {
      y = sectionHeading(doc, y, "Sources");
      const w = [CW * 0.2, CW * 0.45, CW * 0.2, CW * 0.15];
      const headers = ["Type", "URL", "Status", "Characters"];
      y = drawTableHeader(doc, y, headers, w);
      research.sources.forEach((s, i) => {
        y = tableRow(doc, y, [s.type, s.title, s.status, String(s.charCount)], w, i % 2 === 1, {
          headers,
        });
      });
    }

    doc
      .fontSize(9)
      .fillColor(PDF.FOOTER_COLOR)
      .font("Helvetica")
      .text(`Databricks Forge  |  ${today()}`, M, PAGE_H - 35, { width: CW, align: "right" });

    doc.end();
  });
}
