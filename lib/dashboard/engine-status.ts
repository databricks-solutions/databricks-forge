/**
 * In-memory status tracker for async Dashboard Engine generation jobs,
 * with write-through persistence to Lakebase.
 *
 * The in-memory Map is the primary store for fast polling. State
 * transitions (start/complete/fail) are written through to Lakebase
 * so status survives server restarts. On read, if the in-memory Map
 * has no entry, we fall back to Lakebase.
 */

import {
  upsertJobStatus,
  replaceJobStatus,
  getPersistedJobStatus,
} from "@/lib/lakebase/background-jobs";
import type { DashboardValidationFailure } from "./types";
import {
  compactValidationEvidence,
  type ValidationEvidence,
} from "@/lib/validation/evidence";

export interface DashboardJobStatus {
  runId: string;
  status: "generating" | "completed" | "completed_with_failures" | "failed";
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  domainCount: number;
  validationFailures: DashboardValidationFailure[];
}

const jobs = new Map<string, DashboardJobStatus>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

function compactValidationFailures(
  failures: DashboardValidationFailure[],
): DashboardValidationFailure[] {
  return failures.map((failure) => ({
    domain: failure.domain,
    evidence: compactValidationEvidence(failure.evidence),
  }));
}

function parseValidationFailures(detailsJson: string | null): DashboardValidationFailure[] {
  if (!detailsJson) return [];
  try {
    const details = JSON.parse(detailsJson) as {
      validationFailures?: Array<{ domain?: unknown; evidence?: ValidationEvidence[] }>;
    };
    return (details.validationFailures ?? [])
      .filter((failure): failure is { domain: string; evidence?: ValidationEvidence[] } =>
        typeof failure.domain === "string",
      )
      .map((failure) => ({
        domain: failure.domain,
        evidence: compactValidationEvidence(failure.evidence),
      }));
  } catch {
    return [];
  }
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [runId, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(runId);
    } else if (!job.completedAt && now - job.startedAt > JOB_TTL_MS * 2) {
      jobs.delete(runId);
    }
  }
}

export async function startDashboardJob(runId: string): Promise<void> {
  const now = Date.now();
  jobs.set(runId, {
    runId,
    status: "generating",
    message: "Starting Dashboard Engine...",
    percent: 0,
    startedAt: now,
    completedAt: null,
    error: null,
    domainCount: 0,
    validationFailures: [],
  });

  await replaceJobStatus(
    runId,
    "dashboard",
    "generating",
    "Starting Dashboard Engine...",
    0,
    new Date(now),
  );
}

export function updateDashboardJob(runId: string, message: string, percent: number): void {
  const job = jobs.get(runId);
  if (job) {
    job.message = message;
    job.percent = Math.min(100, Math.max(0, percent));
  }
}

export async function completeDashboardJob(
  runId: string,
  domainCount: number,
  validationFailures?: DashboardValidationFailure[],
): Promise<void> {
  const job = jobs.get(runId);
  if (job) {
    if (validationFailures !== undefined) {
      job.validationFailures = compactValidationFailures(validationFailures);
    }
    const failureCount = job.validationFailures.length;
    job.status = failureCount > 0 ? "completed_with_failures" : "completed";
    job.message =
      failureCount > 0
        ? `Partial success: ${domainCount} dashboard${domainCount !== 1 ? "s" : ""} generated; ${failureCount} domain${failureCount !== 1 ? "s" : ""} failed validation`
        : `Complete: ${domainCount} dashboard${domainCount !== 1 ? "s" : ""} generated`;
    job.percent = 100;
    job.completedAt = Date.now();
    job.domainCount = domainCount;

    await upsertJobStatus(runId, "dashboard", job.status, job.message, 100, {
      completedAt: new Date(job.completedAt),
      domainCount,
      ...(validationFailures !== undefined && {
        detailsJson: JSON.stringify({
          validationFailures: compactValidationFailures(validationFailures),
        }),
      }),
    });
  }
}

export async function failDashboardJob(
  runId: string,
  error: string,
  validationFailures?: DashboardValidationFailure[],
): Promise<void> {
  const job = jobs.get(runId);
  if (job) {
    job.status = "failed";
    job.message = "Dashboard generation failed";
    job.completedAt = Date.now();
    job.error = error;
    if (validationFailures !== undefined) {
      job.validationFailures = compactValidationFailures(validationFailures);
    }

    await upsertJobStatus(runId, "dashboard", "failed", job.message, job.percent, {
      completedAt: new Date(job.completedAt),
      error,
      ...(validationFailures !== undefined && {
        detailsJson: JSON.stringify({
          validationFailures: compactValidationFailures(validationFailures),
        }),
      }),
    });
  }
}

/**
 * Get job status: in-memory first, then Lakebase fallback.
 * The DB fallback covers the case where the server restarted
 * after a job completed (in-memory Map was lost).
 */
export async function getDashboardJobStatus(runId: string): Promise<DashboardJobStatus | null> {
  evictStaleJobs();

  const memJob = jobs.get(runId);
  if (memJob) return memJob;

  const persisted = await getPersistedJobStatus(runId, "dashboard");
  if (!persisted) return null;

  return {
    runId: persisted.runId,
    status: persisted.status as DashboardJobStatus["status"],
    message: persisted.message,
    percent: persisted.percent,
    startedAt: persisted.startedAt.getTime(),
    completedAt: persisted.completedAt?.getTime() ?? null,
    error: persisted.error,
    domainCount: persisted.domainCount,
    validationFailures: parseValidationFailures(persisted.detailsJson),
  };
}
