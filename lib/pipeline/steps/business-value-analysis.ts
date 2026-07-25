/**
 * Pipeline Step: Business Value Analysis
 *
 * Runs 4 lightweight LLM passes after scoring to produce:
 * 1. Financial quantification (dollar-value estimates per use case)
 * 2. Roadmap phasing (Quick Wins / Foundation / Transformation)
 * 3. Executive synthesis (key findings, recommendations, risks)
 * 4. Stakeholder analysis (roles, departments, change management)
 *
 * All passes use the fast model endpoint by default.
 */

import type {
  PipelineContext,
  UseCase,
  ValueType,
  ValueConfidence,
  RoadmapPhase,
  EffortEstimate,
  ExecutiveSynthesis,
} from "@/lib/domain/types";
import { executeAIQuery } from "@/lib/ai/agent";
import {
  resolvePremiumReasoningEndpoint,
  getFallbacksForTier,
} from "@/lib/dbx/client";
import { logger as fallbackLogger } from "@/lib/logger";
import { upsertValueEstimates, getValueEstimatesForRun } from "@/lib/lakebase/value-estimates";
import {
  ECONOMIC_PATTERNS,
  isEconomicImpactCategory,
  isEconomicPatternName,
  LEGACY_VALUE_TYPE_MAP,
} from "@/lib/domain/economic-patterns";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";
import { resolveIndustryId } from "@/lib/domain/industry-outcomes";
import { upsertRoadmapPhases } from "@/lib/lakebase/roadmap-phases";
import { replaceStakeholderProfiles } from "@/lib/lakebase/stakeholder-profiles";
import { bulkInitTracking } from "@/lib/lakebase/use-case-tracking";
import {
  updateRunMessage,
  markRunStepDegraded,
  clearRunStepDegraded,
} from "@/lib/lakebase/runs";
import { logActivity } from "@/lib/lakebase/activity-log";
import { withPrisma } from "@/lib/prisma";
import { buildStrategyAlignmentPrompt } from "@/lib/domain/strategy-alignment";
import {
  updateBvJob,
  markBvPassComplete,
  markBvPassDegraded,
} from "@/lib/pipeline/bv-engine-status";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summariseCasesForLLM(useCases: UseCase[]): string {
  return JSON.stringify(
    useCases.map((uc) => ({
      use_case_id: uc.id,
      name: uc.name,
      type: uc.type,
      domain: uc.domain,
      statement: uc.statement,
      business_value: uc.businessValue,
      beneficiary: uc.beneficiary,
      sponsor: uc.sponsor,
      analytics_technique: uc.analyticsTechnique,
      tables_involved: uc.tablesInvolved,
      priority_score: uc.priorityScore,
      feasibility_score: uc.feasibilityScore,
      impact_score: uc.impactScore,
      overall_score: uc.overallScore,
      // Phase 3.5 lineage signals — let the financial / roadmap / synthesis
      // prompts ground their reasoning in the customer's actual data plant.
      // `source_systems` reflects upstream lineage attribution (P3.1);
      // `blast_radius` reflects downstream consumption (P3.2). Both are
      // omitted (undefined → JSON drops them) when not yet resolved so we
      // don't burn prompt tokens on null fields.
      source_systems: uc.sourceSystems && uc.sourceSystems.length > 0
        ? uc.sourceSystems
        : undefined,
      source_systems_origin: uc.sourceSystemsOrigin ?? undefined,
      blast_radius: uc.blastRadius
        ? {
            downstream_table_count: uc.blastRadius.downstreamTableCount,
            total_event_count: uc.blastRadius.totalEventCount,
            by_entity_type: uc.blastRadius.byEntityType,
          }
        : undefined,
    })),
    null,
    2,
  );
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const cleaned = raw
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

/**
 * BV prompts ask for a top-level JSON array (`[{...}]`) but our LLM calls run
 * with `responseFormat: "json_object"`, which lets the model legitimately wrap
 * the array in an object (e.g. `{"stakeholders": [...]}`). Without this helper,
 * `safeParse<T[]>` returns an object cast as an array, `.length` is undefined,
 * and the entire pass silently flags as degraded. Accept either shape.
 *
 * Exported for unit testing only.
 */
export function safeParseArray<T>(raw: string | null | undefined): T[] {
  const parsed = safeParse<unknown>(raw, null);
  if (parsed === null || parsed === undefined) return [];
  if (Array.isArray(parsed)) return parsed as T[];
  if (typeof parsed !== "object") return [];

  const obj = parsed as Record<string, unknown>;
  const preferredKeys = [
    "stakeholders",
    "profiles",
    "estimates",
    "phases",
    "roadmap",
    "results",
    "result",
    "items",
    "data",
    "rows",
    "list",
  ];
  for (const key of preferredKeys) {
    const v = obj[key];
    if (Array.isArray(v)) return v as T[];
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Pass 1: Financial Quantification
// ---------------------------------------------------------------------------

/**
 * Build the canonical economic-patterns prompt block. All 10 patterns are
 * always included so the LLM picks a structured value. Plain text so it can
 * be safely inlined into a template string.
 */
/**
 * Render the canonical economic-patterns table for prompt grounding.
 *
 * `compact` drops the per-pattern "Variables:" hint line. The variables
 * are mostly redundant once the formula is shown, and trimming them
 * shaves ~30% off this block. Used for large batches (>10 use cases)
 * where the dominant failure mode is the smaller models abandoning a
 * very long prompt and emitting empty content.
 */
function buildEconomicPatternsContext(opts?: { compact?: boolean }): string {
  const compact = opts?.compact ?? false;
  const lines: string[] = [];
  for (const p of Object.values(ECONOMIC_PATTERNS)) {
    const range = p.expectedRangePct
      ? ` Typical D4B range: ${p.expectedRangePct.low}--${p.expectedRangePct.high}%.`
      : "";
    lines.push(`- **${p.name}** [${p.category}]`);
    lines.push(`    Formula: ${p.defaultFormula}.${range}`);
    if (!compact) {
      lines.push(`    Variables: ${p.variableHints.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build a per-industry block of pre-calibrated reference cases. Each entry
 * carries the master-repo formula and benchmark uplift so the LLM can lean
 * on a real consultancy-grade anchor instead of inventing one.
 *
 * Source priority:
 *   1. The canonical industry id stored on `run.config.industry` (highest
 *      signal -- the pipeline auto-detects this earlier in `pipeline/engine.ts`
 *      and the user can override it via the run config). Building from this
 *      always finds the matching enrichment when one exists.
 *   2. Free-form `bc.industries` text (e.g. "Banking & Payments, Capital
 *      Markets"). Each comma/semicolon-separated token is normalised to an
 *      id-shaped slug and resolved via `resolveIndustryId()`. This is a
 *      best-effort fallback for older runs whose `config.industry` is null.
 *
 * Both sources are attempted. Results are de-duplicated by canonical id so
 * that, e.g., a run with both `config.industry = "banking"` and
 * `bc.industries = "Banking, Capital Markets"` emits the banking block once
 * and the capital-markets block once.
 *
 * Exported for unit testing.
 */
/**
 * Default caps applied to the rendered industry-reference block. These
 * exist because prior versions of the prompt embedded up to 30 reference
 * cases per industry across an unbounded number of industries, which is
 * the most plausible reason smaller classification models returned empty
 * content for the full financial-quantification prompt. The caps below
 * keep the block well under any plausible context-window concern while
 * still anchoring estimates with real consultancy-grade benchmarks.
 */
const DEFAULT_MAX_INDUSTRIES = 2;
const DEFAULT_MAX_CASES_PER_INDUSTRY = 8;

export function buildIndustryReferenceCases(opts: {
  canonicalIndustryId?: string | null;
  freeText?: string | null;
  /** Hard cap on total industries surfaced. Default: 2. */
  maxIndustries?: number;
  /** Hard cap on reference cases per industry. Default: 8. */
  maxCasesPerIndustry?: number;
}): string {
  const maxIndustries = opts.maxIndustries ?? DEFAULT_MAX_INDUSTRIES;
  const maxCasesPerIndustry = opts.maxCasesPerIndustry ?? DEFAULT_MAX_CASES_PER_INDUSTRY;

  const seen = new Set<string>();
  const blocks: string[] = [];

  function pushIndustry(rawId: string, label: string) {
    if (seen.size >= maxIndustries) return;
    const resolved = resolveIndustryId(rawId) ?? rawId;
    if (!resolved || seen.has(resolved)) return;
    const enrichment = getMasterRepoEnrichment(resolved);
    if (!enrichment) return;
    const refs = enrichment.useCases.filter(
      (uc) => uc.economicPatternName && uc.economicFormula && uc.benchmarkImpact,
    );
    if (refs.length === 0) return;
    seen.add(resolved);
    blocks.push(`Industry: ${label}`);
    for (const uc of refs.slice(0, maxCasesPerIndustry)) {
      const formula = uc.economicFormula ?? "";
      const kpi = uc.kpiTarget ? ` ${uc.kpiTarget}` : "";
      const bench = uc.benchmarkImpact ?? "";
      const pattern = uc.economicPatternName ?? "";
      blocks.push(
        `  * ${uc.name} -> ${pattern} | formula: ${formula} | benchmark:${kpi} ${bench}`,
      );
    }
    blocks.push("");
  }

  // Tier 1: canonical industry id from the run config.
  if (opts.canonicalIndustryId) {
    pushIndustry(opts.canonicalIndustryId, opts.canonicalIndustryId);
  }

  // Tier 2: free-text best-effort. Useful for legacy runs and for runs that
  // span multiple industries.
  const tokens = (opts.freeText ?? "")
    .split(/[,;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (seen.size >= maxIndustries) break;
    const normalized = token.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (normalized) pushIndustry(normalized, token);
  }

  if (blocks.length === 0) return "(no industry reference cases available)";
  return blocks.join("\n");
}

type RawFinancialEstimate = {
  use_case_id: string;
  value_low: number;
  value_mid: number;
  value_high: number;
  value_type: string;
  confidence: string;
  rationale?: string;
  assumptions?: string[];
  industry_benchmark?: string;
  economic_pattern_name?: string;
  economic_impact_category?: string;
  economic_formula_vars?: Record<string, number | string>;
};

/**
 * Execute a single financial-quantification batch end-to-end (LLM + parse).
 * Returns the parsed estimates. Empty array means the model returned no
 * usable structured output (parse failure, refusal, etc.) -- the caller
 * decides whether to halve and retry.
 *
 * Throws only on non-recoverable errors (cancellation, etc.). All other
 * failures (empty content, 5xx, timeouts) propagate from `executeAIQuery`
 * which already does its own retry + endpoint fallback.
 */
async function quantifyBatchOnce(
  ctx: PipelineContext,
  batch: UseCase[],
  baseVariables: Omit<Record<string, string>, "use_cases_json">,
): Promise<{ estimates: RawFinancialEstimate[]; endpoint: string }> {
  const variables: Record<string, string> = {
    ...baseVariables,
    use_cases_json: summariseCasesForLLM(batch),
  };
  const endpoint = resolvePremiumReasoningEndpoint();
  const result = await executeAIQuery({
    runId: ctx.run.runId,
    promptKey: "FINANCIAL_QUANTIFICATION_PROMPT",
    variables,
    modelEndpoint: endpoint,
    responseFormat: "json_object",
    // The agent already retries internally and rotates to a fallback endpoint
    // on 429 / empty-content. Keep retries low here so the halve-batch loop
    // (below) gets to act sooner on persistently empty batches.
    retries: 1,
  });
  return {
    estimates: safeParseArray<RawFinancialEstimate>(result.rawResponse),
    endpoint: result.endpoint ?? endpoint,
  };
}

/**
 * Generic halve-batch retry. Repeatedly evaluates `executor(batch)`; if the
 * executor returns an empty array (or throws), the batch is split in half
 * and each half is retried, up to `maxHalvings` times.
 *
 * Exported for unit testing. Pure -- no LLM, Lakebase, or logger
 * dependencies leak in here. The pipeline-specific wrapper above passes a
 * concrete `executor` that calls Model Serving via `executeAIQuery`.
 */
export async function halveBatchRetry<T extends { id: string }, R extends { use_case_id: string }>(
  initialBatch: T[],
  executor: (sub: T[], depth: number) => Promise<R[]>,
  options: {
    maxHalvings?: number;
    onHalving?: (info: { from: number; to: [number, number]; depth: number; error: string }) => void;
    onGiveUp?: (info: { subBatchSize: number; depth: number; error: string }) => void;
  } = {},
): Promise<{ estimates: R[]; missingItemIds: string[] }> {
  const maxHalvings = options.maxHalvings ?? 2;
  type WorkItem = { batch: T[]; depth: number };
  const queue: WorkItem[] = [{ batch: initialBatch, depth: 0 }];
  const collected: R[] = [];

  while (queue.length > 0) {
    const { batch, depth } = queue.shift()!;
    try {
      const results = await executor(batch, depth);
      if (results.length > 0) {
        collected.push(...results);
        continue;
      }
      // Empty parse -- treat the same as a thrown error so the halving path runs.
      throw new Error("Empty result set after parse");
    } catch (err) {
      const errMsg = String(err);
      if (batch.length <= 1 || depth >= maxHalvings) {
        options.onGiveUp?.({ subBatchSize: batch.length, depth, error: errMsg });
        continue;
      }
      const mid = Math.ceil(batch.length / 2);
      const left = batch.slice(0, mid);
      const right = batch.slice(mid);
      options.onHalving?.({
        from: batch.length,
        to: [left.length, right.length],
        depth: depth + 1,
        error: errMsg,
      });
      queue.unshift(
        { batch: left, depth: depth + 1 },
        { batch: right, depth: depth + 1 },
      );
    }
  }

  const collectedIds = new Set(collected.map((r) => r.use_case_id));
  const missingItemIds = initialBatch
    .filter((u) => !collectedIds.has(u.id))
    .map((u) => u.id);

  return { estimates: collected, missingItemIds };
}

/**
 * Pipeline-specific halve-batch wrapper for the financial-quantification
 * pass. Delegates to the generic `halveBatchRetry` and threads logger
 * events through.
 */
async function quantifyWithHalveBatchFallback(
  ctx: PipelineContext,
  initialBatch: UseCase[],
  baseVariables: Omit<Record<string, string>, "use_cases_json">,
  log: typeof fallbackLogger,
  maxHalvings = 2,
): Promise<{
  estimates: RawFinancialEstimate[];
  missingUseCaseIds: string[];
  lastEndpoint: string | null;
}> {
  let lastEndpoint: string | null = null;
  const { estimates, missingItemIds } = await halveBatchRetry<UseCase, RawFinancialEstimate>(
    initialBatch,
    async (sub) => {
      const { estimates, endpoint } = await quantifyBatchOnce(ctx, sub, baseVariables);
      lastEndpoint = endpoint;
      return estimates;
    },
    {
      maxHalvings,
      onHalving: (info) => {
        log.warn("Financial quantification: halving sub-batch and retrying", {
          fn: "runFinancialQuantification",
          errorCategory: "llm_empty_halving",
          from: info.from,
          to: info.to,
          halvingDepth: info.depth,
          error: info.error,
        });
      },
      onGiveUp: (info) => {
        log.warn("Financial quantification: giving up sub-batch", {
          fn: "runFinancialQuantification",
          errorCategory: "llm_empty_after_halving",
          subBatchSize: info.subBatchSize,
          halvingDepth: info.depth,
          maxHalvings,
          error: info.error,
        });
      },
    },
  );
  return { estimates, missingUseCaseIds: missingItemIds, lastEndpoint };
}

/**
 * Result of the financial-quantification pass.
 *
 * `degraded` is true when one or more use cases ended up without a value
 * estimate after all retries + halvings. The caller persists this on the
 * run so the UI can render an amber "Recompute" CTA instead of a silent $0.
 */
interface FinancialQuantificationResult {
  degraded: boolean;
  missingUseCaseIds: string[];
}

async function runFinancialQuantification(
  ctx: PipelineContext,
  useCases: UseCase[],
): Promise<FinancialQuantificationResult> {
  const log = ctx.logger ?? fallbackLogger;
  const { run } = ctx;
  const bc = run.businessContext;
  if (!bc || useCases.length === 0) {
    return { degraded: false, missingUseCaseIds: [] };
  }

  const batchSize = 25;
  const batches: UseCase[][] = [];
  for (let i = 0; i < useCases.length; i += batchSize) {
    batches.push(useCases.slice(i, i + batchSize));
  }

  // Use the compact patterns block when any batch will exceed 10 use cases.
  // The "Variables:" hint is mostly redundant once the formula is shown, and
  // trimming it shaves token cost on the prompt size that empirically
  // correlates with empty-content failures.
  const compactPatterns = useCases.length > 10;
  const economicPatternsContext = buildEconomicPatternsContext({
    compact: compactPatterns,
  });
  const industryReferenceCases = buildIndustryReferenceCases({
    canonicalIndustryId: run.config.industry ?? null,
    freeText: bc.industries,
    // Caps default to 2 industries x 8 cases each = max 16 reference rows.
  });

  const baseVariables = {
    business_name: run.config.businessName,
    industries: bc.industries,
    revenue_model: bc.revenueModel,
    strategic_goals: bc.strategicGoals,
    value_chain: bc.valueChain,
    estate_context: `${useCases.length} use cases across ${new Set(useCases.map((u) => u.domain)).size} domains`,
    economic_patterns_context: economicPatternsContext,
    industry_reference_cases: industryReferenceCases,
  };

  const allMissingIds: string[] = [];
  const allEstimates: RawFinancialEstimate[] = [];
  let resolvedEndpoint: string | null = null;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    if (batches.length > 1) {
      await updateRunMessage(
        run.runId,
        `Quantifying financial value (batch ${batchIdx + 1} of ${batches.length})...`,
      );
    }

    try {
      const { estimates, missingUseCaseIds, lastEndpoint } = await quantifyWithHalveBatchFallback(
        ctx,
        batch,
        baseVariables,
        log,
      );
      allEstimates.push(...estimates);
      allMissingIds.push(...missingUseCaseIds);
      if (lastEndpoint) resolvedEndpoint = lastEndpoint;
    } catch (err) {
      log.warn("Financial quantification batch fully failed", {
        fn: "runFinancialQuantification",
        errorCategory: "llm_error",
        batchIdx,
        batchSize: batch.length,
        error: String(err),
      });
      allMissingIds.push(...batch.map((u) => u.id));
    }
  }

  if (allEstimates.length > 0) {
    await upsertValueEstimates(
      run.runId,
      allEstimates.map((e) => {
        const valueType = (e.value_type || "efficiency_gain") as ValueType;
        // Prefer the LLM's structured category; fall back via legacy map.
        const impactCategory =
          e.economic_impact_category && isEconomicImpactCategory(e.economic_impact_category)
            ? e.economic_impact_category
            : (LEGACY_VALUE_TYPE_MAP[valueType] ?? null);
        const patternName =
          e.economic_pattern_name && isEconomicPatternName(e.economic_pattern_name)
            ? e.economic_pattern_name
            : null;
        return {
          useCaseId: e.use_case_id,
          valueLow: Math.max(0, e.value_low ?? 0),
          valueMid: Math.max(0, e.value_mid ?? 0),
          valueHigh: Math.max(0, e.value_high ?? 0),
          valueType,
          confidence: (e.confidence || "medium") as ValueConfidence,
          rationale: e.rationale,
          assumptions: e.assumptions,
          industryBenchmark: e.industry_benchmark,
          economicPatternName: patternName,
          economicImpactCategory: impactCategory,
          economicFormulaVars: e.economic_formula_vars ?? null,
        };
      }),
      {
        generatedByModel: resolvedEndpoint,
        generatedAt: new Date(),
      },
    );
  }

  const degraded = allMissingIds.length > 0;
  if (degraded) {
    log.warn("Financial quantification degraded: missing estimates for some use cases", {
      fn: "runFinancialQuantification",
      errorCategory: "llm_partial_failure",
      missingCount: allMissingIds.length,
      totalCount: useCases.length,
    });
  }

  return { degraded, missingUseCaseIds: allMissingIds };
}

// ---------------------------------------------------------------------------
// Pass 2: Roadmap Phasing
// ---------------------------------------------------------------------------

async function runRoadmapPhasing(ctx: PipelineContext, useCases: UseCase[]): Promise<void> {
  const log = ctx.logger ?? fallbackLogger;
  const { run } = ctx;
  const bc = run.businessContext;
  if (!bc || useCases.length === 0) return;

  const variables: Record<string, string> = {
    business_name: run.config.businessName,
    industries: bc.industries,
    strategic_goals: bc.strategicGoals,
    use_cases_json: summariseCasesForLLM(useCases),
  };

  try {
    const endpoint = resolvePremiumReasoningEndpoint();
    const result = await executeAIQuery({
      runId: run.runId,
      promptKey: "ROADMAP_PHASING_PROMPT",
      variables,
      modelEndpoint: endpoint,
      responseFormat: "json_object",
    });

    type RawPhase = {
      use_case_id: string;
      phase: string;
      phase_order: number;
      effort_estimate?: string;
      dependencies?: string[];
      enablers?: string[];
      rationale?: string;
    };
    const phases = safeParseArray<RawPhase>(result.rawResponse);

    if (phases.length > 0) {
      await upsertRoadmapPhases(
        run.runId,
        phases.map((p) => ({
          useCaseId: p.use_case_id,
          phase: (p.phase || "foundation") as RoadmapPhase,
          phaseOrder: p.phase_order ?? 0,
          effortEstimate: (p.effort_estimate || "m") as EffortEstimate,
          dependencies: p.dependencies,
          enablers: p.enablers,
          rationale: p.rationale,
        })),
        {
          generatedByModel: result.endpoint ?? endpoint,
          generatedAt: new Date(),
        },
      );
    }
  } catch (err) {
    log.warn("Roadmap phasing failed", {
      fn: "runRoadmapPhasing",
      errorCategory: "llm_error",
      error: String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 3: Executive Synthesis
// ---------------------------------------------------------------------------

async function runExecutiveSynthesis(ctx: PipelineContext, useCases: UseCase[]): Promise<void> {
  const log = ctx.logger ?? fallbackLogger;
  const { run } = ctx;
  const bc = run.businessContext;
  if (!bc || useCases.length === 0) return;

  const domains = [...new Set(useCases.map((u) => u.domain))];
  const topUseCases = [...useCases].sort((a, b) => b.overallScore - a.overallScore).slice(0, 15);

  const useCaseSummary = [
    `Total: ${useCases.length} use cases across ${domains.length} domains`,
    `Top domains: ${domains.slice(0, 5).join(", ")}`,
    `Score range: ${Math.min(...useCases.map((u) => u.overallScore)).toFixed(2)} - ${Math.max(...useCases.map((u) => u.overallScore)).toFixed(2)}`,
    `Types: AI ${useCases.filter((u) => u.type === "AI").length}, Statistical ${useCases.filter((u) => u.type === "Statistical").length}`,
    `Top 15 use cases:\n${topUseCases.map((u) => `- ${u.name} (${u.domain}, score: ${u.overallScore.toFixed(2)}): ${u.businessValue}`).join("\n")}`,
  ].join("\n");

  const strategyAlignment = run.config.industry
    ? buildStrategyAlignmentPrompt(
        run.config.industry,
        useCases.map((u) => u.name),
      )
    : null;

  const variables: Record<string, string> = {
    business_name: run.config.businessName,
    industries: bc.industries,
    strategic_goals: bc.strategicGoals,
    value_chain: bc.valueChain,
    use_case_summary: useCaseSummary,
    estate_summary: "Estate scan data available in full pipeline context",
    value_summary: `${useCases.length} use cases scored and ranked`,
    strategy_alignment: strategyAlignment || "No industry strategy alignment data available.",
  };

  try {
    const endpoint = resolvePremiumReasoningEndpoint();
    const result = await executeAIQuery({
      runId: run.runId,
      promptKey: "EXECUTIVE_SYNTHESIS_PROMPT",
      variables,
      modelEndpoint: endpoint,
      responseFormat: "json_object",
    });

    type RawSynthesis = {
      key_findings?: Array<{
        title: string;
        description: string;
        domain: string | null;
        severity: string;
      }>;
      strategic_recommendations?: Array<{
        title: string;
        description: string;
        priority: string;
      }>;
      risk_callouts?: Array<{
        title: string;
        description: string;
        impact: string;
      }>;
    };
    const raw = safeParse<RawSynthesis>(result.rawResponse, {});

    const synthesis: ExecutiveSynthesis = {
      keyFindings: (raw.key_findings ?? []).map((f) => ({
        ...f,
        severity: f.severity as "opportunity" | "risk" | "insight",
      })),
      strategicRecommendations: (raw.strategic_recommendations ?? []).map((r) => ({
        ...r,
        priority: r.priority as "high" | "medium" | "low",
      })),
      riskCallouts: (raw.risk_callouts ?? []).map((r) => ({
        ...r,
        impact: r.impact as "high" | "medium" | "low",
      })),
      totalEstimatedValue: { low: 0, mid: 0, high: 0, currency: "USD" },
      quickWinCount: 0,
      topDomain: null,
    };

    if (synthesis.keyFindings.length > 0 || synthesis.strategicRecommendations.length > 0) {
      synthesis.quickWinCount = useCases.filter(
        (u) => u.feasibilityScore >= 0.7 && u.overallScore >= 0.6,
      ).length;
      synthesis.topDomain = domains[0] ?? null;

      await withPrisma(async (prisma) => {
        await prisma.forgeRun.update({
          where: { runId: run.runId },
          data: {
            synthesisJson: JSON.stringify(synthesis),
            synthesisGeneratedByModel: result.endpoint ?? endpoint,
            synthesisGeneratedAt: new Date(),
          },
        });
      });
    }
  } catch (err) {
    log.warn("Executive synthesis failed", {
      fn: "runBusinessValueAnalysis",
      errorCategory: "llm_error",
      error: String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 4: Stakeholder Analysis
// ---------------------------------------------------------------------------

/**
 * Result of the stakeholder-analysis pass. `degraded` is true when no
 * profile was persisted (LLM returned empty / threw across both primary
 * and fallback endpoint). The caller flips the run-level degraded flag
 * so the UI can render a Rerun CTA instead of a silent empty state.
 */
interface StakeholderAnalysisResult {
  degraded: boolean;
  reason?: "empty" | "error";
  endpointsTried: string[];
  errorMessage?: string;
  profileCount: number;
}

type RawProfile = {
  role: string;
  department: string;
  use_case_ids?: string[];
  use_case_count: number;
  domains: string[];
  use_case_types: Record<string, number>;
  change_complexity: "low" | "medium" | "high";
  is_champion: boolean;
  is_sponsor: boolean;
  champion_rationale?: string;
  complexity_rationale?: string;
  key_risks?: string[];
};

async function attemptStakeholderPass(
  ctx: PipelineContext,
  variables: Record<string, string>,
  endpoint: string,
): Promise<{ profiles: RawProfile[]; resolvedEndpoint: string; rawShape: string }> {
  const result = await executeAIQuery({
    runId: ctx.run.runId,
    promptKey: "STAKEHOLDER_ANALYSIS_PROMPT",
    variables,
    modelEndpoint: endpoint,
    responseFormat: "json_object",
  });
  const profiles = safeParseArray<RawProfile>(result.rawResponse);
  const rawShape = describeRawShape(result.rawResponse);
  return { profiles, resolvedEndpoint: result.endpoint ?? endpoint, rawShape };
}

async function runStakeholderAnalysis(
  ctx: PipelineContext,
  useCases: UseCase[],
): Promise<StakeholderAnalysisResult> {
  const log = ctx.logger ?? fallbackLogger;
  const { run } = ctx;
  const bc = run.businessContext;
  if (!bc || useCases.length === 0) {
    return { degraded: false, endpointsTried: [], profileCount: 0 };
  }

  const stakeholderData = useCases.map((uc) => ({
    use_case_id: uc.id,
    name: uc.name,
    domain: uc.domain,
    type: uc.type,
    beneficiary: uc.beneficiary,
    sponsor: uc.sponsor,
    overall_score: uc.overallScore,
    // Phase 3.5: surface the source systems each use case touches so the
    // change-management LLM can identify the *true* organisational owners
    // (e.g. "Salesforce" → CRO / Sales Ops, "SAP" → CFO / Supply Chain).
    source_systems: uc.sourceSystems && uc.sourceSystems.length > 0
      ? uc.sourceSystems
      : undefined,
  }));

  const variables: Record<string, string> = {
    business_name: run.config.businessName,
    industries: bc.industries,
    stakeholder_json: JSON.stringify(stakeholderData, null, 2),
  };

  const primary = resolvePremiumReasoningEndpoint();
  const fallbacks = getFallbacksForTier("reasoning", primary);
  // One-shot fallback retry: try primary, then the first fallback endpoint
  // if the primary returns empty or throws. Beyond that we give up and flag
  // the step as degraded.
  const endpointSequence = [primary, ...fallbacks.slice(0, 1)];
  const endpointsTried: string[] = [];

  let profiles: RawProfile[] = [];
  let resolvedEndpoint: string | null = null;
  let lastError: string | undefined;

  for (const endpoint of endpointSequence) {
    endpointsTried.push(endpoint);
    try {
      const r = await attemptStakeholderPass(ctx, variables, endpoint);
      if (r.profiles.length > 0) {
        profiles = r.profiles;
        resolvedEndpoint = r.resolvedEndpoint;
        break;
      }
      log.warn("Stakeholder analysis returned empty result, attempting fallback", {
        fn: "runStakeholderAnalysis",
        errorCategory: "llm_empty",
        endpoint,
        rawShape: r.rawShape,
      });
    } catch (err) {
      lastError = String(err);
      log.warn("Stakeholder analysis pass threw, attempting fallback", {
        fn: "runStakeholderAnalysis",
        errorCategory: "llm_error",
        endpoint,
        error: lastError,
      });
    }
  }

  if (profiles.length === 0) {
    log.warn("Stakeholder analysis degraded after all endpoint attempts", {
      fn: "runStakeholderAnalysis",
      endpointsTried,
      lastError,
    });
    return {
      degraded: true,
      reason: lastError ? "error" : "empty",
      endpointsTried,
      errorMessage: lastError,
      profileCount: 0,
    };
  }

  const estimates = await getValueEstimatesForRun(run.runId);
  const valueByUseCase = new Map(estimates.map((e) => [e.useCaseId, e.valueMid]));

  await replaceStakeholderProfiles(
    run.runId,
    profiles.map((p) => {
      const ucIds = p.use_case_ids ?? [];
      const totalValue = ucIds.reduce((sum, id) => sum + (valueByUseCase.get(id) ?? 0), 0);
      return {
        role: p.role || "Unknown",
        department: p.department || "Unknown",
        useCaseCount: p.use_case_count ?? ucIds.length ?? 0,
        totalValue,
        domains: p.domains ?? [],
        useCaseTypes: p.use_case_types ?? {},
        useCaseIds: ucIds,
        changeComplexity: p.change_complexity || "medium",
        isChampion: p.is_champion ?? false,
        isSponsor: p.is_sponsor ?? false,
        championRationale: p.champion_rationale ?? null,
        complexityRationale: p.complexity_rationale ?? null,
        keyRisks: p.key_risks ?? null,
      };
    }),
    {
      generatedByModel: resolvedEndpoint,
      generatedAt: new Date(),
    },
  );

  return {
    degraded: false,
    endpointsTried,
    profileCount: profiles.length,
  };
}

/**
 * Best-effort description of the LLM raw response's top-level JSON shape, used
 * only when an array pass returned 0 items. Keeps logs concise (no full body)
 * while making diagnoses possible -- e.g. "object{keys=stakeholders,notes;
 * arrayKey=stakeholders[12]}" vs. "array[0]" vs. "object{empty}".
 */
function describeRawShape(raw: string | null | undefined): string {
  if (!raw) return "empty-string";
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim(),
    );
  } catch (err) {
    return `parse-error:${(err as Error).message.slice(0, 80)}`;
  }
  if (Array.isArray(parsed)) return `array[${parsed.length}]`;
  if (parsed === null || typeof parsed !== "object") {
    return `primitive:${typeof parsed}`;
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  const arrayKey = keys.find((k) => Array.isArray(obj[k]));
  if (arrayKey) {
    const arr = obj[arrayKey] as unknown[];
    return `object{keys=${keys.join(",")};arrayKey=${arrayKey}[${arr.length}]}`;
  }
  return `object{keys=${keys.join(",")}}`;
}

// ---------------------------------------------------------------------------
// Main step entry point
// ---------------------------------------------------------------------------

export async function runBusinessValueAnalysis(ctx: PipelineContext): Promise<void> {
  const log = ctx.logger ?? fallbackLogger;
  const useCases = ctx.useCases;

  if (!useCases || useCases.length === 0) {
    log.info("No use cases to analyze, skipping");
    return;
  }

  log.info("Starting business value analysis", {
    useCaseCount: useCases.length,
  });

  // Initialize tracking records for all use cases
  await bulkInitTracking(
    ctx.run.runId,
    useCases.map((u) => u.id),
  );

  const runId = ctx.run.runId;

  // All four BV passes are pinned to the premium reasoning endpoint
  // (databricks-claude-opus-4-7 with Opus / GPT-5 fallbacks). Stakeholder
  // analysis previously ran on flash-lite, which silently degraded under
  // load and left consumers staring at empty pages. The Opus pin is the
  // single source-of-truth fix; resolvePremiumReasoningEndpoint() picks
  // the best available endpoint per call.
  // Mirror per-pass progress to the BV background-job tracker so the
  // /api/runs/[runId]/business-value/status polling endpoint surfaces
  // real-time progress in the UI (otherwise we sit at 0/4 the whole time).
  const FIN_MSG = "Quantifying financial value with premium reasoning model (Opus 4-7)...";
  const ROADMAP_MSG = "Building implementation roadmap phases (Opus 4-7)...";
  const SYNTH_MSG = "Generating executive synthesis (Opus 4-7)...";
  const STAKE_MSG = "Analyzing stakeholder profiles (Opus 4-7)...";

  await updateRunMessage(runId, FIN_MSG, 86);
  updateBvJob(runId, FIN_MSG, 25);
  const finResult = await runFinancialQuantification(ctx, useCases);
  markBvPassComplete(runId, "financial-quantification");

  await updateRunMessage(runId, ROADMAP_MSG, 87);
  updateBvJob(runId, ROADMAP_MSG, 50);
  await runRoadmapPhasing(ctx, useCases);
  markBvPassComplete(runId, "roadmap-phasing");

  await updateRunMessage(runId, SYNTH_MSG, 88);
  updateBvJob(runId, SYNTH_MSG, 70);
  await runExecutiveSynthesis(ctx, useCases);
  markBvPassComplete(runId, "executive-synthesis");

  await updateRunMessage(runId, STAKE_MSG, 89);
  updateBvJob(runId, STAKE_MSG, 88);
  const stakeholderResult = await runStakeholderAnalysis(ctx, useCases);
  markBvPassComplete(runId, "stakeholder-analysis");
  updateBvJob(runId, "Business value passes complete", 92);

  // Surface degradation: when financial-quantification could not produce
  // estimates for one or more use cases, flag the run so the UI shows an
  // amber "Recompute" CTA instead of a silent $0.
  if (finResult.degraded) {
    markBvPassDegraded(runId, "financial-quantification");
    await markRunStepDegraded(runId, "financial-quantification");
    // Fire-and-forget activity log so the failure is visible in the
    // activity stream and can be alerted on.
    logActivity("bv_step_degraded", {
      userId: ctx.ownerEmail ?? null,
      resourceId: runId,
      metadata: {
        step: "financial-quantification",
        missingUseCaseIds: finResult.missingUseCaseIds,
        missingCount: finResult.missingUseCaseIds.length,
        totalUseCases: useCases.length,
      },
    });
  } else {
    await clearRunStepDegraded(runId, "financial-quantification");
  }

  // Mirror the same degradation signal for stakeholder analysis. Today
  // the Stakeholder page renders an empty state when no profiles exist
  // for two very different reasons -- BV was disabled vs. the LLM pass
  // failed silently. The flag lets the UI tell the difference.
  if (stakeholderResult.degraded) {
    markBvPassDegraded(runId, "stakeholder-analysis");
    await markRunStepDegraded(runId, "stakeholder-analysis");
    logActivity("bv_step_degraded", {
      userId: ctx.ownerEmail ?? null,
      resourceId: runId,
      metadata: {
        step: "stakeholder-analysis",
        reason: stakeholderResult.reason ?? "empty",
        endpointsTried: stakeholderResult.endpointsTried,
        errorMessage: stakeholderResult.errorMessage,
      },
    });
  } else {
    await clearRunStepDegraded(runId, "stakeholder-analysis");
  }

  log.info("Business value analysis complete", {
    financialQuantificationDegraded: finResult.degraded,
    missingEstimateCount: finResult.missingUseCaseIds.length,
    stakeholderDegraded: stakeholderResult.degraded,
    stakeholderProfiles: stakeholderResult.profileCount,
  });
}
