/**
 * Portfolio data aggregation for the Business Value dashboard.
 */

import { withPrisma } from "@/lib/prisma";
import type {
  BusinessValuePortfolio,
  ExecutiveSynthesis,
  TrackingStage,
  RoadmapPhase,
} from "@/lib/domain/types";

export type PortfolioUseCase = {
  id: string;
  name: string;
  domain: string;
  type: string;
  overallScore: number;
  feasibilityScore: number;
  businessValue: string;
  valueMid: number;
  phase: RoadmapPhase | null;
  effortEstimate: string | null;
  // ---- Rationale & detail surfaced on expand (Phase 2.1) -------------------
  // Each pair below is the LLM-produced justification persisted on
  // ForgeValueEstimate / ForgeRoadmapPhase. They are surfaced as expandable
  // detail rows on /business-value and /business-value/roadmap so a
  // consumer never sees a number without the math behind it.
  valueLow: number | null;
  valueHigh: number | null;
  valueType: string | null;
  confidence: string | null;
  rationale: string | null;
  assumptions: string[];
  industryBenchmark: string | null;
  economicPatternName: string | null;
  economicImpactCategory: string | null;
  economicFormulaVars: Record<string, number | string> | null;
  phaseRationale: string | null;
  enablers: string[];
  dependencies: string[];
};

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getPortfolioData(
  userEmail?: string | null,
  accessibleRunIds: string[] = [],
): Promise<BusinessValuePortfolio & { latestRunId: string | null }> {
  return withPrisma(async (prisma) => {
    const owner = userEmail ? userEmail.toLowerCase().trim() : null;
    // Build a where clause that scopes to the user's owned + shared runs.
    const runIdScope = owner
      ? {
          OR: [
            { ownerEmail: owner },
            ...(accessibleRunIds.length > 0 ? [{ runId: { in: accessibleRunIds } }] : []),
          ],
        }
      : {};

    const accessibleRunsForUser = owner
      ? await prisma.forgeRun.findMany({
          where: runIdScope,
          select: { runId: true },
        })
      : [];
    const userRunIds = accessibleRunsForUser.map((r) => r.runId);
    const useCaseScope = owner
      ? userRunIds.length > 0
        ? { runId: { in: userRunIds } }
        : { runId: "__no_run__" }
      : {};

    const latestRun = await prisma.forgeRun.findFirst({
      where: {
        status: "completed",
        synthesisJson: { not: null },
        ...runIdScope,
      },
      orderBy: { completedAt: "desc" },
      select: { runId: true, synthesisJson: true },
    });

    const totalUseCases = await prisma.forgeUseCase.count({
      where: useCaseScope,
    });

    const valueAgg = await prisma.forgeValueEstimate.aggregate({
      where: useCaseScope,
      _sum: { valueLow: true, valueMid: true, valueHigh: true },
    });

    const stageGroups = await prisma.forgeUseCaseTracking.groupBy({
      by: ["stage"],
      where: useCaseScope,
      _count: { _all: true },
    });
    const byStage: Record<TrackingStage, number> = {
      discovered: 0,
      planned: 0,
      in_progress: 0,
      delivered: 0,
      measured: 0,
    };
    for (const g of stageGroups) {
      byStage[g.stage as TrackingStage] = g._count._all;
    }

    const phaseGroups = await prisma.forgeRoadmapPhase.groupBy({
      by: ["phase"],
      where: useCaseScope,
      _count: { _all: true },
    });
    const byPhase: Record<RoadmapPhase, { count: number; valueMid: number }> = {
      quick_wins: { count: 0, valueMid: 0 },
      foundation: { count: 0, valueMid: 0 },
      transformation: { count: 0, valueMid: 0 },
    };
    for (const g of phaseGroups) {
      const phase = g.phase as RoadmapPhase;
      if (byPhase[phase]) {
        byPhase[phase].count = g._count._all;
      }
    }

    const byDomain: BusinessValuePortfolio["byDomain"] = [];
    if (latestRun) {
      const domainGroups = await prisma.forgeUseCase.groupBy({
        by: ["domain"],
        where: { runId: latestRun.runId },
        _count: { _all: true },
        _avg: { feasibilityScore: true, overallScore: true },
      });

      const domainUseCases = await prisma.forgeUseCase.findMany({
        where: { runId: latestRun.runId },
        select: { id: true, domain: true },
      });
      const domainEstimates = await prisma.forgeValueEstimate.findMany({
        where: { runId: latestRun.runId },
        select: { useCaseId: true, valueMid: true },
      });
      const valueByUc = new Map(domainEstimates.map((e) => [e.useCaseId, e.valueMid]));
      const domainValueMap = new Map<string, number>();
      for (const uc of domainUseCases) {
        if (!uc.domain) continue;
        const prev = domainValueMap.get(uc.domain) ?? 0;
        domainValueMap.set(uc.domain, prev + (valueByUc.get(uc.id) ?? 0));
      }

      for (const g of domainGroups) {
        if (g.domain) {
          byDomain.push({
            domain: g.domain,
            useCaseCount: g._count._all,
            valueMid: domainValueMap.get(g.domain) ?? 0,
            avgFeasibility: g._avg.feasibilityScore ?? 0,
            avgScore: g._avg.overallScore ?? 0,
          });
        }
      }
    }

    const deliveredAgg = await prisma.forgeValueCapture.aggregate({
      where: useCaseScope,
      _sum: { amount: true },
    });

    const synthesis = safeParse<ExecutiveSynthesis>(
      latestRun?.synthesisJson ?? null,
      null as unknown as ExecutiveSynthesis,
    );

    return {
      totalUseCases,
      totalEstimatedValue: {
        low: valueAgg._sum.valueLow ?? 0,
        mid: valueAgg._sum.valueMid ?? 0,
        high: valueAgg._sum.valueHigh ?? 0,
        currency: "USD",
      },
      byStage,
      byPhase,
      byDomain,
      deliveredValue: deliveredAgg._sum.amount ?? 0,
      latestSynthesis: synthesis,
      latestRunId: latestRun?.runId ?? null,
    };
  });
}

export async function getPortfolioUseCases(
  userEmail?: string | null,
  accessibleRunIds: string[] = [],
): Promise<PortfolioUseCase[]> {
  return withPrisma(async (prisma) => {
    const owner = userEmail ? userEmail.toLowerCase().trim() : null;
    const runIdScope = owner
      ? {
          OR: [
            { ownerEmail: owner },
            ...(accessibleRunIds.length > 0 ? [{ runId: { in: accessibleRunIds } }] : []),
          ],
        }
      : {};
    const latestRun = await prisma.forgeRun.findFirst({
      where: { status: "completed", ...runIdScope },
      orderBy: { completedAt: "desc" },
      select: { runId: true },
    });
    if (!latestRun) return [];

    const useCases = await prisma.forgeUseCase.findMany({
      where: { runId: latestRun.runId },
      select: {
        id: true,
        name: true,
        domain: true,
        type: true,
        overallScore: true,
        feasibilityScore: true,
        businessValue: true,
      },
      orderBy: { overallScore: "desc" },
    });

    const estimates = await prisma.forgeValueEstimate.findMany({
      where: { runId: latestRun.runId },
      select: {
        useCaseId: true,
        valueLow: true,
        valueMid: true,
        valueHigh: true,
        valueType: true,
        confidence: true,
        rationale: true,
        assumptions: true,
        industryBenchmark: true,
        economicPatternName: true,
        economicImpactCategory: true,
        economicFormulaVars: true,
      },
    });
    const estimateMap = new Map(estimates.map((e) => [e.useCaseId, e]));

    const phases = await prisma.forgeRoadmapPhase.findMany({
      where: { runId: latestRun.runId },
      select: {
        useCaseId: true,
        phase: true,
        effortEstimate: true,
        rationale: true,
        enablers: true,
        dependencies: true,
      },
    });
    const phaseMap = new Map(phases.map((p) => [p.useCaseId, p]));

    return useCases.map((uc) => {
      const p = phaseMap.get(uc.id);
      const est = estimateMap.get(uc.id);
      return {
        id: uc.id,
        name: uc.name ?? "Untitled",
        domain: uc.domain ?? "Uncategorized",
        type: uc.type ?? "Unknown",
        overallScore: uc.overallScore ?? 0,
        feasibilityScore: uc.feasibilityScore ?? 0,
        businessValue: uc.businessValue ?? "",
        valueMid: est?.valueMid ?? 0,
        phase: (p?.phase as RoadmapPhase) ?? null,
        effortEstimate: p?.effortEstimate ?? null,
        valueLow: est?.valueLow ?? null,
        valueHigh: est?.valueHigh ?? null,
        valueType: est?.valueType ?? null,
        confidence: est?.confidence ?? null,
        rationale: est?.rationale ?? null,
        assumptions: safeParse<string[]>(est?.assumptions ?? null, []),
        industryBenchmark: est?.industryBenchmark ?? null,
        economicPatternName: est?.economicPatternName ?? null,
        economicImpactCategory: est?.economicImpactCategory ?? null,
        economicFormulaVars: safeParse<Record<string, number | string> | null>(
          est?.economicFormulaVars ?? null,
          null,
        ),
        phaseRationale: p?.rationale ?? null,
        enablers: safeParse<string[]>(p?.enablers ?? null, []),
        dependencies: safeParse<string[]>(p?.dependencies ?? null, []),
      };
    });
  });
}
