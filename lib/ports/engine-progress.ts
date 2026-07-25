/**
 * Abstract engine progress interface.
 *
 * Provides a standard contract for all engines to report progress,
 * structured counters, and lifecycle events. Concrete implementations
 * back this with in-memory maps (singleton pattern with TTL).
 *
 * @module ports/engine-progress
 */

export type EnginePhase = string;

export interface EngineProgressData {
  jobId: string;
  phase: EnginePhase;
  message: string;
  percent: number;
  counters: Record<string, number | string | null>;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  updatedAt: string;
}

/**
 * Standard engine progress tracker.
 *
 * Each engine instantiates one of these (or accepts one via DI)
 * to report lifecycle events. The implementation is typically an
 * in-memory Map with a TTL, but could be backed by Redis, Lakebase,
 * or SSE for real-time UIs.
 */
export interface EngineProgressTracker {
  init(jobId: string): void;
  update(jobId: string, data: Partial<Omit<EngineProgressData, "jobId" | "updatedAt">>): void;
  complete(jobId: string, summary?: Record<string, unknown>): void;
  fail(jobId: string, error: string): void;
  get(jobId: string): EngineProgressData | null;
}
