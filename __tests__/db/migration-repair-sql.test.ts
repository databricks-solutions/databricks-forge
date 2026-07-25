import { describe, it, expect } from "vitest";
// The repair SQL/decision helpers are authored as standalone ESM (.mjs) so the
// exact same module runs at deploy startup (plain `node`) and under Vitest.
import * as repair from "../../scripts/db/repair-sql.mjs";

describe("migration repair — constants", () => {
  it("uses stable, DB-safe table names", () => {
    expect(repair.SCOPES_TABLE).toBe("forge_estate_program_scopes");
    expect(repair.LINEAGE_TABLE).toBe("forge_table_lineage");
    expect(repair.SCANS_TABLE).toBe("forge_environment_scans");
    expect(repair.PROGRAMS_TABLE).toBe("forge_estate_programs");
  });

  it("exposes a stable advisory-lock key that fits a signed 64-bit integer", () => {
    expect(typeof repair.ADVISORY_LOCK_KEY).toBe("number");
    expect(Number.isInteger(repair.ADVISORY_LOCK_KEY)).toBe(true);
    // Must be representable as a Postgres bigint and be a JS safe integer so it
    // round-trips through the pg driver without precision loss.
    expect(Number.isSafeInteger(repair.ADVISORY_LOCK_KEY)).toBe(true);
    expect(repair.ADVISORY_LOCK_KEY).toBeGreaterThan(0);
    // Stability guard: changing this silently would let two concurrent
    // deployments repair the same DB in parallel. Pin it.
    expect(repair.ADVISORY_LOCK_KEY).toBe(4726352010112026);
  });

  it("uses a NULL-entity sentinel that is not a plausible real value", () => {
    expect(repair.NULL_ENTITY_SENTINEL).toBe("__forge_null_entity__");
  });
});

describe("advisoryLockSql / toRegclassSql / columnExistsSql", () => {
  it("acquires a transaction-scoped advisory lock (auto-released on commit)", () => {
    const sql = repair.advisoryLockSql();
    expect(sql).toMatch(/pg_advisory_xact_lock\s*\(\s*\$1\s*\)/i);
    // Must NOT be a session lock — those leak if the process dies mid-startup.
    expect(sql).not.toMatch(/pg_advisory_lock\s*\(/i);
  });

  it("detects table presence via to_regclass (null when absent)", () => {
    const sql = repair.toRegclassSql();
    expect(sql).toMatch(/to_regclass\s*\(\s*\$1\s*\)/i);
    expect(sql).toMatch(/as\s+oid/i);
  });

  it("detects column presence against information_schema", () => {
    const sql = repair.columnExistsSql();
    expect(sql).toMatch(/information_schema\.columns/i);
    expect(sql).toMatch(/table_name\s*=\s*\$1/i);
    expect(sql).toMatch(/column_name\s*=\s*\$2/i);
    expect(sql).toMatch(/as\s+present/i);
  });
});

describe("scope (program_id, sequence) dedup — two-phase renumber", () => {
  it("finds only programs that actually contain duplicate sequences", () => {
    const sql = repair.findDuplicateSequenceProgramsSql();
    expect(sql).toMatch(/from\s+forge_estate_program_scopes/i);
    expect(sql).toMatch(/group\s+by\s+program_id\s*,\s*sequence/i);
    expect(sql).toMatch(/having\s+count\s*\(\s*\*\s*\)\s*>\s*1/i);
    // Returns the offending program ids (distinct) so the renumber is scoped.
    expect(sql).toMatch(/program_id/i);
  });

  it("phase 1 assigns unique NEGATIVE temporary sequences, scoped to affected programs", () => {
    const sql = repair.scopeRenumberPhase1Sql();
    // Deterministic ordering key required by the plan: sequence, created_at, scope_id.
    expect(sql).toMatch(/order\s+by\s+sequence\s+asc\s*,\s*created_at\s+asc\s*,\s*scope_id\s+asc/i);
    expect(sql).toMatch(/partition\s+by\s+program_id/i);
    expect(sql).toMatch(/row_number\s*\(\s*\)/i);
    // The temporary value is negative so it can never collide with a final,
    // non-negative compacted value even if a unique index already exists.
    expect(sql).toMatch(/set\s+sequence\s*=\s*-/i);
    // Scoped to the affected programs only (idempotent / no-op elsewhere).
    expect(sql).toMatch(/program_id\s*=\s*any\s*\(\s*\$1\s*\)/i);
  });

  it("phase 2 compacts negatives to a 0-based ordering, scoped to affected programs", () => {
    const sql = repair.scopeRenumberPhase2Sql();
    // -1 -> 0, -2 -> 1, ...  ==>  (-sequence) - 1
    expect(sql).toMatch(/set\s+sequence\s*=\s*\(\s*-\s*sequence\s*\)\s*-\s*1/i);
    expect(sql).toMatch(/program_id\s*=\s*any\s*\(\s*\$1\s*\)/i);
    expect(sql).toMatch(/sequence\s*<\s*0/i);
  });
});

describe("lineage dedup — semantic key with NULL entity_type equivalence", () => {
  it("groups by the intended semantic key, coalescing NULL entity_type to a sentinel", () => {
    const sql = repair.dedupeLineageSql();
    expect(sql).toMatch(/from\s+forge_table_lineage/i);
    expect(sql).toMatch(
      /partition\s+by\s+scan_id\s*,\s*source_table_fqn\s*,\s*target_table_fqn\s*,\s*coalesce\s*\(\s*entity_type\s*,\s*\$1\s*\)/i,
    );
  });

  it("retains the latest/best row and deletes the rest", () => {
    const sql = repair.dedupeLineageSql();
    // Best = most recent event, then highest event_count, then id tiebreak.
    expect(sql).toMatch(/order\s+by\s+last_event_time\s+desc\s+nulls\s+last/i);
    expect(sql).toMatch(/event_count\s+desc/i);
    expect(sql).toMatch(/id\s+desc/i);
    expect(sql).toMatch(/^\s*with[\s\S]*delete\s+from\s+forge_table_lineage/im);
    expect(sql).toMatch(/rn\s*>\s*1/i);
  });

  it("backfills logical nulls to the canonical sentinel before Prisma makes the column NOT NULL", () => {
    const sql = repair.backfillLineageEntityTypeSql();
    expect(sql).toMatch(/update\s+forge_table_lineage/i);
    expect(sql).toMatch(/set\s+entity_type\s*=\s*\$1/i);
    expect(sql).toMatch(/where\s+entity_type\s+is\s+null/i);
  });
});

describe("scan lifecycle backfill", () => {
  it("marks legacy scans complete only where the status is still NULL", () => {
    const sql = repair.backfillScanStatusSql();
    expect(sql).toMatch(/update\s+forge_environment_scans/i);
    expect(sql).toMatch(/set\s+scan_status\s*=\s*'complete'/i);
    expect(sql).toMatch(/where\s+scan_status\s+is\s+null/i);
  });
});

describe("classifyMigrationSql — destructive-delta gate", () => {
  it("treats a purely additive delta as safe", () => {
    const sql = [
      'ALTER TABLE "forge_estate_program_scopes" ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "forge_environment_scans" ADD COLUMN "scan_status" TEXT NOT NULL DEFAULT \'complete\';',
      'CREATE INDEX "forge_environment_scans_scan_status_idx" ON "forge_environment_scans"("scan_status");',
    ].join("\n");
    const result = repair.classifyMigrationSql(sql);
    expect(result.destructive).toBe(false);
    expect(result.statements).toEqual([]);
  });

  it("does NOT flag DROP INDEX (index->unique conversion is non-destructive)", () => {
    const sql = [
      'DROP INDEX "forge_estate_program_scopes_program_id_sequence_idx";',
      'CREATE UNIQUE INDEX "forge_estate_program_scopes_program_id_sequence_key" ON "forge_estate_program_scopes"("program_id", "sequence");',
    ].join("\n");
    const result = repair.classifyMigrationSql(sql);
    expect(result.destructive).toBe(false);
  });

  it("flags DROP TABLE as destructive", () => {
    const result = repair.classifyMigrationSql('DROP TABLE "forge_runs";');
    expect(result.destructive).toBe(true);
    expect(result.statements.join(" ")).toMatch(/drop table/i);
  });

  it("flags DROP COLUMN as destructive", () => {
    const result = repair.classifyMigrationSql(
      'ALTER TABLE "forge_runs" DROP COLUMN "business_name";',
    );
    expect(result.destructive).toBe(true);
    expect(result.statements.join(" ")).toMatch(/drop column/i);
  });

  it("flags TRUNCATE and DROP SCHEMA as destructive", () => {
    expect(repair.classifyMigrationSql("TRUNCATE forge_runs;").destructive).toBe(true);
    expect(repair.classifyMigrationSql("DROP SCHEMA public CASCADE;").destructive).toBe(true);
  });

  it("flags ALTER COLUMN TYPE and PostgreSQL shorthand type changes", () => {
    expect(
      repair.classifyMigrationSql(
        'ALTER TABLE "forge_runs" ALTER COLUMN "progress_pct" TYPE SMALLINT;',
      ).destructive,
    ).toBe(true);
    expect(
      repair.classifyMigrationSql(
        'ALTER TABLE "forge_runs" ALTER "progress_pct" SET DATA TYPE SMALLINT;',
      ).destructive,
    ).toBe(true);
  });

  it("flags table and column renames because migrate-diff cannot prove semantic preservation", () => {
    expect(
      repair.classifyMigrationSql('ALTER TABLE "forge_runs" RENAME TO "forge_jobs";').destructive,
    ).toBe(true);
    expect(
      repair.classifyMigrationSql(
        'ALTER TABLE "forge_runs" RENAME COLUMN "business_name" TO "name";',
      ).destructive,
    ).toBe(true);
  });

  it("flags DROP TYPE and destructive enum-value changes", () => {
    expect(repair.classifyMigrationSql('DROP TYPE "RunStatus";').destructive).toBe(true);
    expect(
      repair.classifyMigrationSql("ALTER TYPE \"RunStatus\" RENAME VALUE 'pending' TO 'queued';")
        .destructive,
    ).toBe(true);
  });

  it("flags destructive view/sequence/function drops and DELETE statements", () => {
    for (const sql of [
      'DROP VIEW "estate_rollup";',
      'DROP MATERIALIZED VIEW "estate_rollup";',
      'DROP SEQUENCE "legacy_ids";',
      'DROP FUNCTION "legacy_fn"();',
      'DELETE FROM "forge_runs";',
    ]) {
      expect(repair.classifyMigrationSql(sql).destructive, sql).toBe(true);
    }
  });

  it("collects only the destructive statements from a mixed script", () => {
    const sql = [
      'ALTER TABLE "a" ADD COLUMN "x" TEXT;',
      'ALTER TABLE "a" DROP COLUMN "y";',
      'CREATE UNIQUE INDEX "i" ON "a"("x");',
      'DROP TABLE "b";',
    ].join("\n");
    const result = repair.classifyMigrationSql(sql);
    expect(result.destructive).toBe(true);
    expect(result.statements).toHaveLength(2);
  });

  it("treats an empty/whitespace delta as safe (no-op push)", () => {
    expect(repair.classifyMigrationSql("").destructive).toBe(false);
    expect(repair.classifyMigrationSql("   \n  ").destructive).toBe(false);
  });
});

describe("preflight diff-failure policy", () => {
  it("fails closed by default in every environment", () => {
    expect(repair.allowLocalDiffBypass({})).toBe(false);
    expect(repair.allowLocalDiffBypass({ NODE_ENV: "production" })).toBe(false);
    expect(repair.allowLocalDiffBypass({ NODE_ENV: "development" })).toBe(false);
  });

  it("allows bypass only for an explicit local identity without Databricks app credentials", () => {
    expect(
      repair.allowLocalDiffBypass({
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
      }),
    ).toBe(true);
  });

  it("never allows bypass on the production/app startup path", () => {
    expect(
      repair.allowLocalDiffBypass({
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
        DATABRICKS_CLIENT_ID: "app-client",
      }),
    ).toBe(false);
    expect(
      repair.allowLocalDiffBypass({
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("still blocks a successfully computed destructive delta with local bypass enabled", () => {
    const decision = repair.decideMigrationDiffGate(
      { ok: true, destructive: true, statements: ['DROP TABLE "forge_runs"'] },
      {
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
      },
    );
    expect(decision).toEqual({ proceed: false, bypassed: false });
  });

  it("allows explicit local bypass only after migrate-diff execution/config failure", () => {
    const decision = repair.decideMigrationDiffGate(
      { ok: false, reason: "schema file missing" },
      {
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
      },
    );
    expect(decision).toEqual({ proceed: true, bypassed: true });
  });

  it("blocks migrate-diff failure for production and Databricks App environments", () => {
    for (const env of [
      {
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
        NODE_ENV: "production",
      },
      {
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
        DATABRICKS_CLIENT_ID: "app-client",
      },
    ]) {
      expect(repair.decideMigrationDiffGate({ ok: false, reason: "diff failed" }, env)).toEqual({
        proceed: false,
        bypassed: false,
      });
    }
  });
});
