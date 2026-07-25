/**
 * In-memory cache for serialized Genie Space JSON.
 *
 * Avoids redundant getGenieSpace() API calls during health check, fix,
 * and benchmark workflows. 5-minute TTL, invalidated on mutations.
 */

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  serializedSpace: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getSpaceCache(spaceId: string): string | null {
  const entry = cache.get(spaceId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(spaceId);
    return null;
  }
  return entry.serializedSpace;
}

export function setSpaceCache(spaceId: string, serializedSpace: string): void {
  cache.set(spaceId, {
    serializedSpace,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function invalidateSpaceCache(spaceId: string): void {
  cache.delete(spaceId);
}

export function clearAllSpaceCache(): void {
  cache.clear();
}
