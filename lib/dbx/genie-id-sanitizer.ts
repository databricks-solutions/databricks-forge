/**
 * Recursive ID sanitizer for Genie API payloads.
 *
 * Mirrors upstream `_sanitize_ids` from databricks-genie-workbench
 * (`backend/services/fix_agent.py`). The Genie API rejects IDs that contain
 * whitespace or special characters and silently truncates IDs over 64 chars.
 *
 * This module only touches the literal `id` field on objects within
 * id-bearing collections; it does NOT rewrite string content elsewhere
 * in the payload. ID-character cleanup, length cap, and collision-aware
 * uniquification are all handled here.
 */

const MAX_ID_LENGTH = 64;

/** Collections whose items each carry a unique `id` field that must be sanitised. */
const ID_BEARING_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ["config", "sample_questions"],
  ["instructions", "join_specs"],
  ["instructions", "example_question_sqls"],
  ["instructions", "text_instructions"],
  ["instructions", "sql_snippets", "measures"],
  ["instructions", "sql_snippets", "filters"],
  ["instructions", "sql_snippets", "expressions"],
  ["benchmarks", "questions"],
];

/**
 * Walk every id-bearing collection on the space, normalize each `id`, and
 * uniquify collisions. Mutates the space in place. Returns a summary of how
 * many ids were rewritten so callers can log meaningful diagnostics.
 *
 * Rewrite rules per id:
 * 1. Replace runs of whitespace with a single underscore.
 * 2. Strip any character that isn't `[A-Za-z0-9_-]`.
 * 3. Truncate to `MAX_ID_LENGTH` characters.
 * 4. If the result collides with an id we've already kept in this run,
 *    append `_2`, `_3`, ... until unique (and re-truncate to fit).
 *
 * Items with empty or non-string ids are left alone (callers may rely on
 * `enforceConstraints` to dedupe later).
 */
export function sanitizeIds(space: unknown): { rewritten: number } {
  if (!isObject(space)) return { rewritten: 0 };

  const seen = new Set<string>();
  let rewritten = 0;

  for (const path of ID_BEARING_PATHS) {
    const arr = resolveArrayAt(space, path);
    if (!arr) continue;
    for (const item of arr) {
      if (!isObject(item)) continue;
      const original = item.id;
      if (typeof original !== "string" || original.length === 0) continue;

      const normalized = normalizeId(original);
      if (!normalized) continue;
      const unique = uniquifyId(normalized, seen);
      seen.add(unique);

      if (unique !== original) {
        item.id = unique;
        rewritten++;
      }
    }
  }

  return { rewritten };
}

function normalizeId(id: string): string {
  return id
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, MAX_ID_LENGTH);
}

function uniquifyId(id: string, seen: Set<string>): string {
  if (!seen.has(id)) return id;
  let suffix = 2;
  while (true) {
    const trial = id.length + `_${suffix}`.length > MAX_ID_LENGTH
      ? `${id.slice(0, MAX_ID_LENGTH - `_${suffix}`.length)}_${suffix}`
      : `${id}_${suffix}`;
    if (!seen.has(trial)) return trial;
    suffix++;
    if (suffix > 999) return trial;
  }
}

function resolveArrayAt(
  obj: Record<string, unknown>,
  path: ReadonlyArray<string>,
): unknown[] | null {
  let current: unknown = obj;
  for (const seg of path) {
    if (!isObject(current)) return null;
    current = current[seg];
  }
  return Array.isArray(current) ? (current as unknown[]) : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
