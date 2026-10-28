import { describe, expect, it, vi } from "vitest";
import {
  evaluateEconomicFormula,
  normalizeValueEstimateBounds,
} from "@/lib/domain/economic-patterns";
import {
  computeFeasibilityScoreFromFactors,
  computeOverallScore,
  computePriorityScoreFromFactors,
} from "@/lib/domain/scoring";

const mockPrisma = {
  forgeRun: {
    findMany: vi.fn(async () => [{ runId: "run-old" }, { runId: "run-latest" }]),
    findFirst: vi.fn(async () => ({ runId: "run-latest", synthesisJson: null })),
  },
  forgeUseCase: {
    count: vi.fn(async ({ where }: { where: { runId?: string } }) =>
      where.runId === "run-latest" ? 2 : 10,
    ),
    groupBy: vi.fn(async () => [
      {
        domain: "Finance",
        _count: { _all: 2 },
        _avg: { feasibilityScore: 0.7, overallScore: 0.8 },
      },
    ]),
    findMany: vi.fn(async () => [
      { id: "uc-1", domain: "Finance" },
      { id: "uc-2", domain: "Finance" },
    ]),
  },
  forgeValueEstimate: {
    aggregate: vi.fn(async ({ where }: { where: { runId?: string } }) => ({
      _sum:
        where.runId === "run-latest"
          ? { valueLow: 100_000, valueMid: 300_000, valueHigh: 600_000 }
          : { valueLow: 500_000, valueMid: 1_500_000, valueHigh: 3_000_000 },
    })),
    findMany: vi.fn(async () => [
      { useCaseId: "uc-1", valueMid: 120_000 },
      { useCaseId: "uc-2", valueMid: 180_000 },
    ]),
  },
  forgeUseCaseTracking: {
    groupBy: vi.fn(async () => [{ stage: "discovered", _count: { _all: 2 } }]),
  },
  forgeRoadmapPhase: {
    groupBy: vi.fn(async () => [
      { phase: "quick_wins", _count: { _all: 1 } },
      { phase: "foundation", _count: { _all: 1 } },
    ]),
    findMany: vi.fn(async () => [
      { useCaseId: "uc-1", phase: "quick_wins" },
      { useCaseId: "uc-2", phase: "foundation" },
    ]),
  },
  forgeValueCapture: {
    aggregate: vi.fn(async () => ({ _sum: { amount: 50_000 } })),
  },
};

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(cb: (p: unknown) => Promise<T>) => cb(mockPrisma),
}));

import { getPortfolioData } from "@/lib/lakebase/portfolio";

describe("PR-04 financial formula evaluator, portfolio rollup & scoring math", () => {
  describe("evaluateEconomicFormula & normalizeValueEstimateBounds", () => {
    it("evaluates Loss Avoidance formula vars accurately ($2M * 0.15 * 0.6 * 0.7 = $126,000)", () => {
      const evaluated = evaluateEconomicFormula(
        "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
        {
          Loss_yr: 2_000_000,
          Delta_pct: 0.15,
          "Adopt%": 0.6,
          "Cap%": 0.7,
        },
      );
      expect(evaluated).toBe(126_000);
    });

    it("normalizes percentage strings and whole numbers on percentage keys", () => {
      const evaluated = evaluateEconomicFormula(
        "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
        {
          Loss_yr: "$2,000,000",
          Delta_pct: "15%",
          "Adopt%": 60,
          "Cap%": 70,
        },
      );
      expect(evaluated).toBe(126_000);
    });

    it("enforces monotonic bounds (low <= mid <= high) and anchors mid to evaluated formula", () => {
      const bounds = normalizeValueEstimateBounds({
        valueLow: 500_000,
        valueMid: 200_000,
        valueHigh: 50_000,
        evaluatedMid: 126_000,
      });
      expect(bounds.valueMid).toBe(126_000);
      expect(bounds.valueLow).toBeLessThanOrEqual(bounds.valueMid);
      expect(bounds.valueMid).toBeLessThanOrEqual(bounds.valueHigh);
    });
  });

  describe("scoring sub-factor formulas", () => {
    it("computes Priority, Feasibility, and Overall scores deterministically from sub-factors", () => {
      const priority = computePriorityScoreFromFactors({
        roi: 0.8,
        strategic_alignment: 0.7,
        time_to_value: 0.5,
        reusability: 0.6,
      });
      expect(priority).toBe(0.738);

      const feasibility = computeFeasibilityScoreFromFactors({
        data_availability: 0.9,
        data_accessibility: 0.8,
        architecture_fitness: 0.7,
        team_skills: 0.4,
        domain_knowledge: 0.6,
        people_allocation: 0.5,
        budget_allocation: 0.7,
        time_to_production: 0.5,
      });
      expect(feasibility).toBe(0.638);

      const overall = computeOverallScore(priority, feasibility);
      expect(overall).toBe(0.713);
    });
  });

  describe("getPortfolioData single-run consistency & roadmap phase values", () => {
    it("scopes totalEstimatedValue to latestRun (no multi-run double count) and populates byPhase.valueMid", async () => {
      const portfolio = await getPortfolioData("alice@company.com");

      expect(portfolio.totalUseCases).toBe(2);
      expect(portfolio.totalEstimatedValue.mid).toBe(300_000);
      expect(portfolio.byDomain[0].valueMid).toBe(300_000);
      expect(portfolio.byPhase.quick_wins.valueMid).toBe(120_000);
      expect(portfolio.byPhase.foundation.valueMid).toBe(180_000);
      expect(portfolio.byPhase.transformation.valueMid).toBe(0);
    });
  });
});
