/**
 * In-memory comment engine progress tracker.
 *
 * Same pattern as `lib/pipeline/scan-progress.ts` -- fire-and-forget engine
 * writes progress here, frontend polls it via
 * `/api/environment/comments/[jobId]/progress`.
 *
 * Entries auto-expire after 30 minutes to prevent memory leaks.
 *
 * @module ai/comment-engine/progress
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommentPhase =
  | "starting"
  | "fetching-metadata"
  | "walking-lineage"
  | "enriching-tables"
  | "classifying"
  | "generating-tables"
  | "generating-columns"
  | "consistency-review"
  | "saving"
  | "complete"
  | "failed";

export interface CommentProgress {
  jobId: string;
  phase: CommentPhase;
  message: string;

  /** Total tables discovered in scope. */
  tablesFound: number;
  /** Total columns discovered. */
  columnsFound: number;
  /** Lineage edges found. */
  lineageEdgesFound: number;

  /** Tables enriched with DESCRIBE DETAIL/HISTORY so far. */
  enrichedCount: number;
  /** Total to enrich. */
  enrichTotal: number;

  /** Table descriptions generated so far (Phase 2). */
  tablesGenerated: number;
  /** Column descriptions generated so far (Phase 3). */
  columnsGenerated: number;
  /** Tables processed in column pass so far. */
  columnTablesProcessed: number;

  /** Current table being processed (for column pass). */
  currentTable: string | null;

  /** Number of LLM batches in table pass. */
  tableBatches: number;
  /** Batches completed in table pass. */
  tableBatchesDone: number;

  /** Consistency fixes found. */
  consistencyFixes: number;

  /** Elapsed milliseconds since generation started. */
  elapsedMs: number;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const TTL_MS = 30 * 60 * 1000;

interface StoreEntry {
  progress: CommentProgress;
  startTime: number;
  expiresAt: number;
}

const store = new Map<string, StoreEntry>();

export function initCommentProgress(jobId: string): void {
  cleanup();
  const now = Date.now();
  store.set(jobId, {
    startTime: now,
    expiresAt: now + TTL_MS,
    progress: {
      jobId,
      phase: "starting",
      message: "Initialising comment generation...",
      tablesFound: 0,
      columnsFound: 0,
      lineageEdgesFound: 0,
      enrichedCount: 0,
      enrichTotal: 0,
      tablesGenerated: 0,
      columnsGenerated: 0,
      columnTablesProcessed: 0,
      currentTable: null,
      tableBatches: 0,
      tableBatchesDone: 0,
      consistencyFixes: 0,
      elapsedMs: 0,
      updatedAt: new Date().toISOString(),
    },
  });
}

export function updateCommentProgress(
  jobId: string,
  update: Partial<Omit<CommentProgress, "jobId" | "elapsedMs" | "updatedAt">>,
): void {
  const entry = store.get(jobId);
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

export function getCommentProgress(jobId: string): CommentProgress | null {
  cleanup();
  const entry = store.get(jobId);
  if (!entry) return null;
  entry.progress.elapsedMs = Date.now() - entry.startTime;
  return { ...entry.progress };
}

function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}
