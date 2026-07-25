import { describe, it, expect, vi, beforeEach } from "vitest";

const getEnvironmentScan = vi.fn();
const getLatestDataGapAnalysisForScan = vi.fn();
const findUnique = vi.fn();
const findFirst = vi.fn();

vi.mock("@/lib/lakebase/environment-scans", () => ({
  getEnvironmentScan: (...a: unknown[]) => getEnvironmentScan(...a),
}));
vi.mock("@/lib/lakebase/data-gap-analyses", () => ({
  getLatestDataGapAnalysisForScan: (...a: unknown[]) => getLatestDataGapAnalysisForScan(...a),
}));
vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) =>
    cb({
      forgeEstateProgram: { findUnique },
      forgeWafAssessment: { findFirst },
    }),
}));

import { buildSynthesisInputForScan } from "@/lib/ai/estate-synthesis/build-input";

function baseScan() {
  return {
    scanId: "scan-1",
    ucPath: "main.sales",
    programId: null,
    scanSummaryJson: JSON.stringify({ readinessScore: 62 }),
    details: [
      {
        tableFqn: "main.sales.customer",
        dataDomain: "Sales",
        dataTier: "gold",
        comment: "c",
        generatedDescription: null,
        governanceScore: 80,
        sensitivityLevel: "pii",
        owner: "team@x.com",
        lastModified: "2026-05-01T00:00:00Z",
      },
    ],
    histories: [
      { tableFqn: "main.sales.customer", lastWriteTimestamp: "2026-05-20T00:00:00Z", healthScore: 90 },
    ],
    insights: [
      { insightType: "analytics_maturity", tableFqn: null, payloadJson: JSON.stringify({ overallScore: 55 }), severity: "info" },
    ],
  };
}

describe("buildSynthesisInputForScan", () => {
  beforeEach(() => {
    getEnvironmentScan.mockReset();
    getLatestDataGapAnalysisForScan.mockReset();
    findUnique.mockReset();
    findFirst.mockReset();
    getLatestDataGapAnalysisForScan.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
  });

  it("returns null when the scan does not exist", async () => {
    getEnvironmentScan.mockResolvedValue(null);
    expect(await buildSynthesisInputForScan("missing", "u@x.com")).toBeNull();
  });

  it("maps tables, prefers history write/health, and reads summary + maturity", async () => {
    getEnvironmentScan.mockResolvedValue(baseScan());
    const inp = await buildSynthesisInputForScan("scan-1", "u@x.com");
    expect(inp).not.toBeNull();
    expect(inp!.readinessScore).toBe(62);
    expect(inp!.analyticsMaturityScore).toBe(55);
    const t = inp!.tables[0];
    expect(t.lastWriteAt).toBe("2026-05-20T00:00:00Z"); // history wins over lastModified
    expect(t.healthScore).toBe(90);
    expect(t.governanceScore).toBe(80);
  });

  it("threads explicit industryId without hitting the program lookup", async () => {
    getEnvironmentScan.mockResolvedValue(baseScan());
    const inp = await buildSynthesisInputForScan("scan-1", "u@x.com", { industryId: "retail" });
    expect(inp!.industryId).toBe("retail");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("resolves industry from the owning estate program when not explicit", async () => {
    getEnvironmentScan.mockResolvedValue({ ...baseScan(), programId: "p1" });
    findUnique.mockResolvedValue({ industryId: "banking" });
    const inp = await buildSynthesisInputForScan("scan-1", "u@x.com");
    expect(inp!.industryId).toBe("banking");
  });

  it("maps a cached data-gap analysis into the input signal", async () => {
    getEnvironmentScan.mockResolvedValue(baseScan());
    getLatestDataGapAnalysisForScan.mockResolvedValue({
      result: {
        industryId: "retail",
        industryName: "Retail",
        summary: {
          missingAssets: 4,
          mcMissing: 1,
          valueAtRiskLow: 10,
          valueAtRiskMid: 20,
          valueAtRiskHigh: 30,
        },
      },
    });
    const inp = await buildSynthesisInputForScan("scan-1", "u@x.com");
    expect(inp!.dataGap).toMatchObject({ industryId: "retail", missingAssets: 4, valueAtRiskMid: 20 });
    expect(inp!.industryName).toBe("Retail");
  });

  it("normalises a fractional WAF overall score to a 0-100 scale", async () => {
    getEnvironmentScan.mockResolvedValue(baseScan());
    findFirst.mockResolvedValue({ overallScore: 0.72 });
    const inp = await buildSynthesisInputForScan("scan-1", "u@x.com");
    expect(inp!.waf).toEqual({ overallScore: 72 });
  });
});
