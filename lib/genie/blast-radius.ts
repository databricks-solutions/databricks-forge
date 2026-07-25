/**
 * Blast-Radius Gate for the Auto-Improve Loop.
 *
 * Bounds the "surface area" a single set of patches can touch in one
 * iteration. If a fix would mutate state across more than `BLAST_RADIUS_MAX`
 * distinct tables, the entire fix is dropped with reason
 * `blast_radius_exceeded`.
 *
 * Mirrors upstream Fix Agent's `blast_radius_max` guardrail.
 *
 * Tables are identified by their `tables[].path` (preferred) or
 * `tables[].identifier` (fallback). Anything that doesn't carry a path is
 * counted as the special bucket `__no_path__` so a single un-pathed change
 * still consumes one unit of blast radius.
 */

import type { SpaceJson } from "@/lib/genie/types";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BLAST_RADIUS_MAX = 5;

function readBlastRadiusMax(): number {
  const raw = process.env.FORGE_BLAST_RADIUS_MAX;
  if (!raw) return DEFAULT_BLAST_RADIUS_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BLAST_RADIUS_MAX;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlastRadiusReport {
  /** Distinct table paths affected by the diff. */
  tablesTouched: string[];
  /** Active threshold from env or default. */
  max: number;
  /** True when `tablesTouched.length > max`. */
  exceeded: boolean;
  /** True when no tables were affected -- always allowed. */
  noChanges: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathOf(table: unknown): string {
  if (!table || typeof table !== "object") return "__no_path__";
  const t = table as Record<string, unknown>;
  return (
    (typeof t.path === "string" && t.path.trim()) ||
    (typeof t.identifier === "string" && t.identifier.trim()) ||
    "__no_path__"
  );
}

function tableIdSet(space: SpaceJson | unknown): Set<string> {
  const tables = ((space as SpaceJson | undefined)?.data_sources?.tables ?? []) as unknown[];
  return new Set(tables.map((t) => pathOf(t)));
}

/**
 * Compute the union of table paths whose contents differ between two space
 * snapshots. Includes paths added or removed entirely.
 */
function affectedTablePaths(before: SpaceJson, after: SpaceJson): string[] {
  const beforeTables = (before?.data_sources?.tables ?? []) as Array<Record<string, unknown>>;
  const afterTables = (after?.data_sources?.tables ?? []) as Array<Record<string, unknown>>;
  const indexBy = (rows: Array<Record<string, unknown>>) => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) m.set(pathOf(r), r);
    return m;
  };
  const ix1 = indexBy(beforeTables);
  const ix2 = indexBy(afterTables);

  const touched = new Set<string>();
  const allPaths = new Set<string>([...ix1.keys(), ...ix2.keys()]);
  for (const p of allPaths) {
    const a = ix1.get(p);
    const b = ix2.get(p);
    if (!a || !b) {
      touched.add(p);
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) touched.add(p);
  }

  // Also count instruction-level changes that reference table paths.
  const beforeRefs = referencedTables(before);
  const afterRefs = referencedTables(after);
  for (const r of afterRefs) if (!beforeRefs.has(r)) touched.add(r);
  for (const r of beforeRefs) if (!afterRefs.has(r)) touched.add(r);

  return [...touched];
}

function referencedTables(space: SpaceJson): Set<string> {
  const knownPaths = tableIdSet(space);
  const out = new Set<string>();
  const text = JSON.stringify(space ?? {});
  for (const p of knownPaths) {
    if (p === "__no_path__") continue;
    if (text.includes(p)) out.add(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a blast-radius report comparing the pre-fix and post-fix space
 * configurations. Pure, no IO.
 */
export function evaluateBlastRadius(opts: {
  before: SpaceJson;
  after: SpaceJson;
  max?: number;
}): BlastRadiusReport {
  const max = opts.max ?? readBlastRadiusMax();
  const tables = affectedTablePaths(opts.before, opts.after);
  const realTables = tables.filter((t) => t !== "__no_path__");
  const exceeded = realTables.length > max;
  return {
    tablesTouched: tables,
    max,
    exceeded,
    noChanges: tables.length === 0,
  };
}

/**
 * Throw-or-pass gate: drops a fix that exceeds the blast radius and
 * returns `kept` / `dropped`. The caller decides what to do with the
 * dropped patches (typically: log the reason and skip apply).
 */
export function gateByBlastRadius<T>(
  opts: { before: SpaceJson; after: SpaceJson; payload: T; spaceId?: string },
): { allowed: boolean; report: BlastRadiusReport; payload: T | null } {
  const report = evaluateBlastRadius({ before: opts.before, after: opts.after });
  if (report.exceeded) {
    logger.warn("[blast-radius] dropping fix that exceeds threshold", {
      spaceId: opts.spaceId,
      tablesTouched: report.tablesTouched.length,
      max: report.max,
    });
    return { allowed: false, report, payload: null };
  }
  return { allowed: true, report, payload: opts.payload };
}
