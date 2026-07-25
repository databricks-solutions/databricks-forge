/**
 * In-memory status tracker for async Business Value Analysis jobs,
 * with write-through persistence to Lakebase.
 *
 * Mirrors the pattern used by `lib/genie/engine-status.ts` and
 * `lib/dashboard/engine-status.ts`. The BV job runs 4 LLM passes
 * (financial quantification → roadmap phasing → executive synthesis →
 * stakeholder analysis) plus a downstream embedding step. The in-memory
 * Map is the primary store for fast polling; state transitions are
 * written through to `forge_background_jobs` so status survives server
 * restarts.
 */

import { upsertJobStatus, getPersistedJobStatus } from "@/lib/lakebase/background-jobs";

export type BvPassName =
  | "financial-quantification"
  | "roadmap-phasing"
  | "executive-synthesis"
  | "stakeholder-analysis"
  | "embedding";

export interface BvJobStatus {
  runId: string;
  status: "generating" | "completed" | "failed";
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  completedPasses: number;
  totalPasses: number;
  /** Names of passes that have completed successfully. */
  completedPassNames: BvPassName[];
  /** Names of passes that ran but produced no usable output (degraded). */
  degradedPassNames: BvPassName[];
}

/** The four LLM passes shown to the consumer. Embedding is intentionally
 * omitted from this count -- it is a follow-up enrichment, not a "pass"
 * the user is waiting for content from. */
const TOTAL_PASSES = 4;

const jobs = new Map<string, BvJobStatus>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

export async function startBvJob(runId: string): Promise<void> {
  const now = Date.now();
  jobs.set(runId, {
    runId,
    status: "generating",
    message: "Starting business value analysis...",
    percent: 0,
    startedAt: now,
    completedAt: null,
    error: null,
    completedPasses: 0,
    totalPasses: TOTAL_PASSES,
    completedPassNames: [],
    degradedPassNames: [],
  });

  await upsertJobStatus(
    runId,
    "business-value",
    "generating",
    "Starting business value analysis...",
    0,
    { startedAt: new Date(now) },
  );
}

export function updateBvJob(runId: string, message: string, percent: number): void {
  const job = jobs.get(runId);
  if (job && job.status === "generating") {
    job.message = message;
    job.percent = Math.min(100, Math.max(0, percent));
  }
}

export function markBvPassComplete(runId: string, pass: BvPassName): void {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return;
  if (job.completedPassNames.includes(pass)) return;
  job.completedPassNames.push(pass);
  if (pass !== "embedding") {
    job.completedPasses = Math.min(TOTAL_PASSES, job.completedPasses + 1);
  }
}

export function markBvPassDegraded(runId: string, pass: BvPassName): void {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return;
  if (!job.degradedPassNames.includes(pass)) {
    job.degradedPassNames.push(pass);
  }
}

export async function completeBvJob(runId: string): Promise<void> {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return;

  job.status = "completed";
  job.percent = 100;
  job.completedAt = Date.now();
  const degradedNote = job.degradedPassNames.length
    ? ` (${job.degradedPassNames.length} pass${job.degradedPassNames.length === 1 ? "" : "es"} degraded)`
    : "";
  job.message = `Business value analysis complete${degradedNote}`;

  await upsertJobStatus(runId, "business-value", "completed", job.message, 100, {
    completedAt: new Date(job.completedAt),
  });
}

export async function failBvJob(runId: string, error: string): Promise<void> {
  const job = jobs.get(runId);
  if (!job || job.status !== "generating") return;

  job.status = "failed";
  job.message = "Business value analysis failed";
  job.completedAt = Date.now();
  job.error = error;

  await upsertJobStatus(runId, "business-value", "failed", job.message, job.percent, {
    completedAt: new Date(job.completedAt),
    error,
  });
}

/**
 * Get job status: in-memory first, then Lakebase fallback.
 * The DB fallback covers the case where the server restarted
 * after a job completed (in-memory Map was lost).
 */
export async function getBvJobStatus(runId: string): Promise<BvJobStatus | null> {
  evictStaleJobs();

  const memJob = jobs.get(runId);
  if (memJob) return memJob;

  const persisted = await getPersistedJobStatus(runId, "business-value");
  if (!persisted) return null;

  return {
    runId: persisted.runId,
    status: persisted.status as BvJobStatus["status"],
    message: persisted.message,
    percent: persisted.percent,
    startedAt: persisted.startedAt.getTime(),
    completedAt: persisted.completedAt?.getTime() ?? null,
    error: persisted.error,
    completedPasses: persisted.status === "completed" ? TOTAL_PASSES : 0,
    totalPasses: TOTAL_PASSES,
    completedPassNames: [],
    degradedPassNames: [],
  };
}
