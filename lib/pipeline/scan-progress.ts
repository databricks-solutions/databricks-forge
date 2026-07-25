/**
 * In-memory scan progress tracker.
 *
 * Standalone scans run fire-and-forget. This module provides a lightweight
 * way for the scan runner to report phase-level progress and for the
 * frontend to poll it via /api/environment-scan/[scanId]/progress.
 *
 * Progress entries auto-expire after 30 minutes to prevent memory leaks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanPhase =
  | "starting"
  | "listing-tables"
  | "fetching-metadata"
  | "walking-lineage"
  | "enriching"
  | "fetching-tags"
  | "health-scoring"
  | "llm-intelligence"
  | "asset-discovery"
  | "saving"
  | "complete"
  | "failed";

export interface ScanProgress {
  scanId: string;
  phase: ScanPhase;
  message: string;
  /** Total tables discovered so far (including lineage-expanded). */
  tablesFound: number;
  /** Total columns discovered. */
  columnsFound: number;
  /** Tables discovered via lineage walk. */
  lineageTablesFound: number;
  /** Lineage edges found. */
  lineageEdgesFound: number;
  /** Enrichment: how many tables processed so far. */
  enrichedCount: number;
  /** Total to enrich. */
  enrichTotal: number;
  /** Current LLM intelligence pass name (if running). */
  llmPass: string | null;
  /** Domains discovered by LLM. */
  domainsFound: number;
  /** PII tables detected by LLM. */
  piiDetected: number;
  /** Elapsed milliseconds since scan started. */
  elapsedMs: number;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoreEntry {
  progress: ScanProgress;
  startTime: number;
  expiresAt: number;
  ownerEmail: string | null;
}

const store = new Map<string, StoreEntry>();

/**
 * Initialize a scan progress entry.
 */
export function initScanProgress(scanId: string, ownerEmail: string | null = null): void {
  cleanup();
  const now = Date.now();
  store.set(scanId, {
    startTime: now,
    expiresAt: now + TTL_MS,
    ownerEmail: ownerEmail ? ownerEmail.toLowerCase().trim() : null,
    progress: {
      scanId,
      phase: "starting",
      message: "Initialising scan...",
      tablesFound: 0,
      columnsFound: 0,
      lineageTablesFound: 0,
      lineageEdgesFound: 0,
      enrichedCount: 0,
      enrichTotal: 0,
      llmPass: null,
      domainsFound: 0,
      piiDetected: 0,
      elapsedMs: 0,
      updatedAt: new Date().toISOString(),
    },
  });
}

/**
 * Count of scans currently in-flight for the given user, used by quota checks.
 *
 * "In-flight" means present in the in-memory store and not yet in a terminal
 * phase ("complete" or "failed").
 */
export function listInflightScansForUser(ownerEmail: string): number {
  cleanup();
  const target = ownerEmail.toLowerCase().trim();
  let count = 0;
  for (const entry of store.values()) {
    if (entry.ownerEmail !== target) continue;
    const phase = entry.progress.phase;
    if (phase === "complete" || phase === "failed") continue;
    count++;
  }
  return count;
}

/**
 * Update a scan's progress. Partial updates are merged.
 */
export function updateScanProgress(
  scanId: string,
  update: Partial<Omit<ScanProgress, "scanId" | "elapsedMs" | "updatedAt">>,
): void {
  const entry = store.get(scanId);
  if (!entry) return;

  const now = Date.now();
  entry.progress = {
    ...entry.progress,
    ...update,
    elapsedMs: now - entry.startTime,
    updatedAt: new Date(now).toISOString(),
  };
  entry.expiresAt = now + TTL_MS;
}

/**
 * Get the current progress for a scan. Returns null if not found/expired.
 */
export function getScanProgress(scanId: string): ScanProgress | null {
  cleanup();
  const entry = store.get(scanId);
  if (!entry) return null;

  // Recompute elapsed
  entry.progress.elapsedMs = Date.now() - entry.startTime;
  return { ...entry.progress };
}

/**
 * Return progress for all scans that are still running (not complete/failed).
 */
export function getActiveScans(): ScanProgress[] {
  cleanup();
  const now = Date.now();
  const active: ScanProgress[] = [];
  for (const entry of store.values()) {
    if (entry.progress.phase !== "complete" && entry.progress.phase !== "failed") {
      entry.progress.elapsedMs = now - entry.startTime;
      active.push({ ...entry.progress });
    }
  }
  return active;
}

/**
 * Remove expired entries.
 */
function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}
