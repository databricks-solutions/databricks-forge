# Release Notes -- 2026-07-21

**Databricks Forge**

---

## Safe schema upgrade from a pre-PR database + reproducible CI evidence

Estate Programs introduced a hard `@@unique([programId, sequence])` on
`forge_estate_program_scopes`, a semantic scan-edge unique on
`forge_table_lineage`, and new scan/scope lifecycle columns. Databases created
by an earlier app version can hold data that a naive `prisma db push` would
either reject (duplicate `(program_id, sequence)` rows block the new unique) or
lose (`--accept-data-loss`). This release makes the upgrade safe, deterministic,
and provable in CI.

### Startup preflight (repair + destructive-delta gate)

- New `scripts/db-preflight.mjs` runs **before** `prisma db push` in
  `scripts/start.sh` and the local `npm start`, and is exposed as
  `npm run db:preflight` for a manual dry-run against `DATABASE_URL`.
- The repair (`scripts/db/repair.mjs`, pure SQL builders in
  `scripts/db/repair-sql.mjs`) runs inside **one advisory-locked transaction**:
  - **Scope sequence dedup** — a two-phase renumber (unique negative
    temporaries, then a dense 0-based compaction ordered by
    `sequence, created_at, scope_id`), scoped only to programs that actually
    contain duplicates. **No scope is deleted** — duplicates are re-sequenced.
  - **Lineage dedup** — collapses duplicate edges under the intended semantic
    key `(scan_id, source, target, entity_type)`, treating **all NULL
    `entity_type` rows as one equivalence class**, keeping the latest/best row
    (`last_event_time` desc, then `event_count` desc). Retained logical nulls
    are normalized to the non-null `__forge_null_entity__` database sentinel;
    the runtime createMany path uses the same mapping, while all domain/API,
    reconstitution, Excel, and ERD boundaries map it back to `null`.
  - **Scan lifecycle backfill** — legacy scans become `scan_status='complete'`
    so historical scans keep counting in aggregates/Portfolio/exports.
- Properties: idempotent, **no-op on a clean/fresh DB**, transaction-safe (any
  failure rolls the entire repair back), and advisory-lock protected so
  concurrent app boots serialize.

### `--accept-data-loss` kept but gated (no longer blind)

- `prisma db push` still needs `--accept-data-loss` — but only because it
  classifies **adding a unique constraint** as a potential-data-loss warning
  (it could fail on duplicates). It is not real data loss, and the repair above
  already removed the duplicates, so the constraints apply losslessly.
- To make passing the flag safe, the preflight computes the pending delta with
  `prisma migrate diff --script` and classifies it: a genuinely data-losing
  or ambiguous statement (`DROP TABLE/COLUMN/SCHEMA/TYPE`, `TRUNCATE`, rename,
  or column type change) **aborts startup** instead of letting the flag discard
  or reinterpret estate data. A migrate-diff execution error now fails closed
  by default. (`DROP INDEX` / `DROP CONSTRAINT` from the `index -> unique`
  conversion remain non-destructive.)
- The only bypass is explicit and local:
  `FORGE_DB_PREFLIGHT_LOCAL_BYPASS=1` + `FORGE_LOCAL_USER_EMAIL`; it is refused
  for Databricks App credentials and `NODE_ENV=production`. Migrate diff is
  always attempted first: the bypass applies only to execution/configuration
  failure and never to a successfully computed destructive delta.

### Tests + CI

- Unit tests for the SQL construction/decision helpers
  (`__tests__/db/migration-repair-sql.test.ts`).
- A real-PostgreSQL integration test
  (`__tests__/db/migration-integration.test.ts`, `npm run test:integration`)
  seeds a legacy schema with duplicate sequence/lineage rows, runs the repair
  **twice**, then `prisma db push`, and asserts rows are preserved/deduped/
  backfilled and the new constraints are enforced. Gated on `TEST_DATABASE_URL`
  so it is skipped when no disposable Postgres is available.
- New CI `migration` job runs that integration test against a
  `pgvector/pgvector:pg16` service (secrets-free, fixed local credentials).
- The Playwright browser E2E job (`e2e`) is retained.

See `docs/DEPLOYMENT.md` → "Safe upgrade from a pre-PR database" for the full
upgrade behavior and recovery instructions.

## PR #270 live merge-readiness validation

Validated on the isolated FEVM deployment `forge-pr270` (profile `fejul26`) at
`https://forge-pr270-7474650150013868.aws.databricksapps.com`.

- Final deployment: zero-egress bundle, app `RUNNING`, deployment `SUCCEEDED`,
  health `200 healthy`, Forge `1.0.4`, OAuth runtime ready, Lakebase and SQL
  Warehouse checks healthy, six model-pool endpoints available.
- Safe startup: the preflight ran before `prisma db push`, reported a
  non-destructive unique-constraint delta, synchronized the fresh PostgreSQL 17
  Lakebase schema, and started the server successfully.
- Estate sequence: three completed scans over three deduplicated tables.
  Pause held a pending scope, resume continued it, cancel prevented a queued
  overlap scope from running, and an intentional missing-schema failure stayed
  failed until an explicit retry (attempt count advanced once; no loop).
- Restart recovery: the app was stopped during a running scan. After the
  persisted lease expired, the stale attempt was reclaimed under a new scan ID
  and completed on attempt two. The interrupted checkpoint stayed excluded.
- Decoupled discovery: a completed estate scan seeded a use-case run; the
  server replaced a deliberately incorrect client UC scope with the scan's
  authoritative scope, disabled nested estate scanning, and completed with
  eight generated use cases.
- C-level outputs: estate synthesis generated and cached, PDF (7 pages) and
  Excel exports returned valid files, and Portfolio reported one estate, three
  completed scans, and three deduplicated tables.
- Automated gates: 1,785 unit/integration tests, 11 Playwright tests, lint
  (zero errors), typecheck, production build, critical dependency audit, and
  diff whitespace validation passed locally. CI retains PostgreSQL migration
  and Playwright jobs as required merge gates.

The first source deployment exposed a remote dependency-install timeout. A
zero-egress retry then exposed stale source files and a missing preflight script
in the bundle. Deployment packaging now replaces the remote source tree and
recursively includes every project script referenced by `start.sh`; the final
deployment validated both fixes.
