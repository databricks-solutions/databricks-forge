/**
 * Run comparison logic — compares two pipeline runs including prompt diffs,
 * outcome metrics, token usage, and use case alignment.
 */

import type { PipelineRun, UseCase } from "@/lib/domain/types";
import { getRunById } from "./runs";
import { getUseCasesByRunId } from "./usecases";
import { getPromptLogStats, getPromptLogsByRunId, type PromptLogEntry } from "./prompt-logs";
import { getPromptTemplatesBatch } from "./prompt-templates";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptDiff {
  promptKey: string;
  versionA: string;
  versionB: string;
  templateA: string | null;
  templateB: string | null;
}

export interface RunMetrics {
  useCaseCount: number;
  avgOverallScore: number;
  domains: string[];
  aiCount: number;
  statisticalCount: number;
  geospatialCount: number;
  sqlSuccessRate: number;
  totalTokens: number;
  totalDurationMs: number;
}

export interface UseCaseAlignmentEntry {
  nameA: string;
  nameB: string;
  scoreA: number;
  scoreB: number;
  domainA: string;
  domainB: string;
  similarity: number;
}

export interface StepMetrics {
  step: string;
  durationMsA: number | null;
  durationMsB: number | null;
  tokensA: number;
  tokensB: number;
  callsA: number;
  callsB: number;
  successRateA: number;
  successRateB: number;
}

export interface RunComparisonResult {
  runA: { run: PipelineRun; metrics: RunMetrics };
  runB: { run: PipelineRun; metrics: RunMetrics };
  promptDiffs: PromptDiff[];
  stepMetrics: StepMetrics[];
  useCaseAlignment: UseCaseAlignmentEntry[];
  overlap: {
    sharedCount: number;
    uniqueACount: number;
    uniqueBCount: number;
    sharedNames: string[];
  };
}

// ---------------------------------------------------------------------------
// Core comparison
// ---------------------------------------------------------------------------

export async function compareRuns(runAId: string, runBId: string): Promise<RunComparisonResult> {
  const [runA, runB] = await Promise.all([getRunById(runAId), getRunById(runBId)]);

  if (!runA || !runB) {
    throw new Error("One or both runs not found");
  }

  const [useCasesA, useCasesB, statsA, statsB, logsA, logsB] = await Promise.all([
    getUseCasesByRunId(runAId),
    getUseCasesByRunId(runBId),
    getPromptLogStats(runAId).catch((e) => {
      logger.debug("[run-comparison] Failed to get prompt log stats", {
        runId: runAId,
        error: String(e),
      });
      return null;
    }),
    getPromptLogStats(runBId).catch((e) => {
      logger.debug("[run-comparison] Failed to get prompt log stats", {
        runId: runBId,
        error: String(e),
      });
      return null;
    }),
    getPromptLogsByRunId(runAId).catch((e) => {
      logger.debug("[run-comparison] Failed to get prompt logs", {
        runId: runAId,
        error: String(e),
      });
      return [];
    }),
    getPromptLogsByRunId(runBId).catch((e) => {
      logger.debug("[run-comparison] Failed to get prompt logs", {
        runId: runBId,
        error: String(e),
      });
      return [];
    }),
  ]);

  const metricsA = buildMetrics(useCasesA, statsA);
  const metricsB = buildMetrics(useCasesB, statsB);

  const promptDiffs = await buildPromptDiffs(runA.promptVersions, runB.promptVersions);

  const stepMetrics = buildStepMetrics(runA, runB, logsA, logsB);
  const overlap = computeOverlap(useCasesA, useCasesB);
  const useCaseAlignment = computeAlignment(useCasesA, useCasesB);

  return {
    runA: { run: runA, metrics: metricsA },
    runB: { run: runB, metrics: metricsB },
    promptDiffs,
    stepMetrics,
    useCaseAlignment,
    overlap,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetrics(
  useCases: UseCase[],
  stats: Awaited<ReturnType<typeof getPromptLogStats>> | null,
): RunMetrics {
  const avgOverallScore =
    useCases.length > 0 ? useCases.reduce((s, uc) => s + uc.overallScore, 0) / useCases.length : 0;

  const withSql = useCases.filter((uc) => uc.sqlCode);
  const sqlSuccessRate =
    withSql.length > 0
      ? withSql.filter((uc) => uc.sqlStatus === "generated").length / withSql.length
      : 0;

  return {
    useCaseCount: useCases.length,
    avgOverallScore: Math.round(avgOverallScore * 100),
    domains: [...new Set(useCases.map((uc) => uc.domain))],
    aiCount: useCases.filter((uc) => uc.type === "AI").length,
    statisticalCount: useCases.filter((uc) => uc.type === "Statistical").length,
    geospatialCount: useCases.filter((uc) => uc.type === "Geospatial").length,
    sqlSuccessRate: Math.round(sqlSuccessRate * 100),
    totalTokens: stats?.totalTokens ?? 0,
    totalDurationMs: stats?.totalDurationMs ?? 0,
  };
}

function buildStepMetrics(
  runA: PipelineRun,
  runB: PipelineRun,
  logsA: PromptLogEntry[],
  logsB: PromptLogEntry[],
): StepMetrics[] {
  const allSteps = new Set([
    ...runA.stepLog.map((s) => s.step),
    ...runB.stepLog.map((s) => s.step),
  ]);

  const groupByStep = (logs: PromptLogEntry[]) => {
    const map = new Map<string, PromptLogEntry[]>();
    for (const log of logs) {
      const existing = map.get(log.step) ?? [];
      existing.push(log);
      map.set(log.step, existing);
    }
    return map;
  };

  const logMapA = groupByStep(logsA);
  const logMapB = groupByStep(logsB);
  const stepMapA = new Map(runA.stepLog.map((s) => [s.step, s]));
  const stepMapB = new Map(runB.stepLog.map((s) => [s.step, s]));

  const result: StepMetrics[] = [];

  for (const step of allSteps) {
    const entryA = stepMapA.get(step);
    const entryB = stepMapB.get(step);
    const stepLogsA = logMapA.get(step) ?? [];
    const stepLogsB = logMapB.get(step) ?? [];

    const tokensA = stepLogsA.reduce((s, l) => s + (l.tokenUsage?.totalTokens ?? 0), 0);
    const tokensB = stepLogsB.reduce((s, l) => s + (l.tokenUsage?.totalTokens ?? 0), 0);
    const successRateA =
      stepLogsA.length > 0
        ? Math.round((stepLogsA.filter((l) => l.success).length / stepLogsA.length) * 100)
        : 100;
    const successRateB =
      stepLogsB.length > 0
        ? Math.round((stepLogsB.filter((l) => l.success).length / stepLogsB.length) * 100)
        : 100;

    result.push({
      step,
      durationMsA: entryA?.durationMs ?? null,
      durationMsB: entryB?.durationMs ?? null,
      tokensA,
      tokensB,
      callsA: stepLogsA.length,
      callsB: stepLogsB.length,
      successRateA,
      successRateB,
    });
  }

  return result;
}

async function buildPromptDiffs(
  versionsA: Record<string, string> | null,
  versionsB: Record<string, string> | null,
): Promise<PromptDiff[]> {
  if (!versionsA || !versionsB) return [];

  const allKeys = new Set([...Object.keys(versionsA), ...Object.keys(versionsB)]);

  const changedKeys: PromptDiff[] = [];
  const hashesToFetch = new Set<string>();

  for (const key of allKeys) {
    const hashA = versionsA[key] ?? "";
    const hashB = versionsB[key] ?? "";
    if (hashA !== hashB) {
      if (hashA) hashesToFetch.add(hashA);
      if (hashB) hashesToFetch.add(hashB);
      changedKeys.push({
        promptKey: key,
        versionA: hashA,
        versionB: hashB,
        templateA: null,
        templateB: null,
      });
    }
  }

  if (changedKeys.length === 0) return [];

  const templates = await getPromptTemplatesBatch([...hashesToFetch]);

  for (const diff of changedKeys) {
    diff.templateA = templates.get(diff.versionA)?.templateText ?? null;
    diff.templateB = templates.get(diff.versionB)?.templateText ?? null;
  }

  return changedKeys;
}

function computeOverlap(
  useCasesA: UseCase[],
  useCasesB: UseCase[],
): RunComparisonResult["overlap"] {
  const namesA = new Set(useCasesA.map((uc) => uc.name.toLowerCase()));
  const namesB = new Set(useCasesB.map((uc) => uc.name.toLowerCase()));
  const shared = [...namesA].filter((n) => namesB.has(n));
  const uniqueA = [...namesA].filter((n) => !namesB.has(n));
  const uniqueB = [...namesB].filter((n) => !namesA.has(n));

  return {
    sharedCount: shared.length,
    uniqueACount: uniqueA.length,
    uniqueBCount: uniqueB.length,
    sharedNames: shared.slice(0, 30),
  };
}

/**
 * Fuzzy alignment of use cases between two runs. Matches by normalised name
 * overlap (Jaccard on words). Only pairs with similarity >= 0.3 are returned.
 */
function computeAlignment(useCasesA: UseCase[], useCasesB: UseCase[]): UseCaseAlignmentEntry[] {
  const tokenise = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

  const tokensA = useCasesA.map((uc) => ({ uc, tokens: tokenise(uc.name) }));
  const tokensB = useCasesB.map((uc) => ({ uc, tokens: tokenise(uc.name) }));

  const alignment: UseCaseAlignmentEntry[] = [];
  const usedB = new Set<number>();

  for (const { uc: ucA, tokens: tA } of tokensA) {
    let bestIdx = -1;
    let bestSim = 0;

    for (let j = 0; j < tokensB.length; j++) {
      if (usedB.has(j)) continue;
      const tB = tokensB[j].tokens;
      const intersection = [...tA].filter((w) => tB.has(w)).length;
      const union = new Set([...tA, ...tB]).size;
      const sim = union > 0 ? intersection / union : 0;
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0 && bestSim >= 0.3) {
      const ucB = tokensB[bestIdx].uc;
      usedB.add(bestIdx);
      alignment.push({
        nameA: ucA.name,
        nameB: ucB.name,
        scoreA: Math.round(ucA.overallScore * 100),
        scoreB: Math.round(ucB.overallScore * 100),
        domainA: ucA.domain,
        domainB: ucB.domain,
        similarity: Math.round(bestSim * 100),
      });
    }
  }

  return alignment.sort((a, b) => b.similarity - a.similarity);
}
