import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnvironmentScan: vi.fn(),
  getAggregateForExcel: vi.fn(),
  getLatestDataGapAnalysisForScan: vi.fn(),
  findUnique: vi.fn(),
  wafFindFirst: vi.fn(),
}));

vi.mock("@/lib/lakebase/environment-scans", () => ({
  getEnvironmentScan: mocks.getEnvironmentScan,
  getAggregateForExcel: mocks.getAggregateForExcel,
}));
vi.mock("@/lib/lakebase/data-gap-analyses", () => ({
  getLatestDataGapAnalysisForScan: mocks.getLatestDataGapAnalysisForScan,
}));
vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(
    cb: (p: {
      forgeEstateProgram: { findUnique: typeof mocks.findUnique };
      forgeWafAssessment: { findFirst: typeof mocks.wafFindFirst };
    }) => Promise<T>,
  ) =>
    cb({
      forgeEstateProgram: { findUnique: mocks.findUnique },
      forgeWafAssessment: { findFirst: mocks.wafFindFirst },
    }),
}));

import { buildSynthesisInputForProgram } from "@/lib/ai/estate-synthesis/build-input";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wafFindFirst.mockResolvedValue(null);
});

describe("buildSynthesisInputForProgram", () => {
  it("returns null when the program does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await buildSynthesisInputForProgram("p1", "owner@x.com")).toBeNull();
    expect(mocks.getAggregateForExcel).not.toHaveBeenCalled();
  });

  it("returns null when the program has no completed scans (Task4 invariant)", async () => {
    mocks.findUnique.mockResolvedValue({ name: "Estate", industryId: "retail" });
    // getAggregateForExcel already filters to complete scans; empty → null.
    mocks.getAggregateForExcel.mockResolvedValue(null);
    expect(await buildSynthesisInputForProgram("p1", "owner@x.com")).toBeNull();
  });

  it("aggregates merged details/insights across member scans into the input", async () => {
    mocks.findUnique.mockResolvedValue({ name: "Petronas", industryId: "oil_gas" });
    mocks.getAggregateForExcel.mockResolvedValue({
      details: [
        {
          tableFqn: "cat.up.wells",
          dataDomain: "Upstream",
          dataTier: "gold",
          comment: "c",
          generatedDescription: null,
          governanceScore: 70,
          sensitivityLevel: "internal",
          owner: "team",
          lastModified: "2026-01-01T00:00:00Z",
        },
      ],
      histories: [{ tableFqn: "cat.up.wells", lastWriteTimestamp: "2026-02-01T00:00:00Z", healthScore: 88 }],
      insights: [
        { insightType: "analytics_maturity", tableFqn: null, payloadJson: JSON.stringify({ overallScore: 55 }), severity: "info" },
        { insightType: "canonical_entity", tableFqn: null, payloadJson: JSON.stringify({ name: "Well" }), severity: "info" },
      ],
    });

    const input = await buildSynthesisInputForProgram("p1", "owner@x.com");
    expect(input).not.toBeNull();
    expect(input!.scanId).toBe("program:p1");
    expect(input!.ucPath).toBe("Petronas");
    expect(input!.industryId).toBe("oil_gas");
    expect(input!.tables).toHaveLength(1);
    expect(input!.tables[0].lastWriteAt).toBe("2026-02-01T00:00:00Z");
    expect(input!.tables[0].healthScore).toBe(88);
    expect(input!.insights).toHaveLength(2);
    expect(input!.analyticsMaturityScore).toBe(55);
  });

  it("honours an explicit industryId override", async () => {
    mocks.findUnique.mockResolvedValue({ name: "E", industryId: "retail" });
    mocks.getAggregateForExcel.mockResolvedValue({
      details: [{ tableFqn: "a", dataDomain: null, dataTier: null, comment: null, generatedDescription: null, governanceScore: null, sensitivityLevel: null, owner: null, lastModified: null }],
      histories: [],
      insights: [],
    });
    const input = await buildSynthesisInputForProgram("p1", "owner@x.com", { industryId: "manufacturing" });
    expect(input!.industryId).toBe("manufacturing");
  });
});
