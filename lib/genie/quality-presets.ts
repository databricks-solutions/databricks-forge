/**
 * Quality Preset System for the Genie Engine.
 *
 * Each preset defines a GenerationBudget that controls how much content
 * is generated per domain, which review surfaces are enabled, and how
 * many domains run in parallel. The goal: produce A-grade health scores
 * with the minimum required work for Speed, scaling up richness for
 * Balanced and Premium.
 */

export type QualityPreset = "speed" | "balanced" | "premium";

export interface GenerationBudget {
  /** Target measure count for Worker A (foundation aggregates). */
  measuresWorkerA: number;
  /** Target measure count for Worker B (ratio/derived measures). */
  measuresWorkerB: number;
  /** Target filter count for Worker C. */
  filters: number;
  /** Target dimension count for Worker C. */
  dimensions: number;
  /** Max use cases fed to trusted asset authoring. */
  trustedAssetUseCaseCap: number;
  /** Max use cases fed to benchmark generation. */
  benchmarkUseCaseCap: number;
  /** Benchmarks requested per LLM batch call. */
  benchmarksPerBatch: number;
  /** Whether metric view generation is enabled. */
  enableMetricViews: boolean;
  /** Genie review surfaces to disable (values match isReviewEnabled surface names). */
  disabledReviewSurfaces: string[];
  /** Max domains processed in parallel. */
  domainConcurrency: number;
  /** maxTokens for semantic expression worker calls. */
  maxTokensExpressions: number;
  /** maxTokens for trusted asset authoring calls. */
  maxTokensTrustedAssets: number;
  /** maxTokens for benchmark generation calls. */
  maxTokensBenchmarks: number;
}

const SPEED_BUDGET: GenerationBudget = {
  measuresWorkerA: 4,
  measuresWorkerB: 2,
  filters: 4,
  dimensions: 4,
  trustedAssetUseCaseCap: 6,
  benchmarkUseCaseCap: 6,
  benchmarksPerBatch: 3,
  enableMetricViews: false,
  disabledReviewSurfaces: [
    "genie-semantic-expressions",
    "genie-join-inference",
    "genie-metric-views",
  ],
  domainConcurrency: 3,
  maxTokensExpressions: 2048,
  maxTokensTrustedAssets: 4096,
  maxTokensBenchmarks: 3072,
};

const BALANCED_BUDGET: GenerationBudget = {
  measuresWorkerA: 6,
  measuresWorkerB: 4,
  filters: 6,
  dimensions: 6,
  trustedAssetUseCaseCap: 9,
  benchmarkUseCaseCap: 9,
  benchmarksPerBatch: 4,
  enableMetricViews: true,
  disabledReviewSurfaces: ["genie-join-inference", "genie-metric-views"],
  domainConcurrency: 5,
  maxTokensExpressions: 3072,
  maxTokensTrustedAssets: 6144,
  maxTokensBenchmarks: 4096,
};

const PREMIUM_BUDGET: GenerationBudget = {
  measuresWorkerA: 15,
  measuresWorkerB: 10,
  filters: 12,
  dimensions: 12,
  trustedAssetUseCaseCap: 12,
  benchmarkUseCaseCap: 10,
  benchmarksPerBatch: 4,
  enableMetricViews: true,
  disabledReviewSurfaces: [],
  domainConcurrency: 10,
  maxTokensExpressions: 4096,
  maxTokensTrustedAssets: 8192,
  maxTokensBenchmarks: 6144,
};

const PRESETS: Record<QualityPreset, GenerationBudget> = {
  speed: SPEED_BUDGET,
  balanced: BALANCED_BUDGET,
  premium: PREMIUM_BUDGET,
};

/** Resolve the generation budget for a given quality preset. */
export function resolveBudget(preset: QualityPreset): GenerationBudget {
  return PRESETS[preset];
}
