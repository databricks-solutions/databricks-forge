/**
 * Ephemeral in-memory store for OBO tokens belonging to runs that were queued
 * by `checkQuota("pipeline", ..., "queue")`.
 *
 * Tokens are held in memory only (never written to Lakebase), expire after
 * MAX_TTL_MS (50 minutes, matching Databricks OBO token lifetime), and are
 * deleted immediately when claimed by `lib/pipeline/scheduler.ts`.
 */

interface QueuedTokenEntry {
  oboToken: string;
  expiresAt: number;
}

const MAX_TTL_MS = 50 * 60 * 1000;
const store = new Map<string, QueuedTokenEntry>();

export function stashQueuedOboToken(runId: string, oboToken: string | null | undefined): void {
  if (!runId || !oboToken) return;
  store.set(runId, {
    oboToken,
    expiresAt: Date.now() + MAX_TTL_MS,
  });
}

export function consumeQueuedOboToken(runId: string): string | null {
  const entry = store.get(runId);
  if (!entry) return null;
  store.delete(runId);
  if (Date.now() >= entry.expiresAt) {
    return null;
  }
  return entry.oboToken;
}

export function clearQueuedOboTokens(): void {
  store.clear();
}
