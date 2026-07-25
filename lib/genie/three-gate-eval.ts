/**
 * Three-Gate Eval for the Auto-Improve Loop.
 *
 *   Slice (5)  ─pass→  P0 (top-10)  ─pass→  Full
 *      │ fail               │ fail
 *      ▼                    ▼
 *    abandon              abandon
 *
 * Goal: detect catastrophic / targeted regressions cheaply and abandon the
 * iteration before paying for the full benchmark suite. Mirrors upstream
 * `databricks-genie-workbench` GSO three-gate progression.
 *
 * Token / latency cost ~ 50–60% of running the full eval every iteration.
 */

import { runEval, type EvalRunResult, type RunEvalOptions } from "@/lib/genie/benchmark-runner";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreeGateOptions {
  spaceId: string;
  evalOptions?: RunEvalOptions;
  /** All known benchmark question IDs (used as the universe for sampling). */
  allQuestionIds: ReadonlyArray<string>;
  /**
   * The 10 hardest question IDs from the previous iteration (failed or
   * `NEEDS_REVIEW`). When empty, the P0 gate is skipped.
   */
  hardestQuestionIds: ReadonlyArray<string>;
  /** Slice size (default 5). */
  sliceSize?: number;
  /**
   * Failure-rate threshold for the slice gate. Iteration is abandoned when
   * pass rate < (1 - sliceFailThreshold). Default 0.4 (i.e. abandon when
   * ≥ 40% of slice questions fail).
   */
  sliceFailThreshold?: number;
}

export type ThreeGateOutcome =
  | { status: "abandoned"; gate: "slice" | "p0"; reason: string; sliceResult?: EvalRunResult; p0Result?: EvalRunResult }
  | { status: "complete"; sliceResult: EvalRunResult; p0Result?: EvalRunResult; fullResult: EvalRunResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleSlice(all: ReadonlyArray<string>, n: number): string[] {
  if (all.length <= n) return [...all];
  const shuffled = [...all];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

/**
 * Normalise `EvalRunResult.accuracy` (a 0-100 percentage produced by
 * `benchmark-runner`) to a 0-1 fraction so the gate thresholds
 * (`sliceFailThreshold` defaults to 0.4, P0 must be exactly 1) are
 * comparable. Codex caught the original code treating `accuracy` as a
 * fraction directly, which made the slice gate produce negative fail
 * rates and the P0 gate only fail at exactly 0%.
 */
function passRate(r: EvalRunResult): number {
  const raw = typeof r.accuracy === "number" ? r.accuracy : 0;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Tolerate either convention from upstream callers.
  const fraction = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, fraction));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the three-gate eval. Returns an outcome describing which gate passed
 * or failed. The full eval is only executed if both upstream gates pass.
 *
 * Defaults are conservative -- the slice is 5 random questions, the P0 is
 * the caller-supplied "hardest" list, and the full suite uses whatever
 * `evalOptions` (sans `questionIds`) the caller provides.
 */
export async function runThreeGateEval(opts: ThreeGateOptions): Promise<ThreeGateOutcome> {
  const sliceSize = opts.sliceSize ?? 5;
  const sliceFailThreshold = opts.sliceFailThreshold ?? 0.4;
  const baseOptions = opts.evalOptions ?? {};

  // -------------------- Gate 1: Slice --------------------
  const sliceIds = sampleSlice(opts.allQuestionIds, sliceSize);
  const sliceResult = await runEval(opts.spaceId, {
    ...baseOptions,
    questionIds: sliceIds.length > 0 ? sliceIds : undefined,
  });
  const sliceFailRate = 1 - passRate(sliceResult);
  logger.info("[three-gate] slice complete", {
    spaceId: opts.spaceId,
    sliceSize: sliceIds.length,
    accuracy: sliceResult.accuracy,
  });
  if (sliceIds.length > 0 && sliceFailRate >= sliceFailThreshold) {
    return {
      status: "abandoned",
      gate: "slice",
      reason: `slice fail rate ${(sliceFailRate * 100).toFixed(0)}% ≥ ${(sliceFailThreshold * 100).toFixed(0)}%`,
      sliceResult,
    };
  }

  // -------------------- Gate 2: P0 (hardest) --------------------
  let p0Result: EvalRunResult | undefined;
  if (opts.hardestQuestionIds.length > 0) {
    p0Result = await runEval(opts.spaceId, {
      ...baseOptions,
      questionIds: [...opts.hardestQuestionIds],
    });
    const p0Pass = passRate(p0Result);
    logger.info("[three-gate] P0 complete", {
      spaceId: opts.spaceId,
      p0Size: opts.hardestQuestionIds.length,
      accuracy: p0Result.accuracy,
    });
    // The plan requires *no regression* on P0. We treat <100% pass as a
    // regression because by definition these were the hardest from the
    // previous iteration -- the bar is "nothing got worse".
    if (p0Pass < 1) {
      return {
        status: "abandoned",
        gate: "p0",
        reason: `P0 pass rate ${(p0Pass * 100).toFixed(0)}% < 100%`,
        sliceResult,
        p0Result,
      };
    }
  }

  // -------------------- Gate 3: Full --------------------
  const fullResult = await runEval(opts.spaceId, baseOptions);
  logger.info("[three-gate] full complete", {
    spaceId: opts.spaceId,
    accuracy: fullResult.accuracy,
  });

  return { status: "complete", sliceResult, p0Result, fullResult };
}

/**
 * Identify the N hardest question IDs from a completed eval run.
 *
 * "Hardest" = wrong (`BAD`) first, then `NEEDS_REVIEW`, then `GOOD`. Within
 * each tier, results are returned in the order they appeared in the run.
 */
export function pickHardestQuestionIds(run: EvalRunResult, n: number): string[] {
  const ranked = [...run.results].sort((a, b) => {
    const order: Record<string, number> = { BAD: 0, NEEDS_REVIEW: 1, GOOD: 2 };
    const ao = order[a.assessment] ?? 3;
    const bo = order[b.assessment] ?? 3;
    return ao - bo;
  });
  const ids: string[] = [];
  for (const r of ranked) {
    if (!r.benchmarkQuestionId) continue;
    ids.push(r.benchmarkQuestionId);
    if (ids.length >= n) break;
  }
  return ids;
}
