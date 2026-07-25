import { describe, it, expect } from "vitest";
import {
  computeEstateScores,
  buildFindings,
  computeValueAtRisk,
  documentationScore,
  governanceScore,
  freshnessScore,
  FRESHNESS_WINDOW_DAYS,
} from "@/lib/ai/estate-synthesis/scoring";
import { runEstateSynthesis } from "@/lib/ai/estate-synthesis/engine";
import type { EstateSynthesisInput, SynthTable } from "@/lib/ai/estate-synthesis/types";

const NOW = Date.parse("2026-06-01T00:00:00Z");

function table(p: Partial<SynthTable> & { fqn: string }): SynthTable {
  return {
    fqn: p.fqn,
    dataDomain: p.dataDomain ?? null,
    dataTier: p.dataTier ?? null,
    comment: p.comment ?? null,
    generatedDescription: p.generatedDescription ?? null,
    governanceScore: p.governanceScore ?? null,
    sensitivityLevel: p.sensitivityLevel ?? null,
    owner: p.owner ?? null,
    lastWriteAt: p.lastWriteAt ?? null,
    healthScore: p.healthScore ?? null,
  };
}

function input(p: Partial<EstateSynthesisInput> & { tables: SynthTable[] }): EstateSynthesisInput {
  return {
    scanId: p.scanId ?? "scan-1",
    ucPath: p.ucPath ?? "main.sales",
    industryId: p.industryId ?? null,
    industryName: p.industryName ?? null,
    tables: p.tables,
    insights: p.insights ?? [],
    readinessScore: p.readinessScore ?? null,
    analyticsMaturityScore: p.analyticsMaturityScore ?? null,
    dataGap: p.dataGap ?? null,
    waf: p.waf ?? null,
    costWasteUsd: p.costWasteUsd ?? null,
  };
}

const recent = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
const stale = new Date(NOW - (FRESHNESS_WINDOW_DAYS + 30) * 24 * 60 * 60 * 1000).toISOString();

describe("estate-synthesis scoring", () => {
  it("documentationScore counts comments and generated descriptions", () => {
    const tables = [
      table({ fqn: "a", comment: "documented" }),
      table({ fqn: "b", generatedDescription: "ai gen" }),
      table({ fqn: "c" }),
      table({ fqn: "d", comment: "  " }), // whitespace-only does not count
    ];
    expect(documentationScore(tables)).toBe(50);
  });

  it("governanceScore averages only scored tables", () => {
    const tables = [
      table({ fqn: "a", governanceScore: 80 }),
      table({ fqn: "b", governanceScore: 40 }),
      table({ fqn: "c" }),
    ];
    expect(governanceScore(tables)).toBe(60);
  });

  it("freshnessScore is the share within the freshness window", () => {
    const tables = [
      table({ fqn: "a", lastWriteAt: recent }),
      table({ fqn: "b", lastWriteAt: stale }),
      table({ fqn: "c" }), // no date -> excluded from denominator
    ];
    expect(freshnessScore(tables, NOW)).toBe(50);
  });

  it("computeEstateScores produces a weighted overall and a band", () => {
    const scores = computeEstateScores(
      input({
        tables: [
          table({
            fqn: "a",
            governanceScore: 90,
            healthScore: 90,
            comment: "x",
            lastWriteAt: recent,
          }),
          table({
            fqn: "b",
            governanceScore: 80,
            healthScore: 80,
            comment: "y",
            lastWriteAt: recent,
          }),
        ],
        analyticsMaturityScore: 70,
      }),
      NOW,
    );
    expect(scores.overall).toBeGreaterThan(60);
    expect(["leading", "established"]).toContain(scores.band);
    expect(scores.governance).toBe(85);
    expect(scores.documentation).toBe(100);
    expect(scores.freshness).toBe(100);
  });

  it("cost score falls back to a quality proxy when unmodeled", () => {
    const scores = computeEstateScores(
      input({ tables: [table({ fqn: "a", healthScore: 50 })] }),
      NOW,
    );
    // 50 * 0.8 + 20 = 60
    expect(scores.cost).toBe(60);
  });
});

describe("estate-synthesis findings", () => {
  it("emits a documentation gap when coverage is low", () => {
    const scores = computeEstateScores(
      input({ tables: [table({ fqn: "a" }), table({ fqn: "b" })] }),
      NOW,
    );
    const findings = buildFindings(
      input({ tables: [table({ fqn: "a" }), table({ fqn: "b" })] }),
      scores,
    );
    const doc = findings.find((f) => f.kind === "documentation_gap");
    expect(doc).toBeDefined();
    expect(doc!.action.engine).toBe("comments");
    expect(doc!.evidence.length).toBeGreaterThan(0);
  });

  it("emits coverage_gap + opportunity from a data-gap signal with opportunities href", () => {
    const inp = input({
      tables: [
        table({
          fqn: "a",
          comment: "x",
          governanceScore: 90,
          healthScore: 90,
          lastWriteAt: recent,
        }),
      ],
      dataGap: {
        industryId: "retail",
        industryName: "Retail",
        missingAssets: 5,
        mcMissing: 2,
        valueAtRiskLow: 100,
        valueAtRiskMid: 200,
        valueAtRiskHigh: 300,
      },
    });
    const scores = computeEstateScores(inp, NOW);
    const findings = buildFindings(inp, scores);
    const opp = findings.find((f) => f.kind === "opportunity");
    expect(opp).toBeDefined();
    expect(opp!.action.href).toContain("/configure?fromScan=");
    expect(findings.some((f) => f.kind === "coverage_gap")).toBe(true);
  });

  it("computeValueAtRisk returns null without a data-gap signal", () => {
    expect(computeValueAtRisk(input({ tables: [] }))).toBeNull();
  });
});

describe("runEstateSynthesis engine (DI)", () => {
  it("uses the LLM brief when callLLM succeeds", async () => {
    const result = await runEstateSynthesis(
      input({ tables: [table({ fqn: "a", comment: "x" })] }),
      {
        callLLM: async () =>
          JSON.stringify({
            estateShape: "LLM shape",
            strengths: "LLM strengths",
            criticalRisks: "LLM risks",
            quickWins: "LLM wins",
            strategicRecommendations: "LLM recs",
            situationComplicationResolution: {
              situation: "S",
              complication: "C",
              resolution: "R",
            },
          }),
      },
    );
    expect(result.brief.estateShape).toBe("LLM shape");
    expect(result.passResults.executiveBrief).toBe("success");
    expect(result.scores).toBeDefined();
  });

  it("falls back to a deterministic brief when the LLM throws", async () => {
    const result = await runEstateSynthesis(input({ tables: [table({ fqn: "a" })] }), {
      callLLM: async () => {
        throw new Error("model down");
      },
    });
    expect(result.passResults.executiveBrief).toBe("failed");
    expect(result.brief.estateShape.length).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
