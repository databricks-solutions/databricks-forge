/**
 * Auto-Improve Loop -- iteratively runs eval benchmarks, categorizes failures,
 * applies targeted fixes, and re-benchmarks until a target score is reached
 * or max iterations are exhausted.
 *
 * Supports a three-space architecture for safe iteration:
 *   - Production: the original space, never modified during improvement
 *   - Dev-Best: the best configuration discovered so far (rollback target)
 *   - Dev-Working: where changes are tested before promotion
 *
 * On improvement: dev-working -> dev-best.
 * On regression: dev-best -> dev-working (rollback).
 * On completion: dev-best is promoted (caller handles final publish).
 */

import { runEval, type EvalRunResult, type RunEvalOptions } from "./benchmark-runner";
import { analyzeFeedbackForFixes, type FeedbackEntry } from "./benchmark-feedback";
import {
  getGenieSpace,
  createGenieSpace,
  updateGenieSpace,
  trashGenieSpace,
} from "@/lib/dbx/genie";
import { logger } from "@/lib/logger";
import type { GenieEvalAssessment } from "./eval-types";
import {
  runThreeGateEval,
  pickHardestQuestionIds,
  type ThreeGateOutcome,
} from "./three-gate-eval";
import {
  computePatchSignature,
  filterCandidatesByDoa,
  loadDoaBuffer,
  recordDoa,
} from "./doa-buffer";
import { scoreAnswerBatch, isMultiAxisJudgingEnabled } from "./multi-axis-judges";
import { recordAutoImproveIteration } from "@/lib/lakebase/auto-improve";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoImproveConfig {
  spaceId: string;
  targetScore: number;
  maxIterations: number;
  evalOptions?: RunEvalOptions;
  /** Milliseconds to wait after updating a space before re-scoring (default 30000). */
  indexingWaitMs?: number;
  /** Enable three-space architecture for safe rollback (default true). */
  enableThreeSpace?: boolean;
  /** OBO token captured at request time for background Genie API calls. */
  oboToken?: string;
  /**
   * Enable the three-gate eval (slice -> P0 -> full). Default ON. Set to
   * false for legacy single-shot eval behaviour.
   */
  enableThreeGateEval?: boolean;
  /**
   * Enable the multi-axis judge panel for iteration scoring. Defaults to
   * `isMultiAxisJudgingEnabled()` -- only runs when a review endpoint is
   * configured. The aggregate score is persisted on the iteration row.
   */
  enableMultiAxisJudges?: boolean;
  /**
   * Persist iteration history + DOA signatures to Lakebase. Default ON.
   * Disable for ad-hoc one-shot improvements where history isn't needed.
   */
  persistHistory?: boolean;
  /**
   * Stable session identifier for grouping iterations + DOA signatures.
   * Defaults to `auto-improve-${spaceId}-${startMs}` when absent.
   */
  sessionId?: string;
  /** Owner of the auto-improve session (used by Lakebase rows). */
  ownerEmail?: string | null;
}

export interface AutoImproveIteration {
  iteration: number;
  evalResult: EvalRunResult;
  passRate: number;
  fixCheckIds: string[];
  strategiesApplied: string[];
  durationMs: number;
  /** Slice-gate accuracy when the three-gate eval is enabled. */
  sliceScore?: number;
  /** P0-gate accuracy when the three-gate eval is enabled. */
  p0Score?: number;
  /** Multi-axis judge aggregate (0-100). */
  judgeAggregate?: number;
  /** Per-axis judge scores. */
  judgeByAxis?: Record<string, number>;
  /** Patches dropped because they were previously DOA. */
  patchesDropped?: number;
  /** True when the gate halted before the full eval ran. */
  gateAbandoned?: { gate: "slice" | "p0"; reason: string };
}

export interface AutoImproveResult {
  finalScore: number;
  targetReached: boolean;
  iterations: AutoImproveIteration[];
  totalDurationMs: number;
  stoppedReason: "target_reached" | "max_iterations" | "no_improvement" | "aborted";
  devSpaces?: ThreeSpaceIds;
}

export type AutoImproveProgressCallback = (event: {
  phase: "benchmark" | "analyze" | "fix" | "indexing" | "setup" | "cleanup" | "complete";
  iteration: number;
  maxIterations: number;
  passRate: number;
  targetScore: number;
  message: string;
}) => void;

// ---------------------------------------------------------------------------
// Three-Space Architecture
// ---------------------------------------------------------------------------

export interface ThreeSpaceIds {
  production: string;
  devBest: string;
  devWorking: string;
}

export async function createDevSpaces(
  productionSpaceId: string,
  oboToken?: string,
): Promise<ThreeSpaceIds> {
  const prod = await getGenieSpace(productionSpaceId);
  const title = prod.title ?? "Untitled";
  const serializedSpace = prod.serialized_space ?? "{}";
  const warehouseId = prod.warehouse_id ?? "";

  const devBest = await createGenieSpace({
    title: `[Dev-Best] ${title}`,
    description: `Auto-improve dev-best clone of ${productionSpaceId}`,
    serializedSpace,
    warehouseId,
    oboToken,
  });

  const devWorking = await createGenieSpace({
    title: `[Dev-Working] ${title}`,
    description: `Auto-improve dev-working clone of ${productionSpaceId}`,
    serializedSpace,
    warehouseId,
    oboToken,
  });

  logger.info("Three-space architecture initialized", {
    production: productionSpaceId,
    devBest: devBest.space_id,
    devWorking: devWorking.space_id,
  });

  return {
    production: productionSpaceId,
    devBest: devBest.space_id,
    devWorking: devWorking.space_id,
  };
}

async function promoteWorkingToBest(ids: ThreeSpaceIds): Promise<void> {
  const working = await getGenieSpace(ids.devWorking);
  await updateGenieSpace(ids.devBest, {
    serializedSpace: working.serialized_space ?? "{}",
  });
  logger.info("Promoted dev-working to dev-best", { devBest: ids.devBest });
}

async function rollbackWorkingFromBest(ids: ThreeSpaceIds): Promise<void> {
  const best = await getGenieSpace(ids.devBest);
  await updateGenieSpace(ids.devWorking, {
    serializedSpace: best.serialized_space ?? "{}",
  });
  logger.info("Rolled back dev-working from dev-best", { devWorking: ids.devWorking });
}

export async function cleanupDevSpaces(ids: ThreeSpaceIds): Promise<void> {
  const cleanup = async (spaceId: string, label: string) => {
    try {
      await trashGenieSpace(spaceId);
    } catch (err) {
      logger.warn(`Failed to trash ${label} space`, { spaceId, error: String(err) });
    }
  };
  await Promise.all([cleanup(ids.devWorking, "dev-working"), cleanup(ids.devBest, "dev-best")]);
  logger.info("Dev spaces cleaned up", { ...ids });
}

export async function getDevBestConfig(ids: ThreeSpaceIds): Promise<string> {
  const best = await getGenieSpace(ids.devBest);
  return best.serialized_space ?? "{}";
}

// ---------------------------------------------------------------------------
// Indexing Wait
// ---------------------------------------------------------------------------

const DEFAULT_INDEXING_WAIT_MS = 30_000;

async function waitForIndexing(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

export async function runAutoImproveLoop(
  config: AutoImproveConfig,
  applyFixes: (checkIds: string[], targetSpaceId?: string) => Promise<string[]>,
  onProgress?: AutoImproveProgressCallback,
  signal?: AbortSignal,
): Promise<AutoImproveResult> {
  const {
    spaceId,
    targetScore,
    maxIterations,
    evalOptions: rawEvalOptions,
    indexingWaitMs = DEFAULT_INDEXING_WAIT_MS,
    enableThreeSpace = true,
    oboToken,
    enableThreeGateEval = true,
    enableMultiAxisJudges = isMultiAxisJudgingEnabled(),
    persistHistory = true,
    ownerEmail,
  } = config;
  const evalOptions: RunEvalOptions = { ...rawEvalOptions, oboToken };
  const iterations: AutoImproveIteration[] = [];
  const startTime = Date.now();
  let previousPassRate = -1;
  let stagnationCount = 0;
  const MAX_STAGNATION = 2;

  // Stable session id for DOA buffer + Lakebase rows.
  const sessionId = config.sessionId ?? `auto-improve-${spaceId}-${startTime}`;

  // Hydrate DOA buffer once per session (best-effort).
  if (persistHistory) {
    try {
      await loadDoaBuffer(sessionId);
    } catch (err) {
      logger.warn("[auto-improve] failed to hydrate DOA buffer, starting fresh", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let devSpaces: ThreeSpaceIds | undefined;
  let benchmarkSpaceId = spaceId;
  let hardestQuestionIds: string[] = [];

  if (enableThreeSpace) {
    onProgress?.({
      phase: "setup",
      iteration: 0,
      maxIterations,
      passRate: 0,
      targetScore,
      message: "Creating dev spaces for safe iteration...",
    });

    try {
      devSpaces = await createDevSpaces(spaceId, oboToken);
      benchmarkSpaceId = devSpaces.devWorking;
    } catch (err) {
      logger.warn("Three-space setup failed, falling back to in-place improvement", {
        error: String(err),
      });
      devSpaces = undefined;
      benchmarkSpaceId = spaceId;
    }
  }

  logger.info("Auto-improve loop starting", {
    spaceId,
    benchmarkSpaceId,
    targetScore,
    maxIterations,
    threeSpaceEnabled: !!devSpaces,
    indexingWaitMs,
  });

  const buildResult = (stoppedReason: AutoImproveResult["stoppedReason"]): AutoImproveResult => ({
    finalScore: iterations.length > 0 ? iterations[iterations.length - 1].passRate : 0,
    targetReached: stoppedReason === "target_reached",
    iterations,
    totalDurationMs: Date.now() - startTime,
    stoppedReason,
    devSpaces,
  });

  for (let i = 1; i <= maxIterations; i++) {
    if (signal?.aborted) return buildResult("aborted");

    const iterStart = Date.now();

    onProgress?.({
      phase: "benchmark",
      iteration: i,
      maxIterations,
      passRate: previousPassRate >= 0 ? previousPassRate : 0,
      targetScore,
      message: enableThreeGateEval
        ? `Running three-gate eval (iteration ${i}/${maxIterations})...`
        : `Running eval benchmarks (iteration ${i}/${maxIterations})...`,
    });

    // -------------------- Eval (three-gate or single-shot) --------------------
    let evalResult: EvalRunResult;
    let sliceScore: number | undefined;
    let p0Score: number | undefined;
    let gateAbandoned: AutoImproveIteration["gateAbandoned"];

    if (enableThreeGateEval) {
      const allQuestionIds = collectQuestionIds(evalOptions, hardestQuestionIds);
      const outcome: ThreeGateOutcome = await runThreeGateEval({
        spaceId: benchmarkSpaceId,
        evalOptions,
        allQuestionIds,
        hardestQuestionIds,
      });
      if (outcome.status === "abandoned") {
        const gateResult = outcome.gate === "slice" ? outcome.sliceResult : outcome.p0Result;
        evalResult = gateResult ?? emptyEval(benchmarkSpaceId);
        sliceScore = outcome.sliceResult?.accuracy;
        p0Score = outcome.p0Result?.accuracy;
        gateAbandoned = { gate: outcome.gate, reason: outcome.reason };
        logger.warn("[auto-improve] three-gate abandoned iteration", {
          iteration: i,
          gate: outcome.gate,
          reason: outcome.reason,
        });
      } else {
        evalResult = outcome.fullResult;
        sliceScore = outcome.sliceResult.accuracy;
        p0Score = outcome.p0Result?.accuracy;
      }
    } else {
      evalResult = await runEval(benchmarkSpaceId, evalOptions);
    }
    const passRate = evalResult.accuracy;

    // -------------------- Multi-axis judges --------------------
    let judgeAggregate: number | undefined;
    let judgeByAxis: Record<string, number> | undefined;
    if (enableMultiAxisJudges && evalResult.results.length > 0 && !gateAbandoned) {
      try {
        const sample = evalResult.results.slice(0, 20).map((r) => ({
          question: r.question,
          expectedSql: r.expectedSql,
          actualSql: r.actualSql,
        }));
        const judgeResult = await scoreAnswerBatch(sample);
        judgeAggregate = judgeResult.aggregate;
        judgeByAxis = judgeResult.byJudge;
      } catch (err) {
        logger.warn("[auto-improve] multi-axis judge scoring failed", {
          iteration: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Refresh the "hardest" set for next iteration's P0 gate.
    hardestQuestionIds = pickHardestQuestionIds(evalResult, 10);

    logger.info("Auto-improve eval run", {
      iteration: i,
      passRate,
      sliceScore,
      p0Score,
      judgeAggregate,
      numCorrect: evalResult.numCorrect,
      numQuestions: evalResult.numQuestions,
      gateAbandoned: gateAbandoned?.gate,
    });

    if (passRate >= targetScore) {
      if (devSpaces && passRate > (previousPassRate >= 0 ? previousPassRate : -1)) {
        await promoteWorkingToBest(devSpaces);
      }
      const completeIter: AutoImproveIteration = {
        iteration: i,
        evalResult,
        passRate,
        fixCheckIds: [],
        strategiesApplied: [],
        durationMs: Date.now() - iterStart,
        sliceScore,
        p0Score,
        judgeAggregate,
        judgeByAxis,
        gateAbandoned,
      };
      iterations.push(completeIter);
      await maybePersistIteration({
        persistHistory,
        sessionId,
        ownerEmail,
        workingSpaceId: benchmarkSpaceId,
        bestSpaceId: devSpaces?.devBest,
        iter: completeIter,
        reasonStopped: "target_reached",
      });

      onProgress?.({
        phase: "complete",
        iteration: i,
        maxIterations,
        passRate,
        targetScore,
        message: `Target score reached! ${passRate}% >= ${targetScore}%`,
      });

      return buildResult("target_reached");
    }

    // Track patches applied by *previous* iteration that may have caused a
    // regression -- mark them DOA so they aren't reattempted.
    if (previousPassRate >= 0 && passRate < previousPassRate && persistHistory) {
      const lastIter = iterations[iterations.length - 1];
      if (lastIter && lastIter.fixCheckIds.length > 0) {
        for (const checkId of lastIter.fixCheckIds) {
          const sig = computePatchSignature({
            strategy: lastIter.strategiesApplied.find((s) => s) ?? checkId,
            targetFieldPath: checkId,
            delta: { iteration: lastIter.iteration },
          });
          await recordDoa({
            sessionId,
            signature: sig,
            strategy: lastIter.strategiesApplied[0],
            reason: `regression_iter_${i}_passRate_${previousPassRate}_to_${passRate}`,
            ownerEmail,
          });
        }
        logger.info("[auto-improve] recorded DOA signatures for regressing patches", {
          sessionId,
          regressingIteration: lastIter.iteration,
          checkIds: lastIter.fixCheckIds,
        });
      }
    }

    if (previousPassRate >= 0 && passRate <= previousPassRate) {
      stagnationCount++;

      if (devSpaces && passRate < previousPassRate) {
        await rollbackWorkingFromBest(devSpaces);
        logger.info("Regression detected, rolled back to dev-best", {
          iteration: i,
          passRate,
          previousPassRate,
        });
      }

      if (stagnationCount >= MAX_STAGNATION) {
        const stallIter: AutoImproveIteration = {
          iteration: i,
          evalResult,
          passRate,
          fixCheckIds: [],
          strategiesApplied: [],
          durationMs: Date.now() - iterStart,
          sliceScore,
          p0Score,
          judgeAggregate,
          judgeByAxis,
          gateAbandoned,
        };
        iterations.push(stallIter);
        await maybePersistIteration({
          persistHistory,
          sessionId,
          ownerEmail,
          workingSpaceId: benchmarkSpaceId,
          bestSpaceId: devSpaces?.devBest,
          iter: stallIter,
          reasonStopped: "no_improvement",
        });

        onProgress?.({
          phase: "complete",
          iteration: i,
          maxIterations,
          passRate,
          targetScore,
          message: `No improvement after ${MAX_STAGNATION} iterations. Stopping at ${passRate}%.`,
        });

        return buildResult("no_improvement");
      }
    } else {
      if (devSpaces && previousPassRate >= 0) {
        await promoteWorkingToBest(devSpaces);
      }
      stagnationCount = 0;
    }
    previousPassRate = passRate;

    if (i === maxIterations) {
      const finalIter: AutoImproveIteration = {
        iteration: i,
        evalResult,
        passRate,
        fixCheckIds: [],
        strategiesApplied: [],
        durationMs: Date.now() - iterStart,
        sliceScore,
        p0Score,
        judgeAggregate,
        judgeByAxis,
        gateAbandoned,
      };
      iterations.push(finalIter);
      await maybePersistIteration({
        persistHistory,
        sessionId,
        ownerEmail,
        workingSpaceId: benchmarkSpaceId,
        bestSpaceId: devSpaces?.devBest,
        iter: finalIter,
        reasonStopped: "max_iterations",
      });
      break;
    }

    onProgress?.({
      phase: "analyze",
      iteration: i,
      maxIterations,
      passRate,
      targetScore,
      message: `Analyzing ${evalResult.results.filter((r) => r.assessment !== "GOOD").length} failures and planning fixes...`,
    });

    const feedbackEntries: FeedbackEntry[] = evalResult.results.map((r) => ({
      question: r.question,
      assessment: r.assessment as GenieEvalAssessment,
      assessmentReasons: r.assessmentReasons,
    }));

    const allCheckIds = analyzeFeedbackForFixes(feedbackEntries);

    // Drop any candidate patch already in this session's DOA buffer.
    let patchesDropped = 0;
    let checkIds = allCheckIds;
    if (allCheckIds.length > 0 && persistHistory) {
      const candidates = allCheckIds.map((id) => ({
        checkId: id,
        signature: computePatchSignature({
          strategy: id,
          targetFieldPath: id,
          delta: { iteration: i },
        }),
      }));
      const { kept, dropped } = filterCandidatesByDoa(sessionId, candidates);
      patchesDropped = dropped.length;
      checkIds = kept.map((c) => c.checkId);
      if (dropped.length > 0) {
        logger.info("[auto-improve] DOA buffer filtered patches", {
          iteration: i,
          dropped: dropped.length,
          kept: kept.length,
        });
      }
    }

    if (checkIds.length === 0) {
      const noFixIter: AutoImproveIteration = {
        iteration: i,
        evalResult,
        passRate,
        fixCheckIds: [],
        strategiesApplied: [],
        durationMs: Date.now() - iterStart,
        sliceScore,
        p0Score,
        judgeAggregate,
        judgeByAxis,
        patchesDropped,
        gateAbandoned,
      };
      iterations.push(noFixIter);
      await maybePersistIteration({
        persistHistory,
        sessionId,
        ownerEmail,
        workingSpaceId: benchmarkSpaceId,
        bestSpaceId: devSpaces?.devBest,
        iter: noFixIter,
        reasonStopped: patchesDropped > 0 ? "all_patches_doa" : "no_actionable_failures",
      });
      break;
    }

    onProgress?.({
      phase: "fix",
      iteration: i,
      maxIterations,
      passRate,
      targetScore,
      message: `Applying ${checkIds.length} fix strategies...`,
    });

    const strategiesApplied = await applyFixes(checkIds, benchmarkSpaceId);

    if (indexingWaitMs > 0 && i < maxIterations) {
      onProgress?.({
        phase: "indexing",
        iteration: i,
        maxIterations,
        passRate,
        targetScore,
        message: `Waiting ${Math.round(indexingWaitMs / 1000)}s for Genie indexing...`,
      });
      await waitForIndexing(indexingWaitMs, signal);
    }

    const iteration: AutoImproveIteration = {
      iteration: i,
      evalResult,
      passRate,
      fixCheckIds: checkIds,
      strategiesApplied,
      durationMs: Date.now() - iterStart,
      sliceScore,
      p0Score,
      judgeAggregate,
      judgeByAxis,
      patchesDropped,
      gateAbandoned,
    };
    iterations.push(iteration);
    await maybePersistIteration({
      persistHistory,
      sessionId,
      ownerEmail,
      workingSpaceId: benchmarkSpaceId,
      bestSpaceId: devSpaces?.devBest,
      iter: iteration,
      reasonStopped: null,
    });

    logger.info("Auto-improve iteration complete", {
      iteration: i,
      passRate,
      checkIds,
      strategiesApplied,
      patchesDropped,
      durationMs: iteration.durationMs,
    });
  }

  const finalScore = iterations.length > 0 ? iterations[iterations.length - 1].passRate : 0;

  onProgress?.({
    phase: "complete",
    iteration: maxIterations,
    maxIterations,
    passRate: finalScore,
    targetScore,
    message: `Max iterations reached. Final score: ${finalScore}%.`,
  });

  return buildResult("max_iterations");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect the question-id universe used by `runThreeGateEval` to sample its
 * slice. We prefer caller-supplied `evalOptions.questionIds`, falling back
 * to the previous iteration's `hardestQuestionIds`. When neither is
 * available the slice will be empty and the gate degrades to "always pass".
 */
function collectQuestionIds(
  evalOptions: RunEvalOptions,
  hardest: ReadonlyArray<string>,
): string[] {
  if (evalOptions.questionIds && evalOptions.questionIds.length > 0) {
    return [...evalOptions.questionIds];
  }
  return [...hardest];
}

/** Build a placeholder EvalRunResult when a gate abandons before any results. */
function emptyEval(spaceId: string): EvalRunResult {
  return {
    evalRunId: "abandoned",
    spaceId,
    status: "EVALUATION_FAILED",
    numQuestions: 0,
    numDone: 0,
    numCorrect: 0,
    numNeedsReview: 0,
    accuracy: 0,
    results: [],
  };
}

/**
 * Persist a single iteration to Lakebase when `persistHistory` is enabled.
 * Best-effort -- failures are logged inside `recordAutoImproveIteration`.
 */
async function maybePersistIteration(opts: {
  persistHistory: boolean;
  sessionId: string;
  ownerEmail?: string | null;
  workingSpaceId: string;
  bestSpaceId?: string;
  iter: AutoImproveIteration;
  reasonStopped: string | null;
}): Promise<void> {
  if (!opts.persistHistory) return;
  await recordAutoImproveIteration({
    sessionId: opts.sessionId,
    iteration: opts.iter.iteration,
    ownerEmail: opts.ownerEmail ?? null,
    workingSpaceId: opts.workingSpaceId,
    bestSpaceId: opts.bestSpaceId ?? null,
    sliceScore: opts.iter.sliceScore ?? null,
    p0Score: opts.iter.p0Score ?? null,
    fullScore: opts.iter.passRate,
    judgeScores: opts.iter.judgeByAxis ?? null,
    patchesApplied: opts.iter.fixCheckIds.length > 0
      ? opts.iter.fixCheckIds.map((id, idx) => ({
          checkId: id,
          strategy: opts.iter.strategiesApplied[idx] ?? null,
        }))
      : null,
    patchesDropped: opts.iter.patchesDropped
      ? [{ count: opts.iter.patchesDropped }]
      : null,
    reasonStopped: opts.iter.gateAbandoned
      ? `gate:${opts.iter.gateAbandoned.gate}:${opts.iter.gateAbandoned.reason}`
      : opts.reasonStopped,
  });
}

// ---------------------------------------------------------------------------
// Sequential Fix Evaluation
// ---------------------------------------------------------------------------

export interface SequentialFixConfig {
  spaceId: string;
  checkIds: string[];
  evalOptions?: RunEvalOptions;
  indexingWaitMs?: number;
}

export interface SequentialFixResult {
  fixResults: Array<{
    checkId: string;
    applied: boolean;
    kept: boolean;
    passRateBefore: number;
    passRateAfter: number;
    reason: string;
  }>;
  finalPassRate: number;
  totalDurationMs: number;
}

export async function applyFixesSequentially(
  config: SequentialFixConfig,
  applyOneFix: (checkId: string, targetSpaceId: string) => Promise<string>,
  devSpaces: ThreeSpaceIds,
  onProgress?: AutoImproveProgressCallback,
  signal?: AbortSignal,
): Promise<SequentialFixResult> {
  const {
    checkIds,
    evalOptions,
    indexingWaitMs = DEFAULT_INDEXING_WAIT_MS,
  } = config;
  const startTime = Date.now();
  const fixResults: SequentialFixResult["fixResults"] = [];

  const initialResult = await runEval(devSpaces.devWorking, evalOptions);
  let currentPassRate = initialResult.accuracy;

  logger.info("Sequential fix evaluation starting", {
    checkIds,
    initialPassRate: currentPassRate,
    spaceId: devSpaces.devWorking,
  });

  for (let i = 0; i < checkIds.length; i++) {
    if (signal?.aborted) break;
    const checkId = checkIds[i];

    onProgress?.({
      phase: "fix",
      iteration: i + 1,
      maxIterations: checkIds.length,
      passRate: currentPassRate,
      targetScore: 100,
      message: `Applying fix ${i + 1}/${checkIds.length}: ${checkId}...`,
    });

    try {
      const strategy = await applyOneFix(checkId, devSpaces.devWorking);
      if (!strategy) {
        fixResults.push({
          checkId,
          applied: false,
          kept: false,
          passRateBefore: currentPassRate,
          passRateAfter: currentPassRate,
          reason: "No strategy matched",
        });
        continue;
      }

      if (indexingWaitMs > 0) {
        await waitForIndexing(indexingWaitMs, signal);
      }

      const evalResult = await runEval(devSpaces.devWorking, evalOptions);
      const newPassRate = evalResult.accuracy;

      if (newPassRate > currentPassRate) {
        await promoteWorkingToBest(devSpaces);
        fixResults.push({
          checkId,
          applied: true,
          kept: true,
          passRateBefore: currentPassRate,
          passRateAfter: newPassRate,
          reason: `Score improved: ${currentPassRate}% → ${newPassRate}%`,
        });
        currentPassRate = newPassRate;
      } else if (newPassRate < currentPassRate) {
        await rollbackWorkingFromBest(devSpaces);
        fixResults.push({
          checkId,
          applied: true,
          kept: false,
          passRateBefore: currentPassRate,
          passRateAfter: newPassRate,
          reason: `Score regressed: ${currentPassRate}% → ${newPassRate}%, rolled back`,
        });
      } else {
        fixResults.push({
          checkId,
          applied: true,
          kept: true,
          passRateBefore: currentPassRate,
          passRateAfter: newPassRate,
          reason: `Score unchanged at ${newPassRate}%`,
        });
      }
    } catch (err) {
      fixResults.push({
        checkId,
        applied: false,
        kept: false,
        passRateBefore: currentPassRate,
        passRateAfter: currentPassRate,
        reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    logger.info("Sequential fix result", {
      checkId,
      result: fixResults[fixResults.length - 1],
    });
  }

  return {
    fixResults,
    finalPassRate: currentPassRate,
    totalDurationMs: Date.now() - startTime,
  };
}
