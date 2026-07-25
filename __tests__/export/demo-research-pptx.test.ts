import { describe, expect, it } from "vitest";
import { generateDemoResearchPptx } from "@/lib/export/demo-research-pptx";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";

function longText(prefix: string, length = 250): string {
  const filler =
    " quod erat demonstrandum, lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam, quis nostrud exercitation.";
  let out = prefix;
  while (out.length < length) out += filler;
  return out.slice(0, length);
}

function makeResearch(): ResearchEngineResult {
  return {
    customerName: "Acme Corp",
    industryId: "manufacturing",
    scope: {
      resolvedAssetFamilies: [],
    },
    industryLandscape: {
      marketForces: [
        {
          force: "Persistent Productivity Stagnation & Margin Compression",
          description: longText("Persistent productivity stagnation"),
          urgency: "accelerating",
        },
        {
          force: "Mandatory ESG Disclosure & Carbon Compliance",
          description: longText("Mandatory ESG disclosure"),
          urgency: "accelerating",
        },
        {
          force: "Competitive Dynamics from Tier 1 contractors",
          description: longText("Competitive dynamics"),
          urgency: "stable",
        },
        {
          force: "Safety Regulation Intensification & Predictive Safety",
          description: longText("Safety regulation intensification"),
          urgency: "accelerating",
        },
      ],
      competitiveDynamics: longText("Australia mandatory climate-related disclosure regime", 800),
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
    sources: [],
    confidence: 0.5,
    passTimings: {},
  };
}

describe("generateDemoResearchPptx", () => {
  it("renders Industry Landscape and Competitive Dynamics on separate slides without crashing on long descriptions", async () => {
    const buf = await generateDemoResearchPptx(makeResearch(), "Acme Corp");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(2000);

    // PPTX is a zip; the magic header is 'PK'.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);

    // Search the binary for both slide titles to confirm the split.
    const text = buf.toString("binary");
    expect(text.includes("Industry Landscape")).toBe(true);
    expect(text.includes("Competitive Dynamics")).toBe(true);
  });

  it("does not throw when many sections are missing (Quick preset shape)", async () => {
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
    const buf = await generateDemoResearchPptx(minimal, "Acme");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
