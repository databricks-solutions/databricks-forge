/**
 * Pipeline Step 6: Scoring & Deduplication
 *
 * Scores each use case on multiple dimensions using Model Serving (JSON mode),
 * then removes duplicates and low-value entries.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { buildTokenAwareBatches } from "@/lib/toolkit/token-budget";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { buildIndustryKPIsPrompt } from "@/lib/domain/industry-outcomes-server";
import { buildBenchmarkContextPrompt } from "@/lib/domain/benchmark-context";
import { persistManifest } from "@/lib/pipeline/context-manifest";
import { logger as fallbackLogger } from "@/lib/logger";
import {
  ScoreItemSchema,
  DedupItemSchema,
  CalibrationItemSchema,
  CrossDomainDedupItemSchema,
  validateLLMArray,
} from "@/lib/validation";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import type { PipelineContext, ScoreRationale, UseCase } from "@/lib/domain/types";
import { DEFAULT_DEPTH_CONFIGS } from "@/lib/domain/types";
import { scoreUseCaseConsultingQuality } from "@/lib/pipeline/usecase-scorecard";

const DOMAIN_CONCURRENCY = 5;

export async function runScoring(ctx: PipelineContext, runId?: string): Promise<UseCase[]> {
  const log = ctx.logger ?? fallbackLogger;
  const { run, useCases } = ctx;
  if (!run.businessContext) throw new Error("Business context not available");
  if (useCases.length === 0) return [];

  const bc = run.businessContext;
  let scored = [...useCases];

  // Build industry KPIs for scoring enrichment
  const industryKpis = run.config.industry
    ? await buildIndustryKPIsPrompt(run.config.industry)
    : "";
  const benchmarkResult = await buildBenchmarkContextPrompt(
    run.config.industry || undefined,
    run.config.customerMaturity,
  );

  // Persist scoring-step provenance
  if (runId) {
    const outcomeMapSections: string[] = [];
    if (industryKpis) outcomeMapSections.push("kpis");
    try {
      await persistManifest(runId, {
        benchmarks: benchmarkResult.sources,
        outcomeMap: { industryId: run.config.industry || null, sections: outcomeMapSections },
        steps: ["scoring"],
      });
    } catch (e) {
      log.warn("persistManifest failed (non-fatal)", {
        error: e,
        fn: "runScoring",
        errorCategory: "db",
      });
    }
  }

  // Build existing asset context for scoring (higher scores for gap-filling use cases)
  let assetContext = "";
  if (ctx.discoveryResult) {
    const { buildAssetContextForScoring } = await import("@/lib/discovery/prompt-context");
    assetContext = buildAssetContextForScoring(ctx.discoveryResult);
  }

  // Step 6a: Score per domain (parallel across domains)
  const domains = [...new Set(scored.map((uc) => uc.domain))];
  const bcRecord = bc as unknown as Record<string, string>;
  if (runId)
    await updateRunMessage(
      runId,
      `Scoring ${scored.length} use cases across ${domains.length} domains...`,
    );

  const customerProfileCtx = `Customer maturity: ${run.config.customerMaturity}\nRisk posture: ${run.config.riskPosture}\nTransformation horizon: ${run.config.transformationHorizon}\nAdditional context: ${run.config.additionalContext || "None provided"}`;
  const scoringResults = await mapWithConcurrency(
    domains.map((domain) => async () => {
      const domainCases = scored.filter((uc) => uc.domain === domain);
      try {
        await scoreDomain(
          log,
          domainCases,
          bcRecord,
          resolveEndpoint("reasoning"),
          industryKpis,
          runId,
          assetContext,
          benchmarkResult.text,
          customerProfileCtx,
        );
        return { domain, failed: false };
      } catch (error) {
        log.warn("Scoring failed for domain", {
          domain,
          error: error instanceof Error ? error.message : String(error),
          fn: "runScoring",
          errorCategory: "llm_error",
        });
        domainCases.forEach((uc) => {
          uc.priorityScore = 0.5;
          uc.feasibilityScore = 0.5;
          uc.impactScore = 0.5;
          uc.overallScore = 0.5;
        });
        return { domain, failed: true };
      }
    }),
    DOMAIN_CONCURRENCY,
  );
  const failedScoringDomains = scoringResults.filter((r) => r.failed).length;
  if (failedScoringDomains > 0) {
    const failureRate = failedScoringDomains / Math.max(domains.length, 1);
    if (failureRate >= 0.4) {
      throw new Error(
        `Scoring failed for ${failedScoringDomains}/${domains.length} domains (>=40%). Failing closed to prevent low-quality output.`,
      );
    }
  }

  // Step 6b: Deduplicate per domain (parallel across domains)
  if (runId)
    await updateRunMessage(runId, `Deduplicating: reviewing ${scored.length} use cases...`);
  const dedupResults = await mapWithConcurrency(
    domains
      .filter((domain) => scored.filter((uc) => uc.domain === domain).length > 2)
      .map((domain) => async () => {
        const domainCases = scored.filter((uc) => uc.domain === domain);
        try {
          return await deduplicateDomain(
            log,
            domainCases,
            bcRecord,
            resolveEndpoint("classification"),
            runId,
          );
        } catch (error) {
          log.warn("Dedup failed for domain", {
            domain,
            error: error instanceof Error ? error.message : String(error),
            fn: "runScoring",
            errorCategory: "llm_error",
          });
          return new Set<number>();
        }
      }),
    DOMAIN_CONCURRENCY,
  );
  const allRemovals = new Set<number>();
  for (const s of dedupResults) for (const n of s) allRemovals.add(n);
  scored = scored.filter((uc) => !allRemovals.has(uc.useCaseNo));
  const removedCount = allRemovals.size;

  if (runId && removedCount > 0) {
    await updateRunMessage(runId, `Deduplication: removed ${removedCount} near-duplicates`);
  }

  // Step 6c: Cross-domain deduplication
  if (scored.length > 5) {
    if (runId)
      await updateRunMessage(runId, `Cross-domain dedup: reviewing ${scored.length} use cases...`);
    try {
      const crossDomainRemoved = await deduplicateCrossDomain(
        log,
        scored,
        bcRecord,
        resolveEndpoint("classification"),
        runId,
      );
      if (crossDomainRemoved.size > 0) {
        scored = scored.filter((uc) => !crossDomainRemoved.has(uc.useCaseNo));
        if (runId) {
          await updateRunMessage(
            runId,
            `Cross-domain dedup: removed ${crossDomainRemoved.size} duplicates`,
          );
        }
        log.info("Cross-domain dedup removed use cases", {
          removedCount: crossDomainRemoved.size,
        });
      }
    } catch (error) {
      log.warn("Cross-domain dedup failed", {
        error: error instanceof Error ? error.message : String(error),
        fn: "runScoring",
        errorCategory: "llm_error",
      });
    }
  }

  // Step 6d: Global score calibration (chunked for full coverage)
  if (scored.length > 10) {
    if (runId)
      await updateRunMessage(runId, `Calibrating scores across ${domains.length} domains...`);
    try {
      await calibrateScoresChunked(
        log,
        scored,
        bc as unknown as Record<string, string>,
        resolveEndpoint("reasoning"),
        runId,
      );
    } catch (error) {
      log.warn("Global calibration failed", {
        error: error instanceof Error ? error.message : String(error),
        fn: "runScoring",
        errorCategory: "llm_error",
      });
    }
  }

  // Step 6e: Sort by overall score and re-number with domain prefix
  // Blend LLM scores with deterministic consulting scorecard signals.
  for (const uc of scored) {
    const scorecard = scoreUseCaseConsultingQuality(uc);
    uc.overallScore = scorecard.blendedScore;
    uc.consultingScorecard = scorecard;
  }

  scored.sort((a, b) => b.overallScore - a.overallScore);

  const domainCounters: Record<string, number> = {};
  for (const uc of scored) {
    if (!domainCounters[uc.domain]) domainCounters[uc.domain] = 0;
    domainCounters[uc.domain]++;
    const domainPrefix = uc.domain.substring(0, 3).toUpperCase();
    uc.useCaseNo = domainCounters[uc.domain];
    uc.id = `${domainPrefix}-${String(uc.useCaseNo).padStart(3, "0")}-${uc.id.substring(0, 8)}`;
  }

  // Step 6f: Quality floor -- drop use cases below depth-specific threshold
  const depth = run.config.discoveryDepth ?? "balanced";
  const dc = run.config.depthConfig ?? DEFAULT_DEPTH_CONFIGS[depth];
  const floor = dc.qualityFloor;
  const beforeFloor = scored.length;
  scored = scored.filter((uc) => uc.overallScore >= floor);
  if (scored.length < beforeFloor) {
    const removed = beforeFloor - scored.length;
    log.info("Quality floor applied", { floor, removed, remaining: scored.length });
    if (runId)
      await updateRunMessage(
        runId,
        `Quality floor (${floor}): removed ${removed} low-scoring use cases`,
      );
  }

  // Step 6g: Adaptive volume cap
  const cap = dc.adaptiveCap;
  if (scored.length > cap) {
    scored = scored.slice(0, cap);
    if (runId) await updateRunMessage(runId, `Volume cap (${depth}): capped at ${cap} use cases`);
  }

  const finalDomains = [...new Set(scored.map((uc) => uc.domain))].length;
  if (runId)
    await updateRunMessage(
      runId,
      `Final: ${scored.length} use cases across ${finalDomains} domains`,
    );

  log.info("Scoring complete", {
    useCaseCount: scored.length,
    domainCount: finalDomains,
    depth,
  });

  return scored;
}

async function scoreDomain(
  log: typeof fallbackLogger,
  domainCases: UseCase[],
  businessContext: Record<string, string>,
  aiModel: string,
  industryKpis: string = "",
  runId?: string,
  assetContext: string = "",
  benchmarkContext: string = "",
  customerProfileContext: string = "",
): Promise<void> {
  const renderScoreRow = (uc: UseCase) =>
    `| ${uc.useCaseNo} | ${uc.name} | ${uc.type} | ${uc.analyticsTechnique} | ${uc.statement} |`;

  const baseContextTokens = 2000; // template + business context overhead
  const batches = buildTokenAwareBatches(domainCases, renderScoreRow, baseContextTokens);

  interface ScoreEntry {
    priority: number;
    feasibility: number;
    impact: number;
    overall: number;
    rationale: ScoreRationale | null;
  }

  const scoreMap = new Map<number, ScoreEntry>();

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const useCaseMarkdown = batch.map(renderScoreRow).join("\n");

      const result = await executeAIQuery({
        promptKey: "SCORE_USE_CASES_PROMPT",
        variables: {
          business_context: JSON.stringify(businessContext),
          strategic_goals: businessContext.strategicGoals ?? "",
          business_priorities: businessContext.businessPriorities ?? "",
          strategic_initiative: businessContext.strategicInitiative ?? "",
          value_chain: businessContext.valueChain ?? "",
          revenue_model: businessContext.revenueModel ?? "",
          industry_kpis: industryKpis,
          asset_context: assetContext,
          benchmark_context: benchmarkContext,
          customer_profile_context: customerProfileContext,
          use_case_markdown: `| No | Name | Type | Technique | Statement |\n|---|---|---|---|---|\n${useCaseMarkdown}`,
        },
        modelEndpoint: aiModel,
        responseFormat: "json_object",
        runId,
        step: "scoring",
        maxTokens: 128000,
      });

      let rawItems: unknown[];
      try {
        rawItems = parseLLMJson(result.rawResponse, "scoring:score") as unknown[];
      } catch (parseErr) {
        log.warn("Failed to parse scoring response JSON", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          fn: "runScoring",
          errorCategory: "llm_parse",
        });
        return [];
      }

      return validateLLMArray(rawItems, ScoreItemSchema, "scoreDomain");
    }),
  );

  for (const items of batchResults) {
    for (const item of items) {
      if (isNaN(item.no)) continue;

      let rationale: ScoreRationale | null = null;
      if (item.priority_rationale || item.feasibility_rationale || item.impact_rationale) {
        rationale = {
          priority: {
            rationale: item.priority_rationale || "",
            factors: item.priority_factors
              ? {
                  roi: clampScore(item.priority_factors.roi),
                  strategic_alignment: clampScore(item.priority_factors.strategic_alignment),
                  time_to_value: clampScore(item.priority_factors.time_to_value),
                  reusability: clampScore(item.priority_factors.reusability),
                }
              : { roi: 0, strategic_alignment: 0, time_to_value: 0, reusability: 0 },
          },
          feasibility: {
            rationale: item.feasibility_rationale || "",
            factors: item.feasibility_factors
              ? {
                  data_availability: clampScore(item.feasibility_factors.data_availability),
                  data_accessibility: clampScore(item.feasibility_factors.data_accessibility),
                  architecture_fitness: clampScore(item.feasibility_factors.architecture_fitness),
                  team_skills: clampScore(item.feasibility_factors.team_skills),
                  domain_knowledge: clampScore(item.feasibility_factors.domain_knowledge),
                  people_allocation: clampScore(item.feasibility_factors.people_allocation),
                  budget_allocation: clampScore(item.feasibility_factors.budget_allocation),
                  time_to_production: clampScore(item.feasibility_factors.time_to_production),
                }
              : {
                  data_availability: 0,
                  data_accessibility: 0,
                  architecture_fitness: 0,
                  team_skills: 0,
                  domain_knowledge: 0,
                  people_allocation: 0,
                  budget_allocation: 0,
                  time_to_production: 0,
                },
          },
          impact: { rationale: item.impact_rationale || "" },
        };
      }

      scoreMap.set(item.no, {
        priority: clampScore(item.priority_score),
        feasibility: clampScore(item.feasibility_score),
        impact: clampScore(item.impact_score),
        overall: clampScore(item.overall_score),
        rationale,
      });
    }
  }

  for (const uc of domainCases) {
    const scores = scoreMap.get(uc.useCaseNo);
    if (scores) {
      uc.priorityScore = scores.priority;
      uc.feasibilityScore = scores.feasibility;
      uc.impactScore = scores.impact;
      uc.overallScore = scores.overall;
      uc.scoreRationale = scores.rationale;
    } else {
      uc.priorityScore = 0.5;
      uc.feasibilityScore = 0.5;
      uc.impactScore = 0.5;
      uc.overallScore = 0.5;
      uc.scoreRationale = null;
    }
  }
}

async function deduplicateDomain(
  log: typeof fallbackLogger,
  domainCases: UseCase[],
  businessContext: Record<string, string>,
  aiModel: string,
  runId?: string,
): Promise<Set<number>> {
  const renderDedupRow = (uc: UseCase) =>
    `| ${uc.useCaseNo} | ${uc.domain} | ${uc.name} | ${uc.type} | ${uc.statement} |`;

  const baseContextTokens = 1500;
  const batches = buildTokenAwareBatches(domainCases, renderDedupRow, baseContextTokens);

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const useCaseMarkdown = batch.map(renderDedupRow).join("\n");

      const result = await executeAIQuery({
        promptKey: "REVIEW_USE_CASES_PROMPT",
        variables: {
          total_count: String(batch.length),
          business_name: businessContext.businessName ?? "",
          strategic_goals: businessContext.strategicGoals ?? "",
          use_case_markdown: `| No | Domain | Name | Type | Statement |\n|---|---|---|---|---|\n${useCaseMarkdown}`,
        },
        modelEndpoint: aiModel,
        responseFormat: "json_object",
        runId,
        step: "scoring",
        maxTokens: 128000,
      });

      let rawItems: unknown[];
      try {
        rawItems = parseLLMJson(result.rawResponse, "scoring:dedup") as unknown[];
      } catch (parseErr) {
        log.warn("Failed to parse dedup response JSON", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          fn: "runScoring",
          errorCategory: "llm_parse",
        });
        return [];
      }

      return validateLLMArray(rawItems, DedupItemSchema, "deduplicateDomain");
    }),
  );

  const toRemove = new Set<number>();
  for (const items of batchResults) {
    for (const item of items) {
      const action = String(item.action ?? "")
        .trim()
        .toLowerCase();
      if (!isNaN(item.no) && action === "remove") {
        toRemove.add(item.no);
      }
    }
  }

  return toRemove;
}

function clampScore(value: number): number {
  if (isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Global score calibration
// ---------------------------------------------------------------------------

/**
 * Chunked global calibration: takes top 8 per domain, then calibrates in
 * chunks of 50 with 5-item overlap anchors for scale consistency.
 */
async function calibrateScoresChunked(
  log: typeof fallbackLogger,
  useCases: UseCase[],
  businessContext: Record<string, string>,
  aiModel: string,
  runId?: string,
): Promise<void> {
  const domains = [...new Set(useCases.map((uc) => uc.domain))];
  const candidates: UseCase[] = [];
  for (const domain of domains) {
    const domainCases = useCases
      .filter((uc) => uc.domain === domain)
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 8);
    candidates.push(...domainCases);
  }

  const sorted = candidates.sort((a, b) => b.overallScore - a.overallScore);
  if (sorted.length < 5) return;

  const CHUNK_SIZE = 50;
  const ANCHOR_SIZE = 5;
  const calibrationMap = new Map<number, number>();
  for (let offset = 0; offset < sorted.length; offset += CHUNK_SIZE - ANCHOR_SIZE) {
    const chunk = sorted.slice(offset, offset + CHUNK_SIZE);
    if (chunk.length < 5) break;

    const useCaseMarkdown = chunk
      .map(
        (uc) =>
          `| ${uc.useCaseNo} | ${uc.domain} | ${uc.name} | ${uc.type} | ${uc.statement} | ${uc.overallScore.toFixed(2)} |`,
      )
      .join("\n");

    try {
      const result = await executeAIQuery({
        promptKey: "GLOBAL_SCORE_CALIBRATION_PROMPT",
        variables: {
          business_context: JSON.stringify(businessContext),
          strategic_goals: businessContext.strategicGoals ?? "",
          use_case_markdown: `| No | Domain | Name | Type | Statement | Current Score |\n|---|---|---|---|---|---|\n${useCaseMarkdown}`,
        },
        modelEndpoint: aiModel,
        responseFormat: "json_object",
        runId,
        step: "scoring",
        maxTokens: 128000,
      });

      let rawItems: unknown[];
      try {
        rawItems = parseLLMJson(result.rawResponse, "scoring:calibrate") as unknown[];
      } catch (parseErr) {
        log.warn("Failed to parse calibration chunk JSON", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          chunkOffset: offset,
          fn: "runScoring",
          errorCategory: "llm_parse",
        });
        continue;
      }

      const items = validateLLMArray(rawItems, CalibrationItemSchema, "calibrateScoresChunked");
      for (const item of items) {
        if (!isNaN(item.no)) {
          calibrationMap.set(item.no, clampScore(item.overall_score));
        }
      }
    } catch (error) {
      log.warn("Calibration chunk failed", {
        chunkOffset: offset,
        chunkSize: chunk.length,
        error: error instanceof Error ? error.message : String(error),
        fn: "runScoring",
        errorCategory: "llm_error",
      });
    }
  }

  for (const uc of useCases) {
    const calibrated = calibrationMap.get(uc.useCaseNo);
    if (calibrated !== undefined) {
      uc.overallScore = calibrated;
    }
  }

  log.info("Chunked calibration complete", {
    candidatesConsidered: sorted.length,
    adjustedCount: calibrationMap.size,
    chunks: Math.ceil(sorted.length / (CHUNK_SIZE - ANCHOR_SIZE)),
  });
}

// ---------------------------------------------------------------------------
// Cross-domain deduplication
// ---------------------------------------------------------------------------

async function deduplicateCrossDomain(
  log: typeof fallbackLogger,
  useCases: UseCase[],
  businessContext: Record<string, string>,
  aiModel: string,
  runId?: string,
): Promise<Set<number>> {
  const renderCrossDedupRow = (uc: UseCase) =>
    `| ${uc.useCaseNo} | ${uc.domain} | ${uc.name} | ${uc.type} | ${uc.statement} | ${uc.overallScore.toFixed(2)} |`;

  const baseContextTokens = 1500;
  const batches = buildTokenAwareBatches(useCases, renderCrossDedupRow, baseContextTokens);

  // Build score lookup for safety guard
  const scoreMap = new Map<number, number>();
  for (const uc of useCases) {
    scoreMap.set(uc.useCaseNo, uc.overallScore);
  }

  const toRemove = new Set<number>();

  for (const batch of batches) {
    const useCaseMarkdown = batch.map(renderCrossDedupRow).join("\n");

    const result = await executeAIQuery({
      promptKey: "CROSS_DOMAIN_DEDUP_PROMPT",
      variables: {
        business_name: businessContext.businessName ?? "",
        strategic_goals: businessContext.strategicGoals ?? "",
        use_case_markdown: `| No | Domain | Name | Type | Statement | Score |\n|---|---|---|---|---|---|\n${useCaseMarkdown}`,
      },
      modelEndpoint: aiModel,
      responseFormat: "json_object",
      runId,
      step: "scoring",
      maxTokens: 128000,
    });

    let rawItems: unknown[];
    try {
      rawItems = parseLLMJson(result.rawResponse, "scoring:cross-domain-dedup") as unknown[];
    } catch (parseErr) {
      log.warn("Failed to parse cross-domain dedup response JSON", {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        fn: "runScoring",
        errorCategory: "llm_parse",
      });
      continue;
    }

    const items = validateLLMArray(rawItems, CrossDomainDedupItemSchema, "deduplicateCrossDomain");

    for (const item of items) {
      if (isNaN(item.no) || isNaN(item.duplicate_of)) continue;

      if (toRemove.has(item.duplicate_of)) {
        log.warn("skipping removal — kept item already marked for removal", {
          wouldRemove: item.no,
          duplicateOf: item.duplicate_of,
          fn: "runScoring",
          errorCategory: "llm_error",
        });
        continue;
      }

      const removeScore = scoreMap.get(item.no) ?? 0;
      const keepScore = scoreMap.get(item.duplicate_of) ?? 0;
      if (removeScore > keepScore) {
        log.warn("LLM suggested removing higher-scored item — swapping", {
          suggested: item.no,
          suggestedScore: removeScore,
          duplicateOf: item.duplicate_of,
          duplicateOfScore: keepScore,
          fn: "runScoring",
          errorCategory: "llm_error",
        });
        if (!toRemove.has(item.no)) {
          toRemove.add(item.duplicate_of);
        }
      } else {
        toRemove.add(item.no);
      }
    }
  }

  return toRemove;
}
