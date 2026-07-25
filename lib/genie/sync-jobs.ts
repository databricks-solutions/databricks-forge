/**
 * In-memory job store for Genie Space workspace sync jobs.
 *
 * Follows the same fire-and-forget pattern as improve-jobs.ts:
 * POST starts a job and returns jobId immediately; client polls GET for status.
 * Only one sync can be active at a time.
 */

export interface SyncJobStatus {
  jobId: string;
  status: "syncing" | "completed" | "failed";
  message: string;
  percent: number;
  spacesFound: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

const jobs = new Map<string, SyncJobStatus>();

const JOB_TTL_MS = 30 * 60 * 1000;
const STUCK_TTL_MS = 60 * 60 * 1000;

function evictStale(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(id);
    } else if (!job.completedAt && now - job.startedAt > STUCK_TTL_MS) {
      jobs.delete(id);
    }
  }
}

/** Returns the active (syncing) job if one exists, to prevent concurrent syncs. */
export function getActiveSyncJob(): SyncJobStatus | null {
  evictStale();
  for (const job of jobs.values()) {
    if (job.status === "syncing") return job;
  }
  return null;
}

export function startSyncJob(jobId: string): void {
  evictStale();
  jobs.set(jobId, {
    jobId,
    status: "syncing",
    message: "Starting workspace sync...",
    percent: 0,
    spacesFound: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
  });
}

export function getSyncJob(jobId: string): SyncJobStatus | null {
  evictStale();
  return jobs.get(jobId) ?? null;
}

export function updateSyncJob(
  jobId: string,
  update: { message?: string; percent?: number; spacesFound?: number },
): void {
  const job = jobs.get(jobId);
  if (job && job.status === "syncing") {
    if (update.message !== undefined) job.message = update.message;
    if (update.percent !== undefined) job.percent = Math.min(99, update.percent);
    if (update.spacesFound !== undefined) job.spacesFound = update.spacesFound;
  }
}

export function completeSyncJob(jobId: string, spacesFound: number): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = "completed";
    job.message = "Sync complete";
    job.percent = 100;
    job.spacesFound = spacesFound;
    job.completedAt = Date.now();
  }
}

export function failSyncJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = "failed";
    job.message = "Sync failed";
    job.completedAt = Date.now();
    job.error = error;
  }
}
