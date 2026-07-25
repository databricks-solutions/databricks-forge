/**
 * In-memory progress tracker for Fabric scans.
 * Follows the same pattern as lib/pipeline/scan-progress.ts.
 */

import type { FabricScanProgress } from "./types";

const progress = new Map<string, FabricScanProgress>();

export function setScanProgress(scanId: string, update: Partial<FabricScanProgress>): void {
  const current = progress.get(scanId) ?? {
    scanId,
    status: "pending",
    message: "Initializing...",
    percent: 0,
    phase: "init",
  };
  progress.set(scanId, { ...current, ...update, scanId });
}

export function getScanProgress(scanId: string): FabricScanProgress | null {
  return progress.get(scanId) ?? null;
}

export function clearScanProgress(scanId: string): void {
  progress.delete(scanId);
}
