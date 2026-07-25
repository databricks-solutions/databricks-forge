/**
 * In-memory LRU cache for industry-landscape pass output.
 *
 * Keyed by `industryId::subVertical` with a 24h TTL. The industry
 * landscape is deterministic with respect to (industry, sub-vertical),
 * so repeat customers in the same segment can skip the ~30s pass.
 *
 * Kept deliberately simple (in-memory, per-process). If horizontal
 * scaling becomes necessary the plan calls for an optional
 * `ForgeIndustryLandscapeCache` Lakebase table; that would replace this
 * module without changing its interface.
 */

import type { IndustryLandscapeAnalysis } from "./types";

interface CacheEntry {
  value: IndustryLandscapeAnalysis;
  storedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 50;

const cache = new Map<string, CacheEntry>();

function buildKey(industryId: string, subVertical?: string): string {
  return `${industryId}::${(subVertical ?? "").trim().toLowerCase()}`;
}

export function getCachedIndustryLandscape(
  industryId: string,
  subVertical?: string,
): IndustryLandscapeAnalysis | null {
  const key = buildKey(industryId, subVertical);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Re-insert so LRU order reflects most recent read.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function setCachedIndustryLandscape(
  industryId: string,
  subVertical: string | undefined,
  value: IndustryLandscapeAnalysis,
): void {
  const key = buildKey(industryId, subVertical);
  cache.set(key, { value, storedAt: Date.now() });

  // Evict oldest entry if over the cap.
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function clearIndustryLandscapeCache(): void {
  cache.clear();
}
