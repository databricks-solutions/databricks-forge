/**
 * Shared helper for the main `/` Dashboard.
 *
 * Builds the `DashboardStats` payload consumed by both the SSR landing page
 * (`app/page.tsx`) and the `/api/stats` route. When `runId` is provided, the
 * use-case-related aggregates (counts, scores, type/domain splits) and the
 * extra scoped fields (`runStatus`, `runProgressPct`, `businessValueMid`) are
 * narrowed to that single run. The cross-run `recentRuns` list and the
 * cross-run `runStatusGroups`-derived totals stay global so the bottom
 * "Recent Runs" section keeps working regardless of selection.
 */

import { withPrisma } from "@/lib/prisma";
import { isBenchmarksEnabled } from "@/lib/benchmarks/config";

export interface DashboardStatsOptions {
  userEmail: string;
  sharedRunIds: string[];
  runId?: string | null;
}

export interface DashboardStatsRecentRun {
  runId: string;
  businessName: string;
  status: string;
  progressPct: number;
  useCaseCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface DashboardStatsResult {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  totalUseCases: number;
  aiCount: number;
  statisticalCount: number;
  geospatialCount: number;
  avgScore: number;
  totalDomains: number;
  domainBreakdown: { domain: string; count: number }[];
  scores: number[];
  recentRuns: DashboardStatsRecentRun[];
  quality: {
    avgConsultantReadiness: number | null;
    avgAssistantScore: number | null;
    releaseGatePassRate: number | null;
    benchmarkFreshnessRate: number | null;
    benchmarkIndustryCoverage: number | null;
  };
  // Scoped extras (populated only when `runId` is set and accessible).
  scopedRunId: string | null;
  runStatus: string | null;
  runProgressPct: number | null;
  businessValueMid: number | null;
}

/**
 * Resolves the dashboard stats payload, optionally narrowed to a single run.
 *
 * Returns `null` when `runId` is provided but the caller has no read access
 * (owner ∪ shared). Cross-run paths never return `null`.
 */
export async function getDashboardStats(
  opts: DashboardStatsOptions,
): Promise<DashboardStatsResult | null> {
  const { userEmail, sharedRunIds, runId } = opts;

  return withPrisma(async (prisma) => {
    const visibility = {
      OR: [{ ownerEmail: userEmail }, { runId: { in: sharedRunIds } }],
    };

    // Run-scoped path: verify access first and capture the row's status /
    // progress in the same query. Bail early when the caller can't see it.
    let scopedRun: { status: string; progressPct: number } | null = null;
    if (runId) {
      const access = await prisma.forgeRun.findFirst({
        where: { runId, ...visibility },
        select: { runId: true, status: true, progressPct: true },
      });
      if (!access) return null;
      scopedRun = { status: access.status, progressPct: access.progressPct };
    }

    const runScopeForUseCases = runId
      ? { runId, ...visibility }
      : visibility;
    const useCaseVisibility = { run: runScopeForUseCases };

    const [runStatusGroups, recentRunRows] = await Promise.all([
      // Status counts stay global so the totals tile keeps working when no run
      // is selected. Run-scoped views ignore these counts.
      prisma.forgeRun.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: visibility,
      }),
      prisma.forgeRun.findMany({
        where: visibility,
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          runId: true,
          businessName: true,
          status: true,
          progressPct: true,
          createdAt: true,
          completedAt: true,
          _count: { select: { useCases: true } },
        },
      }),
    ]);

    const [typeGroups, domainGroups, scoreRows] = await Promise.all([
      prisma.forgeUseCase.groupBy({
        by: ["type"],
        _count: { _all: true },
        where: useCaseVisibility,
      }),
      prisma.forgeUseCase.groupBy({
        by: ["domain"],
        _count: { _all: true },
        where: useCaseVisibility,
        orderBy: { _count: { domain: "desc" } },
      }),
      prisma.forgeUseCase.findMany({
        select: { overallScore: true },
        where: { overallScore: { not: null }, ...useCaseVisibility },
      }),
    ]);

    const [qualityRows, benchmarkRows, valueEstimateAgg] = await Promise.all([
      prisma.forgeQualityMetric.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          OR: [{ ownerEmail: userEmail }, { run: visibility }],
          ...(runId ? { runId } : {}),
        },
        select: {
          metricType: true,
          metricName: true,
          metricValue: true,
          passed: true,
        },
      }),
      isBenchmarksEnabled()
        ? prisma.forgeBenchmarkRecord.findMany({
            where: { lifecycleStatus: "published" },
            select: {
              industry: true,
              publishedAt: true,
              ttlDays: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              industry: string | null;
              publishedAt: Date | null;
              ttlDays: number;
            }>,
          ),
      runId
        ? prisma.forgeValueEstimate.aggregate({
            where: { runId },
            _sum: { valueMid: true },
          })
        : Promise.resolve(null),
    ]);

    const statusLookup = new Map(
      runStatusGroups.map((g) => [g.status, g._count._all]),
    );
    const completedRuns = statusLookup.get("completed") ?? 0;
    const failedRuns = statusLookup.get("failed") ?? 0;
    const runningRuns =
      (statusLookup.get("running") ?? 0) + (statusLookup.get("pending") ?? 0);
    const totalRuns = runStatusGroups.reduce((sum, g) => sum + g._count._all, 0);

    const typeLookup = new Map(typeGroups.map((g) => [g.type, g._count._all]));
    const aiCount = typeLookup.get("AI") ?? 0;
    const statisticalCount = typeLookup.get("Statistical") ?? 0;
    const geospatialCount = typeLookup.get("Geospatial") ?? 0;
    const totalUseCases = typeGroups.reduce((sum, g) => sum + g._count._all, 0);

    const scores = scoreRows.map((r) => r.overallScore!);
    const avgScore =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)
        : 0;

    const domainBreakdown = domainGroups.map((g) => ({
      domain: g.domain ?? "Unknown",
      count: g._count._all,
    }));

    const consultantRows = qualityRows.filter(
      (m) => m.metricType === "run" && m.metricName === "consultant_readiness",
    );
    const assistantRows = qualityRows.filter(
      (m) =>
        m.metricType === "assistant" &&
        m.metricName === "assistant_overall_score",
    );
    const avgConsultantReadiness =
      consultantRows.length > 0
        ? consultantRows.reduce((s, m) => s + m.metricValue, 0) /
          consultantRows.length
        : null;
    const avgAssistantScore =
      assistantRows.length > 0
        ? assistantRows.reduce((s, m) => s + m.metricValue, 0) /
          assistantRows.length
        : null;
    const releaseGatePassRate =
      consultantRows.length > 0
        ? consultantRows.filter((m) => m.passed === true).length /
          consultantRows.length
        : null;

    const now = Date.now();
    const freshBenchmarks = benchmarkRows.filter((r) => {
      const start = r.publishedAt ? r.publishedAt.getTime() : now;
      const expiry = start + r.ttlDays * 24 * 60 * 60 * 1000;
      return expiry >= now;
    });
    const benchmarkFreshnessRate =
      benchmarkRows.length > 0
        ? freshBenchmarks.length / benchmarkRows.length
        : null;
    const benchmarkIndustryCoverage = new Set(
      benchmarkRows.map((r) => (r.industry ?? "").trim()).filter(Boolean),
    ).size;

    const recentRuns = recentRunRows.map((r) => ({
      runId: r.runId,
      businessName: r.businessName,
      status: r.status,
      progressPct: r.progressPct,
      useCaseCount: r._count.useCases,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));

    return {
      totalRuns,
      completedRuns,
      failedRuns,
      runningRuns,
      totalUseCases,
      aiCount,
      statisticalCount,
      geospatialCount,
      avgScore,
      totalDomains: domainBreakdown.length,
      domainBreakdown,
      scores,
      recentRuns,
      quality: {
        avgConsultantReadiness,
        avgAssistantScore,
        releaseGatePassRate,
        benchmarkFreshnessRate,
        benchmarkIndustryCoverage,
      },
      scopedRunId: runId ?? null,
      runStatus: scopedRun?.status ?? null,
      runProgressPct: scopedRun?.progressPct ?? null,
      businessValueMid:
        valueEstimateAgg && valueEstimateAgg._sum.valueMid != null
          ? valueEstimateAgg._sum.valueMid
          : null,
    };
  });
}

export interface DashboardRunOption {
  runId: string;
  businessName: string;
  status: string;
  createdAt: string;
}

/**
 * Returns the recent-runs list used to populate the dashboard dropdown.
 * Always scoped to runs the caller can read (owner ∪ shared).
 */
export async function listDashboardRunOptions(
  userEmail: string,
  sharedRunIds: string[],
  limit = 25,
): Promise<DashboardRunOption[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeRun.findMany({
      where: {
        OR: [{ ownerEmail: userEmail }, { runId: { in: sharedRunIds } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        runId: true,
        businessName: true,
        status: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      runId: r.runId,
      businessName: r.businessName,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
