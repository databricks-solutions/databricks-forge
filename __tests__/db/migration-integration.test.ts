import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { runRepair } from "../../scripts/db/repair.mjs";
import type { EnvironmentScan, LineageEdge } from "../../lib/domain/types";

// ---------------------------------------------------------------------------
// Real-PostgreSQL integration test for the pre-schema repair + `prisma db push`
// upgrade path.
//
// GATED: only runs when TEST_DATABASE_URL points at a DISPOSABLE Postgres with
// the `vector` extension available (CI uses the pgvector/pgvector image; locally
// run against a throwaway DB). It DROPs and recreates the public schema, so it
// must NEVER be pointed at a real database.
//
//   Export TEST_DATABASE_URL for a disposable local database, then run:
//     npm run test:integration
// ---------------------------------------------------------------------------

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const runIt = TEST_DATABASE_URL ? it : it.skip;

function resolvePrismaEntry() {
  const js = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  if (existsSync(js)) return js;
  throw new Error("prisma CLI build not found");
}

function prismaDbPush(url: string): string {
  const entry = resolvePrismaEntry();
  // --accept-data-loss mirrors the real deploy: Prisma forces it to add the new
  // UNIQUE constraints. It is lossless here because runRepair() already removed
  // the duplicate rows (asserted below: all rows preserved).
  return execFileSync(
    process.execPath,
    [entry, "db", "push", "--accept-data-loss", "--schema=prisma/schema.prisma"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DATABASE_URL: url },
    },
  );
}

function runPreflight(url: string, extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
  return execFileSync(process.execPath, ["scripts/db-preflight.mjs"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: url, ...extraEnv },
  });
}

// Legacy ("pre-PR") shape: forge_estate_program_scopes has a PLAIN index on
// (program_id, sequence) — not the new unique — and lacks the lifecycle columns.
// forge_table_lineage has no unique key. forge_environment_scans has no
// scan_status column.
const LEGACY_DDL = `
CREATE TABLE forge_estate_programs (
  program_id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  industry_id text,
  sub_vertical text,
  org_context text,
  owner_email text,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  updated_at timestamp(3) NOT NULL DEFAULT now()
);

CREATE TABLE forge_estate_program_scopes (
  scope_id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES forge_estate_programs(program_id) ON DELETE CASCADE,
  label text NOT NULL,
  uc_metadata text NOT NULL,
  excluded_scope text,
  exclusion_patterns text,
  inclusion_patterns text,
  asset_discovery_enabled boolean NOT NULL DEFAULT false,
  lineage_depth integer NOT NULL DEFAULT 5,
  lineage_enabled boolean NOT NULL DEFAULT true,
  lineage_direction text NOT NULL DEFAULT 'upstream',
  workspace_id text,
  team_label text,
  status text NOT NULL DEFAULT 'planned',
  scan_id text,
  sequence integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  updated_at timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX forge_estate_program_scopes_program_id_idx ON forge_estate_program_scopes(program_id);
CREATE INDEX forge_estate_program_scopes_program_id_sequence_idx ON forge_estate_program_scopes(program_id, sequence);

CREATE TABLE forge_environment_scans (
  scan_id text PRIMARY KEY,
  run_id text,
  program_id text,
  uc_path text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  owner_email text
);

CREATE TABLE forge_table_lineage (
  id text PRIMARY KEY,
  scan_id text NOT NULL REFERENCES forge_environment_scans(scan_id) ON DELETE CASCADE,
  source_table_fqn text NOT NULL,
  target_table_fqn text NOT NULL,
  source_type text,
  target_type text,
  entity_type text,
  last_event_time text,
  event_count integer NOT NULL DEFAULT 1
);
CREATE INDEX forge_table_lineage_scan_id_idx ON forge_table_lineage(scan_id);
`;

async function seedLegacy(client: pg.Client) {
  await client.query(
    `INSERT INTO forge_estate_programs (program_id, name) VALUES ('P1','Program One'),('P2','Program Two')`,
  );

  // P1: duplicated sequences (0,0 and 1,1) plus one clean row.
  await client.query(`
    INSERT INTO forge_estate_program_scopes (scope_id, program_id, label, uc_metadata, sequence, created_at) VALUES
      ('s1','P1','s1','[]',0,'2024-01-01T00:00:00Z'),
      ('s2','P1','s2','[]',0,'2024-01-02T00:00:00Z'),
      ('s3','P1','s3','[]',1,'2024-01-03T00:00:00Z'),
      ('s4','P1','s4','[]',1,'2024-01-04T00:00:00Z'),
      ('s5','P1','s5','[]',2,'2024-01-05T00:00:00Z')
  `);
  // P2: already clean — must be left untouched.
  await client.query(`
    INSERT INTO forge_estate_program_scopes (scope_id, program_id, label, uc_metadata, sequence, created_at) VALUES
      ('t1','P2','t1','[]',0,'2024-01-01T00:00:00Z'),
      ('t2','P2','t2','[]',1,'2024-01-02T00:00:00Z')
  `);

  await client.query(`
    INSERT INTO forge_environment_scans (scan_id, uc_path) VALUES
      ('sc1','cat.sch'),
      ('sc2','cat.sch2')
  `);

  // Lineage duplicates: TABLE-typed dup, NULL-typed dup (NULL equivalence),
  // plus unique rows in different groups.
  await client.query(`
    INSERT INTO forge_table_lineage (id, scan_id, source_table_fqn, target_table_fqn, entity_type, last_event_time, event_count) VALUES
      ('l1','sc1','A','B','TABLE','2024-01-01',1),
      ('l2','sc1','A','B','TABLE','2024-02-01',5),
      ('l3','sc1','A','B',NULL,'2024-01-01',1),
      ('l4','sc1','A','B',NULL,'2024-03-01',2),
      ('l5','sc1','C','D',NULL,NULL,1),
      ('l6','sc2','A','B','TABLE','2024-01-01',1)
  `);
}

describe("migration integration — repair + prisma db push (real Postgres)", () => {
  let client: pg.Client;
  // The repair runs on plain Postgres; only `prisma db push` needs the `vector`
  // extension (the embedding column). When pgvector is unavailable we still
  // exercise the full repair against a real DB and note the push as skipped.
  let vectorAvailable = false;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) return;
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      vectorAvailable = true;
    } catch {
      vectorAvailable = false;
    }
    await client.query(LEGACY_DDL);
    await seedLegacy(client);
  }, 120_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  runIt(
    "repairs duplicate sequence + lineage rows without losing scopes, and is a no-op on rerun",
    async () => {
      // -- First repair --------------------------------------------------
      const first = await runRepair(TEST_DATABASE_URL!, { client });
      expect(first.scopeProgramsRenumbered).toBe(1); // only P1 had dups
      expect(first.scopeRowsRenumbered).toBe(5); // all P1 scopes renumbered
      expect(first.lineageDuplicatesRemoved).toBe(2); // l1 + l3
      expect(first.lineageEntityTypesBackfilled).toBe(2); // retained l4 + l5

      // No scopes lost: 5 (P1) + 2 (P2) preserved.
      const scopeCount = await client.query(
        "SELECT COUNT(*)::int AS n FROM forge_estate_program_scopes",
      );
      expect(scopeCount.rows[0].n).toBe(7);

      // P1 sequences are now unique + compacted 0..4 in (sequence,created_at,scope_id) order.
      const p1 = await client.query(
        "SELECT scope_id, sequence FROM forge_estate_program_scopes WHERE program_id='P1' ORDER BY sequence",
      );
      expect(p1.rows.map((r) => `${r.scope_id}:${r.sequence}`)).toEqual([
        "s1:0",
        "s2:1",
        "s3:2",
        "s4:3",
        "s5:4",
      ]);

      // P2 (clean) is untouched.
      const p2 = await client.query(
        "SELECT scope_id, sequence FROM forge_estate_program_scopes WHERE program_id='P2' ORDER BY sequence",
      );
      expect(p2.rows.map((r) => `${r.scope_id}:${r.sequence}`)).toEqual(["t1:0", "t2:1"]);

      // Lineage: best rows retained per semantic key.
      const lin = await client.query("SELECT id FROM forge_table_lineage ORDER BY id");
      expect(lin.rows.map((r) => r.id)).toEqual(["l2", "l4", "l5", "l6"]);
      const logicalNulls = await client.query(
        "SELECT id, entity_type FROM forge_table_lineage WHERE id IN ('l4','l5') ORDER BY id",
      );
      expect(logicalNulls.rows).toEqual([
        { id: "l4", entity_type: "__forge_null_entity__" },
        { id: "l5", entity_type: "__forge_null_entity__" },
      ]);

      // -- Second repair is a pure no-op --------------------------------
      const second = await runRepair(TEST_DATABASE_URL!, { client });
      expect(second.scopeProgramsRenumbered).toBe(0);
      expect(second.scopeRowsRenumbered).toBe(0);
      expect(second.lineageDuplicatesRemoved).toBe(0);
      expect(second.lineageEntityTypesBackfilled).toBe(0);
    },
    120_000,
  );

  runIt(
    "prisma db push applies the new schema, enforces constraints, and backfills scan_status",
    async () => {
      if (!vectorAvailable) {
        console.warn(
          "[migration-integration] pgvector unavailable — skipping `prisma db push` assertions. " +
            "Run against pgvector/pgvector image for full coverage.",
        );
        return;
      }
      // Succeeds because duplicates were already repaired: the unique-constraint
      // adds apply losslessly (all rows preserved, asserted below).
      expect(() => prismaDbPush(TEST_DATABASE_URL!)).not.toThrow();

      // New lifecycle columns exist with defaults applied to legacy rows.
      const attempt = await client.query(
        "SELECT attempt_count FROM forge_estate_program_scopes WHERE scope_id='s1'",
      );
      expect(attempt.rows[0].attempt_count).toBe(0);

      // Legacy scans became complete via the column DEFAULT.
      const scans = await client.query(
        "SELECT scan_status FROM forge_environment_scans ORDER BY scan_id",
      );
      expect(scans.rows.map((r) => r.scan_status)).toEqual(["complete", "complete"]);

      const entityTypeColumn = await client.query(
        `SELECT is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name='forge_table_lineage'
           AND column_name='entity_type'`,
      );
      expect(entityTypeColumn.rows[0].is_nullable).toBe("NO");
      expect(entityTypeColumn.rows[0].column_default).toContain("__forge_null_entity__");

      // Unique (program_id, sequence) is now enforced.
      await expect(
        client.query(
          `INSERT INTO forge_estate_program_scopes (scope_id, program_id, label, uc_metadata, sequence)
           VALUES ('dup','P1','dup','[]',0)`,
        ),
      ).rejects.toThrow();

      // A logical-null duplicate is durable: raw NULL is forbidden, and the
      // canonical sentinel collides with the repaired l5 semantic key.
      await expect(
        client.query(
          `INSERT INTO forge_table_lineage
             (id, scan_id, source_table_fqn, target_table_fqn, entity_type)
           VALUES ('dup-null','sc1','C','D',NULL)`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `INSERT INTO forge_table_lineage
             (id, scan_id, source_table_fqn, target_table_fqn, entity_type)
           VALUES ('dup-sentinel','sc1','C','D','__forge_null_entity__')`,
        ),
      ).rejects.toThrow();

      // Exercise the real runtime createMany({ skipDuplicates: true }) path.
      // Re-saving the same logical-null edge must map null to the sentinel and
      // leave exactly one row.
      process.env.DATABASE_URL = TEST_DATABASE_URL!;
      const { saveEnvironmentScan } = await import("../../lib/lakebase/environment-scans");
      const runtimeScan: EnvironmentScan = {
        scanId: "sc1",
        runId: null,
        ucPath: "cat.sch",
        scannedAt: "2026-01-01T00:00:00Z",
        tableCount: 0,
        totalSizeBytes: 0,
        totalFiles: 0,
        totalRows: 0,
        tablesWithStreaming: 0,
        tablesWithCDF: 0,
        tablesNeedingOptimize: 0,
        tablesNeedingVacuum: 0,
        lineageDiscoveredCount: 0,
        domainCount: 0,
        piiTablesCount: 0,
        redundancyPairsCount: 0,
        dataProductCount: 0,
        avgGovernanceScore: 0,
        genieSpaceCount: 0,
        dashboardCount: 0,
        metricViewCount: 0,
        analyticsCoveragePercent: 0,
        scanDurationMs: 1,
        passResults: {},
        scanStatus: "complete",
      };
      const logicalNullEdge: LineageEdge = {
        sourceTableFqn: "runtime.source",
        targetTableFqn: "runtime.target",
        sourceType: "TABLE",
        targetType: "TABLE",
        entityType: null,
        lastEventTime: null,
        eventCount: 1,
      };
      await saveEnvironmentScan(runtimeScan, [], [], [logicalNullEdge], []);
      await saveEnvironmentScan(runtimeScan, [], [], [logicalNullEdge], []);
      const runtimeRows = await client.query(
        `SELECT COUNT(*)::int AS n, MIN(entity_type) AS entity_type
         FROM forge_table_lineage
         WHERE scan_id='sc1' AND source_table_fqn='runtime.source'
           AND target_table_fqn='runtime.target'`,
      );
      expect(runtimeRows.rows[0]).toEqual({
        n: 1,
        entity_type: "__forge_null_entity__",
      });

      // Lineage scan_edge unique is now enforced for the non-null entity case.
      await expect(
        client.query(
          `INSERT INTO forge_table_lineage (id, scan_id, source_table_fqn, target_table_fqn, entity_type)
           VALUES ('dup1','sc1','A','B','TABLE')`,
        ),
      ).rejects.toThrow();

      // Rows are still all present (nothing dropped by the push).
      const finalScopes = await client.query(
        "SELECT COUNT(*)::int AS n FROM forge_estate_program_scopes",
      );
      expect(finalScopes.rows[0].n).toBe(7);
      const finalLineage = await client.query("SELECT COUNT(*)::int AS n FROM forge_table_lineage");
      expect(finalLineage.rows[0].n).toBe(5);
    },
    180_000,
  );

  runIt(
    "fails closed when migrate-diff cannot prove the pending schema is safe",
    async () => {
      expect(() =>
        runPreflight(TEST_DATABASE_URL!, {
          PRISMA_SCHEMA_PATH: "prisma/does-not-exist.prisma",
        }),
      ).toThrow();
    },
    120_000,
  );

  runIt(
    "applies local bypass only to diff failure and never to a computed destructive delta",
    async () => {
      const localEnv = {
        PRISMA_SCHEMA_PATH: "prisma/does-not-exist.prisma",
        FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
        FORGE_LOCAL_USER_EMAIL: "dev@example.com",
      };

      // Execution/config failure is bypassable only for a true local identity.
      expect(() => runPreflight(TEST_DATABASE_URL!, localEnv)).not.toThrow();
      expect(() =>
        runPreflight(TEST_DATABASE_URL!, { ...localEnv, NODE_ENV: "production" }),
      ).toThrow();
      expect(() =>
        runPreflight(TEST_DATABASE_URL!, {
          ...localEnv,
          DATABRICKS_CLIENT_ID: "app-client",
        }),
      ).toThrow();

      // A successfully computed destructive delta is never bypassable.
      await client.query("CREATE TABLE preflight_destructive_probe (id text PRIMARY KEY)");
      try {
        expect(() =>
          runPreflight(TEST_DATABASE_URL!, {
            FORGE_DB_PREFLIGHT_LOCAL_BYPASS: "1",
            FORGE_LOCAL_USER_EMAIL: "dev@example.com",
          }),
        ).toThrow();
      } finally {
        await client.query("DROP TABLE IF EXISTS preflight_destructive_probe");
      }
    },
    120_000,
  );
});
