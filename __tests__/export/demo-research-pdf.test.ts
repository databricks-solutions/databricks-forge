import { describe, expect, it } from "vitest";
import { generateDemoResearchPdf } from "@/lib/export/demo-research-pdf";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import type { ResearchSource } from "@/lib/demo/types";

function longText(prefix: string, length = 220): string {
  const filler =
    " consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
  let out = prefix;
  while (out.length < length) out += filler;
  return out.slice(0, length);
}

function manySources(count: number): ResearchSource[] {
  return Array.from({ length: count }, (_, i) => ({
    type: i % 2 === 0 ? "website" : ("investor-doc" as const),
    title: longText(`Source ${i + 1} — `, 180),
    url: `https://example.com/source-${i + 1}`,
    charCount: 12000 + i * 250,
    status: "ready" as const,
  }));
}

function makeResearch(sourceCount: number): ResearchEngineResult {
  return {
    customerName: "Acme Corp",
    industryId: "manufacturing",
    scope: { resolvedAssetFamilies: [] },
    industryLandscape: {
      marketForces: [
        {
          force: "Force A",
          description: longText("Force A description"),
          urgency: "accelerating",
        },
        {
          force: "Force B",
          description: longText("Force B description"),
          urgency: "stable",
        },
      ],
      competitiveDynamics: longText("Competitive dynamics", 600),
      regulatoryPressures: "",
      technologyDisruptors: "",
      keyBenchmarks: [],
    },
    companyProfile: null,
    dataStrategy: null,
    demoNarrative: null,
    matchedDataAssetIds: [],
    nomenclature: {},
    dataNarratives: [],
    sources: manySources(sourceCount),
    confidence: 0.5,
    passTimings: {},
  };
}

function countPdfPages(buf: Buffer): number {
  const text = buf.toString("binary");
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

describe("generateDemoResearchPdf", () => {
  it("paginates a large Sources table across multiple pages", async () => {
    const buf = await generateDemoResearchPdf(makeResearch(30), "Acme Corp");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    expect(countPdfPages(buf)).toBeGreaterThan(1);
  });

  it("does not throw with empty/minimal research", async () => {
    const minimal: ResearchEngineResult = {
      customerName: "Acme",
      industryId: "retail",
      scope: { resolvedAssetFamilies: [] },
      industryLandscape: null,
      companyProfile: null,
      dataStrategy: null,
      demoNarrative: null,
      matchedDataAssetIds: [],
      nomenclature: {},
      dataNarratives: [],
      sources: [],
      confidence: 0.1,
      passTimings: {},
    };
    const buf = await generateDemoResearchPdf(minimal, "Acme");
    expect(buf.length).toBeGreaterThan(500);
    expect(countPdfPages(buf)).toBeGreaterThanOrEqual(1);
  });

  it("dynamically grows table row height for long wrapped cell text", async () => {
    const shortBuf = await generateDemoResearchPdf(
      {
        ...makeResearch(2),
        sources: [
          { type: "website", title: "A", url: "https://a", charCount: 100, status: "ready" },
          { type: "website", title: "B", url: "https://b", charCount: 100, status: "ready" },
        ],
      },
      "Acme",
    );
    const longBuf = await generateDemoResearchPdf(makeResearch(2), "Acme");
    expect(longBuf.length).toBeGreaterThan(shortBuf.length);
  });
});
