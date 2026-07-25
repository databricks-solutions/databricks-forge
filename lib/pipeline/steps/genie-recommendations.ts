/**
 * Pipeline Step 8: Genie Space Recommendations
 *
 * Uses the Genie Engine to generate production-grade Genie Space
 * recommendations with full knowledge stores, benchmarks, and metric
 * view proposals. Falls back to the legacy generator if the engine fails.
 */

import type { PipelineContext } from "@/lib/domain/types";
import { EngineCancelledError, runGenieEngine } from "@/lib/genie/engine";
import { generateGenieRecommendations } from "@/lib/genie/recommend";
import { saveGenieRecommendations } from "@/lib/lakebase/genie-recommendations";
import { getGenieEngineConfig } from "@/lib/lakebase/genie-engine-config";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger as fallbackLogger } from "@/lib/logger";

export interface GenieRecommendationOptions {
  signal?: AbortSignal;
  allowLegacyFallback?: boolean;
  requireSemanticManifests?: boolean;
}

export async function runGenieRecommendations(
  ctx: PipelineContext,
  runId: string,
  onProgress?: (
    message: string,
    percent: number,
    completedDomains: number,
    totalDomains: number,
    completedDomainName?: string,
  ) => void,
  onDomainsReady?: (domains: Array<{ domain: string; tables: number }>) => void,
  onDomainPhase?: (domain: string, phase: import("@/lib/genie/engine-status").DomainPhase) => void,
  options: GenieRecommendationOptions = {},
): Promise<number> {
  const log = ctx.logger ?? fallbackLogger;
  const metadata = ctx.metadata ?? (await loadMetadataForRun(runId));
  if (!metadata) {
    log.warn("Skipping Genie recommendations: no metadata snapshot available", {
      fn: "runGenieRecommendations",
      errorCategory: "data",
      runId,
    });
    return 0;
  }

  if (ctx.useCases.length === 0) {
    log.warn("Skipping Genie recommendations: no use cases available", {
      fn: "runGenieRecommendations",
      errorCategory: "data",
      runId,
    });
    return 0;
  }

  try {
    // Load engine config (defaults if none saved)
    const { config, version } = await getGenieEngineConfig(runId);

    const result = await runGenieEngine({
      run: ctx.run,
      useCases: ctx.useCases,
      metadata,
      config,
      sampleData: ctx.sampleData,
      existingSpaces: ctx.discoveryResult?.genieSpaces,
      signal: options.signal,
      onProgress,
      onDomainsReady,
      onDomainPhase,
    });

    if (options.requireSemanticManifests) {
      const manifestDomains = new Set(
        result.passOutputs
          .filter((output) => output.semanticAssetManifest)
          .map((output) => output.domain),
      );
      const complete =
        result.recommendations.length > 0 &&
        result.failedDomains.length === 0 &&
        result.recommendations.every((recommendation) =>
          manifestDomains.has(recommendation.domain),
        );
      if (!complete) {
        throw new Error(
          "Genie semantic stage produced no persisted domain semantic manifests or incomplete domain output",
        );
      }
    }

    await saveGenieRecommendations(runId, result.recommendations, result.passOutputs, version);
    const manifestDomains = result.passOutputs
      .filter((output) => output.semanticAssetManifest)
      .map((output) => output.domain);
    const improveCount = result.passOutputs.reduce(
      (total, output) =>
        total +
        (output.metricViewProposals ?? []).filter(
          (proposal) => proposal.classification === "improve",
        ).length,
      0,
    );
    const userId = ctx.ownerEmail ?? ctx.run.ownerEmail ?? null;
    if (manifestDomains.length > 0) {
      await logActivity("semantic_manifest_built", {
        userId,
        resourceId: runId,
        metadata: {
          manifestCount: manifestDomains.length,
          domains: manifestDomains,
        },
      });
    }
    if (improveCount > 0) {
      await logActivity("metric_view_improve_planned", {
        userId,
        resourceId: runId,
        metadata: {
          improveCount,
          domains: result.passOutputs
            .filter((output) =>
              (output.metricViewProposals ?? []).some(
                (proposal) => proposal.classification === "improve",
              ),
            )
            .map((output) => output.domain),
        },
      });
    }

    log.info("Genie Engine recommendations generated and persisted", {
      runId,
      recommendationCount: result.recommendations.length,
      domains: result.recommendations.map((r) => r.domain),
      engineConfigVersion: version,
    });

    return result.recommendations.length;
  } catch (err) {
    if (err instanceof EngineCancelledError) {
      throw err;
    }
    if (options.allowLegacyFallback === false) {
      throw err;
    }

    // Fallback to legacy generator
    log.warn("Genie Engine failed, falling back to legacy generator", {
      fn: "runGenieRecommendations",
      errorCategory: "llm_error",
      runId,
      error: err instanceof Error ? err.message : String(err),
    });

    const { config: fallbackConfig } = await getGenieEngineConfig(runId);
    const recommendations = generateGenieRecommendations(
      ctx.run,
      ctx.useCases,
      metadata,
      fallbackConfig.questionComplexity,
    );

    await saveGenieRecommendations(runId, recommendations);

    log.info("Legacy Genie recommendations generated (fallback)", {
      fn: "runGenieRecommendations",
      recommendationCount: recommendations.length,
    });

    return recommendations.length;
  }
}
