import PptxGenJS from "pptxgenjs";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import { PPTX, today } from "./brand";
import {
  addTitleSlide,
  addSectionSlide,
  addFooter,
  headerCell,
  bodyCell,
} from "./pptx-helpers";

export async function generateDemoResearchPptx(
  research: ResearchEngineResult,
  customerName: string,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Databricks Forge";
  pptx.title = `${customerName} Demo Preparation`;

  addTitleSlide(
    pptx,
    `${customerName} Demo Preparation`,
    today(),
    research.industryId,
  );

  // --- Executive Brief slide -------------------------------------------
  const brief = research.executiveBrief;
  if (brief) {
    const slide = addSectionSlide(pptx, "Executive Brief");
    const sections: Array<[string, string | undefined]> = [
      ["Who they are", brief.whoTheyAre],
      ["What they care about", brief.whatTheyCareAbout],
      ["What's likely broken", brief.whatsLikelyBroken],
      ["Why now", brief.whyNow],
      ["Where we win first", brief.whereWeWin],
    ];
    const items: PptxGenJS.TextProps[] = [];
    for (const [label, value] of sections) {
      if (!value) continue;
      items.push({
        text: label,
        options: {
          fontSize: 12,
          bold: true,
          color: PPTX.DB_DARK,
          breakLine: true,
          paraSpaceAfter: 2,
        } as PptxGenJS.TextPropsOptions,
      });
      items.push({
        text: value,
        options: {
          fontSize: 11,
          color: PPTX.TEXT_COLOR,
          breakLine: true,
          paraSpaceAfter: 6,
          indentLevel: 1,
        } as PptxGenJS.TextPropsOptions,
      });
    }
    const scr = brief.situationComplicationResolution;
    if (scr && (scr.situation || scr.complication || scr.resolution)) {
      items.push({
        text: "Situation -> Complication -> Resolution",
        options: {
          fontSize: 12,
          bold: true,
          color: PPTX.DB_DARK,
          breakLine: true,
          paraSpaceAfter: 2,
        } as PptxGenJS.TextPropsOptions,
      });
      const scrText = [
        scr.situation ? `Situation. ${scr.situation}` : null,
        scr.complication ? `Complication. ${scr.complication}` : null,
        scr.resolution ? `Resolution. ${scr.resolution}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      items.push({
        text: scrText,
        options: {
          fontSize: 11,
          color: PPTX.TEXT_COLOR,
          italic: true,
          breakLine: true,
          paraSpaceAfter: 4,
          indentLevel: 1,
        } as PptxGenJS.TextPropsOptions,
      });
    }
    slide.addText(items, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      h: 5.7,
      valign: "top",
      fontFace: "Calibri",
      fit: "shrink",
    });
    addFooter(slide);
  }

  const companyProfile = research.companyProfile;
  if (companyProfile) {
    const slide = addSectionSlide(pptx, "Company Overview");
    const items: PptxGenJS.TextProps[] = [];
    if (companyProfile.statedPriorities?.length) {
      items.push(
        {
          text: "Stated Priorities",
          options: {
            fontSize: 14,
            bold: true,
            color: PPTX.DB_DARK,
            breakLine: true,
            paraSpaceAfter: 4,
          } as PptxGenJS.TextPropsOptions,
        },
        ...(companyProfile.statedPriorities ?? []).flatMap((p) => [
          {
            text: `• ${p.priority} (${p.source})`,
            options: {
              fontSize: 12,
              color: PPTX.TEXT_COLOR,
              bullet: true,
              breakLine: true,
              paraSpaceAfter: 2,
              indentLevel: 1,
            } as PptxGenJS.TextPropsOptions,
          },
        ]),
      );
    }
    if (companyProfile.inferredPriorities?.length) {
      items.push(
        {
          text: "Inferred Priorities",
          options: {
            fontSize: 14,
            bold: true,
            color: PPTX.DB_DARK,
            breakLine: true,
            paraSpaceAfter: 4,
          } as PptxGenJS.TextPropsOptions,
        },
        ...(companyProfile.inferredPriorities ?? []).flatMap((p) => [
          {
            text: `• ${p.priority}: ${p.evidence}`,
            options: {
              fontSize: 12,
              color: PPTX.TEXT_COLOR,
              bullet: true,
              breakLine: true,
              paraSpaceAfter: 2,
              indentLevel: 1,
            } as PptxGenJS.TextPropsOptions,
          },
        ]),
      );
    }
    if (companyProfile.urgencySignals?.length) {
      items.push(
        {
          text: "Urgency Signals",
          options: {
            fontSize: 14,
            bold: true,
            color: PPTX.DB_DARK,
            breakLine: true,
            paraSpaceAfter: 4,
          } as PptxGenJS.TextPropsOptions,
        },
        ...(companyProfile.urgencySignals ?? []).flatMap((s) => [
          {
            text: `• ${s.signal} (${s.type}${s.date ? `, ${s.date}` : ""})`,
            options: {
              fontSize: 12,
              color: PPTX.TEXT_COLOR,
              bullet: true,
              breakLine: true,
              paraSpaceAfter: 2,
              indentLevel: 1,
            } as PptxGenJS.TextPropsOptions,
          },
        ]),
      );
    }
    if (items.length > 0) {
      slide.addText(items, {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: PPTX.CONTENT_W - 0.6,
        h: 5.5,
        valign: "top",
        fontFace: "Calibri",
        fit: "shrink",
      });
    }
    addFooter(slide);
  }

  if (companyProfile?.swotSummary) {
    const swot = companyProfile.swotSummary;
    const slide = addSectionSlide(pptx, "SWOT Analysis");
    const positions: Array<{ x: number; y: number; label: string; items: string[] }> = [
      { x: 0.5, y: 1.5, label: "Strengths", items: swot.strengths ?? [] },
      { x: 5.2, y: 1.5, label: "Weaknesses", items: swot.weaknesses ?? [] },
      { x: 0.5, y: 4, label: "Opportunities", items: swot.opportunities ?? [] },
      { x: 5.2, y: 4, label: "Threats", items: swot.threats ?? [] },
    ];
    const boxW = 4.4;
    const boxH = 2.2;
    for (const { x, y, label, items } of positions) {
      slide.addShape("rect", {
        x,
        y,
        w: boxW,
        h: boxH,
        fill: { color: PPTX.WARM_WHITE },
        line: { color: PPTX.BORDER_COLOR, width: 0.5 },
        rectRadius: 0.08,
      });
      slide.addText(label, {
        x: x + 0.1,
        y: y + 0.1,
        w: boxW - 0.2,
        fontSize: 14,
        bold: true,
        color: PPTX.DB_DARK,
        fontFace: "Calibri",
      });
      const bulletText = items.slice(0, 4).map((i) => `• ${i}`).join("\n");
      if (bulletText) {
        slide.addText(bulletText, {
          x: x + 0.15,
          y: y + 0.45,
          w: boxW - 0.3,
          h: boxH - 0.55,
          fontSize: 10,
          color: PPTX.TEXT_COLOR,
          fontFace: "Calibri",
          valign: "top",
        });
      }
    }
    addFooter(slide);
  }

  const industryLandscape = research.industryLandscape;
  if (industryLandscape?.marketForces?.length) {
    const slide = addSectionSlide(pptx, "Industry Landscape");
    const forceData: PptxGenJS.TableRow[] = [
      [headerCell("Force"), headerCell("Description"), headerCell("Urgency")],
      ...industryLandscape.marketForces.map(
        (f): PptxGenJS.TableRow => [
          bodyCell(f.force, { bold: true }),
          bodyCell(f.description),
          bodyCell(f.urgency, { align: "center" }),
        ],
      ),
    ];
    slide.addTable(forceData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      colW: [2.5, 6, 1.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 10,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.2,
      autoPageCharWeight: -0.5,
    });
    addFooter(slide);
  }

  if (industryLandscape?.competitiveDynamics) {
    const slide = addSectionSlide(pptx, "Competitive Dynamics");
    slide.addText(industryLandscape.competitiveDynamics, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      h: 5.5,
      fontSize: 13,
      color: PPTX.TEXT_COLOR,
      fontFace: "Calibri",
      valign: "top",
      fit: "shrink",
    });
    addFooter(slide);
  }

  if (industryLandscape?.keyBenchmarks?.length) {
    const slide = addSectionSlide(pptx, "Key Benchmarks");
    const benchData: PptxGenJS.TableRow[] = [
      [headerCell("Metric"), headerCell("Impact"), headerCell("Source")],
      ...(industryLandscape.keyBenchmarks ?? []).map(
        (b): PptxGenJS.TableRow => [
          bodyCell(b.metric, { bold: true }),
          bodyCell(b.impact),
          bodyCell(b.source),
        ],
      ),
    ];
    slide.addTable(benchData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      colW: [4, 4, 4],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 11,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.2,
      autoPageCharWeight: -0.5,
    });
    addFooter(slide);
  }

  const dataStrategy = research.dataStrategy;
  if (dataStrategy?.assetDetails?.length) {
    const slide = addSectionSlide(pptx, "Data Strategy");
    const assetData: PptxGenJS.TableRow[] = [
      [headerCell("ID"), headerCell("Relevance"), headerCell("Rationale"), headerCell("Quick Win")],
      ...(dataStrategy.assetDetails ?? []).map(
        (a): PptxGenJS.TableRow => [
          bodyCell(a.id, { bold: true }),
          bodyCell(String(a.relevance), { align: "center" }),
          bodyCell(a.rationale),
          bodyCell(a.quickWin ? "Yes" : "No", { align: "center" }),
        ],
      ),
    ];
    slide.addTable(assetData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      colW: [2, 1.5, 6, 1.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 10,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.2,
      autoPageCharWeight: -0.5,
    });
    addFooter(slide);
  }

  const demoNarrative = research.demoNarrative;
  if (demoNarrative?.demoFlow && demoNarrative.demoFlow.length > 0) {
    const slide = addSectionSlide(pptx, "Demo Flow");
    const items: PptxGenJS.TextProps[] = demoNarrative.demoFlow.flatMap((step) => [
      {
        text: `${step.step}. ${step.moment} (${step.assetId})`,
        options: {
          fontSize: 14,
          bold: true,
          color: PPTX.DB_DARK,
          breakLine: true,
          paraSpaceAfter: 2,
        } as PptxGenJS.TextPropsOptions,
      },
      {
        text: step.talkingPoint,
        options: {
          fontSize: 12,
          color: PPTX.TEXT_COLOR,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 6,
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
      fit: "shrink",
    });
    addFooter(slide);
  }

  if (demoNarrative?.killerMoments && demoNarrative.killerMoments.length > 0) {
    const moments = demoNarrative.killerMoments.slice(0, 6);
    const heading = (text: string): PptxGenJS.TextProps => ({
      text,
      options: {
        fontSize: 12,
        bold: true,
        color: PPTX.DB_DARK,
        breakLine: true,
        paraSpaceAfter: 2,
      } as PptxGenJS.TextPropsOptions,
    });
    const body = (text: string, indentLevel = 1): PptxGenJS.TextProps => ({
      text,
      options: {
        fontSize: 11,
        color: PPTX.TEXT_COLOR,
        breakLine: true,
        paraSpaceAfter: 6,
        indentLevel,
      } as PptxGenJS.TextPropsOptions,
    });
    for (const m of moments) {
      const slide = addSectionSlide(pptx, m.title);
      const items: PptxGenJS.TextProps[] = [];

      items.push(heading("Problem Statement"));
      items.push(body(m.problemStatement ?? m.scenario));

      items.push(heading("Value Hypothesis"));
      items.push(body(m.insightStatement));

      if (m.quantifiedImpact) {
        items.push(heading(`Quantified Impact (${m.quantifiedImpact.unit})`));
        items.push(
          body(
            `Low ${m.quantifiedImpact.low} · Mid ${m.quantifiedImpact.mid} · High ${m.quantifiedImpact.high}`,
          ),
        );
      }

      if (m.kpiDelta) {
        items.push(heading("KPI Delta"));
        items.push(body(m.kpiDelta));
      }

      if (m.hypothesisTree && m.hypothesisTree.length > 0) {
        items.push(heading("Hypothesis Tree"));
        for (const h of m.hypothesisTree) items.push(body(`• ${h}`));
      }

      if (m.discoveryQuestions && m.discoveryQuestions.length > 0) {
        items.push(heading("Discovery Questions"));
        for (const q of m.discoveryQuestions) items.push(body(`• ${q}`));
      }

      if (m.riskOfInaction) {
        items.push(heading("Risk of Inaction"));
        items.push(body(m.riskOfInaction));
      }

      if (m.measureOfSuccess) {
        items.push(heading("Measure of Success"));
        items.push(body(m.measureOfSuccess));
      }

      if (m.evidence && m.evidence.length > 0) {
        items.push(heading("Evidence"));
        for (const e of m.evidence) {
          const line =
            e.tier === "sourced"
              ? `[Sourced] ${e.quote ?? e.claim ?? ""}${e.sourceTitle ? ` — ${e.sourceTitle}` : ""}`
              : e.tier === "benchmark"
                ? `[Benchmark] ${e.benchmarkLabel ?? ""} ${e.benchmarkRange ?? ""}`
                : `[Inferred] ${e.rationale ?? e.claim ?? ""}`;
          items.push(body(line));
        }
      }

      slide.addText(items, {
        x: PPTX.CONTENT_MARGIN + 0.3,
        y: 1.2,
        w: PPTX.CONTENT_W - 0.6,
        h: 5.5,
        valign: "top",
        fontFace: "Calibri",
        fit: "shrink",
      });
      addFooter(slide);
    }
  }

  // --- Persona Talk Tracks (one slide per persona) ---------------------
  const talkTracks = research.personaTalkTracks ?? [];
  for (const track of talkTracks) {
    const slide = addSectionSlide(pptx, `Talk Track: ${track.label}`);
    const items: PptxGenJS.TextProps[] = [];
    const h = (text: string): PptxGenJS.TextProps => ({
      text,
      options: {
        fontSize: 12,
        bold: true,
        color: PPTX.DB_DARK,
        breakLine: true,
        paraSpaceAfter: 2,
      } as PptxGenJS.TextPropsOptions,
    });
    const b = (text: string): PptxGenJS.TextProps => ({
      text,
      options: {
        fontSize: 11,
        color: PPTX.TEXT_COLOR,
        breakLine: true,
        paraSpaceAfter: 6,
        indentLevel: 1,
      } as PptxGenJS.TextPropsOptions,
    });

    if (track.caresAbout.length > 0) {
      items.push(h("Cares about"));
      for (const c of track.caresAbout) items.push(b(`• ${c}`));
    }
    if (track.provocativeOpening) {
      items.push(h("Provocative opening"));
      items.push(b(track.provocativeOpening));
    }
    if (track.whatToSay) {
      items.push(h("What to say"));
      items.push(b(track.whatToSay));
    }
    if (track.threeObjections && track.threeObjections.length > 0) {
      items.push(h("Objections + responses"));
      for (const o of track.threeObjections) {
        items.push(b(`"${o.objection}"  ->  ${o.response}`));
      }
    }
    if (track.discoveryTrack && track.discoveryTrack.length > 0) {
      items.push(h("Discovery ladder"));
      for (const q of track.discoveryTrack) items.push(b(`• ${q}`));
    }
    if (track.closeSignal) {
      items.push(h("Close signal"));
      items.push(b(track.closeSignal));
    }

    slide.addText(items, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      h: 5.5,
      valign: "top",
      fontFace: "Calibri",
      fit: "shrink",
    });
    addFooter(slide);
  }

  if (demoNarrative?.competitorAngles && demoNarrative.competitorAngles.length > 0) {
    const slide = addSectionSlide(pptx, "Competitive Positioning");
    const compData: PptxGenJS.TableRow[] = [
      [headerCell("Competitor"), headerCell("Their Move"), headerCell("Your Opportunity")],
      ...demoNarrative.competitorAngles.map(
        (c): PptxGenJS.TableRow => [
          bodyCell(c.competitor, { bold: true }),
          bodyCell(c.theirMove),
          bodyCell(c.yourOpportunity),
        ],
      ),
    ];
    slide.addTable(compData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      colW: [2.5, 4.5, 4.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 10,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.2,
      autoPageCharWeight: -0.5,
    });
    addFooter(slide);
  }

  if (demoNarrative?.executiveTalkingPoints && demoNarrative.executiveTalkingPoints.length > 0) {
    const slide = addSectionSlide(pptx, "Executive Talking Points");
    const items: PptxGenJS.TextProps[] = demoNarrative.executiveTalkingPoints.flatMap((tp) => [
      {
        text: `${tp.assetId}: ${tp.headline}`,
        options: {
          fontSize: 14,
          bold: true,
          color: PPTX.DB_DARK,
          breakLine: true,
          paraSpaceAfter: 2,
        } as PptxGenJS.TextPropsOptions,
      },
      {
        text: tp.benchmarkTieIn,
        options: {
          fontSize: 12,
          color: PPTX.TEXT_COLOR,
          bullet: true,
          breakLine: true,
          paraSpaceAfter: 8,
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
      fit: "shrink",
    });
    addFooter(slide);
  }

  if (research.dataNarratives && research.dataNarratives.length > 0) {
    const slide = addSectionSlide(pptx, "Data Narratives");
    const cardW = 4;
    const cardH = 1.8;
    const gap = 0.3;
    let y = 1.2;
    let x = PPTX.CONTENT_MARGIN + 0.3;
    for (const n of research.dataNarratives.slice(0, 6)) {
      slide.addShape("rect", {
        x,
        y,
        w: cardW,
        h: cardH,
        fill: { color: PPTX.WARM_WHITE },
        line: { color: PPTX.BORDER_COLOR, width: 0.5 },
        rectRadius: 0.08,
      });
      slide.addText(n.title, {
        x: x + 0.1,
        y: y + 0.1,
        w: cardW - 0.2,
        fontSize: 12,
        bold: true,
        color: PPTX.DB_DARK,
        fontFace: "Calibri",
      });
      slide.addText(n.description, {
        x: x + 0.1,
        y: y + 0.45,
        w: cardW - 0.2,
        h: cardH - 0.7,
        fontSize: 10,
        color: PPTX.TEXT_COLOR,
        fontFace: "Calibri",
        valign: "top",
      });
      slide.addText(`Pattern: ${n.pattern}`, {
        x: x + 0.1,
        y: y + cardH - 0.35,
        w: cardW - 0.2,
        fontSize: 9,
        color: PPTX.MID_GRAY,
        fontFace: "Calibri",
      });
      x += cardW + gap;
      if (x + cardW > PPTX.SLIDE_W - PPTX.CONTENT_MARGIN - 0.3) {
        x = PPTX.CONTENT_MARGIN + 0.3;
        y += cardH + gap;
      }
    }
    addFooter(slide);
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
    const slide = addSectionSlide(pptx, "Evidence Register");
    const evData: PptxGenJS.TableRow[] = [
      [headerCell("Tier"), headerCell("Claim"), headerCell("Evidence"), headerCell("Source")],
      ...evidenceRows.slice(0, 20).map(
        (r): PptxGenJS.TableRow => [
          bodyCell(r.tier, { align: "center" }),
          bodyCell(r.claim),
          bodyCell(r.detail),
          bodyCell(r.source),
        ],
      ),
    ];
    slide.addTable(evData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      colW: [1.2, 2.8, 5.5, 1.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 10,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.2,
      autoPageCharWeight: -0.5,
    });
    addFooter(slide);
  }

  if (research.sources && research.sources.length > 0) {
    const slide = addSectionSlide(pptx, "Sources");
    const sourceData: PptxGenJS.TableRow[] = [
      [headerCell("Type"), headerCell("URL"), headerCell("Status"), headerCell("Characters")],
      ...research.sources.map(
        (s): PptxGenJS.TableRow => [
          bodyCell(s.type, { align: "center" }),
          bodyCell(s.title),
          bodyCell(s.status, { align: "center" }),
          bodyCell(String(s.charCount), { align: "right" }),
        ],
      ),
    ];
    slide.addTable(sourceData, {
      x: PPTX.CONTENT_MARGIN + 0.3,
      y: 1.2,
      w: PPTX.CONTENT_W - 0.6,
      colW: [2, 6, 1.5, 1.5],
      border: { type: "solid", pt: 0.5, color: PPTX.BORDER_COLOR },
      fontSize: 10,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 1.2,
      autoPageCharWeight: -0.5,
    });
    addFooter(slide);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(output as ArrayBuffer);
}
