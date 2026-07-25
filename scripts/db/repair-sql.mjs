// ---------------------------------------------------------------------------
// Pre-schema migration/repair — pure SQL construction + decision helpers.
//
// Authored as standalone ESM (no TypeScript, no app imports) so the EXACT same
// module runs at deploy startup under plain `node` (scripts/db-preflight.mjs)
// AND under Vitest (unit tests). Every function here is pure: it returns a SQL
// string or a plain decision object and never touches the network or a DB.
//
// The repair exists to make a "pre-PR" Lakebase database safe to upgrade with
// `prisma db push`, specifically:
//   1. Deduplicate ForgeEstateProgramScope rows that share (program_id,
//      sequence) BEFORE the new @@unique([programId, sequence]) is created.
//   2. Deduplicate ForgeTableLineage rows under the intended semantic key
//      (scan_id, source, target, entity_type) with NULL entity_type treated as
//      a single equivalence class.
//   3. Ensure legacy scans carry a non-NULL scan_status ("complete").
//
// See docs/DEPLOYMENT.md ("Safe upgrade from a pre-PR database").
// ---------------------------------------------------------------------------

export const SCOPES_TABLE = "forge_estate_program_scopes";
export const LINEAGE_TABLE = "forge_table_lineage";
export const SCANS_TABLE = "forge_environment_scans";
export const PROGRAMS_TABLE = "forge_estate_programs";

/**
 * Fixed Postgres advisory-lock key. Two app instances booting against the same
 * Lakebase project must not run the repair concurrently, so both take this
 * transaction-scoped lock first; the loser blocks until the winner commits and
 * then finds nothing to do. Encodes "forge" + a date stamp for readability.
 * MUST stay a JS-safe integer so it round-trips through the pg driver as a
 * bigint without precision loss.
 */
export const ADVISORY_LOCK_KEY = 4726352010112026;

/**
 * Sentinel used to collapse all NULL entity_type lineage rows into one
 * equivalence class. Chosen to never collide with a real Databricks entity
 * type (TABLE / VIEW / MATERIALIZED_VIEW / STREAMING_TABLE / ...).
 */
export const NULL_ENTITY_SENTINEL = "__forge_null_entity__";

/** Acquire a transaction-scoped advisory lock (auto-released on COMMIT/ROLLBACK). */
export function advisoryLockSql() {
  return "SELECT pg_advisory_xact_lock($1)";
}

/** Resolve a (possibly schema-qualified) relation name to its regclass, or NULL. */
export function toRegclassSql() {
  return "SELECT to_regclass($1) AS oid";
}

/** Test whether a given column exists on a given table in the public schema. */
export function columnExistsSql() {
  return `SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = $1
    AND column_name = $2
) AS present`;
}

/**
 * Return the distinct program ids that contain at least one duplicated
 * sequence. Used both to detect whether any repair is needed (no-op when the
 * result is empty) and to scope the two-phase renumber below.
 */
export function findDuplicateSequenceProgramsSql() {
  return `SELECT DISTINCT program_id
FROM ${SCOPES_TABLE}
GROUP BY program_id, sequence
HAVING COUNT(*) > 1`;
}

/**
 * Phase 1 of the scope renumber: within each AFFECTED program, assign a unique
 * NEGATIVE temporary sequence (-1, -2, ... in the deterministic order
 * sequence, created_at, scope_id). Negative temporaries can never collide with
 * a final, non-negative compacted value, so this is safe even if a unique
 * index already exists. $1 = text[] of affected program ids.
 */
export function scopeRenumberPhase1Sql() {
  return `WITH ranked AS (
  SELECT scope_id,
         ROW_NUMBER() OVER (
           PARTITION BY program_id
           ORDER BY sequence ASC, created_at ASC, scope_id ASC
         ) AS rn
  FROM ${SCOPES_TABLE}
  WHERE program_id = ANY($1)
)
UPDATE ${SCOPES_TABLE} AS s
SET sequence = -ranked.rn
FROM ranked
WHERE s.scope_id = ranked.scope_id`;
}

/**
 * Phase 2 of the scope renumber: compact the negative temporaries into a dense
 * 0-based ordering (-1 -> 0, -2 -> 1, ...). $1 = text[] of affected program ids.
 */
export function scopeRenumberPhase2Sql() {
  return `UPDATE ${SCOPES_TABLE}
SET sequence = (-sequence) - 1
WHERE program_id = ANY($1)
  AND sequence < 0`;
}

/**
 * Delete duplicate lineage edges, keeping the latest/best row per semantic key
 * (scan_id, source, target, COALESCE(entity_type, sentinel)). "Best" = most
 * recent last_event_time, then highest event_count, then id tiebreak.
 * $1 = NULL entity sentinel.
 */
export function dedupeLineageSql() {
  return `WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY scan_id, source_table_fqn, target_table_fqn, COALESCE(entity_type, $1)
           ORDER BY last_event_time DESC NULLS LAST, event_count DESC, id DESC
         ) AS rn
  FROM ${LINEAGE_TABLE}
)
DELETE FROM ${LINEAGE_TABLE}
WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`;
}

/** Normalize legacy logical NULLs before Prisma applies NOT NULL + UNIQUE. */
export function backfillLineageEntityTypeSql() {
  return `UPDATE ${LINEAGE_TABLE}
SET entity_type = $1
WHERE entity_type IS NULL`;
}

/** Backfill scan_status='complete' for legacy scans whose status is still NULL. */
export function backfillScanStatusSql() {
  return `UPDATE ${SCANS_TABLE}
SET scan_status = 'complete'
WHERE scan_status IS NULL`;
}

// ---------------------------------------------------------------------------
// Destructive-delta gate.
//
// Instead of blindly passing `--accept-data-loss` to `prisma db push`, the
// preflight computes the pending migration SQL (`prisma migrate diff`) and runs
// it through this classifier. Genuinely data-losing statements (dropping
// tables/columns/types, renames, DELETE/TRUNCATE) abort the deploy; benign statements — even
// DROP INDEX, which `index -> unique` conversions emit — are allowed through so
// the gated `db push --accept-data-loss` cannot silently destroy data.
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate real data loss. Deliberately does NOT include
 * `DROP INDEX` / `DROP CONSTRAINT` (non-destructive; emitted when converting a
 * plain index to a unique one) or `ADD COLUMN` (additive).
 */
const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+TYPE\b/i,
  /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/i,
  /\bDROP\s+(?:SEQUENCE|FUNCTION|PROCEDURE|DOMAIN|EXTENSION)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+TABLE\b[\s\S]*\bALTER(?:\s+COLUMN)?\b[\s\S]*\b(?:TYPE|SET\s+DATA\s+TYPE)\b/i,
  /\bALTER\s+TABLE\b[\s\S]*\bRENAME(?:\s+COLUMN)?\b/i,
  /\bALTER\s+TYPE\b[\s\S]*\b(?:RENAME|DROP)\b/i,
];

/**
 * A migrate-diff failure may only be bypassed by an explicit local developer.
 * Databricks App startup has DATABRICKS_CLIENT_ID and production is always
 * closed, so the production path cannot silently continue.
 */
export function allowLocalDiffBypass(env) {
  return (
    env?.FORGE_DB_PREFLIGHT_LOCAL_BYPASS === "1" &&
    Boolean(env?.FORGE_LOCAL_USER_EMAIL?.trim()) &&
    !env?.DATABRICKS_CLIENT_ID &&
    env?.NODE_ENV !== "production"
  );
}

/**
 * Decide whether preflight may proceed after migrate-diff has been attempted.
 * A computed destructive delta is never bypassable. The local bypass applies
 * only to execution/config failures where no delta could be computed.
 */
export function decideMigrationDiffGate(gate, env) {
  if (gate?.ok) {
    return { proceed: !gate.destructive, bypassed: false };
  }
  const bypassed = allowLocalDiffBypass(env);
  return { proceed: bypassed, bypassed };
}

/**
 * Classify a migration SQL script for destructive (data-losing) statements.
 * @param {string} sql - raw SQL, possibly many `;`-separated statements.
 * @returns {{ destructive: boolean, statements: string[] }}
 */
export function classifyMigrationSql(sql) {
  if (!sql || !sql.trim()) return { destructive: false, statements: [] };

  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((stmt) => DESTRUCTIVE_PATTERNS.some((re) => re.test(stmt)));

  return { destructive: statements.length > 0, statements };
}
