/**
 * In-memory status tracker for async SQL generation jobs, with
 * write-through persistence to Lakebase.
 *
 * Mirrors `lib/genie/engine-status.ts`: the in-memory Map is the
 * primary store for fast polling, and state transitions
 * (start/complete/fail/cancel) are written through to
 * `forge_background_jobs` so status survives server restarts.
 *
 * SQL generation moved off the blocking pipeline path in the Async SQL
 * Generation refactor — this module is the durable status surface that
 * the run-detail UI polls while per-use-case SQL streams in.
 */

import { upsertJobStatus, getPersistedJobStatus } from "@/lib/lakebase/background-jobs";

export interface SqlJobStatus {
  runId: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  /** Total use cases expected for this job. Set by the step at start. */
  total: number;
  /** Use cases successfully generated so far (best-effort, in-memory). */
  generated: number;
  /** Use cases that hit a terminal failure (best-effort, in-memory). */
  failed: number;
}

const jobs = new Map<string, SqlJobStatus>();
const controllers = new Map<string, AbortController>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [runId, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(runId);
    } else if (!job.completedAt && now - job.startedAt > JOB_TTL_MS * 2) {
      jobs.delete(runId);
      controllers.delete(runId);
    }
  }
}

export async function startSqlJob(runId: string): Promise<void> {
  controllers.get(runId)?.abort();

  const controller = new AbortController();
  controllers.set(runId, controller);

  const now = Date.now();
  jobs.set(runId, {
    runId,
    status: "generating",
    message: "Starting SQL generation...",
    percent: 0,
    startedAt: now,
    completedAt: null,
    error: null,
    total: 0,
    generated: 0,
    failed: 0,
  });

  await upsertJobStatus(runId, "sql", "generating", "Starting SQL generation...", 0, {
    startedAt: new Date(now),
  });
}

export function getSqlJobController(runId: string): AbortController | null {
  return controllers.get(runId) ?? null;
}

export function updateSqlJob(runId: string, message: string, percent: number): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.message = message;
    job.percent = Math.min(100, Math.max(0, percent));
  }
}

/** Set the total expected use case count for the job. Called once at start. */
export function setSqlJobTotal(runId: string, total: number): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.total = total;
  }
}

/** Increment the in-memory counter for a successful use case. */
export function incrementSqlGenerated(runId: string): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.generated += 1;
  }
}

/** Increment the in-memory counter for a failed use case. */
export function incrementSqlFailed(runId: string): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.failed += 1;
  }
}

export async function completeSqlJob(
  runId: string,
  generated: number,
  failed: number,
): Promise<void> {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.status = "completed";
    job.percent = 100;
    job.completedAt = Date.now();
    job.generated = generated;
    job.failed = failed;
    job.message = `SQL generation complete: ${generated} generated${
      failed > 0 ? `, ${failed} failed` : ""
    }`;

    await upsertJobStatus(runId, "sql", "completed", job.message, 100, {
      completedAt: new Date(job.completedAt),
      domainCount: generated, // overload the existing column to record success count
    });
  }
  controllers.delete(runId);
}

export async function failSqlJob(runId: string, error: string): Promise<void> {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.status = "failed";
    job.message = "SQL generation failed";
    job.completedAt = Date.now();
    job.error = error;

    await upsertJobStatus(runId, "sql", "failed", job.message, job.percent, {
      completedAt: new Date(job.completedAt),
      error,
    });
  }
  controllers.delete(runId);
}

/**
 * Cancel a running job. Returns true if it was actively generating and
 * has been cancelled, false otherwise (already finished or no job).
 */
export async function cancelSqlJob(runId: string): Promise<boolean> {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return false;

  controllers.get(runId)?.abort();

  job.status = "cancelled";
  job.message = "SQL generation cancelled by user";
  job.completedAt = Date.now();

  await upsertJobStatus(runId, "sql", "cancelled", job.message, job.percent, {
    completedAt: new Date(job.completedAt),
  });

  return true;
}

/**
 * Get job status: in-memory first, then Lakebase fallback. The DB
 * fallback covers the case where the server restarted after a job
 * completed (in-memory Map was lost).
 */
export async function getSqlJobStatus(runId: string): Promise<SqlJobStatus | null> {
  evictStaleJobs();

  const memJob = jobs.get(runId);
  if (memJob) return memJob;

  const persisted = await getPersistedJobStatus(runId, "sql");
  if (!persisted) return null;

  return {
    runId: persisted.runId,
    status: persisted.status as SqlJobStatus["status"],
    message: persisted.message,
    percent: persisted.percent,
    startedAt: persisted.startedAt.getTime(),
    completedAt: persisted.completedAt?.getTime() ?? null,
    error: persisted.error,
    total: 0,
    generated: persisted.status === "completed" ? persisted.domainCount : 0,
    failed: 0,
  };
}
