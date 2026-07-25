/**
 * In-memory job store for Genie Space improvement jobs.
 *
 * Keyed by spaceId (one active improvement per space). Shared across
 * the improve API route and the batch-status endpoint.
 */

import type { GenieSpaceRecommendation } from "./types";

export interface ImproveHealthDiagnostics {
  healthScore: number;
  grade: string;
  failedChecks: { id: string; detail?: string }[];
  strategiesRun: string[];
  mode: "targeted" | "full";
}

export interface ImproveJobResult {
  recommendation?: GenieSpaceRecommendation;
  updatedSerializedSpace?: string;
  originalSerializedSpace: string;
  changes: ImproveChange[];
  statsBefore: ImproveStats;
  statsAfter: ImproveStats;
  diagnostics?: ImproveHealthDiagnostics;
}

export interface ImproveChange {
  section: string;
  description: string;
  added: number;
  modified: number;
}

export interface ImproveStats {
  tables: number;
  joins: number;
  measures: number;
  filters: number;
  dimensions: number;
  benchmarks: number;
  sampleQuestions: number;
  exampleSqls: number;
  instructionLength: number;
  metricViews: number;
}

export interface ImproveJobStatus {
  spaceId: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  message: string;
  percent: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  result: ImproveJobResult | null;
}

const jobs = new Map<string, ImproveJobStatus>();
const controllers = new Map<string, AbortController>();

const JOB_TTL_MS = 30 * 60 * 1000;
const STUCK_TTL_MS = 60 * 60 * 1000;

function evictStale(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(id);
      controllers.delete(id);
    } else if (!job.completedAt && now - job.startedAt > STUCK_TTL_MS) {
      jobs.delete(id);
      controllers.delete(id);
    }
  }
}

export function startImproveJob(spaceId: string): AbortController {
  evictStale();
  const controller = new AbortController();
  controllers.set(spaceId, controller);
  jobs.set(spaceId, {
    spaceId,
    status: "generating",
    message: "Starting Genie Engine improvement...",
    percent: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    result: null,
  });
  return controller;
}

export function getImproveJob(spaceId: string): ImproveJobStatus | null {
  evictStale();
  return jobs.get(spaceId) ?? null;
}

export function getAllActiveImproveJobs(): Record<string, ImproveJobStatus> {
  evictStale();
  const active: Record<string, ImproveJobStatus> = {};
  for (const [id, job] of jobs) {
    if (job.status === "generating" || (job.status === "completed" && job.result)) {
      active[id] = job;
    }
  }
  return active;
}

export function updateImproveJob(spaceId: string, message: string, percent: number): void {
  const job = jobs.get(spaceId);
  if (job && job.status === "generating") {
    job.message = message;
    job.percent = Math.min(99, percent);
  }
}

export function completeImproveJob(spaceId: string, result: ImproveJobResult): void {
  const job = jobs.get(spaceId);
  if (job) {
    job.status = "completed";
    job.message = "Improvement complete";
    job.percent = 100;
    job.completedAt = Date.now();
    job.result = result;
  }
  controllers.delete(spaceId);
}

export function failImproveJob(spaceId: string, error: string): void {
  const job = jobs.get(spaceId);
  if (job) {
    job.status = "failed";
    job.message = "Improvement failed";
    job.completedAt = Date.now();
    job.error = error;
  }
  controllers.delete(spaceId);
}

export function cancelImproveJob(spaceId: string): void {
  const controller = controllers.get(spaceId);
  if (controller) controller.abort();
  const job = jobs.get(spaceId);
  if (job) {
    job.status = "cancelled";
    job.message = "Cancelled";
    job.completedAt = Date.now();
  }
  controllers.delete(spaceId);
}

export function getImproveController(spaceId: string): AbortController | undefined {
  return controllers.get(spaceId);
}

/** Remove a completed/failed/cancelled job so it is no longer returned. */
export function dismissImproveJob(spaceId: string): void {
  const job = jobs.get(spaceId);
  if (job && job.status !== "generating") {
    jobs.delete(spaceId);
    controllers.delete(spaceId);
  }
}

// -------------------------------------------------------------------------
// Diff helpers
// -------------------------------------------------------------------------

export function computeImproveStats(serializedSpace: string): ImproveStats {
  try {
    const space = JSON.parse(serializedSpace);
    const snippets = space?.instructions?.sql_snippets;
    return {
      tables: space?.data_sources?.tables?.length ?? 0,
      joins: space?.instructions?.join_specs?.length ?? 0,
      measures: snippets?.measures?.length ?? 0,
      filters: snippets?.filters?.length ?? 0,
      dimensions: snippets?.expressions?.length ?? 0,
      benchmarks: space?.benchmarks?.questions?.length ?? 0,
      sampleQuestions: space?.config?.sample_questions?.length ?? 0,
      exampleSqls: space?.instructions?.example_question_sqls?.length ?? 0,
      instructionLength:
        space?.instructions?.text_instructions?.reduce(
          (sum: number, i: { content?: string[] }) => sum + (i.content?.join(" ").length ?? 0),
          0,
        ) ?? 0,
      metricViews: space?.data_sources?.metric_views?.length ?? 0,
    };
  } catch {
    return {
      tables: 0,
      joins: 0,
      measures: 0,
      filters: 0,
      dimensions: 0,
      benchmarks: 0,
      sampleQuestions: 0,
      exampleSqls: 0,
      instructionLength: 0,
      metricViews: 0,
    };
  }
}

export function computeImproveChanges(before: ImproveStats, after: ImproveStats): ImproveChange[] {
  const changes: ImproveChange[] = [];
  const diff = (label: string, section: string, b: number, a: number) => {
    if (a > b)
      changes.push({ section, description: `Added ${a - b} ${label}`, added: a - b, modified: 0 });
    else if (a < b)
      changes.push({
        section,
        description: `Reduced ${label} from ${b} to ${a}`,
        added: 0,
        modified: 1,
      });
  };

  diff("tables", "Data Sources / Tables", before.tables, after.tables);
  diff("joins", "Join Specifications", before.joins, after.joins);
  diff("measures", "SQL Snippets / Measures", before.measures, after.measures);
  diff("filters", "SQL Snippets / Filters", before.filters, after.filters);
  diff("dimensions/expressions", "SQL Snippets / Expressions", before.dimensions, after.dimensions);
  diff("benchmarks", "Benchmarks", before.benchmarks, after.benchmarks);
  diff("sample questions", "Sample Questions", before.sampleQuestions, after.sampleQuestions);
  diff("example SQLs", "Example SQL Queries", before.exampleSqls, after.exampleSqls);
  diff("metric views", "Metric Views", before.metricViews, after.metricViews);

  if (after.instructionLength > before.instructionLength + 50) {
    changes.push({
      section: "Text Instructions",
      description: `Enriched instructions (${before.instructionLength} → ${after.instructionLength} chars)`,
      added: 0,
      modified: 1,
    });
  }

  return changes;
}
