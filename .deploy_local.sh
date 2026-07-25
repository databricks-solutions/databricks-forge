#!/usr/bin/env bash
# ============================================================================
# Databricks Forge -- Local Development Setup
#
# Provisions a Lakebase database on a target Databricks workspace and writes
# all required configuration to .env.local. Designed for environments that
# do not allow serverless egress or for developers who want to test locally.
#
# Prerequisites:
#   - Databricks CLI installed (brew install databricks)
#   - Authenticated: databricks auth login --host https://your-workspace.cloud.databricks.com
#   - Node.js 20+ and npm
#
# Usage:
#   bash .deploy_local.sh                          # interactive (default profile)
#   bash .deploy_local.sh --profile staging         # use a named CLI profile
#   bash .deploy_local.sh --warehouse "My WH"      # skip warehouse prompt
#   bash .deploy_local.sh --project-id my-project   # custom Lakebase project ID
#
# This script is idempotent -- safe to re-run.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
PROJECT_ID="forge-local"
DATABASE_NAME="databricks_postgres"
NATIVE_USER="forge_local_dev"
ENV_FILE="$SCRIPT_DIR/.env.local"
ARG_WAREHOUSE=""
ARG_PROJECT_ID=""
ARG_PROFILE=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --warehouse)    ARG_WAREHOUSE="$2"; shift 2 ;;
    --project-id)   ARG_PROJECT_ID="$2"; shift 2 ;;
    --profile)      ARG_PROFILE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: bash .deploy_local.sh [--profile \"name\"] [--warehouse \"Name\"] [--project-id \"id\"]"
      echo ""
      echo "Options:"
      echo "  --profile NAME      Databricks CLI profile to use (default: default profile)"
      echo "  --warehouse NAME    Skip interactive warehouse selection"
      echo "  --project-id ID     Custom Lakebase project ID (default: forge-local)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -n "$ARG_PROJECT_ID" ]; then
  PROJECT_ID="$ARG_PROJECT_ID"
fi

# Build the --profile flag string for all databricks CLI commands
CLI_PROFILE_FLAG=""
if [ -n "$ARG_PROFILE" ]; then
  CLI_PROFILE_FLAG="--profile $ARG_PROFILE"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() { echo "  ERROR: $*" >&2; exit 1; }

log() { printf "  %s\n" "$*"; }

check_command() {
  if ! command -v "$1" &>/dev/null; then
    die "$1 is not installed. $2"
  fi
}

# ---------------------------------------------------------------------------
# Step 0: Prerequisites
# ---------------------------------------------------------------------------

echo ""
echo "============================================"
echo "  Databricks Forge -- Local Dev Setup"
echo "============================================"
echo ""

check_command databricks "Install: brew install databricks"
check_command node "Install Node.js 20+ from https://nodejs.org"
check_command npx "Comes with Node.js -- reinstall Node if missing."

# Verify npm dependencies are installed (needed for pg in Step 6 and prisma in Step 7)
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo ""
  log "node_modules not found. Run 'npm install' first:"
  echo ""
  echo "    npm install"
  echo ""
  die "Dependencies not installed. Run 'npm install' and then re-run this script."
fi

# ---------------------------------------------------------------------------
# Step 1: Verify CLI authentication
# ---------------------------------------------------------------------------

log "Checking Databricks CLI authentication..."

if ! USER_JSON=$(databricks current-user me $CLI_PROFILE_FLAG --output json 2>/dev/null); then
  echo ""
  log "Not authenticated. Run this first:"
  echo ""
  if [ -n "$ARG_PROFILE" ]; then
    echo "    databricks auth login --profile $ARG_PROFILE"
  else
    echo "    databricks auth login --host https://your-workspace.cloud.databricks.com"
  fi
  echo ""
  die "CLI authentication required."
fi

USER_EMAIL=$(echo "$USER_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('userName',''))")
if [ -z "$USER_EMAIL" ]; then
  die "Could not determine user email from CLI."
fi
log "Authenticated as: $USER_EMAIL"

DATABRICKS_HOST=$(databricks auth describe $CLI_PROFILE_FLAG --output json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
h = d.get('host', '') or d.get('details', {}).get('host', '') or ''
if not h.startswith('https://') and h:
    h = 'https://' + h
# Strip trailing path slashes without destroying the protocol://
while h.endswith('/') and not h.endswith('://'):
    h = h[:-1]
print(h)
" 2>/dev/null || echo "")

if [ -z "$DATABRICKS_HOST" ]; then
  die "Could not determine workspace host from CLI auth."
fi
log "Workspace: $DATABRICKS_HOST"

# ---------------------------------------------------------------------------
# Step 2: Select SQL Warehouse
# ---------------------------------------------------------------------------

echo ""
log "Discovering SQL Warehouses..."

WH_JSON=$(databricks warehouses list $CLI_PROFILE_FLAG --output json 2>/dev/null) || die "Failed to list SQL Warehouses."

WH_COUNT=$(echo "$WH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
wh = data if isinstance(data, list) else data.get('warehouses', [])
print(len(wh))
")

if [ "$WH_COUNT" -eq 0 ]; then
  die "No SQL Warehouses found. Create one in your workspace first."
fi

echo "$WH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
wh = data if isinstance(data, list) else data.get('warehouses', [])
for i, w in enumerate(wh, 1):
    state = w.get('state', 'UNKNOWN')
    name  = w.get('name', 'Unnamed')
    print(f'    {i}) {name} ({state})')
"

if [ -n "$ARG_WAREHOUSE" ]; then
  WAREHOUSE_RESULT=$(echo "$WH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
wh = data if isinstance(data, list) else data.get('warehouses', [])
target = '''$ARG_WAREHOUSE'''
for w in wh:
    if w.get('name','') == target:
        print(w['id'] + '|' + w.get('name',''))
        sys.exit(0)
print('')
")
  if [ -z "$WAREHOUSE_RESULT" ]; then
    die "Warehouse '$ARG_WAREHOUSE' not found."
  fi
  WAREHOUSE_ID="${WAREHOUSE_RESULT%%|*}"
  WAREHOUSE_NAME="${WAREHOUSE_RESULT#*|}"
  log "-> $WAREHOUSE_NAME (via --warehouse flag)"
else
  printf "  Enter number [1]: "
  read -r choice
  choice="${choice:-1}"

  WAREHOUSE_RESULT=$(echo "$WH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
wh = data if isinstance(data, list) else data.get('warehouses', [])
idx = int('''$choice''') - 1
if 0 <= idx < len(wh):
    w = wh[idx]
    print(w['id'] + '|' + w.get('name','Unnamed'))
else:
    print('')
")
  if [ -z "$WAREHOUSE_RESULT" ]; then
    die "Invalid selection."
  fi
  WAREHOUSE_ID="${WAREHOUSE_RESULT%%|*}"
  WAREHOUSE_NAME="${WAREHOUSE_RESULT#*|}"
  log "-> $WAREHOUSE_NAME"
fi

# ---------------------------------------------------------------------------
# Step 3: Provision Lakebase project
# ---------------------------------------------------------------------------

echo ""
log "Checking Lakebase project '$PROJECT_ID'..."

if databricks postgres get-project "projects/$PROJECT_ID" $CLI_PROFILE_FLAG --output json &>/dev/null; then
  log "Project '$PROJECT_ID' already exists."
else
  log "Creating Lakebase project '$PROJECT_ID'..."
  databricks postgres create-project "$PROJECT_ID" $CLI_PROFILE_FLAG \
    --json '{"spec": {"display_name": "Forge Local Dev"}}' \
    || die "Failed to create Lakebase project."
  log "Project created."
fi

# ---------------------------------------------------------------------------
# Step 4: Get branch and endpoint IDs
# ---------------------------------------------------------------------------

log "Discovering branch and endpoint..."

BRANCH_ID=$(databricks postgres list-branches "projects/$PROJECT_ID" $CLI_PROFILE_FLAG --output json | python3 -c "
import sys, json
data = json.load(sys.stdin)
branches = data if isinstance(data, list) else data.get('branches', [])
for b in branches:
    name = b.get('name', '')
    parts = name.split('/')
    if len(parts) >= 4:
        print(parts[3])
        break
")

if [ -z "$BRANCH_ID" ]; then
  die "No branch found in project '$PROJECT_ID'."
fi
log "Branch: $BRANCH_ID"

ENDPOINT_RESULT=$(databricks postgres list-endpoints "projects/$PROJECT_ID/branches/$BRANCH_ID" $CLI_PROFILE_FLAG --output json | python3 -c "
import sys, json
data = json.load(sys.stdin)
eps = data if isinstance(data, list) else data.get('endpoints', [])
for ep in eps:
    name = ep.get('name', '')
    parts = name.split('/')
    if len(parts) >= 6:
        print(parts[5])
        break
")

if [ -z "$ENDPOINT_RESULT" ]; then
  die "No endpoint found on branch '$BRANCH_ID'."
fi
ENDPOINT_ID="$ENDPOINT_RESULT"
log "Endpoint: $ENDPOINT_ID"

# Get the direct host from the endpoint detail
ENDPOINT_HOST=$(databricks postgres get-endpoint "projects/$PROJECT_ID/branches/$BRANCH_ID/endpoints/$ENDPOINT_ID" $CLI_PROFILE_FLAG --output json | python3 -c "
import sys, json
data = json.load(sys.stdin)
host = data.get('status', {}).get('hosts', {}).get('host', '')
if not host:
    host = data.get('status', {}).get('host', '')
print(host)
")

if [ -z "$ENDPOINT_HOST" ]; then
  die "Could not determine endpoint host. The endpoint may still be starting up -- wait a minute and re-run."
fi
log "Endpoint host: $ENDPOINT_HOST"

# ---------------------------------------------------------------------------
# Step 5: Generate database credential
# ---------------------------------------------------------------------------

log "Generating database credential..."

DB_TOKEN=$(databricks postgres generate-database-credential \
  "projects/$PROJECT_ID/branches/$BRANCH_ID/endpoints/$ENDPOINT_ID" \
  $CLI_PROFILE_FLAG --output json | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('token', data.get('password', '')))
")

if [ -z "$DB_TOKEN" ]; then
  die "Failed to generate database credential."
fi
log "Credential generated."

SETUP_URL="postgresql://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$USER_EMAIL', safe=''))")\
:$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$DB_TOKEN''', safe=''))")\
@${ENDPOINT_HOST}/${DATABASE_NAME}?sslmode=require&uselibpqcompat=true"

# ---------------------------------------------------------------------------
# Step 6: Enable pgvector extension
# ---------------------------------------------------------------------------

echo ""
log "Enabling pgvector extension..."

MAX_RETRIES=5
RETRY_INTERVAL=3
PGVEC_READY=false

for attempt in $(seq 1 $MAX_RETRIES); do
  if DATABASE_URL="$SETUP_URL" node -e "
    const pg = require('pg');
    (async () => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('  pgvector extension enabled.');
      } finally {
        await pool.end();
      }
    })();
  " 2>&1; then
    PGVEC_READY=true
    break
  fi
  if [ "$attempt" -lt "$MAX_RETRIES" ]; then
    log "Database not ready (attempt $attempt/$MAX_RETRIES), retrying in ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
  fi
done

if [ "$PGVEC_READY" = false ]; then
  log "WARNING: Could not enable pgvector after $MAX_RETRIES attempts."
fi

# ---------------------------------------------------------------------------
# Step 7: Run Prisma schema push
# ---------------------------------------------------------------------------

log "Pushing Prisma schema..."

DB_READY=false
for attempt in $(seq 1 $MAX_RETRIES); do
  if DATABASE_URL="$SETUP_URL" npx prisma db push --accept-data-loss 2>&1; then
    log "Database schema sync complete."
    DB_READY=true
    break
  fi
  if [ "$attempt" -lt "$MAX_RETRIES" ]; then
    log "Schema push not ready (attempt $attempt/$MAX_RETRIES), retrying in ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
  fi
done

if [ "$DB_READY" = false ]; then
  die "Prisma schema push failed after $MAX_RETRIES attempts."
fi

# ---------------------------------------------------------------------------
# Step 8: Create native password role for stable local dev credentials
# ---------------------------------------------------------------------------

echo ""
log "Setting up native database role '$NATIVE_USER'..."

NATIVE_PASSWORD=$(python3 -c "
import secrets, string
alphabet = string.ascii_letters + string.digits + '-_@#%+=.'
print(''.join(secrets.choice(alphabet) for _ in range(48)))
")

DATABASE_URL="$SETUP_URL" NATIVE_USER="$NATIVE_USER" NATIVE_PASSWORD="$NATIVE_PASSWORD" node -e "
  const pg = require('pg');
  (async () => {
    const role = process.env.NATIVE_USER;
    const password = process.env.NATIVE_PASSWORD;
    const safeRole = '\"' + role.replace(/\"/g, '\"\"') + '\"';
    const safePassword = \"'\" + password.replace(/'/g, \"''\") + \"'\";

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
    try {
      const roleExists = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = \$1) AS ok', [role]
      );
      if (!roleExists.rows[0]?.ok) {
        await pool.query('CREATE ROLE ' + safeRole + ' LOGIN');
        console.log('  Created native role: ' + role);
      } else {
        await pool.query('ALTER ROLE ' + safeRole + ' WITH LOGIN');
        console.log('  Native role already exists: ' + role);
      }

      await pool.query('ALTER ROLE ' + safeRole + ' PASSWORD ' + safePassword);
      await pool.query('GRANT ' + safeRole + ' TO CURRENT_USER');
      await pool.query('GRANT CONNECT ON DATABASE $DATABASE_NAME TO ' + safeRole);
      await pool.query('GRANT USAGE, CREATE ON SCHEMA public TO ' + safeRole);
      await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO ' + safeRole);
      await pool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + safeRole);
      await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO ' + safeRole);
      await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ' + safeRole);

      // Transfer ownership of existing tables
      const { rows: tables } = await pool.query(
        \"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner != \\\$1\", [role]
      );
      for (const { tablename } of tables) {
        try {
          const safeT = '\"' + tablename.replace(/\"/g, '\"\"') + '\"';
          await pool.query('ALTER TABLE public.' + safeT + ' OWNER TO ' + safeRole);
        } catch (_) {}
      }
      if (tables.length > 0) {
        console.log('  Transferred ownership of ' + tables.length + ' table(s).');
      }
      console.log('  Native role grants applied.');
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error('  ERROR: Native role setup failed: ' + err.message);
    process.exit(1);
  });
" || die "Native role setup failed."

# Build the stable DATABASE_URL with native password
NATIVE_URL="postgresql://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$NATIVE_USER', safe=''))")\
:$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$NATIVE_PASSWORD''', safe=''))")\
@${ENDPOINT_HOST}/${DATABASE_NAME}?sslmode=require&uselibpqcompat=true"

# ---------------------------------------------------------------------------
# Step 9: Write .env.local
# ---------------------------------------------------------------------------

echo ""
log "Writing $ENV_FILE..."

# Preserve any existing optional settings (model endpoints, feature flags)
EXISTING_EXTRAS=""
if [ -f "$ENV_FILE" ]; then
  EXISTING_EXTRAS=$(grep -E '^(DATABRICKS_SERVING_ENDPOINT|DATABRICKS_REVIEW_ENDPOINT|DATABRICKS_EMBEDDING_ENDPOINT|FORGE_|DATABRICKS_ALLOWED_MODELS)' "$ENV_FILE" 2>/dev/null | \
    grep -v '^FORGE_LOCAL_USER_EMAIL=' | \
    grep -v '^DATABRICKS_APP_PORT=' | \
    grep -v '^DATABRICKS_CLI_PROFILE=' || true)
fi

cat > "$ENV_FILE" <<EOF
# Databricks Forge -- Local Development Configuration
# Generated by .deploy_local.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
#
# Authentication: Uses Databricks CLI OAuth session (no PAT stored).
# Run \`databricks auth login\` if your session expires.

# Databricks workspace
DATABRICKS_HOST=$DATABRICKS_HOST

# SQL Warehouse ($WAREHOUSE_NAME)
DATABRICKS_WAREHOUSE_ID=$WAREHOUSE_ID

# Lakebase (native password -- stable credentials for local dev)
DATABASE_URL=$NATIVE_URL

# User identity (used in place of OBO proxy headers)
FORGE_LOCAL_USER_EMAIL=$USER_EMAIL

# Port
DATABRICKS_APP_PORT=3000
EOF

# Write CLI profile if one was specified
if [ -n "$ARG_PROFILE" ]; then
  echo "" >> "$ENV_FILE"
  echo "# Databricks CLI profile (used by getCliToken for multi-workspace setups)" >> "$ENV_FILE"
  echo "DATABRICKS_CLI_PROFILE=$ARG_PROFILE" >> "$ENV_FILE"
fi

# Re-append preserved optional settings
if [ -n "$EXISTING_EXTRAS" ]; then
  echo "" >> "$ENV_FILE"
  echo "# Preserved from previous .env.local" >> "$ENV_FILE"
  echo "$EXISTING_EXTRAS" >> "$ENV_FILE"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "============================================"
echo "  Setup Complete"
echo "============================================"
echo ""
echo "  Workspace:       $DATABRICKS_HOST"
if [ -n "$ARG_PROFILE" ]; then
echo "  CLI Profile:     $ARG_PROFILE"
fi
echo "  SQL Warehouse:   $WAREHOUSE_NAME ($WAREHOUSE_ID)"
echo "  Lakebase:        projects/$PROJECT_ID"
echo "  DB Endpoint:     $ENDPOINT_HOST"
echo "  DB User:         $NATIVE_USER"
echo "  User Email:      $USER_EMAIL"
echo "  Config file:     $ENV_FILE"
echo ""
echo "  Next steps:"
echo ""
echo "    npm run dev"
echo "    open http://localhost:3000"
echo ""
echo "  No PAT or tokens stored in .env.local."
echo "  If your CLI session expires, run:"
echo ""
if [ -n "$ARG_PROFILE" ]; then
echo "    databricks auth login --profile $ARG_PROFILE"
else
echo "    databricks auth login --host $DATABRICKS_HOST"
fi
echo ""
