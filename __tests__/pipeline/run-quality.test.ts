import { describe, it, expect } from "vitest";
import { computeRunQualityBaseline, evaluateRunReleaseGate } from "@/lib/pipeline/run-quality";
import { applyDeterministicQualityFilter } from "@/lib/pipeline/usecase-quality";
import { scoreUseCaseConsultingQuality } from "@/lib/pipeline/usecase-scorecard";
import type { UseCase } from "@/lib/domain/types";

function makeUseCase(overrides: Partial<UseCase> = {}): UseCase {
  return {
    id: "UC-001",
    runId: "run-1",
    useCaseNo: 1,
    name: "Predict Invoice Payment Risk",
    type: "AI",
    analyticsTechnique: "ai_classify",
    statement:
      "Predict late-payment risk for receivables using historical payment behavior and account characteristics.",
    solution:
      "Build a risk scoring pipeline with segmentation by customer profile and aging buckets.",
    businessValue:
      "Reduce bad debt exposure and improve cash flow predictability with prioritized collections actions.",
    beneficiary: "Accounts Receivable Lead",
    sponsor: "CFO",
    domain: "Finance",
    subdomain: "Collections",
    tablesInvolved: ["main.finance.ar_invoice"],
    priorityScore: 0.75,
    feasibilityScore: 0.65,
    impactScore: 0.7,
    overallScore: 0.72,
    userPriorityScore: null,
    userFeasibilityScore: null,
    userImpactScore: null,
    userOverallScore: null,
    scoreRationale: null,
    consultingScorecard: null,
    sqlCode: "SELECT 1",
    sqlStatus: "generated",
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

describe("pipeline quality modules", () => {
  it("computes run baseline metrics", () => {
    const ucs = [
      makeUseCase(),
      makeUseCase({
        id: "UC-002",
        useCaseNo: 2,
        name: "Forecast DSO",
        tablesInvolved: ["main.finance.ar_invoice", "main.finance.customer"],
      }),
    ];
    const baseline = computeRunQualityBaseline(ucs, [
      "main.finance.ar_invoice",
      "main.finance.customer",
      "main.finance.payment",
    ]);
    expect(baseline.totalUseCases).toBe(2);
    expect(baseline.consultantReadinessScore).toBeGreaterThan(0.6);
    expect(baseline.groundedUseCaseRate).toBe(1);
  });

  it("filters generic low-quality use cases deterministically", () => {
    const accepted = makeUseCase();
    const generic = makeUseCase({
      id: "UC-003",
      name: "Improve Operations",
      statement: "Improve operations with AI.",
      businessValue: "Analyze data for insights.",
      tablesInvolved: [],
    });
    const result = applyDeterministicQualityFilter(
      [accepted, generic],
      ["main.finance.ar_invoice"],
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("computes consulting scorecard with blended score", () => {
    const uc = makeUseCase();
    const scorecard = scoreUseCaseConsultingQuality(uc);
    expect(scorecard.blendedScore).toBeGreaterThan(0.6);
    expect(scorecard.measurableValue).toBeGreaterThan(0.4);
  });

  it("evaluates release gate policy", () => {
    const baseline = computeRunQualityBaseline([makeUseCase()], ["main.finance.ar_invoice"]);
    const gate = evaluateRunReleaseGate(baseline, {
      consultantReadiness: 0.5,
      sqlGeneratedRate: 0.7,
      schemaCoveragePct: 0.2,
      lowSpecificityRateMax: 0.3,
    });
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });
});
