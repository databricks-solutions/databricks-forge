/**
 * Build an EstateSynthesisInput from a persisted scan + cross-engine signals.
 * Keeps the engine itself pure/DI-friendly: all Lakebase reads happen here.
 */

import { getEnvironmentScan, getAggregateForExcel } from "@/lib/lakebase/environment-scans";
import { getLatestDataGapAnalysisForScan } from "@/lib/lakebase/data-gap-analyses";
import { inferIndustryIdFromScope } from "@/lib/pipeline/standalone-scan";
import { withPrisma } from "@/lib/prisma";
import type { EstateSynthesisInput, SynthTable, SynthInsight } from "./types";

export async function buildSynthesisInputForScan(
  scanId: string,
  ownerEmail: string,
  opts: { industryId?: string | null } = {},
): Promise<EstateSynthesisInput | null> {
  const scan = await getEnvironmentScan(scanId);
  if (!scan) return null;

  // History lookups keyed by table fqn.
  const historyByFqn = new Map(scan.histories.map((h) => [h.tableFqn, h]));

  const tables: SynthTable[] = scan.details.map((d) => {
    const h = historyByFqn.get(d.tableFqn);
    return {
      fqn: d.tableFqn,
      dataDomain: d.dataDomain,
      dataTier: d.dataTier,
      comment: d.comment,
      generatedDescription: d.generatedDescription,
      governanceScore: d.governanceScore,
      sensitivityLevel: d.sensitivityLevel,
      owner: d.owner,
      lastWriteAt: h?.lastWriteTimestamp ?? d.lastModified ?? null,
      healthScore: h?.healthScore ?? null,
    };
  });

  const insights: SynthInsight[] = scan.insights.map((i) => ({
    insightType: i.insightType,
    tableFqn: i.tableFqn,
    payloadJson: i.payloadJson,
    severity: i.severity,
  }));

  // Estate summary signals.
  let readinessScore: number | null = null;
  let analyticsMaturityScore: number | null = null;
  if (scan.scanSummaryJson) {
    try {
      const summary = JSON.parse(scan.scanSummaryJson) as { readinessScore?: number };
      readinessScore = summary.readinessScore ?? null;
    } catch {
      /* ignore */
    }
  }
  const maturityInsight = insights.find((i) => i.insightType === "analytics_maturity");
  if (maturityInsight) {
    try {
      const payload = JSON.parse(maturityInsight.payloadJson) as { overallScore?: number };
      analyticsMaturityScore = payload.overallScore ?? null;
    } catch {
      /* ignore */
    }
  }

  // Industry from explicit option, the owning estate, or inferred from ucPath.
  let industryId = opts.industryId ?? null;
  let industryName: string | null = null;
  if (!industryId && scan.programId) {
    const program = await withPrisma((prisma) =>
      prisma.forgeEstateProgram.findUnique({
        where: { id: scan.programId! },
        select: { industryId: true },
      }),
    );
    industryId = program?.industryId ?? null;
  }
  if (!industryId && scan.ucPath) {
    industryId = inferIndustryIdFromScope(scan.ucPath) ?? null;
  }

  // Data-gap signal (if a prior analysis exists).
  const dataGapCached = await getLatestDataGapAnalysisForScan(scanId, ownerEmail);
  const dataGap = dataGapCached
    ? {
        industryId: dataGapCached.result.industryId,
        industryName: dataGapCached.result.industryName,
        missingAssets: dataGapCached.result.summary.missingAssets,
        mcMissing: dataGapCached.result.summary.mcMissing,
        valueAtRiskLow: dataGapCached.result.summary.valueAtRiskLow,
        valueAtRiskMid: dataGapCached.result.summary.valueAtRiskMid,
        valueAtRiskHigh: dataGapCached.result.summary.valueAtRiskHigh,
      }
    : null;
  if (dataGap) industryName = dataGap.industryName;

  // WAF posture (latest assessment for this owner, best-effort).
  let waf: EstateSynthesisInput["waf"] = null;
  try {
    const latestWaf = await withPrisma((prisma) =>
      prisma.forgeWafAssessment.findFirst({
        where: { ownerEmail },
        orderBy: { createdAt: "desc" },
        select: { overallScore: true },
      }),
    );
    if (latestWaf && typeof latestWaf.overallScore === "number") {
      waf = {
        overallScore: Math.round(latestWaf.overallScore * (latestWaf.overallScore <= 1 ? 100 : 1)),
      };
    }
  } catch {
    /* WAF optional */
  }

  return {
    scanId,
    ucPath: scan.ucPath,
    industryId,
    industryName,
    tables,
    insights,
    readinessScore,
    analyticsMaturityScore,
    dataGap,
    waf,
    costWasteUsd: null,
  };
}

/**
 * Build an EstateSynthesisInput for an ENTIRE estate program by aggregating the
 * merged world model across ALL completed member scans (latest-per-table +
 * type-aware insight merge — see getAggregateForExcel / insight-merge). This is
 * the production estate-level synthesis input; it never relies on a single
 * diagnosis/latest scan. Returns null when the program has no completed scans.
 */
export async function buildSynthesisInputForProgram(
  programId: string,
  ownerEmail: string,
  opts: { industryId?: string | null } = {},
): Promise<EstateSynthesisInput | null> {
  const program = await withPrisma((prisma) =>
    prisma.forgeEstateProgram.findUnique({
      where: { id: programId },
      select: { name: true, industryId: true },
    }),
  );
  if (!program) return null;

  const aggregate = await getAggregateForExcel(programId);
  if (!aggregate || aggregate.details.length === 0) return null;

  const historyByFqn = new Map(aggregate.histories.map((h) => [h.tableFqn, h]));

  const tables: SynthTable[] = aggregate.details.map((d) => {
    const h = historyByFqn.get(d.tableFqn);
    return {
      fqn: d.tableFqn,
      dataDomain: d.dataDomain,
      dataTier: d.dataTier,
      comment: d.comment,
      generatedDescription: d.generatedDescription,
      governanceScore: d.governanceScore,
      sensitivityLevel: d.sensitivityLevel,
      owner: d.owner,
      lastWriteAt: h?.lastWriteTimestamp ?? d.lastModified ?? null,
      healthScore: h?.healthScore ?? null,
    };
  });

  const insights: SynthInsight[] = aggregate.insights.map((i) => ({
    insightType: i.insightType,
    tableFqn: i.tableFqn,
    payloadJson: i.payloadJson,
    severity: i.severity,
  }));

  let analyticsMaturityScore: number | null = null;
  const maturityInsight = insights.find((i) => i.insightType === "analytics_maturity");
  if (maturityInsight) {
    try {
      const payload = JSON.parse(maturityInsight.payloadJson) as { overallScore?: number };
      analyticsMaturityScore = payload.overallScore ?? null;
    } catch {
      /* ignore */
    }
  }

  const industryId = opts.industryId ?? program.industryId ?? null;

  // WAF posture (latest assessment for the estate's root owner, best-effort).
  let waf: EstateSynthesisInput["waf"] = null;
  try {
    const latestWaf = await withPrisma((prisma) =>
      prisma.forgeWafAssessment.findFirst({
        where: { ownerEmail },
        orderBy: { createdAt: "desc" },
        select: { overallScore: true },
      }),
    );
    if (latestWaf && typeof latestWaf.overallScore === "number") {
      waf = {
        overallScore: Math.round(latestWaf.overallScore * (latestWaf.overallScore <= 1 ? 100 : 1)),
      };
    }
  } catch {
    /* WAF optional */
  }

  return {
    scanId: `program:${programId}`,
    ucPath: program.name,
    industryId,
    industryName: null,
    tables,
    insights,
    readinessScore: null,
    analyticsMaturityScore,
    dataGap: null,
    waf,
    costWasteUsd: null,
  };
}
