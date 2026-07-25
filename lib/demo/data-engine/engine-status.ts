/**
 * In-memory status tracker for Data Engine jobs.
 *
 * Demo jobs do NOT persist to ForgeBackgroundJob (which has an FK to
 * ForgeRun). Final status is written to ForgeDemoSession instead.
 *
 * Extends the base pattern with per-table phase tracking.
 */

import type { TablePhase } from "../types";
import type { DataJobStatus } from "./types";

const jobs = new Map<string, DataJobStatus>();
const controllers = new Map<string, AbortController>();
const JOB_TTL_MS = 30 * 60 * 1000;

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const completedAt =
      job.status === "completed" || job.status === "failed" ? now : null;
    if (completedAt && now - completedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function startDataJob(sessionId: string): AbortController {
  controllers.get(sessionId)?.abort();

  const controller = new AbortController();
  controllers.set(sessionId, controller);

  jobs.set(sessionId, {
    sessionId,
    status: "generating",
    message: "Starting data generation...",
    percent: 0,
    totalTables: 0,
    completedTables: 0,
    tableStatuses: [],
    error: undefined,
    startedAt: Date.now(),
  });

  return controller;
}

export function getDataJobController(sessionId: string): AbortController | null {
  return controllers.get(sessionId) ?? null;
}

export function initTableList(
  sessionId: string,
  tables: Array<{ tableName: string }>,
): void {
  const job = jobs.get(sessionId);
  if (!job || job.status !== "generating") return;
  job.totalTables = tables.length;
  job.tableStatuses = tables.map((t) => ({
    tableName: t.tableName,
    phase: "pending" as TablePhase,
    rowCount: 0,
    retryCount: 0,
  }));
}

export function updateTablePhase(
  sessionId: string,
  tableName: string,
  phase: TablePhase,
  rowCount?: number,
): void {
  const job = jobs.get(sessionId);
  if (!job || job.status !== "generating") return;
  const entry = job.tableStatuses.find((t) => t.tableName === tableName);
  if (!entry) return;
  entry.phase = phase;
  if (rowCount !== undefined) entry.rowCount = rowCount;
  if (phase === "retrying") entry.retryCount++;
  if (phase === "completed") {
    job.completedTables = job.tableStatuses.filter((t) => t.phase === "completed").length;
    job.percent = Math.round((job.completedTables / job.totalTables) * 100);
  }
}

export function updateDataJob(sessionId: string, message: string, percent: number): void {
  const job = jobs.get(sessionId);
  if (job && job.status === "generating") {
    job.message = message;
    job.percent = Math.min(100, Math.max(0, percent));
  }
}

export function completeDataJob(sessionId: string): void {
  const job = jobs.get(sessionId);
  if (job && job.status === "generating") {
    job.status = "completed";
    job.message = `Complete: ${job.completedTables} tables generated`;
    job.percent = 100;
  }
  controllers.delete(sessionId);
}

export function failDataJob(sessionId: string, error: string): void {
  const job = jobs.get(sessionId);
  if (job && job.status === "generating") {
    job.status = "failed";
    job.message = "Data generation failed";
    job.error = error;
  }
  controllers.delete(sessionId);
}

export function cancelDataJob(sessionId: string): boolean {
  const job = jobs.get(sessionId);
  if (!job || job.status !== "generating") return false;

  controllers.get(sessionId)?.abort();
  job.status = "cancelled";
  job.message = "Data generation cancelled";

  return true;
}

export function getDataJobStatus(sessionId: string): DataJobStatus | null {
  evictStaleJobs();
  return jobs.get(sessionId) ?? null;
}
