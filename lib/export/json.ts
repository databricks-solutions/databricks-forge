/**
 * JSON export generator for use cases with run metadata.
 */

import type { ConsultingScorecard, PipelineRun, ScoreRationale, UseCase } from "@/lib/domain/types";

interface ExportJson {
  exportedAt: string;
  appVersion: string | null;
  run: {
    runId: string;
    businessName: string;
    ucMetadata: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    discoveryDepth: string;
    industry: string;
    totalUseCases: number;
    totalDomains: number;
  };
  useCases: Array<{
    id: string;
    useCaseNo: number;
    name: string;
    type: string;
    domain: string;
    subdomain: string;
    analyticsTechnique: string;
    statement: string;
    solution: string;
    businessValue: string;
    beneficiary: string;
    sponsor: string;
    tablesInvolved: string[];
    scores: {
      priority: number;
      feasibility: number;
      impact: number;
      overall: number;
    };
    userScores: {
      priority: number | null;
      feasibility: number | null;
      impact: number | null;
      overall: number | null;
    };
    scoreRationale: ScoreRationale | null;
    consultingScorecard: ConsultingScorecard | null;
    enrichmentTags: string[] | null;
    sqlStatus: string | null;
    feedback: string | null;
  }>;
}

export function generateJson(run: PipelineRun, useCases: UseCase[]): Buffer {
  const domains = new Set(useCases.map((uc) => uc.domain));

  const payload: ExportJson = {
    exportedAt: new Date().toISOString(),
    appVersion: run.appVersion ?? null,
    run: {
      runId: run.runId,
      businessName: run.config.businessName,
      ucMetadata: run.config.ucMetadata,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      discoveryDepth: run.config.discoveryDepth ?? "balanced",
      industry: run.config.industry ?? "",
      totalUseCases: useCases.length,
      totalDomains: domains.size,
    },
    useCases: useCases.map((uc) => ({
      id: uc.id,
      useCaseNo: uc.useCaseNo,
      name: uc.name,
      type: uc.type,
      domain: uc.domain,
      subdomain: uc.subdomain,
      analyticsTechnique: uc.analyticsTechnique,
      statement: uc.statement,
      solution: uc.solution,
      businessValue: uc.businessValue,
      beneficiary: uc.beneficiary,
      sponsor: uc.sponsor,
      tablesInvolved: uc.tablesInvolved,
      scores: {
        priority: uc.priorityScore,
        feasibility: uc.feasibilityScore,
        impact: uc.impactScore,
        overall: uc.overallScore,
      },
      userScores: {
        priority: uc.userPriorityScore,
        feasibility: uc.userFeasibilityScore,
        impact: uc.userImpactScore,
        overall: uc.userOverallScore,
      },
      scoreRationale: uc.scoreRationale ?? null,
      consultingScorecard: uc.consultingScorecard ?? null,
      enrichmentTags: uc.enrichmentTags ?? null,
      sqlStatus: uc.sqlStatus,
      feedback: uc.feedback,
    })),
  };

  return Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
}
