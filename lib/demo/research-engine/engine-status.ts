/**
 * In-memory status tracker for Research Engine jobs.
 *
 * Demo jobs do NOT persist to ForgeBackgroundJob (which has an FK to
 * ForgeRun). Final status is written to ForgeDemoSession instead.
 */

import { isAuthErrorMessage } from "@/lib/lakebase/auth-errors";
import type { ResearchPhase } from "./types";

export interface ResearchJobStatus {
  sessionId: string;
  status: "researching" | "completed" | "failed" | "cancelled";
  phase: ResearchPhase;
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  errorType: "auth" | "general" | null;
}

const jobs = new Map<string, ResearchJobStatus>();
const controllers = new Map<string, AbortController>();
const JOB_TTL_MS = 30 * 60 * 1000;

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(id);
    } else if (!job.completedAt && now - job.startedAt > JOB_TTL_MS * 2) {
      jobs.delete(id);
      controllers.delete(id);
    }
  }
}

export function startResearchJob(sessionId: string): AbortController {
  controllers.get(sessionId)?.abort();

  const controller = new AbortController();
  controllers.set(sessionId, controller);

  jobs.set(sessionId, {
    sessionId,
    status: "researching",
    phase: "source-collection",
    message: "Starting research...",
    percent: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    errorType: null,
  });

  return controller;
}

export function getResearchJobController(sessionId: string): AbortController | null {
  return controllers.get(sessionId) ?? null;
}

export function updateResearchJob(
  sessionId: string,
  phase: ResearchPhase,
  percent: number,
  detail?: string,
): void {
  const job = jobs.get(sessionId);
  if (job && job.status === "researching") {
    job.phase = phase;
    job.percent = Math.min(100, Math.max(0, percent));
    if (detail) job.message = detail;
  }
}

export function completeResearchJob(sessionId: string): void {
  const job = jobs.get(sessionId);
  if (job && job.status === "researching") {
    job.status = "completed";
    job.phase = "complete";
    job.message = "Research complete";
    job.percent = 100;
    job.completedAt = Date.now();
  }
  controllers.delete(sessionId);
}

export function failResearchJob(sessionId: string, error: string): void {
  const job = jobs.get(sessionId);
  if (job && job.status === "researching") {
    job.status = "failed";
    job.message = "Research failed";
    job.completedAt = Date.now();
    job.error = error;
    job.errorType = isAuthErrorMessage(error) ? "auth" : "general";
  }
  controllers.delete(sessionId);
}

export function cancelResearchJob(sessionId: string): boolean {
  const job = jobs.get(sessionId);
  if (!job || job.status !== "researching") return false;

  controllers.get(sessionId)?.abort();
  job.status = "cancelled";
  job.message = "Research cancelled";
  job.completedAt = Date.now();

  return true;
}

export function getResearchJobStatus(
  sessionId: string,
): ResearchJobStatus | null {
  evictStaleJobs();
  return jobs.get(sessionId) ?? null;
}
