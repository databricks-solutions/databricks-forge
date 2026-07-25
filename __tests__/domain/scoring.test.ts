import { describe, it, expect } from "vitest";
import {
  computeOverallScore,
  getScoreTier,
  rankUseCases,
  groupByDomain,
  computeDomainStats,
} from "@/lib/domain/scoring";
import type { UseCase } from "@/lib/domain/types";

function makeUseCase(overrides: Partial<UseCase> = {}): UseCase {
  return {
    id: "test-001",
    runId: "run-001",
    useCaseNo: 1,
    name: "Test Use Case",
    type: "AI",
    analyticsTechnique: "ai_forecast",
    statement: "Predict sales",
    solution: "Use ai_forecast",
    businessValue: "Increase revenue",
    beneficiary: "Sales",
    sponsor: "CRO",
    domain: "Finance",
    subdomain: "Revenue",
    tablesInvolved: ["catalog.schema.table"],
    priorityScore: 0.7,
    feasibilityScore: 0.6,
    impactScore: 0.8,
    overallScore: 0.72,
    userPriorityScore: null,
    userFeasibilityScore: null,
    userImpactScore: null,
    userOverallScore: null,
    scoreRationale: null,
    consultingScorecard: null,
    sqlCode: null,
    sqlStatus: null,
    feedback: null,
    feedbackAt: null,
    enrichmentTags: null,
    sourceSystems: null,
    sourceSystemsOrigin: null,
    blastRadius: null,
    referenceUseCaseName: null,
    referenceUseCaseResolvedAt: null,
    ...overrides,
  };
}

describe("computeOverallScore", () => {
  it("computes Value-First weighted score: (priority * 0.75) + (feasibility * 0.25)", () => {
    expect(computeOverallScore(1.0, 1.0)).toBe(1.0);
    expect(computeOverallScore(0.0, 0.0)).toBe(0.0);
    // 0.7 * 0.75 + 0.6 * 0.25 = 0.525 + 0.15 = 0.675
    expect(computeOverallScore(0.7, 0.6)).toBe(0.675);
  });

  it("handles edge values", () => {
    expect(computeOverallScore(0.5, 0.5)).toBe(0.5);
    expect(computeOverallScore(1.0, 0.0)).toBe(0.75);
    expect(computeOverallScore(0.0, 1.0)).toBe(0.25);
  });

  it("ignores impact score (it is embedded in priority)", () => {
    expect(computeOverallScore(0.8, 0.6)).toBe(0.75);
  });
});

describe("getScoreTier", () => {
  it("classifies high scores", () => {
    expect(getScoreTier(0.7)).toBe("high");
    expect(getScoreTier(0.9)).toBe("high");
    expect(getScoreTier(1.0)).toBe("high");
  });

  it("classifies medium scores", () => {
    expect(getScoreTier(0.4)).toBe("medium");
    expect(getScoreTier(0.5)).toBe("medium");
    expect(getScoreTier(0.69)).toBe("medium");
  });

  it("classifies low scores", () => {
    expect(getScoreTier(0.0)).toBe("low");
    expect(getScoreTier(0.3)).toBe("low");
    expect(getScoreTier(0.39)).toBe("low");
  });
});

describe("rankUseCases", () => {
  it("sorts by overall score descending", () => {
    const cases = [
      makeUseCase({ overallScore: 0.5, domain: "A" }),
      makeUseCase({ overallScore: 0.9, domain: "B" }),
      makeUseCase({ overallScore: 0.7, domain: "C" }),
    ];
    const ranked = rankUseCases(cases);
    expect(ranked.map((uc) => uc.overallScore)).toEqual([0.9, 0.7, 0.5]);
  });

  it("breaks ties by domain name alphabetically", () => {
    const cases = [
      makeUseCase({ overallScore: 0.7, domain: "Zebra" }),
      makeUseCase({ overallScore: 0.7, domain: "Alpha" }),
    ];
    const ranked = rankUseCases(cases);
    expect(ranked.map((uc) => uc.domain)).toEqual(["Alpha", "Zebra"]);
  });

  it("does not mutate the original array", () => {
    const cases = [makeUseCase({ overallScore: 0.5 }), makeUseCase({ overallScore: 0.9 })];
    const ranked = rankUseCases(cases);
    expect(ranked).not.toBe(cases);
  });
});

describe("groupByDomain", () => {
  it("groups use cases by domain", () => {
    const cases = [
      makeUseCase({ domain: "Finance" }),
      makeUseCase({ domain: "Marketing" }),
      makeUseCase({ domain: "Finance" }),
    ];
    const groups = groupByDomain(cases);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups["Finance"]).toHaveLength(2);
    expect(groups["Marketing"]).toHaveLength(1);
  });

  it("returns empty object for empty input", () => {
    expect(groupByDomain([])).toEqual({});
  });
});

describe("computeDomainStats", () => {
  it("computes correct statistics", () => {
    const cases = [
      makeUseCase({ domain: "Finance", type: "AI", overallScore: 0.8 }),
      makeUseCase({ domain: "Finance", type: "Statistical", overallScore: 0.6 }),
      makeUseCase({ domain: "Marketing", type: "AI", overallScore: 0.5 }),
    ];
    const stats = computeDomainStats(cases);
    expect(stats).toHaveLength(2);

    const finance = stats.find((s) => s.domain === "Finance")!;
    expect(finance.count).toBe(2);
    expect(finance.avgScore).toBe(0.7);
    expect(finance.topScore).toBe(0.8);
    expect(finance.aiCount).toBe(1);
    expect(finance.statsCount).toBe(1);
  });

  it("sorts by average score descending", () => {
    const cases = [
      makeUseCase({ domain: "Low", overallScore: 0.3 }),
      makeUseCase({ domain: "High", overallScore: 0.9 }),
    ];
    const stats = computeDomainStats(cases);
    expect(stats[0].domain).toBe("High");
    expect(stats[1].domain).toBe("Low");
  });
});
