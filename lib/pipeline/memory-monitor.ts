/**
 * Lightweight memory monitoring for pipeline execution.
 *
 * Logs heap usage at step boundaries so operators can diagnose OOM risks
 * on large schemas (12k+ tables). The `getMemorySnapshot` export is also
 * used by /api/health to surface heap stats.
 */

import { logger } from "@/lib/logger";

export interface MemorySnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

const MB = 1024 * 1024;

export function getMemorySnapshot(): MemorySnapshot {
  const m = process.memoryUsage();
  return {
    heapUsedMB: Math.round(m.heapUsed / MB),
    heapTotalMB: Math.round(m.heapTotal / MB),
    rssMB: Math.round(m.rss / MB),
    externalMB: Math.round(m.external / MB),
    arrayBuffersMB: Math.round(m.arrayBuffers / MB),
  };
}

export function logMemoryUsage(label: string, extra?: Record<string, unknown>): void {
  const snap = getMemorySnapshot();
  logger.info(`[memory] ${label}`, { ...snap, ...extra });
}
