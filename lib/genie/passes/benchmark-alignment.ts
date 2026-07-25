/**
 * Benchmark Alignment Review (post-pass).
 *
 * For each generated benchmark, asks the review LLM whether the
 * `expectedSql` is the most direct query that answers the question, and
 * rewrites it tighter if not. Rewrites are validated through the SQL
 * validator pipeline before being accepted.
 *
 * Mirrors upstream `databricks-genie-workbench` `plan_builder.py` benchmark
 * alignment review. Disabled when `FORGE_SQL_REPAIR_ENABLED` is off so this
 * is purely opt-in for the first release.
 *
 * Inputs:
 *   - benchmarks: the generation pass output
 *   - schemaContext: schema markdown for the LLM
 *   - reviewEndpoint: serving endpoint for the review LLM
 *
 * Outputs:
 *   - aligned benchmarks (with rewritten SQL where appropriate)
 *   - dropped benchmarks (kept aside in `dropped` for diagnostics)
 */

import { logger } from "@/lib/logger";
import { reviewSql } from "@/lib/ai/sql-reviewer";
import { isSqlRepairEnabled, validateAndRepair } from "@/lib/genie/sql-validator";
import type { BenchmarkInput } from "@/lib/genie/types";
import { getPromptSync, interpolatePrompt } from "@/lib/ai/prompt-registry";
import { PROMPT_KEYS } from "@/lib/genie/passes/prompt-defaults";
import "@/lib/genie/passes/prompt-defaults";

export interface BenchmarkAlignmentInput {
  benchmarks: BenchmarkInput[];
  schemaContext?: string;
  /**
   * The review endpoint surface label, primarily for telemetry. The actual
   * endpoint is resolved inside `reviewSql()` from `getReviewEndpoint()`.
   */
  surface?: string;
  signal?: AbortSignal;
}

export interface BenchmarkAlignmentOutput {
  aligned: BenchmarkInput[];
  dropped: Array<{ benchmark: BenchmarkInput; reason: string }>;
  /** Number of benchmarks whose expected_sql was rewritten by the alignment review. */
  rewrittenCount: number;
}

const DEFAULT_SURFACE = "genie-benchmark-alignment";

/**
 * Run alignment review over a batch of benchmarks. When the SQL repair flag
 * is OFF this is a no-op (returns the input unchanged) so callers can wire
 * it in unconditionally.
 */
export async function runBenchmarkAlignment(
  input: BenchmarkAlignmentInput,
): Promise<BenchmarkAlignmentOutput> {
  const { benchmarks, schemaContext, surface, signal } = input;

  if (!isSqlRepairEnabled() || benchmarks.length === 0) {
    return { aligned: benchmarks, dropped: [], rewrittenCount: 0 };
  }

  const aligned: BenchmarkInput[] = [];
  const dropped: BenchmarkAlignmentOutput["dropped"] = [];
  let rewrittenCount = 0;

  for (const b of benchmarks) {
    if (signal?.aborted) break;

    const review = await reviewSqlAlignment(b, schemaContext, surface ?? DEFAULT_SURFACE);

    if (review.kind === "ok") {
      aligned.push(b);
      continue;
    }

    if (review.kind === "rewrite") {
      const validation = await validateAndRepair({
        sql: review.rewrittenSql,
        kind: "benchmark",
        schemaContext,
        surface: `${surface ?? DEFAULT_SURFACE}:rewrite-validate`,
      });

      if (validation.status === "ok" || validation.status === "repaired") {
        const finalSql = validation.finalSql ?? review.rewrittenSql;
        aligned.push({ ...b, expectedSql: finalSql });
        rewrittenCount++;
        logger.info("Benchmark alignment rewrite accepted", {
          question: b.question,
          reason: review.reason,
        });
        continue;
      }

      dropped.push({
        benchmark: b,
        reason: `rewrite_validation_failed:${validation.reason ?? validation.errorClass ?? "unknown"}`,
      });
      logger.warn("Benchmark alignment rewrite failed validation; dropped", {
        question: b.question,
        reason: validation.reason,
      });
      continue;
    }

    dropped.push({ benchmark: b, reason: review.reason });
  }

  if (rewrittenCount > 0 || dropped.length > 0) {
    logger.info("Benchmark alignment summary", {
      input: benchmarks.length,
      aligned: aligned.length,
      rewritten: rewrittenCount,
      dropped: dropped.length,
    });
  }

  return { aligned, dropped, rewrittenCount };
}

type AlignmentReviewVerdict =
  | { kind: "ok" }
  | { kind: "rewrite"; rewrittenSql: string; reason: string }
  | { kind: "drop"; reason: string };

/**
 * Ask the reviewer whether `expectedSql` is the most direct SQL for the
 * question. Returns a structured verdict.
 *
 * We re-use the existing `reviewSql` machinery but inject a benchmark-
 * specific runtime hint so the reviewer prefers tightening over leaving
 * SQL as-is.
 */
async function reviewSqlAlignment(
  b: BenchmarkInput,
  schemaContext: string | undefined,
  surface: string,
): Promise<AlignmentReviewVerdict> {
  const runtimeHint = interpolatePrompt(
    getPromptSync(PROMPT_KEYS.benchmarkAlignmentRuntimeHint),
    { question: b.question },
  );

  let result;
  try {
    result = await reviewSql(b.expectedSql, {
      surface,
      requestFix: true,
      schemaContext,
      runtimeError: runtimeHint,
    });
  } catch (err) {
    logger.warn("Benchmark alignment review LLM call failed; keeping original", {
      question: b.question,
      error: String(err),
    });
    return { kind: "ok" };
  }

  if (result.fixedSql && result.fixedSql.trim() && result.fixedSql.trim() !== b.expectedSql.trim()) {
    return {
      kind: "rewrite",
      rewrittenSql: result.fixedSql,
      reason: result.suggestions[0] ?? "alignment_tightened",
    };
  }
  if (result.verdict === "fail") {
    return {
      kind: "drop",
      reason: result.issues[0]?.message ?? "alignment_failed",
    };
  }
  return { kind: "ok" };
}
