/**
 * Profile-grounded prompt prefix.
 *
 * Builds a "Use ONLY these actual values" block that pass prompts can prepend
 * before the schema context. Prevents the LLM from hallucinating literal
 * values in WHERE clauses (e.g. `status = 'COMPLETED'` when the real values
 * are `'completed'` / `'in_progress'`).
 *
 * Mirrors upstream `databricks-genie-workbench` `plan_builder.py` which
 * grounds every measure / filter / benchmark prompt in observed sample data.
 *
 * Pure function. Zero IO. Returns an empty string when there's nothing
 * useful to ground on.
 */

import type { SampleDataCache, SampleDataEntry } from "@/lib/genie/types";

export interface ColumnSampleSnapshot {
  tableFqn: string;
  columnName: string;
  values: string[];
}

const DEFAULT_MAX_COLUMNS = 30;
const DEFAULT_MAX_VALUES_PER_COLUMN = 8;
const DEFAULT_MAX_VALUE_CHARS = 60;

/**
 * Build a prompt prefix from per-column sample snapshots.
 *
 * @param snapshots Pre-collected sample values, typically harvested in the
 *                  entity-extraction pass.
 * @param opts      Caps to keep the prefix small.
 *
 * Output shape (when non-empty):
 *
 *   ### Profile-Grounded Values (use ONLY these actual values, do NOT invent)
 *   - cat.sch.tbl.col_a: ['active', 'pending', 'cancelled']
 *   - cat.sch.tbl.col_b: ['US', 'CA', 'UK']
 *   ...
 */
export function buildProfileGroundingBlock(
  snapshots: ReadonlyArray<ColumnSampleSnapshot>,
  opts?: {
    maxColumns?: number;
    maxValuesPerColumn?: number;
    maxValueChars?: number;
  },
): string {
  const maxColumns = opts?.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const maxValuesPerColumn = opts?.maxValuesPerColumn ?? DEFAULT_MAX_VALUES_PER_COLUMN;
  const maxValueChars = opts?.maxValueChars ?? DEFAULT_MAX_VALUE_CHARS;

  const filtered = snapshots
    .filter((s) => Array.isArray(s.values) && s.values.length > 0)
    .slice(0, maxColumns);
  if (filtered.length === 0) return "";

  const lines = filtered.map((s) => {
    const trimmed = s.values
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .slice(0, maxValuesPerColumn)
      .map((v) => {
        const safe = v.length > maxValueChars ? v.slice(0, maxValueChars - 1) + "…" : v;
        return `'${safe.replace(/'/g, "''")}'`;
      })
      .join(", ");
    return `- ${s.tableFqn}.${s.columnName}: [${trimmed}]`;
  });

  return [
    "### Profile-Grounded Values (use ONLY these actual values, do NOT invent)",
    ...lines,
  ].join("\n");
}

/**
 * Adapter: pull column-level snapshots out of the `SampleDataCache` that the
 * engine produces during entity extraction, optionally restricting to a
 * given list of (tableFqn, columnName) pairs.
 */
export function snapshotsFromSampleCache(
  cache: SampleDataCache,
  filter?: ReadonlyArray<{ tableFqn: string; columnName: string }>,
): ColumnSampleSnapshot[] {
  const out: ColumnSampleSnapshot[] = [];
  const filterSet = filter
    ? new Set(filter.map((f) => `${f.tableFqn.toLowerCase()}::${f.columnName.toLowerCase()}`))
    : null;

  for (const [tableFqn, entry] of cache.entries()) {
    if (!entry || !Array.isArray(entry.columns) || !Array.isArray(entry.rows)) continue;
    for (let colIdx = 0; colIdx < entry.columns.length; colIdx++) {
      const columnName = entry.columns[colIdx];
      if (!columnName) continue;
      const key = `${tableFqn.toLowerCase()}::${columnName.toLowerCase()}`;
      if (filterSet && !filterSet.has(key)) continue;
      const values = collectColumnValues(entry, colIdx);
      if (values.length > 0) {
        out.push({ tableFqn, columnName, values });
      }
    }
  }
  return out;
}

/**
 * Adapter: build profile snapshots directly from the engine's
 * `EntityMatchingCandidate[]` (which already carries deduped sample values).
 *
 * Used by passes that don't have access to the raw `SampleDataCache` but do
 * see entity candidates (semantic-expressions, trusted-assets, benchmarks).
 */
export function snapshotsFromEntityCandidates(
  candidates: ReadonlyArray<{
    tableFqn: string;
    columnName: string;
    sampleValues: ReadonlyArray<string>;
  }>,
  filter?: ReadonlyArray<{ tableFqn: string; columnName: string }>,
): ColumnSampleSnapshot[] {
  const filterSet = filter
    ? new Set(filter.map((f) => `${f.tableFqn.toLowerCase()}::${f.columnName.toLowerCase()}`))
    : null;
  const out: ColumnSampleSnapshot[] = [];
  for (const c of candidates) {
    const key = `${c.tableFqn.toLowerCase()}::${c.columnName.toLowerCase()}`;
    if (filterSet && !filterSet.has(key)) continue;
    const values = (c.sampleValues ?? [])
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .slice(0, 12);
    if (values.length > 0) {
      out.push({ tableFqn: c.tableFqn, columnName: c.columnName, values });
    }
  }
  return out;
}

function collectColumnValues(entry: SampleDataEntry, colIdx: number): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of entry.rows) {
    if (!Array.isArray(row)) continue;
    const v = row[colIdx];
    if (v == null) continue;
    const s = String(v);
    if (!s.trim()) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    values.push(s);
    if (values.length >= 12) break;
  }
  return values;
}
