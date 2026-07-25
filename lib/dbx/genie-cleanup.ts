/**
 * Genie API hygiene: defensive constraints + payload cleanup.
 *
 * Mirrors upstream `_enforce_constraints` + `_clean_config` from
 * databricks-genie-workbench (`backend/genie_creator.py`). Pure functions,
 * no side effects -- safe to call repeatedly. Operates on parsed
 * `SerializedSpace` v2 JSON objects.
 *
 * Used by `lib/dbx/genie.ts` `createGenieSpace` / `updateGenieSpace` after
 * `sanitizeSerializedSpace` (which handles shape coercion) and after
 * `sanitizeIds` (which handles ID character normalization).
 */

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/** Genie API caps the number of tables per space. */
export const MAX_TABLES_PER_SPACE = 50;

/**
 * Genie API caps each individual string field in the payload. Anything longer
 * is silently truncated by the server, so we truncate explicitly and log so
 * we can surface a warning to the user.
 */
export const MAX_STRING_FIELD_CHARS = 25_000;
const STRING_TRUNCATE_WARN_AT = 24_000;

/** Soft warning threshold for total payload bytes. */
export const PAYLOAD_BYTES_WARN_THRESHOLD = 3_500_000;

/**
 * Collections whose items each have a unique `id` field. Dedupe across all of
 * these to catch e.g. a measure and a filter accidentally sharing an id.
 */
const ID_BEARING_PATHS: ReadonlyArray<string[]> = [
  ["config", "sample_questions"],
  ["instructions", "join_specs"],
  ["instructions", "example_question_sqls"],
  ["instructions", "text_instructions"],
  ["instructions", "sql_snippets", "measures"],
  ["instructions", "sql_snippets", "filters"],
  ["instructions", "sql_snippets", "expressions"],
  ["benchmarks", "questions"],
];

// ---------------------------------------------------------------------------
// enforceConstraints -- structural caps + dedup + drop empties
// ---------------------------------------------------------------------------

interface EnforceConstraintsResult {
  tablesDropped: number;
  benchmarksDropped: number;
  trustedAssetsDropped: number;
  duplicateIdsRenamed: number;
}

/**
 * Apply Genie API structural constraints to a parsed space JSON.
 *
 * Mutates the input in place AND returns a summary of what changed (for
 * logging). Idempotent -- calling twice on the same input is a no-op.
 *
 * - Cap `data_sources.tables` at MAX_TABLES_PER_SPACE.
 * - Strip `instructions.example_question_sqls` whose SQL is whitespace-only.
 * - Drop `benchmarks.questions` whose answer SQL is whitespace-only.
 * - Dedupe IDs across measures/filters/expressions/joins/text_instructions/
 *   sample_questions/example_question_sqls/benchmarks. On collision, the
 *   second-and-subsequent items are renamed `<original>_dup_2`, `_dup_3`, ...
 */
export function enforceConstraints(space: unknown): EnforceConstraintsResult {
  if (!isObject(space)) {
    return {
      tablesDropped: 0,
      benchmarksDropped: 0,
      trustedAssetsDropped: 0,
      duplicateIdsRenamed: 0,
    };
  }

  let tablesDropped = 0;
  let benchmarksDropped = 0;
  let trustedAssetsDropped = 0;
  let duplicateIdsRenamed = 0;

  const dataSources = space.data_sources;
  if (isObject(dataSources)) {
    const tables = dataSources.tables;
    if (Array.isArray(tables) && tables.length > MAX_TABLES_PER_SPACE) {
      tablesDropped = tables.length - MAX_TABLES_PER_SPACE;
      dataSources.tables = tables.slice(0, MAX_TABLES_PER_SPACE);
      logger.warn("Genie space tables capped", {
        kept: MAX_TABLES_PER_SPACE,
        dropped: tablesDropped,
      });
    }
  }

  const instructions = space.instructions;
  if (isObject(instructions)) {
    const exampleSqls = instructions.example_question_sqls;
    if (Array.isArray(exampleSqls)) {
      const before = exampleSqls.length;
      instructions.example_question_sqls = exampleSqls.filter(isExampleSqlNonEmpty);
      trustedAssetsDropped = before - (instructions.example_question_sqls as unknown[]).length;
    }
  }

  const benchmarks = space.benchmarks;
  if (isObject(benchmarks)) {
    const questions = benchmarks.questions;
    if (Array.isArray(questions)) {
      const before = questions.length;
      benchmarks.questions = questions.filter(isBenchmarkQuestionAnswerable);
      benchmarksDropped = before - (benchmarks.questions as unknown[]).length;
    }
  }

  duplicateIdsRenamed = dedupeIdsAcrossCollections(space);

  if (tablesDropped || benchmarksDropped || trustedAssetsDropped || duplicateIdsRenamed) {
    logger.info("enforceConstraints applied", {
      tablesDropped,
      benchmarksDropped,
      trustedAssetsDropped,
      duplicateIdsRenamed,
    });
  }

  return { tablesDropped, benchmarksDropped, trustedAssetsDropped, duplicateIdsRenamed };
}

function isExampleSqlNonEmpty(item: unknown): boolean {
  if (!isObject(item)) return false;
  const sql = item.sql;
  if (Array.isArray(sql)) {
    return sql.some((s) => typeof s === "string" && s.trim().length > 0);
  }
  if (typeof sql === "string") {
    return sql.trim().length > 0;
  }
  return false;
}

function isBenchmarkQuestionAnswerable(item: unknown): boolean {
  if (!isObject(item)) return false;
  const question = item.question;
  const hasQuestion =
    (Array.isArray(question) && question.some((q) => typeof q === "string" && q.trim().length > 0)) ||
    (typeof question === "string" && question.trim().length > 0);
  if (!hasQuestion) return false;

  const answer = item.answer;
  if (!Array.isArray(answer) || answer.length === 0) {
    return true;
  }
  for (const a of answer) {
    if (!isObject(a)) continue;
    const content = a.content;
    if (Array.isArray(content)) {
      if (content.some((c) => typeof c === "string" && c.trim().length > 0)) return true;
    } else if (typeof content === "string" && content.trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Walk every id-bearing collection in the space and rename duplicates with
 * a `_dup_N` suffix. Returns the total number of items renamed.
 */
function dedupeIdsAcrossCollections(space: Record<string, unknown>): number {
  const seen = new Map<string, number>();
  let renamed = 0;

  for (const path of ID_BEARING_PATHS) {
    const arr = resolveArrayAt(space, path);
    if (!arr) continue;
    for (const item of arr) {
      if (!isObject(item)) continue;
      const id = item.id;
      if (typeof id !== "string" || id.length === 0) continue;
      const count = seen.get(id) ?? 0;
      if (count > 0) {
        item.id = `${id}_dup_${count + 1}`;
        renamed++;
      }
      seen.set(id, count + 1);
    }
  }
  return renamed;
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

// ---------------------------------------------------------------------------
// cleanConfig -- defensive payload cleanup (truncation, byte warning,
// relationship_type normalization)
// ---------------------------------------------------------------------------

interface CleanConfigResult {
  stringsTruncated: number;
  totalBytes: number;
  payloadOversize: boolean;
}

/**
 * Run defensive payload cleanup. Mutates the input in place.
 *
 * - Truncate every string field to MAX_STRING_FIELD_CHARS, logging a
 *   warning per truncation so we can attribute oversized fields.
 * - Compute total payload bytes; warn (but do not error) if over
 *   PAYLOAD_BYTES_WARN_THRESHOLD.
 * - Normalize `relationship_type` enum strings on join_specs to upper-case
 *   so the `--rt=` SQL comment encoding produced by `sanitizeSerializedSpace`
 *   sees a canonical form.
 */
export function cleanConfig(space: unknown): CleanConfigResult {
  if (!isObject(space)) {
    return { stringsTruncated: 0, totalBytes: 0, payloadOversize: false };
  }

  let stringsTruncated = 0;

  const truncateStringsWalk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (node.length > MAX_STRING_FIELD_CHARS) {
        stringsTruncated++;
        return node.slice(0, MAX_STRING_FIELD_CHARS);
      }
      if (node.length > STRING_TRUNCATE_WARN_AT) {
        logger.debug("Genie payload string approaching truncation limit", {
          length: node.length,
          limit: MAX_STRING_FIELD_CHARS,
        });
      }
      return node;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = truncateStringsWalk(node[i]);
      }
      return node;
    }
    if (isObject(node)) {
      for (const key of Object.keys(node)) {
        node[key] = truncateStringsWalk(node[key]);
      }
      return node;
    }
    return node;
  };

  truncateStringsWalk(space);
  normalizeRelationshipTypes(space);

  const totalBytes = JSON.stringify(space).length;
  const payloadOversize = totalBytes > PAYLOAD_BYTES_WARN_THRESHOLD;
  if (payloadOversize) {
    logger.warn("Genie payload exceeds soft size limit", {
      bytes: totalBytes,
      threshold: PAYLOAD_BYTES_WARN_THRESHOLD,
    });
  }
  if (stringsTruncated > 0) {
    logger.warn("Genie payload strings truncated", {
      count: stringsTruncated,
      maxChars: MAX_STRING_FIELD_CHARS,
    });
  }

  return { stringsTruncated, totalBytes, payloadOversize };
}

/**
 * Normalize relationship_type values to canonical uppercase enum tokens.
 *
 * `sanitizeSerializedSpace` later encodes these into `--rt=FROM_RELATIONSHIP_TYPE_<X>--`
 * SQL comments and removes the `relationship_type` field. We only need to make
 * sure incoming values are canonical so casing variations don't leak into the
 * encoded SQL comments.
 */
function normalizeRelationshipTypes(space: Record<string, unknown>): void {
  const instructions = space.instructions;
  if (!isObject(instructions)) return;
  const joinSpecs = instructions.join_specs;
  if (!Array.isArray(joinSpecs)) return;

  for (const js of joinSpecs) {
    if (!isObject(js)) continue;
    const rt = js.relationship_type;
    if (typeof rt === "string") {
      js.relationship_type = rt.trim().toUpperCase().replace(/[^A-Z_]/g, "_");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
