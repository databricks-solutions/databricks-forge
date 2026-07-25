# Deployment Guide

## Quick Deploy (Recommended)

The supported deployment path is the interactive deploy script. It discovers
your resources, creates the app, uploads code, and deploys -- all in one
command with a single prompt (which SQL Warehouse to use).

Model and Lakebase availability varies by Databricks cloud and region. Forge is
a community-maintained accelerator with best-effort
[support](https://github.com/databricks-solutions/databricks-forge/blob/main/SUPPORT.md),
not an officially supported Databricks product.

```bash
./deploy.sh
```

Models default to `databricks-claude-opus-4-7` for premium tasks and
`databricks-claude-sonnet-4-6` for fast tasks. The script probes availability
and selects a fallback when needed. Override with flags if needed:

```bash
./deploy.sh --warehouse "My Warehouse" --endpoint "my-model" --fast-endpoint "my-fast-model"
```

Lakebase is **auto-provisioned by default** — no flags required:

```bash
# Zero-touch: deploy.sh creates a per-app Lakebase project, default
# branch, databricks_postgres database, pgvector + databricks_auth
# extensions, and grants the app SP the right public schema privileges.
./deploy.sh

# Bind an existing Lakebase project instead of auto-provisioning
./deploy.sh \
  --lakebase-branch   "projects/my-project/branches/production" \
  --lakebase-database "projects/my-project/branches/production/databases/databricks_postgres"

# Latency-critical deploy: disable scale-to-zero (keeps the DB warm)
./deploy.sh --lakebase-scale-to-zero-seconds 0
```

To remove the app (prompts about the Lakebase project):

```bash
./deploy.sh --destroy
```

Non-interactive cleanup:

```bash
./deploy.sh --destroy --keep-database     # preserve the project (default in CI)
./deploy.sh --destroy --destroy-database  # soft-delete (recoverable)
./deploy.sh --destroy --purge-database    # hard-delete (immediate, unrecoverable)
```

See the [Quick Start](quickstart.md) for the full customer setup and
verification flow.

---

## How It Works

Databricks Forge is deployed as a **Databricks App** -- a containerised web
application that runs inside a Databricks workspace with automatic
authentication.

### What `deploy.sh` does

1. Validates the Databricks CLI is installed and authenticated
2. Lists SQL Warehouses and lets you pick one
3. Creates the Databricks App (or detects an existing one)
4. **Resolves the Lakebase binding**: discovers an existing `postgres`
   resource on the app, else auto-provisions a per-app Lakebase project,
   default `databricks_postgres` database, and waits for the endpoint to
   become `ACTIVE`
5. Configures scale-to-zero on the branch (`300s` default on
   auto-provisioned projects)
6. Binds resources (SQL warehouse, serving endpoints, Postgres) and
   user authorization scopes via the Apps API `create-update` endpoint
7. **Bootstraps Postgres grants** for the app's service principal:
   installs `pgvector` + `databricks_auth` as the project owner, ensures
   the SP role exists, grants `CONNECT`/`USAGE`/`CREATE`/table/sequence
   privileges + default privileges, and transfers ownership of any
   pre-existing `public.*` tables to the SP so Prisma can ALTER/DROP them
8. Optionally grants the deploying user the same Postgres role (default
   on auto-provisioned deploys) so they get SQL Editor access immediately
9. Syncs the project source code to a workspace folder
10. Deploys the app from that workspace folder and polls the submitted
    deployment until it is the active `SUCCEEDED` deployment and
    `app_status` is `RUNNING`. `CRASHED`, `UNAVAILABLE`, and `FAILED` states
    fail the command once they belong to the submitted active deployment,
    with the deployment ID and a direct logs command. A stale crashed
    deployment remains observable while its replacement is pending.

No manual UI configuration is needed. The script handles everything.

### Lakebase auto-provisioning

By default, `./deploy.sh` is **zero-touch** for Lakebase: it derives a
per-app project ID from `--app-name` (sanitized to `[a-z0-9-]{1,63}`),
auto-creates the project, default branch, and `databricks_postgres`
database, then re-uses the same binding on every subsequent re-deploy.

Power-user overrides (rarely needed):

- `--lakebase-project-id ID` — override the auto-derived project ID
  (still auto-creates if missing). Useful when running multiple apps
  against the same project (not recommended; see "Per-app isolation").
- `--lakebase-branch <path> --lakebase-database <path>` — bind an
  existing, externally-managed project/branch/database. Disables
  auto-provisioning.
- `--lakebase-scale-to-zero-seconds N` — branch inactivity timeout
  before scale-to-zero. Default `300` on auto-provisioned projects;
  `0` disables (always-on, latency-critical prod); minimum `60`.
  Re-deploys against an existing branch leave the value alone unless
  this flag is explicitly passed.
- `--lakebase-bootstrap-user EMAIL` — grant a specific Databricks user
  the same Postgres role as the app SP. Defaults to the deploying user
  when `deploy.sh` auto-provisions the project. Pass `""` to opt out.

### Destroy / cleanup

`./deploy.sh --destroy` removes the Databricks App, then **prompts**
about deleting the associated Lakebase project. Default is *keep*
(data preservation wins over convenience).

Non-interactive flags:

- `--destroy-database` — soft-delete the Lakebase project (recoverable).
- `--purge-database` — hard-delete (immediate, unrecoverable). Implies
  `--destroy-database`.
- `--keep-database` — skip the prompt, preserve the project (default in
  non-interactive contexts like CI without a TTY).

### Per-app isolation

Each `--app-name` deploys to its own Databricks App AND its own
auto-provisioned Lakebase project (named after the app). Demos and dev
instances are completely isolated from production:

```bash
./deploy.sh                              # → app: databricks-forge / project: databricks-forge
./deploy.sh --app-name forge-demo        # → app: forge-demo      / project: forge-demo
```

### Resource bindings

The script binds three resources to the app via the API. The `app.yaml`
references these using `valueFrom:` keys, which the platform resolves to
environment variables at runtime.

| Resource key | Type | Default | Permission |
|---|---|---|---|
| `sql-warehouse` | SQL Warehouse | Customer-selected | CAN_USE |
| `serving-endpoint` | Serving Endpoint | `databricks-claude-sonnet-4-6` | CAN_QUERY |
| `serving-endpoint-fast` | Serving Endpoint | `databricks-claude-sonnet-4-6` | CAN_QUERY |

### User authorization scopes

The script configures these OAuth scopes so the app can act on behalf of the
logged-in user, enforcing their Unity Catalog permissions:

| Scope | Purpose |
|---|---|
| `sql` | Execute SQL via warehouse |
| `catalog.tables:read` | Read tables in Unity Catalog |
| `catalog.schemas:read` | Read schemas in Unity Catalog |
| `catalog.catalogs:read` | Read catalogs in Unity Catalog |
| `files.files` | Manage files and directories |
| `dashboards.genie` | Manage Genie Spaces (create, update, trash as user) |

`dashboards` is not accepted as a Databricks Apps user authorization scope in
the verified workspace runtime. Lakeview OBO requests nevertheless return 403
when they require that scope. Forge therefore keeps `dashboards.genie` and does
not add the rejected scope. External/user-owned Lakeview discovery remains
explicit OBO and reports unsupported-scope errors without credential fallback.
Forge-owned dashboards under `/Shared/Forge Dashboards/` use the app service
principal's workspace OAuth M2M token (`scope=all-apis`) consistently for
create, update, draft read-back, publish, and publication read-back. The
initiating user is still authorized by the route guard and recorded for
ownership/activity. A service-principal 403 is returned as the actual bounded
permission diagnostic; it is not mislabeled as an Apps OBO capability limit.

The bound `sql-warehouse` resource grants the app service principal `CAN_USE`,
which is required when app-owned dashboards execute through the selected
warehouse. Publishing defaults to `embed_credentials=false`.

`configure_app` sends this complete supported list on every deployment, so
redeploying an existing app removes stale invalid scope requests.

### Platform-injected variables

These are set automatically by the Databricks Apps platform at runtime:

| Variable | Description |
|---|---|
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_CLIENT_ID` | OAuth client ID (app service principal) |
| `DATABRICKS_CLIENT_SECRET` | OAuth client secret |
| `DATABRICKS_APP_PORT` | Port the app must listen on |

---

## Zero-Egress Deployment

For workspaces that **block serverless egress** (no `npm install` capability),
use the `--zero-egress` flag. This builds the app locally, compresses it into
a split archive, and uploads only ~6 files to the workspace.

```bash
./deploy.sh --zero-egress --warehouse "My Warehouse"
```

### How it works

1. `npm run build` runs locally (prisma generate + next build)
2. The Next.js standalone output is assembled with the Prisma CLI and Linux
   schema engine binary (downloaded from Prisma CDN)
3. Non-runtime files are aggressively pruned (.map, .nft.json, docs, macOS
   binaries)
4. No `package.json` is included -- prevents the platform from running
   `npm install`
5. On macOS, the bundle is compressed with BSD tar's `--no-xattrs` because
   macOS 15 can retain protected `com.apple.provenance` attributes even when
   `xattr -d/-c` reports success. Linux uses portable tar flags without the
   unsupported BSD option. Archive creation failures remain fatal.
6. The archive is split into <10MB chunks (Databricks Apps per-file limit)
7. A minimal wrapper is uploaded: `app.yaml`, `bootstrap.sh`, archive chunks,
   and a `.prebuilt` marker

At startup, `bootstrap.sh` reassembles the archive, extracts it, and hands
off to the normal `scripts/start.sh` flow.

| Metric | Source mode | Zero-egress mode |
|--------|-----------|-----------------|
| Files uploaded | ~4,400 | ~6 |
| Upload size | ~100 MB (uncompressed) | ~26 MB (compressed) |
| Requires egress | Yes (`npm install`) | No |
| Build location | Platform | Local machine |

---

## Build and Start Sequence (Source Mode)

Databricks Apps builds the application from `package.json`. No Dockerfile is
needed -- the platform handles containerisation.

1. `npm install` (runs `postinstall` which triggers `prisma generate`)
2. `npm run build` (runs `prisma generate && next build && sh scripts/postbuild.sh`)
3. `scripts/start.sh`:
   - Mints a short-lived Lakebase OAuth credential as the app SP
   - Confirms `pgvector` is installed (no-op — `deploy.sh` already
     installed it as the project owner)
   - **Runs the database preflight (`scripts/db-preflight.mjs`)** — an
     idempotent, advisory-lock-protected repair + destructive-delta gate
     (see "Safe upgrade from a pre-PR database" below)
   - Runs `prisma db push --accept-data-loss` to sync the Postgres schema —
     safe because the preflight already removed the duplicates and proved the
     delta is non-destructive (see below); the SP grants applied by `deploy.sh`
     make this succeed on first deploy
   - Optionally grants the `LAKEBASE_BOOTSTRAP_USER` the same Postgres
     role as the SP so they can open the SQL Editor against the database
   - Starts the Next.js standalone server on `DATABRICKS_APP_PORT`

---

## Safe upgrade from a pre-PR database

Estate Programs added a hard `@@unique([programId, sequence])` on
`forge_estate_program_scopes`, a semantic scan-edge unique on
`forge_table_lineage`, and new scan/scope lifecycle columns
(`scan_status`, `attempt_count`, `queued_at`, `heartbeat_at`, …). A database
provisioned by an **earlier** app version can hold data that would make a naive
`prisma db push` fail (duplicate `(program_id, sequence)` rows block the new
unique) or lose data (`--accept-data-loss`).

To make the upgrade safe and reproducible, every startup runs a **preflight**
(`scripts/db-preflight.mjs`) *before* `prisma db push`. It runs the pure repair
logic in `scripts/db/repair.mjs` (unit-tested SQL builders in
`scripts/db/repair-sql.mjs`) inside **one advisory-locked transaction**:

1. **Scope sequence dedup.** For each program that actually contains duplicate
   sequences, a two-phase renumber assigns unique negative temporaries, then
   compacts to a dense 0-based ordering by `(sequence, created_at, scope_id)`.
   **No scope is ever deleted** — duplicates are re-sequenced, not dropped.
2. **Lineage dedup.** Duplicate edges are collapsed under the intended semantic
   key `(scan_id, source, target, entity_type)` — with **all NULL
   `entity_type` rows treated as one equivalence class** — keeping the
   latest/best row (most recent `last_event_time`, then highest `event_count`).
   Retained NULLs are then normalized to the non-null
   `__forge_null_entity__` storage sentinel before Prisma applies `NOT NULL`
   and the unique index. Runtime `createMany({skipDuplicates:true})` uses the
   same normalization, so repeated saves cannot reaccumulate a logical-null
   edge. Read/reconstitution/export/ERD boundaries translate the sentinel back
   to domain/API `null`; it is never user-facing.
3. **Scan lifecycle backfill.** Legacy scans are stamped `scan_status='complete'`
   (either directly, or via the Prisma column `DEFAULT 'complete'` when the
   column is being added) so historical scans keep counting in aggregates.

Properties: **idempotent** (safe to rerun), **no-op on a clean/fresh DB**
(missing tables are skipped; dedup statements touch zero rows), **transaction-
safe** (any failure rolls the whole repair back), and **advisory-lock
protected** (concurrent app boots serialize on a fixed key).

**Why `--accept-data-loss` is kept but is now safe.** `prisma db push`
structurally *requires* `--accept-data-loss` here for one reason: it classifies
**adding a unique constraint** (the new `(program_id, sequence)` and lineage
scan-edge uniques) as a "data loss warning" because it *could* fail if
duplicates exist. There is no way to add a unique constraint via `db push`
without the flag. That warning is not real data loss — and after the repair
above there are no duplicates left, so the constraints apply losslessly. To make
passing the flag safe rather than blind, the preflight computes the pending
delta with `prisma migrate diff --script` and classifies it: if it ever contains
a genuinely data-losing or ambiguous statement (`DROP TABLE/COLUMN/SCHEMA/TYPE`,
`TRUNCATE`, table/column/type rename, or `ALTER COLUMN TYPE`), the preflight
**aborts startup** instead of letting `--accept-data-loss` discard or reinterpret
estate data. (`DROP INDEX` / `DROP CONSTRAINT`, emitted for the
`index -> unique` conversion and FK re-creation, are correctly treated as
non-destructive.) A `migrate diff` execution error also **fails closed by
default**: inability to prove safety is not treated as safety.

The only bypass is explicitly local:
`FORGE_DB_PREFLIGHT_LOCAL_BYPASS=1` together with
`FORGE_LOCAL_USER_EMAIL`. It is refused when `DATABRICKS_CLIENT_ID` is present
or `NODE_ENV=production`, so Databricks App/startup cannot silently continue.
The preflight **always attempts `migrate diff` first**. This bypass applies only
when diff execution/configuration fails; it can never override a successfully
computed destructive delta.

### Recovery instructions

- **Startup fails with "destructive schema delta detected":** the pending delta
  would drop a table/column or truncate. Inspect the statements printed by the
  preflight, reconcile `prisma/schema.prisma` with the live DB (a column may
  have been renamed rather than dropped), and apply the change deliberately in
  the SQL Editor. Never work around it by re-adding `--accept-data-loss`.
- **Startup fails during repair (rolled back):** the transaction rolled back, so
  no partial dedup was committed — the DB is unchanged. Re-check connectivity /
  SP grants and redeploy; the repair is idempotent.
- **Startup fails because `migrate diff` could not run:** treat this as a safety
  failure, not a warning. Restore the Prisma CLI/config or database
  connectivity, rerun `npm run db:preflight`, and only proceed after the gate
  can compute and classify the delta.
- **Manual dry-run against a live DB:** `DATABASE_URL=... npm run db:preflight`
  runs the exact same repair + gate the app runs at startup and prints a JSON
  report (rows renumbered / duplicates removed / scans backfilled) without
  starting the server.
- **Reproduce the whole upgrade locally / in CI:** the `migration` CI job (and
  `npm run test:integration` against a disposable `TEST_DATABASE_URL`) seeds a
  legacy schema with duplicate sequence + lineage rows, runs the repair twice,
  then `prisma db push`, and asserts every row is preserved/deduped/backfilled
  and the new constraints are enforced.

---

## Local Development

Local development is designed for two scenarios:

1. **No serverless egress** -- workspaces that restrict outbound traffic from
   Databricks Apps (e.g. private-link environments where you cannot deploy an
   app but can still reach the workspace APIs from your machine).
2. **Development and testing** -- iterate on UI, prompts, or pipeline logic
   locally before deploying.

### Prerequisites

- **[Node.js 20.9+](https://nodejs.org)** and npm 10+ -- if you've never installed
  Node, download the LTS installer from https://nodejs.org, or:
  ```bash
  # macOS
  brew install node@20
  # Any OS with nvm
  nvm install 20
  ```
  Verify: `node -v` should print `v20.x.x` or higher. `npm -v` should also work.
- **[Databricks CLI](https://docs.databricks.com/dev-tools/cli/install.html)** installed
- A **SQL Warehouse** (Serverless or Pro) in the target workspace
- Your workspace must support **Lakebase Autoscaling** (available in
  `us-east-1`, `us-east-2`, `us-west-2`, `ca-central-1`, `sa-east-1`,
  `eu-central-1`, `eu-west-1`, `eu-west-2`, `ap-south-1`, `ap-southeast-1`,
  `ap-southeast-2`)

### Quick Setup (Recommended)

```bash
# 1. Clone the repo
git clone https://github.com/databricks-solutions/databricks-forge.git
cd databricks-forge

# 2. Install dependencies (downloads all required packages -- takes ~60s first time)
npm install

# 3. One-time: browser-based OAuth login (opens your browser, no PAT created)
databricks auth login --host https://your-workspace.cloud.databricks.com

# 4. Provision Lakebase, select warehouse, write .env.local
bash .deploy_local.sh

# 5. Start dev server (runs prisma generate + next dev with Turbopack)
npm run dev
```

Open **http://localhost:3000** in your browser. The first page load takes
10-15 seconds while Next.js compiles the app. You should see the Forge
dashboard with a sidebar and a "New Discovery Run" button.

### What `.deploy_local.sh` Does

The script is idempotent -- safe to re-run at any time.

1. **Verifies CLI authentication** via `databricks current-user me`
2. **Selects a SQL Warehouse** (interactive prompt or `--warehouse "Name"`)
3. **Provisions a Lakebase project** (`databricks postgres create-project`)
   with scale-to-zero enabled by default
4. **Discovers the branch and endpoint** for the project
5. **Generates a short-lived DB credential** to run initial setup SQL
6. **Creates the `vector` extension** (pgvector for embeddings)
7. **Pushes the Prisma schema** (`npx prisma db push`)
8. **Creates a native password role** (`forge_local_dev`) for stable
   credentials that do not expire during dev sessions
9. **Resolves your email** from the CLI session
10. **Writes `.env.local`** with all required config (no PAT or token stored)

**Flags:**

| Flag | Description |
|------|-------------|
| `--profile "name"` | Use a named Databricks CLI profile (multi-workspace setups) |
| `--warehouse "Name"` | Skip the interactive warehouse prompt |
| `--project-id "id"` | Custom Lakebase project ID (default: `forge-local`) |

### Authentication Architecture

Local dev uses a different auth model than the deployed Databricks App:

| Concern | Databricks App | Local Dev |
|---------|---------------|-----------|
| **Databricks API auth** | OBO user token (from proxy header) or SP OAuth | Databricks CLI OAuth U2M (`databricks auth token`) |
| **Auth credential storage** | Platform-injected, no files | None on disk -- CLI manages token cache |
| **User identity** | `x-forwarded-email` header | `FORGE_LOCAL_USER_EMAIL` env var |
| **Lakebase auth** | Auto-provisioned OAuth or native password with SP credential rotation | Native password (`forge_local_dev`) via `DATABASE_URL` |
| **Token refresh** | Automatic (platform / SP OAuth) | Automatic (CLI refreshes OAuth tokens; re-run `databricks auth login` if session expires) |

The auth priority chain in `lib/dbx/client.ts`:

1. **OBO header** -- `x-forwarded-access-token` (Databricks Apps only)
2. **PAT** -- `DATABRICKS_TOKEN` env var (optional explicit override)
3. **CLI OAuth U2M** -- `databricks auth token` (primary local dev path)
4. **SP OAuth M2M** -- `DATABRICKS_CLIENT_ID` / `SECRET` (Databricks Apps)

### Manual Setup (Without `.deploy_local.sh`)

If you prefer manual control or already have a Lakebase project:

1. **Authenticate:**
   ```bash
   databricks auth login --host https://your-workspace.cloud.databricks.com
   ```

2. **Create a Lakebase project** (skip if you have one):
   ```bash
   databricks postgres create-project forge-local \
     --json '{"spec": {"display_name": "Forge Local Dev"}}'
   ```

3. **Get your endpoint host:**
   ```bash
   databricks postgres list-branches projects/forge-local
   # Note the branch ID, then:
   databricks postgres list-endpoints projects/forge-local/branches/<branch_id>
   databricks postgres get-endpoint projects/forge-local/branches/<branch_id>/endpoints/<endpoint_id>
   ```

4. **Generate a credential and connect with psql** to create extensions and
   roles, or set up `DATABASE_URL` and run `npx prisma db push`.

5. **Create `.env.local`** (see `.env.local.example` for all options):
   ```env
   DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
   DATABRICKS_WAREHOUSE_ID=your_warehouse_id
   # Paste the Lakebase connection string generated in the previous step.
   DATABASE_URL=
   FORGE_LOCAL_USER_EMAIL=your.email@company.com
   DATABRICKS_APP_PORT=3000
   ```

6. **Start:**
   ```bash
   npm run dev
   ```

### Limitations vs Deployed App

| Feature | Deployed App | Local Dev |
|---------|-------------|-----------|
| Multi-user (OBO) | Each user runs queries as themselves | Single user context (your CLI identity) |
| Resource bindings | `app.yaml` `valueFrom:` | `.env.local` env vars |
| Credential rotation | Automatic (SP-managed, proactive refresh) | Native password (stable, no rotation) |
| Scale-to-zero management | `scripts/start.sh` manages endpoint lifecycle | Inherits default (endpoint auto-suspends) |
| HTTPS | Platform-provided | `http://localhost:3000` |

### Troubleshooting

**"No authentication credentials found"**
Your CLI session has expired. Run:
```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

**Lakebase endpoint not ready / connection timeout**
After creating a new project or waking from scale-to-zero, the endpoint can
take 30-60 seconds to become available. Re-run `.deploy_local.sh` or wait and
retry `npm run dev`.

**`@/lib/generated/prisma/client` import errors**
The Prisma client was not generated. `npm run dev` runs `prisma generate`
automatically, but if you see this error from another command, run:
```bash
npx prisma generate
```

**Conversations show "not authenticated" / benchmark admin returns 403**
`FORGE_LOCAL_USER_EMAIL` is not set in `.env.local`. Run `.deploy_local.sh` or
add it manually.

**Embeddings / Ask Forge RAG not working**
Set `DATABRICKS_EMBEDDING_ENDPOINT` in `.env.local`:
```env
DATABRICKS_EMBEDDING_ENDPOINT=databricks-qwen3-embedding-0-6b
```

---

## CI/CD

Recommended pipeline:

1. **Lint** -- `npm run lint`
2. **Type check** -- `npm run typecheck`
3. **Test** -- `npm test`
4. **Build** -- `npm run build`
5. **Deploy** -- `./deploy.sh --warehouse "Production Warehouse"`
