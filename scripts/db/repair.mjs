// ---------------------------------------------------------------------------
// Pre-schema migration/repair — orchestrator.
//
// Runs the pure SQL helpers from repair-sql.mjs inside ONE advisory-locked
// transaction against a live Postgres/Lakebase database. Guarantees:
//   - transaction-safe: any failure rolls the whole repair back (no partial
//     dedup that could still block `prisma db push`);
//   - advisory-lock protected: concurrent app boots serialize on a fixed key;
//   - no-op on a clean/fresh DB: missing tables are skipped, and the dedup
//     statements touch zero rows when there is nothing to repair;
//   - safe on rerun: every operation is idempotent.
//
// It NEVER calls Prisma and NEVER passes `--accept-data-loss` — schema
// application is a separate, gated step (see scripts/db-preflight.mjs).
// ---------------------------------------------------------------------------

import pg from "pg";
import {
  ADVISORY_LOCK_KEY,
  NULL_ENTITY_SENTINEL,
  SCOPES_TABLE,
  LINEAGE_TABLE,
  SCANS_TABLE,
  advisoryLockSql,
  toRegclassSql,
  columnExistsSql,
  findDuplicateSequenceProgramsSql,
  scopeRenumberPhase1Sql,
  scopeRenumberPhase2Sql,
  dedupeLineageSql,
  backfillLineageEntityTypeSql,
  backfillScanStatusSql,
} from "./repair-sql.mjs";

/**
 * @typedef {Object} RepairReport
 * @property {number} scopeProgramsRenumbered   distinct programs whose scopes were renumbered
 * @property {number} scopeRowsRenumbered       scope rows touched by the two-phase renumber
 * @property {number} lineageDuplicatesRemoved  duplicate lineage edges deleted
 * @property {number} lineageEntityTypesBackfilled legacy NULL entity types normalized
 * @property {number} scanStatusBackfilled      legacy scans stamped scan_status='complete'
 * @property {string[]} skipped                 tables that did not exist yet (fresh DB)
 */

async function relationExists(client, qualifiedName) {
  const res = await client.query(toRegclassSql(), [qualifiedName]);
  return Boolean(res.rows[0]?.oid);
}

/**
 * Repair a (possibly pre-PR) database so the new Prisma schema can be pushed
 * without losing scopes, without duplicate lineage edges, and with legacy scans
 * marked complete.
 *
 * @param {string} connectionString  Postgres/Lakebase DATABASE_URL
 * @param {{ logger?: Pick<Console,'log'|'error'>, client?: import('pg').Client }} [opts]
 *        `client` lets tests inject an already-connected client; otherwise a
 *        short-lived client is created and closed here.
 * @returns {Promise<RepairReport>}
 */
export async function runRepair(connectionString, opts = {}) {
  const logger = opts.logger ?? console;
  const injected = opts.client;
  const client = injected ?? new pg.Client({ connectionString });
  if (!injected) await client.connect();

  /** @type {RepairReport} */
  const report = {
    scopeProgramsRenumbered: 0,
    scopeRowsRenumbered: 0,
    lineageDuplicatesRemoved: 0,
    lineageEntityTypesBackfilled: 0,
    scanStatusBackfilled: 0,
    skipped: [],
  };

  try {
    await client.query("BEGIN");
    // Serialize concurrent startups; auto-released on COMMIT/ROLLBACK.
    await client.query(advisoryLockSql(), [ADVISORY_LOCK_KEY]);

    // -- 1. ForgeEstateProgramScope (program_id, sequence) dedup -------------
    if (await relationExists(client, SCOPES_TABLE)) {
      const dupRes = await client.query(findDuplicateSequenceProgramsSql());
      const programIds = dupRes.rows.map((r) => r.program_id);
      if (programIds.length > 0) {
        const phase1 = await client.query(scopeRenumberPhase1Sql(), [programIds]);
        await client.query(scopeRenumberPhase2Sql(), [programIds]);
        report.scopeProgramsRenumbered = programIds.length;
        report.scopeRowsRenumbered = phase1.rowCount ?? 0;
        logger.log(
          `[db-repair] renumbered ${report.scopeRowsRenumbered} scope(s) across ${programIds.length} program(s) with duplicate sequences`,
        );
      }
    } else {
      report.skipped.push(SCOPES_TABLE);
    }

    // -- 2. ForgeTableLineage semantic-key dedup ----------------------------
    if (await relationExists(client, LINEAGE_TABLE)) {
      const del = await client.query(dedupeLineageSql(), [NULL_ENTITY_SENTINEL]);
      report.lineageDuplicatesRemoved = del.rowCount ?? 0;
      if (report.lineageDuplicatesRemoved > 0) {
        logger.log(
          `[db-repair] removed ${report.lineageDuplicatesRemoved} duplicate lineage edge(s)`,
        );
      }
      const normalized = await client.query(backfillLineageEntityTypeSql(), [NULL_ENTITY_SENTINEL]);
      report.lineageEntityTypesBackfilled = normalized.rowCount ?? 0;
      if (report.lineageEntityTypesBackfilled > 0) {
        logger.log(
          `[db-repair] normalized ${report.lineageEntityTypesBackfilled} NULL lineage entity type(s)`,
        );
      }
    } else {
      report.skipped.push(LINEAGE_TABLE);
    }

    // -- 3. Legacy scan lifecycle backfill ----------------------------------
    // Only needed when scan_status already exists but is nullable. When the
    // column is absent, `prisma db push` adds it with DEFAULT 'complete', which
    // Postgres applies to every existing row — so legacy scans become complete
    // either way.
    if (await relationExists(client, SCANS_TABLE)) {
      const col = await client.query(columnExistsSql(), [SCANS_TABLE, "scan_status"]);
      if (col.rows[0]?.present) {
        const up = await client.query(backfillScanStatusSql());
        report.scanStatusBackfilled = up.rowCount ?? 0;
        if (report.scanStatusBackfilled > 0) {
          logger.log(
            `[db-repair] backfilled scan_status='complete' on ${report.scanStatusBackfilled} legacy scan(s)`,
          );
        }
      }
    } else {
      report.skipped.push(SCANS_TABLE);
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure; surface the original error below
    }
    throw err;
  } finally {
    if (!injected) await client.end();
  }

  return report;
}
