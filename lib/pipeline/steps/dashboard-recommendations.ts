/**
 * Pipeline Step: Dashboard Recommendations
 *
 * Uses the Dashboard Engine to generate AI/BI (Lakeview) dashboard
 * recommendations per domain. Runs as a background task after pipeline
 * completion and after Genie persists semantic manifests.
 */

import type { PipelineContext } from "@/lib/domain/types";
import { runDashboardEngine } from "@/lib/dashboard/engine";
import { saveDashboardRecommendations } from "@/lib/lakebase/dashboard-recommendations";
import { getGenieRecommendationsByRunId } from "@/lib/lakebase/genie-recommendations";
import { loadMetadataForRun } from "@/lib/lakebase/metadata-cache";
import { logger as fallbackLogger } from "@/lib/logger";
import { failDashboardJob } from "@/lib/dashboard/engine-status";
import { DashboardValidationError } from "@/lib/dashboard/errors";
import type { DashboardValidationFailure } from "@/lib/dashboard/types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import {
  missingDashboardManifestDomains,
  normalizeDashboardDomain,
  selectDashboardDomainGroups,
} from "@/lib/dashboard/domain-groups";

export interface DashboardRecommendationsResult {
  recommendationCount: number;
  validationFailures: DashboardValidationFailure[];
}

export async function runDashboardRecommendations(
  ctx: PipelineContext,
  runId: string,
  onProgress?: (message: string, percent: number) => void,
): Promise<DashboardRecommendationsResult> {
  const log = ctx.logger ?? fallbackLogger;
  const metadata = ctx.metadata ?? (await loadMetadataForRun(runId));
  if (!metadata) {
    log.warn("Skipping dashboard recommendations: no metadata snapshot available", {
      fn: "runDashboardRecommendations",
      errorCategory: "data",
      runId,
    });
    return { recommendationCount: 0, validationFailures: [] };
  }

  if (ctx.useCases.length === 0) {
    log.warn("Skipping dashboard recommendations: no use cases available", {
      fn: "runDashboardRecommendations",
      errorCategory: "data",
      runId,
    });
    return { recommendationCount: 0, validationFailures: [] };
  }

  try {
    // Load only persisted, owner/run-scoped Genie output. The orchestrator
    // starts this step after Genie has completed manifest persistence.
    const ownerEmail = ctx.ownerEmail ?? ctx.run.ownerEmail ?? null;
    const genieRecommendations = await getGenieRecommendationsByRunId(runId, ownerEmail);
    const semanticManifests: Record<string, SemanticAssetManifest> = {};
    for (const recommendation of genieRecommendations) {
      if (!recommendation.semanticAssetManifest) continue;
      try {
        const manifest = JSON.parse(recommendation.semanticAssetManifest) as SemanticAssetManifest;
        if (
          manifest.version === "1" &&
          normalizeDashboardDomain(manifest.domain) ===
            normalizeDashboardDomain(recommendation.domain)
        ) {
          semanticManifests[recommendation.domain] = manifest;
        }
      } catch {
        log.warn("Ignoring malformed persisted semantic manifest", {
          fn: "runDashboardRecommendations",
          runId,
          domain: recommendation.domain,
        });
      }
    }
    const requiredDomainGroups = selectDashboardDomainGroups(ctx.useCases);
    const missingManifestDomains = missingDashboardManifestDomains(
      requiredDomainGroups,
      semanticManifests,
    );
    if (missingManifestDomains.length > 0) {
      throw new Error(
        `No persisted Genie semantic manifests are available for dashboard domains: ${missingManifestDomains.join(", ")}`,
      );
    }

    const result = await runDashboardEngine({
      run: ctx.run,
      useCases: ctx.useCases,
      metadata,
      genieRecommendations,
      semanticManifests,
      existingDashboards: ctx.discoveryResult?.dashboards,
      onProgress,
    });

    if (result.recommendations.length === 0 && result.validationFailures.length > 0) {
      const count = result.validationFailures.length;
      const message = `Dashboard validation failed for ${count} domain${count === 1 ? "" : "s"}`;
      await failDashboardJob(runId, message, result.validationFailures);
      throw new DashboardValidationError(message, result.validationFailures);
    }

    await saveDashboardRecommendations(
      runId,
      result.recommendations,
      undefined,
      ctx.run.ownerEmail,
    );

    log.info("Dashboard recommendations generated and persisted", {
      runId,
      recommendationCount: result.recommendations.length,
      domains: result.recommendations.map((r) => r.domain),
    });

    return {
      recommendationCount: result.recommendations.length,
      validationFailures: result.validationFailures,
    };
  } catch (err) {
    log.error("Dashboard Engine failed", {
      fn: "runDashboardRecommendations",
      errorCategory: err instanceof DashboardValidationError ? "validation" : "llm_error",
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
