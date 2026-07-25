/**
 * Tiny pure helper used by the `/runs` list page polling effect.
 *
 * Extracted to its own module so a node-only Vitest can import it
 * without pulling React, Next.js, or `"use client"` boundaries from
 * `runs-content.tsx`. Keeping the predicate isolated also documents
 * exactly which statuses qualify as "worth polling for" in one place.
 */

const ACTIVE_RUN_STATUSES = new Set(["running", "pending", "queued"]);

export function hasActiveRunStatuses(
  runs: ReadonlyArray<{ status: string }>,
): boolean {
  for (const run of runs) {
    if (ACTIVE_RUN_STATUSES.has(run.status)) return true;
  }
  return false;
}
