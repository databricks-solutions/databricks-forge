#!/bin/sh
# Databricks Forge — Production startup script for Databricks Apps
#
# Source mode: the platform runs `npm install` + `npm run build` first.
# Zero-egress mode: bootstrap.sh extracts the pre-built archive first.
# In both cases .prebuilt marker determines server.js location.
#
# Contract: the `postgres` app resource binding (see app.yaml) gives us
#   PGHOST, PGPORT, PGDATABASE, PGUSER, PGSSLMODE, LAKEBASE_ENDPOINT
# from the platform. We mint a startup OAuth credential, push the schema,
# create the HNSW index, and hand off to Next.js standalone.

set -e

# ---------------------------------------------------------------------------
# Lakebase startup credential (resource-binding mode)
#
# The `postgres` resource is bound in app.yaml -- the platform has already
# injected PGHOST / PGUSER / PGDATABASE / LAKEBASE_ENDPOINT. We just need
# to mint a short-lived OAuth credential for the schema-sync / HNSW DDL
# we run before the server starts.
# ---------------------------------------------------------------------------

LAKEBASE_STARTUP_URL=""

if [ -n "$DATABRICKS_CLIENT_ID" ] && [ -z "$DATABASE_URL" ]; then
  if [ -z "$PGHOST" ] || [ -z "$PGUSER" ] || [ -z "$LAKEBASE_ENDPOINT" ]; then
    echo "[startup] FATAL: Lakebase resource binding env vars missing."
    echo "[startup]  Expected PGHOST, PGUSER, LAKEBASE_ENDPOINT to be injected by the platform."
    echo "[startup]  Run deploy.sh to bind the 'postgres' resource on this app."
    exit 1
  fi

  echo "[startup] Minting Lakebase OAuth startup credential..."
  LAKEBASE_STARTUP_URL=$(node scripts/provision-lakebase.mjs)

  if [ -z "$LAKEBASE_STARTUP_URL" ]; then
    echo "[startup] ERROR: Lakebase credential minting returned empty URL."
    exit 1
  fi
  echo "[startup] Startup credential ready."
fi

# ---------------------------------------------------------------------------
# Database schema sync (mandatory)
#
# Lakebase Autoscale endpoints may need a few seconds after credential
# minting before they accept authenticated connections. Retry schema sync
# with backoff to absorb cold-start delay. The server MUST NOT start
# until the schema is confirmed in sync.
# ---------------------------------------------------------------------------

PRISMA_BIN="./node_modules/.bin/prisma"
SCHEMA_URL="${DATABASE_URL:-$LAKEBASE_STARTUP_URL}"
MAX_DB_RETRIES=5
DB_RETRY_INTERVAL=3

if [ -x "$PRISMA_BIN" ] && [ -n "$SCHEMA_URL" ]; then
  # -- Step A: Enable pgvector extension BEFORE Prisma schema push --------
  # The ForgeEmbedding model uses Unsupported("vector(1024)") so the
  # extension must exist before prisma db push tries to create the table.
  echo "[startup] Enabling pgvector extension..."
  PGVEC_ATTEMPT=0
  PGVEC_READY=false

  while [ "$PGVEC_ATTEMPT" -lt "$MAX_DB_RETRIES" ]; do
    PGVEC_ATTEMPT=$((PGVEC_ATTEMPT + 1))

    if DATABASE_URL="$SCHEMA_URL" node -e "
      const pg = require('pg');
      (async () => {
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        try {
          await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
          console.log('[startup] pgvector extension enabled.');
        } finally {
          await pool.end();
        }
      })();
    " 2>&1; then
      PGVEC_READY=true
      break
    fi

    if [ "$PGVEC_ATTEMPT" -lt "$MAX_DB_RETRIES" ]; then
      echo "[startup] Database not ready for pgvector (attempt $PGVEC_ATTEMPT/$MAX_DB_RETRIES), retrying in ${DB_RETRY_INTERVAL}s..."
      sleep "$DB_RETRY_INTERVAL"
    fi
  done

  if [ "$PGVEC_READY" = false ]; then
    echo "[startup] WARNING: Could not enable pgvector after $MAX_DB_RETRIES attempts. Prisma push may fail for vector columns."
  fi

  # -- Step B: Validate Databricks OAuth DB prerequisites ------------------
  if [ -n "$DATABRICKS_CLIENT_ID" ]; then
    echo "[startup] Validating Databricks OAuth DB prerequisites..."
    if ! DATABASE_URL="$SCHEMA_URL" DATABRICKS_CLIENT_ID="$DATABRICKS_CLIENT_ID" node -e "
      const pg = require('pg');
      (async () => {
        const role = process.env.DATABRICKS_CLIENT_ID;
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
        try {
          const ext = await pool.query(\"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'databricks_auth') AS ok\");
          const roleExists = await pool.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = \$1) AS ok', [role]);
          const dbConnect = await pool.query(\"SELECT has_database_privilege(\$1, current_database(), 'CONNECT') AS ok\", [role]);
          const schemaUsage = await pool.query(\"SELECT has_schema_privilege(\$1, 'public', 'USAGE') AS ok\", [role]);
          const tableGrantCount = await pool.query('SELECT COUNT(*)::int AS count FROM information_schema.role_table_grants WHERE grantee = \$1', [role]);

          const checks = {
            databricksAuthExtension: !!ext.rows[0]?.ok,
            servicePrincipalRole: !!roleExists.rows[0]?.ok,
            databaseConnect: !!dbConnect.rows[0]?.ok,
            publicSchemaUsage: !!schemaUsage.rows[0]?.ok,
            tableGrantCount: Number(tableGrantCount.rows[0]?.count || 0),
          };

          const pass = checks.databricksAuthExtension && checks.servicePrincipalRole && checks.databaseConnect && checks.publicSchemaUsage;
          console.log('[startup] OAuth DB prerequisite check', JSON.stringify({ role, pass, ...checks }));

          if (!pass) {
            console.error('[startup] WARNING: OAuth DB prerequisites are incomplete.');
            console.error('[startup] Suggested remediation SQL:');
            console.error('  CREATE EXTENSION IF NOT EXISTS databricks_auth;');
            console.error(\"  SELECT databricks_create_role('\" + role + \"', 'service_principal');\");
            console.error('  GRANT CONNECT ON DATABASE databricks_postgres TO \"' + role + '\";');
            console.error('  GRANT CREATE, USAGE ON SCHEMA public TO \"' + role + '\";');
          }
        } finally {
          await pool.end();
        }
      })().catch((err) => {
        console.error('[startup] WARNING: OAuth DB prerequisite validation failed:', err.message);
        process.exit(0);
      });
    " 2>&1; then
      echo "[startup] WARNING: OAuth DB prerequisite validation encountered an error."
    fi
  fi

  # -- Step C: Optional user bootstrap grants -------------------------------
  # Allows operators to grant one or more Databricks users DB access
  # without manual SQL editor access.
  #
  # Set either:
  #   LAKEBASE_BOOTSTRAP_USER="user@company.com"
  #   LAKEBASE_BOOTSTRAP_USERS="user1@company.com,user2@company.com"
  #
  # Grants are idempotent and non-fatal if they fail.
  BOOTSTRAP_USERS_RAW="${LAKEBASE_BOOTSTRAP_USERS:-$LAKEBASE_BOOTSTRAP_USER}"

  if [ -z "$BOOTSTRAP_USERS_RAW" ]; then
    DETECTED_BOOTSTRAP_USER=$(DATABASE_URL="$SCHEMA_URL" node -e "
      const pg = require('pg');
      (async () => {
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
        try {
          const r = await pool.query('SELECT pg_get_userbyid(datdba) AS owner_role FROM pg_database WHERE datname = current_database()');
          const owner = String(r.rows?.[0]?.owner_role || '').trim();
          const disallowed = owner === '' || owner === 'postgres' || owner === 'cloud_admin' || owner.startsWith('databricks_');
          if (!disallowed) {
            console.log(owner);
          }
        } finally {
          await pool.end();
        }
      })().catch(() => {});
    " 2>/dev/null | tr -d '\r' | awk 'NF{print; exit}')

    if [ -n "$DETECTED_BOOTSTRAP_USER" ]; then
      BOOTSTRAP_USERS_RAW="$DETECTED_BOOTSTRAP_USER"
      echo "[startup] Auto-detected bootstrap user from database owner role: $DETECTED_BOOTSTRAP_USER"
    else
      echo "[startup] No explicit bootstrap users configured and no eligible database owner role detected."
    fi
  fi

  if [ -n "$BOOTSTRAP_USERS_RAW" ]; then
    echo "[startup] Applying optional Lakebase bootstrap grants for configured users..."
    if ! DATABASE_URL="$SCHEMA_URL" BOOTSTRAP_USERS_RAW="$BOOTSTRAP_USERS_RAW" node -e "
      const pg = require('pg');
      (async () => {
        const raw = process.env.BOOTSTRAP_USERS_RAW || '';
        const users = raw.split(',').map((s) => s.trim()).filter(Boolean);
        if (users.length === 0) return;

        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
        try {
          await pool.query('CREATE EXTENSION IF NOT EXISTS databricks_auth');

          for (const user of users) {
            const roleExists = await pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = \$1) AS ok',
              [user]
            );
            if (!roleExists.rows[0]?.ok) {
              await pool.query(\"SELECT databricks_create_role(\$1, 'USER')\", [user]);
              console.log('[startup] Created Databricks OAuth role for user:', user);
            } else {
              console.log('[startup] Databricks OAuth role already exists for user:', user);
            }

            const safeRole = '\"' + user.replace(/\"/g, '\"\"') + '\"';
            await pool.query('GRANT CONNECT ON DATABASE databricks_postgres TO ' + safeRole);
            await pool.query('GRANT USAGE, CREATE ON SCHEMA public TO ' + safeRole);
            await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO ' + safeRole);
            await pool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + safeRole);
            await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO ' + safeRole);
            await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ' + safeRole);
            console.log('[startup] Granted Lakebase privileges to user:', user);
          }
        } finally {
          await pool.end();
        }
      })().catch((err) => {
        console.error('[startup] WARNING: Optional Lakebase bootstrap grants failed:', err.message);
        process.exit(0);
      });
    " 2>&1; then
      echo "[startup] WARNING: Optional Lakebase bootstrap grant step encountered an error."
    fi
  fi

  # -- Step D0: Pre-schema migration/repair (safe upgrade preflight) -------
  # Repairs a pre-PR database so `prisma db push` can apply the new schema
  # without losing data: dedups ForgeEstateProgramScope (program_id, sequence)
  # rows before the new UNIQUE is created, dedups ForgeTableLineage edges, and
  # backfills scan_status. Idempotent, advisory-lock protected, no-op on a
  # fresh DB. It ALSO runs a destructive-delta gate (prisma migrate diff): a
  # genuinely data-losing delta (DROP TABLE/COLUMN, TRUNCATE) aborts startup.
  # This is what makes the `--accept-data-loss` on the push below SAFE: Prisma
  # forces that flag purely because it classifies adding a unique constraint as
  # a "data loss warning" (it could fail on dupes) — but the repair already
  # removed the dupes and the gate proved nothing destructive. See
  # docs/DEPLOYMENT.md ("Safe upgrade from a pre-PR database").
  echo "[startup] Running database preflight (repair + destructive-delta gate)..."
  PREFLIGHT_ATTEMPT=0
  PREFLIGHT_OK=false

  while [ "$PREFLIGHT_ATTEMPT" -lt "$MAX_DB_RETRIES" ]; do
    PREFLIGHT_ATTEMPT=$((PREFLIGHT_ATTEMPT + 1))

    if DATABASE_URL="$SCHEMA_URL" node scripts/db-preflight.mjs 2>&1; then
      echo "[startup] Preflight complete (attempt $PREFLIGHT_ATTEMPT)."
      PREFLIGHT_OK=true
      break
    fi

    # A non-zero exit means either a cold/unreachable DB (transient — the
    # preflight is idempotent, so we retry) OR a destructive delta / failed
    # repair (persistent — retries exhaust and the fatal branch below aborts).
    if [ "$PREFLIGHT_ATTEMPT" -lt "$MAX_DB_RETRIES" ]; then
      echo "[startup] Preflight not ready (attempt $PREFLIGHT_ATTEMPT/$MAX_DB_RETRIES), retrying in ${DB_RETRY_INTERVAL}s..."
      sleep "$DB_RETRY_INTERVAL"
    fi
  done

  if [ "$PREFLIGHT_OK" = false ]; then
    echo "[startup] FATAL: Database preflight failed after $MAX_DB_RETRIES attempts."
    echo "[startup]  This can mean a DESTRUCTIVE schema delta was detected (data loss)."
    echo "[startup]  Inspect the log above and see docs/DEPLOYMENT.md ('Safe upgrade')."
    exit 1
  fi

  # -- Step D: Prisma schema push ----------------------------------------
  # --accept-data-loss is required by Prisma solely to add the new UNIQUE
  # constraints (it treats any unique add as a potential-data-loss warning).
  # This is safe here ONLY because Step D0 already (a) removed the duplicate
  # rows that would make the unique add lose data and (b) proved via the
  # destructive-delta gate that the delta contains no DROP/TRUNCATE.
  echo "[startup] Verifying database connectivity..."
  ATTEMPT=0
  DB_READY=false

  while [ "$ATTEMPT" -lt "$MAX_DB_RETRIES" ]; do
    ATTEMPT=$((ATTEMPT + 1))

    if DATABASE_URL="$SCHEMA_URL" "$PRISMA_BIN" db push --accept-data-loss 2>&1; then
      echo "[startup] Database ready — schema sync complete (attempt $ATTEMPT)."
      DB_READY=true
      break
    fi

    if [ "$ATTEMPT" -lt "$MAX_DB_RETRIES" ]; then
      echo "[startup] Database not ready (attempt $ATTEMPT/$MAX_DB_RETRIES), retrying in ${DB_RETRY_INTERVAL}s..."
      sleep "$DB_RETRY_INTERVAL"
    fi
  done

  if [ "$DB_READY" = false ]; then
    echo "[startup] FATAL: Database schema sync failed after $MAX_DB_RETRIES attempts."
    exit 1
  fi

  # -- Step E: Create HNSW index (not managed by Prisma) ------------------
  if [ -n "$DATABRICKS_EMBEDDING_ENDPOINT" ]; then
    echo "[startup] Embedding endpoint configured ($DATABRICKS_EMBEDDING_ENDPOINT), ensuring HNSW index..."
    HNSW_ATTEMPT=0
    HNSW_MAX_RETRIES=5
    HNSW_READY=false

    while [ "$HNSW_ATTEMPT" -lt "$HNSW_MAX_RETRIES" ]; do
      HNSW_ATTEMPT=$((HNSW_ATTEMPT + 1))

      if DATABASE_URL="$SCHEMA_URL" node -e "
        const pg = require('pg');
        (async () => {
          const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
          try {
            await pool.query(\`
              CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON forge_embeddings
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            \`);
            console.log('[startup] HNSW index ready.');
          } finally {
            await pool.end();
          }
        })();
      " 2>&1; then
        HNSW_READY=true
        break
      fi

      if [ "$HNSW_ATTEMPT" -lt "$HNSW_MAX_RETRIES" ]; then
        echo "[startup] HNSW index not ready (attempt $HNSW_ATTEMPT/$HNSW_MAX_RETRIES), retrying in ${DB_RETRY_INTERVAL}s..."
        sleep "$DB_RETRY_INTERVAL"
      fi
    done

    if [ "$HNSW_READY" = false ]; then
      echo "[startup] WARNING: HNSW index creation failed after $HNSW_MAX_RETRIES attempts. Semantic search may be slow."
    fi
  else
    echo "[startup] No embedding endpoint configured (serving-endpoint-embedding not bound), skipping HNSW index."
  fi

  # -- Step F: Optional benchmark seed --------------------------------------
  if [ "${FORGE_SEED_BENCHMARKS:-false}" = "true" ]; then
    echo "[startup] Seeding benchmark catalog..."
    if DATABASE_URL="$SCHEMA_URL" \
      FORGE_SEED_BENCHMARKS_ALL_INDUSTRIES="${FORGE_SEED_BENCHMARKS_ALL_INDUSTRIES:-false}" \
      FORGE_SEED_BENCHMARK_INDUSTRIES="${FORGE_SEED_BENCHMARK_INDUSTRIES:-}" \
      node scripts/seed-benchmarks.mjs; then
      echo "[startup] Benchmark seed complete."
    else
      echo "[startup] WARNING: Benchmark seed failed; continuing startup."
    fi
  else
    echo "[startup] Benchmark seed disabled."
  fi

  # -- Step G: Validate model serving endpoints -----------------------------
  # validate-endpoints.mjs writes diagnostic progress to stderr and emits a
  # two-line contract on stdout: state, then the CSV runtime allowlist.
  echo "[startup] Validating model serving endpoints..."
  VALIDATION_OUTPUT=$(node scripts/validate-endpoints.mjs) || VALIDATION_OUTPUT="not_run
"
  VALIDATION_STATE=$(printf '%s\n' "$VALIDATION_OUTPUT" | awk 'NR == 1 { print; exit }')
  VALIDATED_ENDPOINTS=$(printf '%s\n' "$VALIDATION_OUTPUT" | awk 'NR == 2 { print; exit }')
  VALIDATION_STATE="${VALIDATION_STATE:-not_run}"

  export FORGE_ENDPOINT_VALIDATION_STATE="$VALIDATION_STATE"
  export FORGE_VALIDATED_ENDPOINTS="$VALIDATED_ENDPOINTS"

  node scripts/check-endpoint-readiness.mjs

else
  echo "[startup] FATAL: Prisma CLI not found or no DB URL — cannot sync schema."
  exit 1
fi

# ---------------------------------------------------------------------------
# Start the standalone Next.js server
#
# Runtime connections will mint their own OAuth credentials via
# lib/lakebase/provision.ts using the platform-injected PGHOST / PGUSER /
# LAKEBASE_ENDPOINT. The startup DATABASE_URL is discarded so the runtime
# does not reuse it.
#
# Zero-egress / pre-built mode: server.js is at the project root.
# Source mode:                   server.js is inside .next/standalone/.
# ---------------------------------------------------------------------------

export PORT="${DATABRICKS_APP_PORT:-8000}"
echo "[startup] Starting server on port $PORT..."

if [ -f ".prebuilt" ]; then
  echo "[startup] Pre-built / zero-egress deployment detected."
else
  cd .next/standalone
fi

# Allow large schemas (12k+ tables) without OOM.
# Operators can override via NODE_OPTIONS in their environment.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
echo "[startup] Node heap limit: $NODE_OPTIONS"

if [ -n "$LAKEBASE_STARTUP_URL" ]; then
  unset DATABASE_URL
fi
exec node server.js
