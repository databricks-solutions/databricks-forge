/**
 * Smart Task Router.
 *
 * Maps TaskTier to the best available model endpoint using the model registry
 * and pool rate limiter. Considers tier compatibility, priority, and current
 * queue depth to spread load across endpoints.
 *
 * When only legacy env vars are configured (single endpoint), all tiers
 * resolve to that endpoint -- identical to the pre-pool behavior.
 */

import type { TaskTier } from "./model-registry";
import { getModelPool, getEndpointsForTier, isMultiEndpointPool } from "./model-registry";
import { getPoolRateLimiter } from "./rate-limiter";
import { getServingEndpoint, getFastServingEndpoint, getReviewEndpoint } from "./client";
import { logger } from "@/lib/logger";

// Re-export TaskTier so callers only need one import
export type { TaskTier } from "./model-registry";

// ---------------------------------------------------------------------------
// Legacy tier mapping (when pool has a single endpoint or no pool configured)
// ---------------------------------------------------------------------------

function legacyResolve(tier: TaskTier): string {
  switch (tier) {
    case "reasoning":
    case "generation":
      return getServingEndpoint();
    case "classification":
    case "lightweight":
      return getFastServingEndpoint();
    case "sql":
      return getReviewEndpoint();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the best endpoint for a given task tier.
 *
 * Resolution:
 *   1. If pool has a single endpoint, return it (legacy mode).
 *   2. Get all endpoints that support the tier, sorted by priority.
 *   3. Ask the pool rate limiter for the best available (lowest queue depth,
 *      not in 429 backoff).
 *   4. If all tier-specific endpoints are saturated, try any endpoint.
 *   5. Final fallback: legacy resolution.
 */
export function resolveEndpoint(tier: TaskTier): string {
  let chosen: string;
  let source: string;

  if (!isMultiEndpointPool()) {
    chosen = legacyResolve(tier);
    source = "legacy";
  } else {
    const candidates = getEndpointsForTier(tier);
    if (candidates.length === 0) {
      chosen = legacyResolve(tier);
      source = "legacy-no-candidates";
    } else {
      const limiter = getPoolRateLimiter();
      const tierNames = candidates.map((c) => c.name);
      const best = limiter.bestAvailable(tierNames);

      if (best && !limiter.isBlocked(best)) {
        chosen = best;
        source = "tier-match";
      } else {
        const allNames = getModelPool()
          .filter((ep) => ep.available)
          .map((ep) => ep.name);
        const fallback = limiter.bestAvailable(allNames);
        if (fallback && !limiter.isBlocked(fallback)) {
          chosen = fallback;
          source = "overflow";
        } else if (best) {
          chosen = best;
          source = "blocked-tier";
        } else if (fallback) {
          chosen = fallback;
          source = "blocked-any";
        } else {
          chosen = legacyResolve(tier);
          source = "legacy-all-blocked";
        }
      }
    }
  }

  logger.debug("Endpoint resolved", { tier, endpoint: chosen, source });
  return chosen;
}

/**
 * Get fallback endpoints for a given tier, excluding `currentEndpoint`.
 * Used by retry/fallback logic when the primary endpoint returns 429.
 */
export function getFallbacksForTier(tier: TaskTier, currentEndpoint: string): string[] {
  const candidates = getEndpointsForTier(tier).map((c) => c.name);
  const filtered = candidates.filter((c) => c !== currentEndpoint);

  if (filtered.length > 0) return filtered;

  // Fall back to any available endpoint in the pool
  return getModelPool()
    .filter((ep) => ep.available)
    .map((ep) => ep.name)
    .filter((n) => n !== currentEndpoint);
}

// ---------------------------------------------------------------------------
// Premium reasoning endpoint (Business Value + Outcome Map synthesis)
// ---------------------------------------------------------------------------

/**
 * Canonical premium reasoning endpoint. Business Value Analysis, Outcome Map
 * enrichment, and Data-Gap-grounded prompts are all pinned to this model.
 * Critical customer-facing data — we trade throughput for consistency and
 * judgment quality.
 */
const PREMIUM_REASONING = "databricks-claude-opus-4-7";

/**
 * Ordered Opus / GPT fallbacks if the canonical premium model is not in
 * the pool or has been marked unavailable. Falls through to the regular
 * reasoning-tier resolver if none of these are present.
 */
const PREMIUM_FALLBACKS = [
  "databricks-claude-opus-4-6",
  "databricks-claude-opus-4-5",
  "databricks-gpt-5-4",
] as const;

/**
 * Resolve the premium reasoning endpoint, with deterministic Opus-family
 * fallbacks. Unlike `resolveEndpoint("reasoning")`, this never returns a
 * generation-tier or classification-tier model — if every Opus / GPT-5
 * candidate is unavailable, it falls back to the standard reasoning
 * resolver as a last resort (better than returning nothing).
 *
 * Use this for any LLM call whose output is presented to a customer as
 * authoritative business insight (financial estimates, executive synthesis,
 * stakeholder recommendations, outcome map enrichment).
 */
export function resolvePremiumReasoningEndpoint(): string {
  const pool = getModelPool();
  const available = new Set(pool.filter((ep) => ep.available).map((ep) => ep.name));

  if (available.has(PREMIUM_REASONING)) {
    logger.debug("Premium endpoint resolved", { endpoint: PREMIUM_REASONING, source: "primary" });
    return PREMIUM_REASONING;
  }
  for (const name of PREMIUM_FALLBACKS) {
    if (available.has(name)) {
      logger.debug("Premium endpoint resolved", { endpoint: name, source: "premium-fallback" });
      return name;
    }
  }

  const fallback = resolveEndpoint("reasoning");
  logger.warn("Premium endpoint resolution fell back to standard reasoning tier", {
    endpoint: fallback,
  });
  return fallback;
}
