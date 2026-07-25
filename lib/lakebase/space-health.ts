/**
 * CRUD operations for Genie Space Health Scores, Benchmark Runs,
 * and Health Check Config -- backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
  SpaceHealthReport,
  UserCheckOverride,
  UserCustomCheck,
} from "@/lib/genie/health-checks/types";

// ---------------------------------------------------------------------------
// Health Scores
// ---------------------------------------------------------------------------

export async function saveHealthScore(
  spaceId: string,
  report: SpaceHealthReport,
  triggeredBy: "manual" | "post_fix" | "post_benchmark" = "manual",
): Promise<string> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeSpaceHealthScore.create({
      data: {
        spaceId,
        score: report.overallScore,
        grade: report.grade,
        checksJson: JSON.stringify(report.checks),
        triggeredBy,
      },
    });
    logger.info("Health score saved", { spaceId, score: report.overallScore, grade: report.grade });
    return row.id;
  });
}

export async function getHealthScoreHistory(spaceId: string, limit = 20) {
  return withPrisma(async (prisma) => {
    return prisma.forgeSpaceHealthScore.findMany({
      where: { spaceId },
      orderBy: { measuredAt: "desc" },
      take: limit,
    });
  });
}

export async function getLatestHealthScore(spaceId: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeSpaceHealthScore.findFirst({
      where: { spaceId },
      orderBy: { measuredAt: "desc" },
    });
  });
}

// ---------------------------------------------------------------------------
// Benchmark Runs
// ---------------------------------------------------------------------------

export interface BenchmarkRunInput {
  spaceId: string;
  evalRunId: string;
  status: string;
  numQuestions: number;
  numCorrect: number;
  numNeedsReview: number;
  accuracy: number;
  resultsJson: string;
}

export async function saveBenchmarkRun(input: BenchmarkRunInput): Promise<string> {
  return withPrisma(async (prisma) => {
    const existing = await prisma.forgeSpaceBenchmarkRun.findFirst({
      where: { evalRunId: input.evalRunId },
    });
    if (existing) return existing.id;

    const row = await prisma.forgeSpaceBenchmarkRun.create({
      data: {
        spaceId: input.spaceId,
        evalRunId: input.evalRunId,
        status: input.status,
        numQuestions: input.numQuestions,
        numCorrect: input.numCorrect,
        numNeedsReview: input.numNeedsReview,
        accuracy: input.accuracy,
        resultsJson: input.resultsJson,
      },
    });
    logger.info("Benchmark run saved", {
      spaceId: input.spaceId,
      evalRunId: input.evalRunId,
      accuracy: input.accuracy,
      numQuestions: input.numQuestions,
    });
    return row.id;
  });
}

export async function getBenchmarkRun(runId: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeSpaceBenchmarkRun.findUnique({ where: { id: runId } });
  });
}

export async function getBenchmarkHistory(spaceId: string, limit = 20) {
  return withPrisma(async (prisma) => {
    return prisma.forgeSpaceBenchmarkRun.findMany({
      where: { spaceId },
      orderBy: { runAt: "desc" },
      take: limit,
    });
  });
}

export async function updateBenchmarkFeedback(runId: string, feedbackJson: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeSpaceBenchmarkRun.update({
      where: { id: runId },
      data: { feedbackJson },
    });
  });
}

export async function markBenchmarkImprovementsApplied(runId: string, summary: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeSpaceBenchmarkRun.update({
      where: { id: runId },
      data: { improvementsApplied: true, improvementSummary: summary },
    });
  });
}

// ---------------------------------------------------------------------------
// Health Check Config (singleton)
// ---------------------------------------------------------------------------

export interface HealthCheckConfig {
  overrides: UserCheckOverride[];
  customChecks: UserCustomCheck[];
  categoryWeights: Record<string, number> | null;
}

export async function getHealthCheckConfig(): Promise<HealthCheckConfig> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeHealthCheckConfig.findUnique({ where: { id: "singleton" } });
    if (!row) {
      return { overrides: [], customChecks: [], categoryWeights: null };
    }
    return {
      overrides: row.overridesJson ? JSON.parse(row.overridesJson) : [],
      customChecks: row.customChecksJson ? JSON.parse(row.customChecksJson) : [],
      categoryWeights: row.categoryWeightsJson ? JSON.parse(row.categoryWeightsJson) : null,
    };
  });
}

export async function saveHealthCheckConfig(config: HealthCheckConfig) {
  return withPrisma(async (prisma) => {
    await prisma.forgeHealthCheckConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        overridesJson: JSON.stringify(config.overrides),
        customChecksJson: JSON.stringify(config.customChecks),
        categoryWeightsJson: config.categoryWeights ? JSON.stringify(config.categoryWeights) : null,
      },
      update: {
        overridesJson: JSON.stringify(config.overrides),
        customChecksJson: JSON.stringify(config.customChecks),
        categoryWeightsJson: config.categoryWeights ? JSON.stringify(config.categoryWeights) : null,
      },
    });
    logger.info("Health check config saved");
  });
}
