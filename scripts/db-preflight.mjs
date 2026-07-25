#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Database preflight — runs BEFORE `prisma db push` (in scripts/start.sh, the
// local `npm start`, and CI).
//
// Two phases:
//   1. Repair: dedup ForgeEstateProgramScope sequences + ForgeTableLineage
//      edges and backfill scan_status, inside one advisory-locked transaction
//      (scripts/db/repair.mjs). Idempotent + no-op on a clean DB.
//   2. Destructive-delta gate: compute the pending schema delta with
//      `prisma migrate diff` and abort the deploy if it contains genuinely
//      data-losing statements (DROP TABLE/COLUMN/SCHEMA, TRUNCATE).
//
// Why the gate matters: `prisma db push` still needs `--accept-data-loss`
// because it classifies ADDING a unique constraint as a "data loss warning"
// (it *could* fail on duplicates). That is not real data loss — phase 1 already
// removed the duplicates, so the unique adds succeed losslessly. The gate is
// what makes passing that flag safe: it proves the delta contains no genuinely
// destructive statement before we let `db push --accept-data-loss` run.
//
// Exit codes: 0 = safe to push; 1 = repair failed OR a destructive delta was
// detected (operator must intervene). Diff errors fail closed by default.
// Local developers may explicitly bypass with
// FORGE_DB_PREFLIGHT_LOCAL_BYPASS=1 + FORGE_LOCAL_USER_EMAIL, but that bypass
// is refused when Databricks app credentials or NODE_ENV=production are set.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { runRepair } from "./db/repair.mjs";
import { classifyMigrationSql, decideMigrationDiffGate } from "./db/repair-sql.mjs";

const DATABASE_URL = process.env.DATABASE_URL || process.argv[2];
const SCHEMA_PATH = process.env.PRISMA_SCHEMA_PATH || "prisma/schema.prisma";

function log(msg) {
  console.log(`[db-preflight] ${msg}`);
}
function errlog(msg) {
  console.error(`[db-preflight] ${msg}`);
}

function resolvePrismaEntry() {
  const bin = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  return existsSync(bin) ? bin : null;
}

/**
 * Compute the pending migration SQL (live DB -> target schema) and classify it.
 * Uses the Prisma 7 `migrate diff` surface: `--from-config-datasource` reads the
 * live DB via prisma.config.ts (which resolves `DATABASE_URL`), `--to-schema`
 * points at the target datamodel. Returns `{ ok: false }` when the diff could
 * not be computed (caller decides how strict to be).
 */
function computeDestructiveGate(url) {
  const entry = resolvePrismaEntry();
  if (!entry) {
    return { ok: false, reason: "prisma CLI not found" };
  }
  const args = [
    entry,
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    SCHEMA_PATH,
    "--script",
  ];
  try {
    const sql = execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DATABASE_URL: url },
    });
    return { ok: true, ...classifyMigrationSql(sql), sql };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

async function main() {
  if (!DATABASE_URL) {
    errlog("No DATABASE_URL provided (env or first arg). Skipping preflight.");
    // A missing URL is not a repair failure — the caller decides whether a DB
    // is expected. Exit 0 so non-DB build steps are unaffected.
    process.exit(0);
  }

  // -- Phase 1: repair -----------------------------------------------------
  log("Running idempotent schema repair...");
  const report = await runRepair(DATABASE_URL, { logger: console });
  log(`Repair complete: ${JSON.stringify(report)}`);

  // -- Phase 2: destructive-delta gate ------------------------------------
  log("Checking pending schema delta for destructive operations...");
  const gate = computeDestructiveGate(DATABASE_URL);
  const decision = decideMigrationDiffGate(gate, process.env);
  if (!gate.ok) {
    if (decision.bypassed) {
      log(`WARNING: migrate-diff failed (${gate.reason}); explicit local-only bypass accepted.`);
      process.exit(0);
    }
    errlog(`FATAL: could not compute schema delta (${gate.reason}).`);
    errlog("Refusing to continue because the destructive-delta gate could not prove safety.");
    process.exit(1);
  }

  if (!decision.proceed) {
    errlog("FATAL: pending schema delta contains destructive statements:");
    for (const stmt of gate.statements) errlog(`  - ${stmt}`);
    errlog(
      "Refusing to proceed. `prisma db push --accept-data-loss` would drop data. " +
        "Investigate the delta and apply it deliberately (never auto-accept a DROP/" +
        "TRUNCATE on a live estate DB).",
    );
    process.exit(1);
  }

  log(
    "Schema delta is non-destructive (unique-constraint adds only). Safe to " +
      "`prisma db push --accept-data-loss` — duplicates were already repaired.",
  );
  process.exit(0);
}

main().catch((err) => {
  errlog(`FATAL: preflight failed: ${err?.message || err}`);
  process.exit(1);
});
