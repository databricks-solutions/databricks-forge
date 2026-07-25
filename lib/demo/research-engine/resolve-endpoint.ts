/**
 * Research Engine endpoint resolution.
 *
 * Supports tiered routing: "reasoning" (default) pins to Opus/GPT-5 for
 * maximum quality; "generation" and "classification" delegate to the
 * queue-depth-aware task router for faster turnaround.
 */

import { getModelPool } from "@/lib/dbx/model-registry";
import { resolveEndpoint } from "@/lib/dbx/client";
import type { TaskTier } from "@/lib/dbx/model-registry";

const PREFERRED = "databricks-claude-opus-4-7";
const FALLBACKS = ["databricks-claude-opus-4-6", "databricks-gpt-5-4"] as const;

let _reasoningCached: string | null = null;

/**
 * Resolve an endpoint for research engine LLM calls.
 *
 * @param tier - When "reasoning" or omitted, uses the premium Opus/GPT-5
 *   path (bypasses task router). For any other tier, delegates to the
 *   queue-depth-aware task router for faster models.
 */
export function resolveResearchEndpoint(tier?: TaskTier): string {
  if (tier && tier !== "reasoning") {
    return resolveEndpoint(tier);
  }

  if (_reasoningCached) return _reasoningCached;

  const pool = getModelPool();
  const poolNames = new Set(pool.map((ep) => ep.name));

  if (poolNames.has(PREFERRED)) {
    _reasoningCached = PREFERRED;
  } else {
    const matched = FALLBACKS.find((name) => poolNames.has(name));
    _reasoningCached = matched ?? resolveEndpoint("reasoning");
  }

  return _reasoningCached;
}
