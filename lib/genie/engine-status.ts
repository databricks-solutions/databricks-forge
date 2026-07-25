/**
 * In-memory status tracker for async Genie Engine generation jobs,
 * with write-through persistence to Lakebase.
 *
 * The in-memory Map is the primary store for fast polling. State
 * transitions (start/complete/fail/cancel) are written through to
 * Lakebase so status survives server restarts. On read, if the
 * in-memory Map has no entry, we fall back to Lakebase.
 */

import { isAuthErrorMessage } from "@/lib/lakebase/auth-errors";
import { upsertJobStatus, getPersistedJobStatus } from "@/lib/lakebase/background-jobs";

export type EngineErrorType = "auth" | "general" | null;

export type DomainPhase =
  | "pending"
  | "expressions"
  | "joins"
  | "assets"
  | "assembly"
  | "completed"
  | "failed";

export interface DomainProgress {
  domain: string;
  tables: number;
  phase: DomainPhase;
  startedAt: number | null;
  completedAt: number | null;
  error?: string;
}

export interface EngineJobStatus {
  runId: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  errorType: EngineErrorType;
  domainCount: number;
  completedDomains: number;
  totalDomains: number;
  completedDomainNames: string[];
  domainStatuses: DomainProgress[];
}

const jobs = new Map<string, EngineJobStatus>();
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

export async function startJob(runId: string): Promise<void> {
  controllers.get(runId)?.abort();

  const controller = new AbortController();
  controllers.set(runId, controller);

  const now = Date.now();
  jobs.set(runId, {
    runId,
    status: "generating",
    message: "Starting Genie Engine...",
    percent: 0,
    startedAt: now,
    completedAt: null,
    error: null,
    errorType: null,
    domainCount: 0,
    completedDomains: 0,
    totalDomains: 0,
    completedDomainNames: [],
    domainStatuses: [],
  });

  await upsertJobStatus(runId, "genie", "generating", "Starting Genie Engine...", 0, {
    startedAt: new Date(now),
  });
}

export function getJobController(runId: string): AbortController | null {
  return controllers.get(runId) ?? null;
}

/**
 * Cancel a running job. Returns true if the job was actively generating
 * and has been cancelled, false otherwise (already finished or no job).
 */
export async function cancelJob(runId: string): Promise<boolean> {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return false;

  controllers.get(runId)?.abort();

  job.status = "cancelled";
  job.message = "Generation cancelled by user";
  job.completedAt = Date.now();

  await upsertJobStatus(runId, "genie", "cancelled", job.message, job.percent, {
    completedAt: new Date(job.completedAt),
  });

  return true;
}

export function updateJob(runId: string, message: string, percent: number): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.message = message;
    job.percent = Math.min(100, Math.max(0, percent));
  }
}

export function updateJobDomainProgress(
  runId: string,
  completedDomains: number,
  totalDomains: number,
): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.completedDomains = completedDomains;
    job.totalDomains = totalDomains;
  }
}

export function addCompletedDomainName(runId: string, domainName: string): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating" && !job.completedDomainNames.includes(domainName)) {
    job.completedDomainNames.push(domainName);
  }
}

/** Populate the domain list after Pass 0 table selection. */
export function initDomainList(
  runId: string,
  domains: Array<{ domain: string; tables: number }>,
): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.domainStatuses = domains.map((d) => ({
      domain: d.domain,
      tables: d.tables,
      phase: "pending" as const,
      startedAt: null,
      completedAt: null,
    }));
  }
}

/** Update the phase for a specific domain. */
export function updateDomainPhase(runId: string, domain: string, phase: DomainPhase): void {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return;
  const entry = job.domainStatuses.find((d) => d.domain === domain);
  if (!entry) return;
  entry.phase = phase;
  if (!entry.startedAt && phase !== "pending") {
    entry.startedAt = Date.now();
  }
  if (phase === "completed" || phase === "failed") {
    entry.completedAt = Date.now();
  }
}

/** Mark a domain as failed with an error message. */
export function failDomain(runId: string, domain: string, error: string): void {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return;
  const entry = job.domainStatuses.find((d) => d.domain === domain);
  if (!entry) return;
  entry.phase = "failed";
  entry.completedAt = Date.now();
  entry.error = error;
}

export async function completeJob(runId: string, domainCount: number): Promise<void> {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.status = "completed";
    job.message = `Complete: ${domainCount} domain${domainCount !== 1 ? "s" : ""} generated`;
    job.percent = 100;
    job.completedAt = Date.now();
    job.domainCount = domainCount;

    await upsertJobStatus(runId, "genie", "completed", job.message, 100, {
      completedAt: new Date(job.completedAt),
      domainCount,
    });
  }
  controllers.delete(runId);
}

export async function failJob(runId: string, error: string): Promise<void> {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.status = "failed";
    job.message = "Generation failed";
    job.completedAt = Date.now();
    job.error = error;
    job.errorType = isAuthErrorMessage(error) ? "auth" : "general";

    await upsertJobStatus(runId, "genie", "failed", job.message, job.percent, {
      completedAt: new Date(job.completedAt),
      error,
    });
  }
  controllers.delete(runId);
}

/**
 * Get job status: in-memory first, then Lakebase fallback.
 * The DB fallback covers the case where the server restarted
 * after a job completed (in-memory Map was lost).
 */
export async function getJobStatus(runId: string): Promise<EngineJobStatus | null> {
  evictStaleJobs();

  const memJob = jobs.get(runId);
  if (memJob) return memJob;

  const persisted = await getPersistedJobStatus(runId, "genie");
  if (!persisted) return null;

  return {
    runId: persisted.runId,
    status: persisted.status as EngineJobStatus["status"],
    message: persisted.message,
    percent: persisted.percent,
    startedAt: persisted.startedAt.getTime(),
    completedAt: persisted.completedAt?.getTime() ?? null,
    error: persisted.error,
    errorType: persisted.error ? (isAuthErrorMessage(persisted.error) ? "auth" : "general") : null,
    domainCount: persisted.domainCount,
    completedDomains: 0,
    totalDomains: 0,
    completedDomainNames: [],
    domainStatuses: [],
  };
}
