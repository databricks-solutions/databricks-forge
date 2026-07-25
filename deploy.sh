#!/usr/bin/env bash
# =========================================================================
# Databricks Forge — One-command deployment
#
# Usage:
#   ./deploy.sh                          Interactive (pick a warehouse)
#   ./deploy.sh --warehouse "Name"       Non-interactive
#   ./deploy.sh --zero-egress             Build locally, package as split archive (no npm install on target)
#   ./deploy.sh --full                   Full sync (default: diff sync — only changed files)
#   ./deploy.sh --profile "my-profile"   Use a specific CLI profile
#   ./deploy.sh --app-name "forge-demo"  Deploy as a separate named instance
#   ./deploy.sh --destroy                Remove the app
#
# Override model endpoints (advanced):
#   ./deploy.sh --endpoint "model" --fast-endpoint "fast-model" --review-endpoint "review-model"
#   ./deploy.sh --reasoning-endpoint-2 "model" --generation-endpoint "model" --sql-endpoint "model"
#   ./deploy.sh --allowed-models "model1,model2"
#
# Lakebase resource binding (auto-provisioned by default):
#   ./deploy.sh                                     # auto-provision project = sanitized app-name
#   ./deploy.sh --lakebase-project-id "my-project"  # auto-provision into a named project
#
# Power-user override (skip auto-provision; use an existing project/branch/database):
#   ./deploy.sh --lakebase-branch   "projects/<PROJECT_ID>/branches/<BRANCH_ID>"
#               --lakebase-database "projects/<PROJECT_ID>/branches/<BRANCH_ID>/databases/<DB_ID>"
#
# Discover existing via:
#   databricks postgres list-projects
#   databricks postgres list-branches projects/<PROJECT_ID>
#   databricks postgres list-databases projects/<PROJECT_ID>/branches/<BRANCH_ID>
#
# Scale-to-zero (Lakebase Autoscaling) — applied to the branch at deploy time:
#   ./deploy.sh --lakebase-scale-to-zero-seconds 300  # default
#   ./deploy.sh --lakebase-scale-to-zero-seconds 0    # disabled (always-on)
#
# Optional Lakebase bootstrap grants (defaults to deploying user when auto-provisioning):
#   ./deploy.sh --lakebase-bootstrap-user "user@company.com"
#   ./deploy.sh --lakebase-bootstrap-user ""          # explicit opt-out
#
# Destroy flow (interactive prompt + non-interactive flags):
#   ./deploy.sh --destroy                       # prompts about the Lakebase project
#   ./deploy.sh --destroy --destroy-database    # also delete the project (soft)
#   ./deploy.sh --destroy --purge-database      # also delete the project (hard / immediate)
#   ./deploy.sh --destroy --keep-database       # skip the prompt, preserve the project
# Optional benchmark seeding behavior:
#   ./deploy.sh --seed-benchmarks --seed-benchmarks-all-industries
#               --seed-benchmark-industries "banking,hls,rcg"
# Optional benchmark admin restriction:
#   ./deploy.sh --benchmark-admins "alice@company.com,bob@company.com"
# Optional metric views (disabled by default):
#   ./deploy.sh --enable-metric-views
# Optional Fabric / Power BI features (disabled by default):
#   ./deploy.sh --enable-fabric
# Optional Demo Mode for Field Engineering / Sales (disabled by default):
#   ./deploy.sh --enable-demo-mode
# Optional cost governance (both fields are optional; applied only when set):
#   ./deploy.sh --budget-policy-id "<policy-id>"
#               --tag team=data-eng --tag cost-center=1234
# =========================================================================

set -euo pipefail

# Absolute directory of this script, so sibling helpers resolve correctly no
# matter which working directory the operator invoked deploy.sh from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -------------------------------------------------------------------------
# Defaults
# -------------------------------------------------------------------------
APP_NAME="databricks-forge"
APP_DESC="Discover AI-powered use cases from Unity Catalog metadata"
DEFAULT_ENDPOINT="databricks-claude-opus-4-7"
DEFAULT_FAST_ENDPOINT="databricks-claude-sonnet-4-6"
DEFAULT_EMBEDDING_ENDPOINT="databricks-qwen3-embedding-0-6b"
DEFAULT_REVIEW_ENDPOINT="databricks-gpt-5-4"
DEFAULT_REASONING_ENDPOINT_2="databricks-gemini-3-flash"
DEFAULT_GENERATION_ENDPOINT="databricks-llama-4-maverick"
DEFAULT_SQL_ENDPOINT=""
DEFAULT_LIGHTWEIGHT_ENDPOINT="databricks-gemini-3-1-flash-lite"

# -------------------------------------------------------------------------
# State (populated during execution)
# -------------------------------------------------------------------------
USER_EMAIL=""
DATABRICKS_HOST=""
WAREHOUSE_ID=""
WAREHOUSE_NAME=""
WORKSPACE_PATH=""

# -------------------------------------------------------------------------
# Parse arguments
# -------------------------------------------------------------------------
ARG_APP_NAME=""
ARG_WAREHOUSE=""
ARG_PROFILE=""
ARG_ENDPOINT=""
ARG_FAST_ENDPOINT=""
ARG_EMBEDDING_ENDPOINT=""
ARG_REVIEW_ENDPOINT=""
ARG_REASONING_ENDPOINT_2=""
ARG_GENERATION_ENDPOINT=""
ARG_SQL_ENDPOINT=""
ARG_LIGHTWEIGHT_ENDPOINT=""
ARG_ALLOWED_MODELS=""
ARG_LAKEBASE_BOOTSTRAP_USER=""
ARG_LAKEBASE_BOOTSTRAP_USER_SET=false
ARG_LAKEBASE_BRANCH=""
ARG_LAKEBASE_DATABASE=""
ARG_LAKEBASE_PROJECT_ID=""
ARG_LAKEBASE_SCALE_TO_ZERO_SECONDS=""
ARG_LAKEBASE_SCALE_TO_ZERO_SET=false
ARG_DESTROY_DATABASE=false
ARG_PURGE_DATABASE=false
ARG_KEEP_DATABASE=false
ARG_SEED_BENCHMARKS=false
ARG_SEED_BENCHMARKS_ALL_INDUSTRIES=false
ARG_SEED_BENCHMARK_INDUSTRIES=""
ARG_BENCHMARK_ADMINS=""
ARG_ENABLE_METRIC_VIEWS=false
ARG_ENABLE_FABRIC=false
ARG_ENABLE_DEMO_MODE=false
ARG_DISABLE_USER_ISOLATION=false
ARG_MAX_PIPELINE_PER_USER=""
ARG_MAX_SCANS_PER_USER=""
ARG_MAX_GENIE_DEPLOYS_PER_USER=""
ARG_MAX_DEMO_ENGINES_PER_USER=""
ARG_SKIP_PROBE=false
ARG_ZERO_EGRESS=false
ARG_FULL_SYNC=false
ARG_DESTROY=false
ARG_BUDGET_POLICY_ID=""
ARG_TAGS=()

print_usage() {
  cat <<'USAGE'
Databricks Forge — One-command deployment

Usage:
  ./deploy.sh                                  Interactive deployment
  ./deploy.sh --warehouse "My Warehouse"       Skip warehouse prompt
  ./deploy.sh --profile "my-profile"           Use a specific CLI profile
  ./deploy.sh --destroy                        Remove the app

Options:
  --app-name NAME        Custom app name for multi-instance deployments.
                         Isolates the Databricks App and Lakebase database.
                         (default: databricks-forge)
  --warehouse NAME        SQL Warehouse name (skips interactive prompt)
  --profile NAME         Databricks CLI profile name
  --endpoint NAME             Premium model endpoint    (default: databricks-claude-opus-4-7)
  --fast-endpoint NAME        Fast model endpoint       (default: databricks-claude-sonnet-4-6)
  --embedding-endpoint NAME   Embedding model endpoint  (default: databricks-qwen3-embedding-0-6b)
  --review-endpoint NAME      Review model endpoint     (default: databricks-gpt-5-4)
  --reasoning-endpoint-2 NAME Optional second reasoning model for parallel routing
  --generation-endpoint NAME  Optional generation model endpoint
  --sql-endpoint NAME         Optional SQL/codex model endpoint
  --lightweight-endpoint NAME Optional lightweight/fast-classification model endpoint
  --allowed-models CSV        Comma-separated list of models the app may use
  --lakebase-bootstrap-user EMAIL
                             Databricks user email to bootstrap with the same
                             Postgres grants as the app's service principal.
                             Defaults to the deploying user's email when the
                             script auto-provisions the Lakebase project on
                             this run. Pass an empty string to opt out:
                               --lakebase-bootstrap-user ""
  --lakebase-project-id ID   Optional override for the auto-provisioned
                             Lakebase project ID. Defaults to a sanitized
                             form of --app-name. Ignored when --lakebase-branch
                             and --lakebase-database are both passed.
  --lakebase-branch NAME     (Advanced) Lakebase branch resource name. Only
                             needed to bind an existing, externally-managed
                             project/branch. Default: auto-resolved from the
                             app's existing binding, else auto-provisioned.
                             Format: projects/<PROJECT_ID>/branches/<BRANCH_ID>
  --lakebase-database NAME   (Advanced) Lakebase database resource name. Only
                             needed alongside --lakebase-branch to bind an
                             existing, externally-managed database.
                             Format: projects/<PROJECT_ID>/branches/<BRANCH_ID>/databases/<DB_ID>
  --lakebase-scale-to-zero-seconds N
                             Inactivity timeout (seconds) before the Lakebase
                             branch scales to zero. Default: 300 on auto-
                             provisioned projects, leave existing branches
                             untouched on re-deploys. Set to 0 to disable
                             scale-to-zero (always-on; latency-critical prod).
                             Minimum: 60 (Lakebase floor).
  --seed-benchmarks          Seed benchmark catalog during app startup
  --seed-benchmarks-all-industries
                             Include generated baseline records for every
                             industry in lib/domain/industry-outcomes/
  --seed-benchmark-industries CSV
                             Seed only these industry ids (e.g. banking,hls).
                             Applies to curated packs and generated baselines.
  --benchmark-admins CSV     Comma-separated emails allowed to manage benchmarks.
                             If unset, all authenticated users can manage them.
  --enable-metric-views      Enable metric view generation (off by default)
  --enable-fabric            Enable Fabric / Power BI features (off by default)
  --enable-demo-mode         Enable Demo Mode for FE/Sales (off by default)
  --disable-user-isolation   Run as a single-tenant deployment: per-user
                             quotas are not enforced and the Sharing UI
                             is hidden. (Data-layer ownerEmail filters
                             always apply -- this flag does not roll
                             back isolation.) Defaults to enabled.
  --max-pipeline-runs-per-user N
                             Per-user cap on concurrent pipeline runs
                             (default 1). Excess runs are queued and
                             promoted by the scheduler.
  --max-scans-per-user N     Per-user cap on concurrent estate scans (default 1).
  --max-genie-deploys-per-user N
                             Per-user cap on concurrent Genie deploys (default 2).
  --max-demo-engines-per-user N
                             Per-user cap on concurrent demo engines (default 1).
  --budget-policy-id ID      Optional serverless budget policy ID to attach
                             to the Databricks App and the Lakebase project
                             for cost attribution. Applied at create time
                             and reconciled on every subsequent deploy.
  --tag KEY=VALUE             Optional custom tag (repeatable) applied to the
                             Databricks App and the Lakebase project for
                             cost attribution. Example:
                             --tag team=data-eng --tag cost-center=1234
                             Passing --tag at least once opts in to tag
                             management. In that case, two default tags
                             are injected unless overridden with --tag
                             <same-key>=<value>:
                               project=databricks_forge
                               owner=<user running the deploy>
                             To opt out of a specific default (e.g. when a
                             workspace tag policy rejects its value), pass
                             an empty value: --tag project=
                             When --tag is not passed at all, no tags are
                             applied and existing tags on either the App or
                             the Lakebase project are left untouched.
                             App tags are written via the workspace
                             tag-assignments endpoint; Lakebase project tags
                             via FORGE_CUSTOM_TAGS at runtime.
  --skip-probe                Skip model availability probing (use defaults without checking).
                             Useful for air-gapped workspaces or when probing is slow.
  --zero-egress               Build locally and package as a split archive.
                             Zero npm install required on the platform -- ideal for
                             workspaces that block serverless egress.
  --full                      Full sync: upload all files (slower, but guarantees clean state).
                             Default is diff sync: only upload changed files since last deploy.
  --destroy                   Remove the app and clean up workspace files.
                             Interactively prompts about deleting the
                             associated Lakebase project (default: keep).
                             Non-interactive operation:
                               --destroy-database  delete the project (soft)
                               --purge-database    delete the project (hard)
                               --keep-database     preserve the project, no prompt
  --destroy-database          Used with --destroy: delete the Lakebase project
                             (soft delete; recoverable) without prompting.
  --purge-database            Used with --destroy: hard-delete the Lakebase
                             project (immediate, unrecoverable). Implies
                             --destroy-database.
  --keep-database             Used with --destroy: preserve the Lakebase
                             project and skip the prompt (useful in CI).
  -h, --help              Show this help message

Prerequisites:
  - Databricks CLI installed  (https://docs.databricks.com/dev-tools/cli/install.html)
  - Authenticated CLI profile (run: databricks auth login)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-name)       ARG_APP_NAME="$2"; shift 2 ;;
    --warehouse)      ARG_WAREHOUSE="$2"; shift 2 ;;
    --profile)        ARG_PROFILE="$2"; shift 2 ;;
    --endpoint)            ARG_ENDPOINT="$2"; shift 2 ;;
    --fast-endpoint)       ARG_FAST_ENDPOINT="$2"; shift 2 ;;
    --embedding-endpoint)  ARG_EMBEDDING_ENDPOINT="$2"; shift 2 ;;
    --review-endpoint)     ARG_REVIEW_ENDPOINT="$2"; shift 2 ;;
    --reasoning-endpoint-2) ARG_REASONING_ENDPOINT_2="$2"; shift 2 ;;
    --generation-endpoint) ARG_GENERATION_ENDPOINT="$2"; shift 2 ;;
    --sql-endpoint)        ARG_SQL_ENDPOINT="$2"; shift 2 ;;
    --lightweight-endpoint) ARG_LIGHTWEIGHT_ENDPOINT="$2"; shift 2 ;;
    --allowed-models)      ARG_ALLOWED_MODELS="$2"; shift 2 ;;
    --lakebase-bootstrap-user) ARG_LAKEBASE_BOOTSTRAP_USER="$2"; ARG_LAKEBASE_BOOTSTRAP_USER_SET=true; shift 2 ;;
    --lakebase-branch) ARG_LAKEBASE_BRANCH="$2"; shift 2 ;;
    --lakebase-database) ARG_LAKEBASE_DATABASE="$2"; shift 2 ;;
    --lakebase-project-id) ARG_LAKEBASE_PROJECT_ID="$2"; shift 2 ;;
    --lakebase-scale-to-zero-seconds) ARG_LAKEBASE_SCALE_TO_ZERO_SECONDS="$2"; ARG_LAKEBASE_SCALE_TO_ZERO_SET=true; shift 2 ;;
    --seed-benchmarks) ARG_SEED_BENCHMARKS=true; shift ;;
    --seed-benchmarks-all-industries) ARG_SEED_BENCHMARKS_ALL_INDUSTRIES=true; shift ;;
    --seed-benchmark-industries) ARG_SEED_BENCHMARK_INDUSTRIES="$2"; shift 2 ;;
    --benchmark-admins) ARG_BENCHMARK_ADMINS="$2"; shift 2 ;;
    --enable-metric-views) ARG_ENABLE_METRIC_VIEWS=true; shift ;;
    --enable-fabric)       ARG_ENABLE_FABRIC=true; shift ;;
    --enable-demo-mode)    ARG_ENABLE_DEMO_MODE=true; shift ;;
    --disable-user-isolation) ARG_DISABLE_USER_ISOLATION=true; shift ;;
    --max-pipeline-runs-per-user) ARG_MAX_PIPELINE_PER_USER="$2"; shift 2 ;;
    --max-scans-per-user)        ARG_MAX_SCANS_PER_USER="$2"; shift 2 ;;
    --max-genie-deploys-per-user) ARG_MAX_GENIE_DEPLOYS_PER_USER="$2"; shift 2 ;;
    --max-demo-engines-per-user)  ARG_MAX_DEMO_ENGINES_PER_USER="$2"; shift 2 ;;
    --budget-policy-id)    ARG_BUDGET_POLICY_ID="$2"; shift 2 ;;
    --tag)                 ARG_TAGS+=("$2"); shift 2 ;;
    --skip-probe)          ARG_SKIP_PROBE=true; shift ;;
    --zero-egress)         ARG_ZERO_EGRESS=true; shift ;;
    --full)                ARG_FULL_SYNC=true; shift ;;
    --destroy)             ARG_DESTROY=true; shift ;;
    --destroy-database)    ARG_DESTROY_DATABASE=true; shift ;;
    --purge-database)      ARG_PURGE_DATABASE=true; ARG_DESTROY_DATABASE=true; shift ;;
    --keep-database)       ARG_KEEP_DATABASE=true; shift ;;
    -h|--help)        print_usage; exit 0 ;;
    *)                printf "\n  ERROR: Unknown flag: %s\n  Run ./deploy.sh --help\n\n" "$1" >&2; exit 1 ;;
  esac
done

if [[ -n "$ARG_APP_NAME" ]]; then
  APP_NAME="$ARG_APP_NAME"
fi

if [[ -n "$ARG_PROFILE" ]]; then
  export DATABRICKS_CONFIG_PROFILE="$ARG_PROFILE"
fi

# -------------------------------------------------------------------------
# Output helpers (defined early so flag-validation guards below can call die).
# -------------------------------------------------------------------------
die()  { printf "\n  ERROR: %s\n\n" "$1" >&2; exit 1; }
warn() { printf "\n  WARN: %s\n" "$1" >&2; }
info() { printf "  %-48s" "$1"; }
ok()   { if [ -n "${1:-}" ]; then printf "OK  (%s)\n" "$1"; else printf "OK\n"; fi; }

# Extract a value from JSON via Python 3.
# Usage: echo '{"k":"v"}' | json_val "['k']"
json_val() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

ENDPOINT="${ARG_ENDPOINT:-$DEFAULT_ENDPOINT}"
FAST_ENDPOINT="${ARG_FAST_ENDPOINT:-$DEFAULT_FAST_ENDPOINT}"
EMBEDDING_ENDPOINT="${ARG_EMBEDDING_ENDPOINT:-$DEFAULT_EMBEDDING_ENDPOINT}"
REVIEW_ENDPOINT="${ARG_REVIEW_ENDPOINT:-$DEFAULT_REVIEW_ENDPOINT}"
REASONING_ENDPOINT_2="${ARG_REASONING_ENDPOINT_2:-$DEFAULT_REASONING_ENDPOINT_2}"
GENERATION_ENDPOINT="${ARG_GENERATION_ENDPOINT:-$DEFAULT_GENERATION_ENDPOINT}"
SQL_ENDPOINT="${ARG_SQL_ENDPOINT:-$DEFAULT_SQL_ENDPOINT}"
LIGHTWEIGHT_ENDPOINT="${ARG_LIGHTWEIGHT_ENDPOINT:-$DEFAULT_LIGHTWEIGHT_ENDPOINT}"
ALLOWED_MODELS="${ARG_ALLOWED_MODELS:-}"
LAKEBASE_BOOTSTRAP_USER="${ARG_LAKEBASE_BOOTSTRAP_USER:-}"
LAKEBASE_BOOTSTRAP_USER_SET="${ARG_LAKEBASE_BOOTSTRAP_USER_SET}"
LAKEBASE_BRANCH="${ARG_LAKEBASE_BRANCH:-}"
LAKEBASE_DATABASE="${ARG_LAKEBASE_DATABASE:-}"
LAKEBASE_PROJECT_ID="${ARG_LAKEBASE_PROJECT_ID:-}"
LAKEBASE_SCALE_TO_ZERO_SECONDS="${ARG_LAKEBASE_SCALE_TO_ZERO_SECONDS:-}"
LAKEBASE_SCALE_TO_ZERO_SET="${ARG_LAKEBASE_SCALE_TO_ZERO_SET}"
LAKEBASE_AUTOPROVISIONED=false
LAKEBASE_ENDPOINT_PATH=""
DESTROY_DATABASE="${ARG_DESTROY_DATABASE}"
PURGE_DATABASE="${ARG_PURGE_DATABASE}"
KEEP_DATABASE="${ARG_KEEP_DATABASE}"
SEED_BENCHMARKS="${ARG_SEED_BENCHMARKS}"
SEED_BENCHMARKS_ALL_INDUSTRIES="${ARG_SEED_BENCHMARKS_ALL_INDUSTRIES}"
SEED_BENCHMARK_INDUSTRIES="${ARG_SEED_BENCHMARK_INDUSTRIES:-}"
BENCHMARK_ADMINS="${ARG_BENCHMARK_ADMINS:-}"
ENABLE_METRIC_VIEWS="${ARG_ENABLE_METRIC_VIEWS}"
ENABLE_FABRIC="${ARG_ENABLE_FABRIC}"
ENABLE_DEMO_MODE="${ARG_ENABLE_DEMO_MODE}"
DISABLE_USER_ISOLATION="${ARG_DISABLE_USER_ISOLATION}"
MAX_PIPELINE_PER_USER="${ARG_MAX_PIPELINE_PER_USER}"
MAX_SCANS_PER_USER="${ARG_MAX_SCANS_PER_USER}"
MAX_GENIE_DEPLOYS_PER_USER="${ARG_MAX_GENIE_DEPLOYS_PER_USER}"
MAX_DEMO_ENGINES_PER_USER="${ARG_MAX_DEMO_ENGINES_PER_USER}"

# -------------------------------------------------------------------------
# Cost governance (all optional). BUDGET_POLICY_ID is applied to the
# Databricks App and propagated to the Lakebase project. CUSTOM_TAGS_JSON
# is a JSON array of {key, value} objects applied only to the Lakebase
# project (the Databricks Apps API does not accept tags on the App).
#
# Two default tags are injected unless overridden by --tag with the same
# key: project=databricks_forge and owner=<user running the deploy>.
# The owner tag is skipped when USER_EMAIL could not be resolved. The
# JSON is built inside build_custom_tags_json() after USER_EMAIL is
# populated by check_prerequisites; here we only validate the raw input.
# -------------------------------------------------------------------------
BUDGET_POLICY_ID="${ARG_BUDGET_POLICY_ID:-}"
CUSTOM_TAGS_JSON=""
if [[ ${#ARG_TAGS[@]} -gt 0 ]]; then
  ARG_TAGS_RAW="$(printf '%s\n' "${ARG_TAGS[@]}")" python3 - <<'PY'
import os, sys

raw = os.environ.get("ARG_TAGS_RAW", "").splitlines()
seen = set()
for entry in raw:
    entry = entry.strip()
    if not entry:
        continue
    if "=" not in entry:
        sys.stderr.write(f"ERROR: --tag expects KEY=VALUE, got: {entry!r}\n")
        sys.exit(1)
    key, _ = entry.split("=", 1)
    key = key.strip()
    if not key:
        sys.stderr.write(f"ERROR: --tag has empty key in: {entry!r}\n")
        sys.exit(1)
    if key in seen:
        sys.stderr.write(f"ERROR: duplicate --tag key: {key}\n")
        sys.exit(1)
    seen.add(key)
PY
  if [[ $? -ne 0 ]]; then
    printf "\n  ERROR: Failed to parse --tag arguments. Expected KEY=VALUE per flag.\n\n" >&2
    exit 1
  fi
fi

if [[ "$SEED_BENCHMARKS_ALL_INDUSTRIES" = "true" && "$SEED_BENCHMARKS" != "true" ]]; then
  SEED_BENCHMARKS=true
fi
if [[ -n "$SEED_BENCHMARK_INDUSTRIES" && "$SEED_BENCHMARKS" != "true" ]]; then
  SEED_BENCHMARKS=true
fi

if [[ -n "$LAKEBASE_BRANCH" && -z "$LAKEBASE_DATABASE" ]] || \
   [[ -z "$LAKEBASE_BRANCH" && -n "$LAKEBASE_DATABASE" ]]; then
  die "--lakebase-branch and --lakebase-database must be provided together."
fi
if [[ -n "$LAKEBASE_BRANCH" ]]; then
  case "$LAKEBASE_BRANCH" in
    projects/*/branches/*) ;;
    *)
      die "Invalid --lakebase-branch '$LAKEBASE_BRANCH'. Expected: projects/<id>/branches/<id>"
      ;;
  esac
fi
if [[ -n "$LAKEBASE_DATABASE" ]]; then
  case "$LAKEBASE_DATABASE" in
    projects/*/branches/*/databases/*) ;;
    *)
      die "Invalid --lakebase-database '$LAKEBASE_DATABASE'. Expected: projects/<id>/branches/<id>/databases/<id>"
      ;;
  esac
fi

# Validate scale-to-zero flag (when passed): integer >= 0; non-zero values
# must respect the Lakebase floor of 60 seconds.
if [[ "$LAKEBASE_SCALE_TO_ZERO_SET" = "true" ]]; then
  if ! [[ "$LAKEBASE_SCALE_TO_ZERO_SECONDS" =~ ^[0-9]+$ ]]; then
    die "--lakebase-scale-to-zero-seconds must be a non-negative integer (got '$LAKEBASE_SCALE_TO_ZERO_SECONDS')."
  fi
  if [[ "$LAKEBASE_SCALE_TO_ZERO_SECONDS" -gt 0 && "$LAKEBASE_SCALE_TO_ZERO_SECONDS" -lt 60 ]]; then
    die "--lakebase-scale-to-zero-seconds must be 0 (disabled) or >= 60 (Lakebase floor). Got: $LAKEBASE_SCALE_TO_ZERO_SECONDS"
  fi
fi

# Destroy-database flag conflict guard.
if [[ "$DESTROY_DATABASE" = "true" && "$KEEP_DATABASE" = "true" ]]; then
  die "--destroy-database / --purge-database conflict with --keep-database. Pick one."
fi
# These flags are only meaningful with --destroy.
if [[ "$ARG_DESTROY" != "true" ]]; then
  if [[ "$DESTROY_DATABASE" = "true" || "$PURGE_DATABASE" = "true" || "$KEEP_DATABASE" = "true" ]]; then
    die "--destroy-database / --purge-database / --keep-database only apply with --destroy."
  fi
fi

# --lakebase-project-id is only meaningful when we auto-provision. If the
# operator also passed --lakebase-branch (i.e. opted into manual binding),
# the project-id override is ignored — surface that immediately rather than
# silently dropping it.
if [[ -n "$LAKEBASE_PROJECT_ID" && -n "$LAKEBASE_BRANCH" ]]; then
  die "--lakebase-project-id is only valid for auto-provisioned deploys. It cannot be combined with --lakebase-branch/--lakebase-database; the project is implied by the branch path."
fi

# -------------------------------------------------------------------------
# Model endpoint probing and fallback
#
# Before binding endpoints, verify each model exists in the workspace.
# If a preferred model is unavailable, walk a fallback chain of alternatives
# until one is found. This handles cross-region/cloud model availability
# differences silently.
# -------------------------------------------------------------------------

source "$SCRIPT_DIR/scripts/deploy-endpoint-selection.sh"

# Check if a serving endpoint exists. Returns 0 if available, 1 otherwise.
probe_endpoint() {
  local name="$1"
  if [ -z "$name" ]; then return 1; fi
  databricks serving-endpoints get "$name" --output json &>/dev/null
}

# Probe all endpoint roles and resolve to best available.
# Skips probing for roles where the user provided an explicit --flag override.
# Sets the global ENDPOINT, FAST_ENDPOINT, etc. variables.
probe_and_resolve_endpoints() {
  if [ "$ARG_SKIP_PROBE" = "true" ]; then
    printf "\n  Model probing skipped (--skip-probe).\n"
    return
  fi

  printf "\n  Probing model availability...\n"

  local resolved="" preferred="" label="" selection_status=0 did_fallback=false

  # Helper: probe a role and print status
  # Usage: probe_role "Label" "required|optional" "user_override" "fallback chain" VARNAME
  probe_role() {
    local role_label="$1"
    local requirement="$2"
    local user_override="$3"
    local chain="$4"
    local varname="$5"

    if [ -n "$user_override" ]; then
      printf "  %-20s %s (user override)\n" "$role_label:" "$user_override"
      assign_endpoint_var "$varname" "$user_override"
      return
    fi

    preferred="${chain%% *}"
    if resolved=$(select_endpoint_for_role "$requirement" "$chain"); then
      selection_status=0
    else
      selection_status=$?
    fi

    if [ "$selection_status" -eq 0 ]; then
      if [ "$resolved" != "$preferred" ]; then
        printf "  %-20s %s → %s\n" "$role_label:" "$preferred" "$resolved"
        did_fallback=true
      else
        printf "  %-20s %s\n" "$role_label:" "$preferred"
      fi
      assign_endpoint_var "$varname" "$resolved"
    elif [ "$selection_status" -eq 2 ]; then
      printf "  %-20s %s (all probes failed; retaining required-role default)\n" "$role_label:" "$preferred"
      assign_endpoint_var "$varname" "$resolved"
    else
      printf "  %-20s %s (all probes failed; optional role not bound)\n" "$role_label:" "$preferred"
      assign_endpoint_var "$varname" ""
    fi
  }

  probe_role "Primary" "required" "$ARG_ENDPOINT" \
    "databricks-claude-opus-4-7 databricks-claude-opus-4-6 databricks-claude-opus-4-5 databricks-gpt-5-4 databricks-claude-sonnet-4-6" \
    ENDPOINT

  probe_role "Fast" "required" "$ARG_FAST_ENDPOINT" \
    "databricks-claude-sonnet-4-6 databricks-claude-sonnet-4-5 databricks-gemini-3-flash databricks-gemini-3-1-flash-lite" \
    FAST_ENDPOINT

  probe_role "Review" "required" "$ARG_REVIEW_ENDPOINT" \
    "databricks-gpt-5-4 databricks-claude-opus-4-7 databricks-claude-opus-4-6 databricks-claude-sonnet-4-6" \
    REVIEW_ENDPOINT

  probe_role "Embedding" "required" "$ARG_EMBEDDING_ENDPOINT" \
    "databricks-qwen3-embedding-0-6b" \
    EMBEDDING_ENDPOINT

  probe_role "Reasoning2" "optional" "$ARG_REASONING_ENDPOINT_2" \
    "databricks-gemini-3-flash databricks-gemini-3-1-flash-lite databricks-llama-4-maverick" \
    REASONING_ENDPOINT_2

  probe_role "Generation" "optional" "$ARG_GENERATION_ENDPOINT" \
    "databricks-llama-4-maverick databricks-gemini-3-flash databricks-gemini-3-1-flash-lite databricks-claude-sonnet-4-6" \
    GENERATION_ENDPOINT

  probe_role "Lightweight" "optional" "$ARG_LIGHTWEIGHT_ENDPOINT" \
    "databricks-gemini-3-1-flash-lite databricks-gemini-3-flash databricks-claude-sonnet-4-5" \
    LIGHTWEIGHT_ENDPOINT

  if [ -n "$ARG_SQL_ENDPOINT" ]; then
    printf "  %-20s %s (user override)\n" "SQL:" "$ARG_SQL_ENDPOINT"
    SQL_ENDPOINT="$ARG_SQL_ENDPOINT"
  fi

  if [ "$did_fallback" = true ]; then
    printf "\n  Some models were substituted. The app adapts automatically.\n"
    printf "  Use explicit --endpoint flags to override selections.\n"
  fi
}

get_app_compute_state() {
  local app_json
  if ! app_json=$(databricks apps get "$APP_NAME" --output json 2>/dev/null); then
    echo "MISSING"
    return
  fi
  echo "$app_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN"
}

wait_for_app_absent() {
  local attempts=0
  local max_attempts=90
  local sleep_secs=10
  local state
  local last_logged_state=""

  info "Waiting for app deletion (up to 15 min)..."
  while [ $attempts -lt $max_attempts ]; do
    state="$(get_app_compute_state)"
    if [ "$state" = "MISSING" ]; then
      ok "deleted"
      return 0
    fi
    if [ "$state" != "$last_logged_state" ]; then
      printf "\n  app compute: %s (waiting)\n" "$state" >&2
      last_logged_state="$state"
    fi
    sleep "$sleep_secs"
    attempts=$((attempts + 1))
  done

  printf "TIMEOUT\n"
  return 1
}

APP_YAML_BACKUP=""
DEPLOY_SHELL_PID=""

install_app_yaml_restore_traps() {
  # $$ is intentionally not sufficient here: Bash keeps $$ stable in command
  # substitutions. BASHPID identifies the actual shell process on Bash 4+,
  # while BASH_SUBSHELL below covers normal subshell execution on older Bash
  # versions. Bash 3.2 resets EXIT traps in command substitutions by default.
  DEPLOY_SHELL_PID="${BASHPID:-$$}"
  trap restore_app_yaml EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# -------------------------------------------------------------------------
# Merge default tags (project, owner) with user-provided --tag values and
# serialize to CUSTOM_TAGS_JSON. User-provided tags override defaults on
# key collision. The owner tag is skipped when USER_EMAIL is empty.
#
# Opt-in contract: this function is a no-op unless the user passed at
# least one --tag flag. A plain `./deploy.sh` run (or one with only
# --budget-policy-id) leaves CUSTOM_TAGS_JSON empty, which keeps
# FORGE_CUSTOM_TAGS unset in app.yaml and tells the Lakebase runtime
# to skip both create-time and reconcile-time tag operations.
# Call order: after check_prerequisites (which sets USER_EMAIL) and
# before prepare_app_yaml (which consumes CUSTOM_TAGS_JSON).
# -------------------------------------------------------------------------
build_custom_tags_json() {
  CUSTOM_TAGS_JSON=""
  if [[ ${#ARG_TAGS[@]} -eq 0 ]]; then
    return
  fi

  CUSTOM_TAGS_JSON=$(USER_EMAIL="$USER_EMAIL" \
    ARG_TAGS_RAW="$(printf '%s\n' "${ARG_TAGS[@]}")" python3 - <<'PY'
import json, os

user_email = os.environ.get("USER_EMAIL", "").strip()
raw = os.environ.get("ARG_TAGS_RAW", "").splitlines()

# Defaults are inserted first so user --tag with the same key overrides them.
defaults = [{"key": "project", "value": "databricks_forge"}]
if user_email:
    defaults.append({"key": "owner", "value": user_email})

merged = {t["key"]: t["value"] for t in defaults}
for entry in raw:
    entry = entry.strip()
    if not entry or "=" not in entry:
        continue
    key, value = entry.split("=", 1)
    key = key.strip()
    value = value.strip()
    # Empty value opts out of a default (or no-ops a user-provided key).
    if value == "":
        merged.pop(key, None)
        continue
    merged[key] = value

tags = [{"key": k, "value": v} for k, v in merged.items()]
print(json.dumps(tags, separators=(",", ":")))
PY
)
}

prepare_app_yaml() {
  # Back up and patch app.yaml with instance-specific env vars for syncing.
  # The Python matcher below strips known managed entries before re-appending
  # them, so we patch directly on top of the working tree (including any
  # uncommitted local edits). This lets operators run deploy.sh against an
  # in-progress branch without losing their refactor work to a `git checkout`.
  APP_YAML_BACKUP="$(mktemp)"
  cp "app.yaml" "$APP_YAML_BACKUP"

  # Discover the Lakebase endpoint resource path so we can inject
  # LAKEBASE_ENDPOINT as a static env var. The Apps platform auto-injects
  # PGHOST/PGUSER/PGDATABASE/PGPORT/PGSSLMODE from the `postgres` resource
  # binding, but NOT the endpoint resource path — that has to come from
  # `databricks postgres list-endpoints` against the bound branch.
  # Reuse the endpoint path resolved by resolve_lakebase_binding(). If for
  # some reason it wasn't populated (e.g. someone called prepare_app_yaml
  # in isolation), fall back to discovery here.
  LAKEBASE_ENDPOINT_NAME="$LAKEBASE_ENDPOINT_PATH"
  if [ -z "$LAKEBASE_ENDPOINT_NAME" ] && [ -n "$LAKEBASE_BRANCH" ]; then
    info "Discovering Lakebase endpoint on $LAKEBASE_BRANCH..."
    resolve_lakebase_endpoint_path "$LAKEBASE_BRANCH"
    LAKEBASE_ENDPOINT_NAME="$LAKEBASE_ENDPOINT_PATH"
    ok "$LAKEBASE_ENDPOINT_NAME"
  fi

  # The deploying user is auto-seeded as the first Portfolio (CDO) org-admin so
  # the cross-estate portfolio works with zero config; they can then grant
  # access to others from the UI without a redeploy. Prefer the deployer's
  # email, fall back to the Lakebase bootstrap user.
  PORTFOLIO_BOOTSTRAP_ADMIN="${USER_EMAIL:-${LAKEBASE_BOOTSTRAP_USER:-}}"

  export APP_NAME
  export LAKEBASE_BOOTSTRAP_USER
  export PORTFOLIO_BOOTSTRAP_ADMIN
  export LAKEBASE_ENDPOINT_NAME
  export SEED_BENCHMARKS
  export SEED_BENCHMARKS_ALL_INDUSTRIES
  export SEED_BENCHMARK_INDUSTRIES
  export BENCHMARK_ADMINS
  export ENABLE_METRIC_VIEWS
  export ENABLE_FABRIC
  export ENABLE_DEMO_MODE
  export DISABLE_USER_ISOLATION
  export MAX_PIPELINE_PER_USER
  export MAX_SCANS_PER_USER
  export MAX_GENIE_DEPLOYS_PER_USER
  export MAX_DEMO_ENGINES_PER_USER
  export REASONING_ENDPOINT_2
  export GENERATION_ENDPOINT
  export SQL_ENDPOINT
  export LIGHTWEIGHT_ENDPOINT
  export ALLOWED_MODELS
  export BUDGET_POLICY_ID
  export CUSTOM_TAGS_JSON
  python3 - <<'PY'
import os
from pathlib import Path

app_name = os.environ.get("APP_NAME", "databricks-forge").strip()
bootstrap_user = os.environ.get("LAKEBASE_BOOTSTRAP_USER", "").strip()
portfolio_bootstrap_admin = os.environ.get("PORTFOLIO_BOOTSTRAP_ADMIN", "").strip()
lakebase_endpoint_name = os.environ.get("LAKEBASE_ENDPOINT_NAME", "").strip()
seed_benchmarks = os.environ.get("SEED_BENCHMARKS", "").strip().lower() == "true"
seed_benchmarks_all = os.environ.get("SEED_BENCHMARKS_ALL_INDUSTRIES", "").strip().lower() == "true"
seed_benchmark_industries = os.environ.get("SEED_BENCHMARK_INDUSTRIES", "").strip()
benchmark_admins = os.environ.get("BENCHMARK_ADMINS", "").strip()
enable_metric_views = os.environ.get("ENABLE_METRIC_VIEWS", "").strip().lower() == "true"
enable_fabric = os.environ.get("ENABLE_FABRIC", "").strip().lower() == "true"
enable_demo_mode = os.environ.get("ENABLE_DEMO_MODE", "").strip().lower() == "true"
disable_user_isolation = os.environ.get("DISABLE_USER_ISOLATION", "").strip().lower() == "true"
max_pipeline_per_user = os.environ.get("MAX_PIPELINE_PER_USER", "").strip()
max_scans_per_user = os.environ.get("MAX_SCANS_PER_USER", "").strip()
max_genie_deploys_per_user = os.environ.get("MAX_GENIE_DEPLOYS_PER_USER", "").strip()
max_demo_engines_per_user = os.environ.get("MAX_DEMO_ENGINES_PER_USER", "").strip()
reasoning_endpoint_2 = os.environ.get("REASONING_ENDPOINT_2", "").strip()
generation_endpoint = os.environ.get("GENERATION_ENDPOINT", "").strip()
sql_endpoint = os.environ.get("SQL_ENDPOINT", "").strip()
lightweight_endpoint = os.environ.get("LIGHTWEIGHT_ENDPOINT", "").strip()
allowed_models = os.environ.get("ALLOWED_MODELS", "").strip()
budget_policy_id = os.environ.get("BUDGET_POLICY_ID", "").strip()
custom_tags_json = os.environ.get("CUSTOM_TAGS_JSON", "").strip()

path = Path("app.yaml")
lines = path.read_text().splitlines()
out: list[str] = []
i = 0

def is_managed_name_line(s: str) -> bool:
    t = s.strip()
    if not t.startswith("- name:"):
        return False
    return (
        "FORGE_APP_NAME" in t
        or "LAKEBASE_BOOTSTRAP_USER" in t
        or "FORGE_PORTFOLIO_BOOTSTRAP_ADMIN" in t
        or "LAKEBASE_ENDPOINT" in t
        # Legacy env vars retired by the OAuth-only refactor.
        # Listed here so any stale entry in a pre-refactor app.yaml gets
        # stripped on the transition deploy and does not leak into the
        # app's environment.
        or "LAKEBASE_AUTH_MODE" in t
        or "LAKEBASE_NATIVE_USER" in t
        or "LAKEBASE_NATIVE_PASSWORD" in t
        or "LAKEBASE_RUNTIME_MODE" in t
        or "LAKEBASE_ENABLE_POOLER_EXPERIMENT" in t
        or "LAKEBASE_SCALE_TO_ZERO_TIMEOUT" in t
        or "FORGE_SEED_BENCHMARKS" in t
        or "FORGE_SEED_BENCHMARKS_ALL_INDUSTRIES" in t
        or "FORGE_SEED_BENCHMARK_INDUSTRIES" in t
        or "FORGE_BENCHMARK_ADMINS" in t
        or "FORGE_METRIC_VIEWS_ENABLED" in t
        or "FORGE_FABRIC_ENABLED" in t
        or "FORGE_DEMO_MODE_ENABLED" in t
        or "FORGE_USER_ISOLATION" in t
        or "FORGE_MAX_ACTIVE_PIPELINE_RUNS_PER_USER" in t
        or "FORGE_MAX_ACTIVE_SCANS_PER_USER" in t
        or "FORGE_MAX_ACTIVE_GENIE_DEPLOYS_PER_USER" in t
        or "FORGE_MAX_ACTIVE_DEMO_ENGINES_PER_USER" in t
        or "DATABRICKS_SERVING_ENDPOINT_REASONING_2" in t
        or "DATABRICKS_SERVING_ENDPOINT_GENERATION" in t
        or "DATABRICKS_SERVING_ENDPOINT_SQL" in t
        or "DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT" in t
        or "DATABRICKS_ALLOWED_MODELS" in t
        or "FORGE_BUDGET_POLICY_ID" in t
        or "FORGE_CUSTOM_TAGS" in t
    )

while i < len(lines):
    line = lines[i]
    if is_managed_name_line(line):
        i += 1
        while i < len(lines):
            nxt = lines[i]
            if nxt.startswith("  - name:"):
                break
            i += 1
        continue
    out.append(line)
    i += 1

if app_name != "databricks-forge":
    out.append("  - name: FORGE_APP_NAME")
    out.append(f'    value: "{app_name}"')
if bootstrap_user:
    out.append("  - name: LAKEBASE_BOOTSTRAP_USER")
    out.append(f'    value: "{bootstrap_user}"')
if portfolio_bootstrap_admin:
    out.append("  - name: FORGE_PORTFOLIO_BOOTSTRAP_ADMIN")
    out.append(f'    value: "{portfolio_bootstrap_admin}"')
if lakebase_endpoint_name:
    out.append("  - name: LAKEBASE_ENDPOINT")
    out.append(f'    value: "{lakebase_endpoint_name}"')
out.append("  - name: FORGE_SEED_BENCHMARKS")
out.append(f'    value: "{"true" if seed_benchmarks else "false"}"')
out.append("  - name: FORGE_SEED_BENCHMARKS_ALL_INDUSTRIES")
out.append(f'    value: "{"true" if seed_benchmarks_all else "false"}"')
if seed_benchmark_industries:
    out.append("  - name: FORGE_SEED_BENCHMARK_INDUSTRIES")
    out.append(f'    value: "{seed_benchmark_industries}"')
if benchmark_admins:
    out.append("  - name: FORGE_BENCHMARK_ADMINS")
    out.append(f'    value: "{benchmark_admins}"')
if enable_metric_views:
    out.append("  - name: FORGE_METRIC_VIEWS_ENABLED")
    out.append('    value: "true"')
if enable_fabric:
    out.append("  - name: FORGE_FABRIC_ENABLED")
    out.append('    value: "true"')
if enable_demo_mode:
    out.append("  - name: FORGE_DEMO_MODE_ENABLED")
    out.append('    value: "true"')
if disable_user_isolation:
    out.append("  - name: FORGE_USER_ISOLATION")
    out.append('    value: "false"')
if max_pipeline_per_user:
    out.append("  - name: FORGE_MAX_ACTIVE_PIPELINE_RUNS_PER_USER")
    out.append(f'    value: "{max_pipeline_per_user}"')
if max_scans_per_user:
    out.append("  - name: FORGE_MAX_ACTIVE_SCANS_PER_USER")
    out.append(f'    value: "{max_scans_per_user}"')
if max_genie_deploys_per_user:
    out.append("  - name: FORGE_MAX_ACTIVE_GENIE_DEPLOYS_PER_USER")
    out.append(f'    value: "{max_genie_deploys_per_user}"')
if max_demo_engines_per_user:
    out.append("  - name: FORGE_MAX_ACTIVE_DEMO_ENGINES_PER_USER")
    out.append(f'    value: "{max_demo_engines_per_user}"')
if reasoning_endpoint_2:
    out.append("  - name: DATABRICKS_SERVING_ENDPOINT_REASONING_2")
    out.append("    valueFrom: serving-endpoint-reasoning-2")
if generation_endpoint:
    out.append("  - name: DATABRICKS_SERVING_ENDPOINT_GENERATION")
    out.append("    valueFrom: serving-endpoint-generation")
if sql_endpoint:
    out.append("  - name: DATABRICKS_SERVING_ENDPOINT_SQL")
    out.append("    valueFrom: serving-endpoint-sql")
if lightweight_endpoint:
    out.append("  - name: DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT")
    out.append("    valueFrom: serving-endpoint-lightweight")
if allowed_models:
    out.append("  - name: DATABRICKS_ALLOWED_MODELS")
    out.append(f'    value: "{allowed_models}"')
if budget_policy_id:
    out.append("  - name: FORGE_BUDGET_POLICY_ID")
    out.append(f'    value: "{budget_policy_id}"')
if custom_tags_json:
    # Serialize as a single-line JSON value; escape any embedded double quotes
    # so the YAML remains valid. Consumed at runtime by provision.ts.
    escaped = custom_tags_json.replace('"', '\\"')
    out.append("  - name: FORGE_CUSTOM_TAGS")
    out.append(f'    value: "{escaped}"')
path.write_text("\n".join(out) + "\n")
PY
}

restore_app_yaml() {
  local current_shell_pid="${BASHPID:-$$}"
  if [ -z "$DEPLOY_SHELL_PID" ] \
    || [ "$current_shell_pid" != "$DEPLOY_SHELL_PID" ] \
    || [ "${BASH_SUBSHELL:-0}" -ne 0 ]; then
    return 0
  fi
  if [ -n "$APP_YAML_BACKUP" ] && [ -f "$APP_YAML_BACKUP" ]; then
    mv "$APP_YAML_BACKUP" "app.yaml"
    APP_YAML_BACKUP=""
  fi
}

# -------------------------------------------------------------------------
# Zero-egress package assembly
#
# Builds the Next.js standalone bundle locally, then packages it as a
# split tar.gz archive that requires ZERO npm install on the platform.
# Designed for workspaces that block serverless egress.
#
# The deploy wrapper contains only:
#   - app.yaml (command: sh bootstrap.sh)
#   - bootstrap.sh (reassembles archive, extracts, delegates to start.sh)
#   - bundle.tar.gz.part-* (split archive chunks, each <10MB)
#   - .prebuilt marker file
#
# Inside the archive:
#   - server.js + .next/ (Next.js standalone app)
#   - node_modules/ (pruned runtime deps + prisma CLI with linux engine)
#   - public/ + .next/static/ (static assets)
#   - scripts/ (start.sh, provision-lakebase.mjs, etc.)
#   - prisma/ + prisma.config.ts
#   - data/benchmark/*.json (optional)
# -------------------------------------------------------------------------
DEPLOY_PKG=".deploy-pkg"
DEPLOY_WRAPPER=".deploy-pkg-ze"
CHUNK_SIZE_MB=9

create_zero_egress_archive() {
  local bundle_path="$1"
  if [ "$(uname -s)" != "Darwin" ]; then
    if ! COPYFILE_DISABLE=1 tar -czf "$bundle_path" -C "$DEPLOY_PKG" .; then
      die "Failed to create zero-egress archive."
    fi
    return 0
  fi

  # macOS 15 protects com.apple.provenance from removal even when xattr -d/-c
  # reports success. BSD tar's --no-xattrs prevents those attributes from
  # becoming LIBARCHIVE.xattr.* pax headers in the archive.
  if ! COPYFILE_DISABLE=1 tar --no-xattrs -czf "$bundle_path" -C "$DEPLOY_PKG" .; then
    die "Failed to create zero-egress archive."
  fi
}

assemble_zero_egress() {
  printf "\n  Assembling zero-egress deploy package...\n"

  # -- Install Linux sharp binaries for cross-platform build ---------------
  info "Installing Linux sharp binaries..."
  if npm install --no-save --no-audit --no-fund --force \
       @img/sharp-linux-x64 @img/sharp-libvips-linux-x64 2>/dev/null; then
    ok
  else
    ok "skipped (non-critical)"
  fi

  # -- Local build ---------------------------------------------------------
  info "Building locally (prisma generate + next build)..."
  if ! npm run build 2>&1 | tail -3; then
    die "Local build failed. Fix errors and retry."
  fi
  ok

  # -- Locate standalone root (Next.js nests it under the project path) ----
  local standalone_root=".next/standalone"
  local nested
  nested=$(find "$standalone_root" -name "server.js" -maxdepth 6 -not -path "*/node_modules/*" | head -1)
  if [ -z "$nested" ]; then
    die "server.js not found in $standalone_root. Build may have failed."
  fi
  local standalone_app_dir
  standalone_app_dir=$(dirname "$nested")

  # -- Clean and create deploy package directory ---------------------------
  info "Assembling $DEPLOY_PKG/..."
  rm -rf "$DEPLOY_PKG" "$DEPLOY_WRAPPER"
  mkdir -p "$DEPLOY_PKG"

  cp -a "$standalone_app_dir/." "$DEPLOY_PKG/"

  rm -rf "$DEPLOY_PKG/public"
  if [ -d "$standalone_root/public" ]; then
    cp -a "$standalone_root/public" "$DEPLOY_PKG/public"
  fi

  if [ -d "$standalone_root/.next/static" ]; then
    mkdir -p "$DEPLOY_PKG/.next"
    cp -a "$standalone_root/.next/static" "$DEPLOY_PKG/.next/static"
  fi

  # -- Resolve Turbopack hashed external modules ----------------------------
  # Turbopack creates .next/node_modules/ with symlinks like:
  #   pg-61d4919a4f0d7081 -> ../../node_modules/pg
  # These are hashed package names used in server chunks. We must:
  # 1. Copy the hashed entries as real directories (dereference symlinks)
  # 2. Copy their transitive deps into the root node_modules/
  if [ -d ".next/node_modules" ]; then
    info "Resolving Turbopack externals..."
    # Remove the standalone's copy (contains broken symlinks to dev machine)
    rm -rf "$DEPLOY_PKG/.next/node_modules"
    # Re-copy with -L to dereference symlinks into real directories
    cp -aL ".next/node_modules" "$DEPLOY_PKG/.next/node_modules"
    # Trace real package names from symlinks and collect their transitive deps
    local turbo_real_pkgs=""
    while IFS= read -r link; do
      local target
      target=$(readlink "$link" 2>/dev/null) || continue
      local real_pkg
      real_pkg=$(echo "$target" | sed -E 's|.*/node_modules/||; s|/$||')
      turbo_real_pkgs="${turbo_real_pkgs}${real_pkg}\n"
    done < <(find ".next/node_modules" -maxdepth 3 -type l)
    # Use node to trace transitive deps of all external packages
    if [ -n "$turbo_real_pkgs" ]; then
      local ext_deps
      ext_deps=$(echo -e "$turbo_real_pkgs" | sort -u | node -e "
const fs=require('fs'),path=require('path'),rl=require('readline');
const nm=path.join(process.cwd(),'node_modules');
const seen=new Set();
function trace(pkg){
  if(seen.has(pkg))return;
  seen.add(pkg);
  try{
    const p=JSON.parse(fs.readFileSync(path.join(nm,pkg,'package.json'),'utf8'));
    for(const d of Object.keys(p.dependencies||{}))trace(d);
  }catch{}
}
const lines=[];
const r=rl.createInterface({input:process.stdin});
r.on('line',l=>{if(l.trim())trace(l.trim())});
r.on('close',()=>console.log([...seen].join('\n')));
")
      local ext_count=0
      while IFS= read -r dep; do
        [ -z "$dep" ] && continue
        [ -d "$DEPLOY_PKG/node_modules/$dep" ] && continue
        [ ! -d "node_modules/$dep" ] && continue
        mkdir -p "$(dirname "$DEPLOY_PKG/node_modules/$dep")"
        cp -a "node_modules/$dep" "$DEPLOY_PKG/node_modules/$dep"
        ext_count=$((ext_count + 1))
      done <<< "$ext_deps"
      ok "${ext_count} deps"
    else
      ok "none"
    fi
  fi

  # -- Strip macOS-only sharp binaries -------------------------------------
  rm -rf "$DEPLOY_PKG/node_modules/@img/sharp-darwin-arm64" \
         "$DEPLOY_PKG/node_modules/@img/sharp-libvips-darwin-arm64" \
         "$DEPLOY_PKG/node_modules/@img/sharp-darwin-x64" \
         "$DEPLOY_PKG/node_modules/@img/sharp-libvips-darwin-x64" \
         2>/dev/null || true

  # -- Strip typescript (bundled prisma handles its own TS needs) ----------
  rm -rf "$DEPLOY_PKG/node_modules/typescript" 2>/dev/null || true

  # -- Strip non-PostgreSQL Prisma WASM compilers (saves ~35M) -------------
  find "$DEPLOY_PKG" -path "*/@prisma/client*/runtime/*" \
    \( -name "*mysql*" -o -name "*sqlite*" -o -name "*sqlserver*" -o -name "*cockroachdb*" \) \
    -type f -delete 2>/dev/null || true
  # Also strip .d.ts and .d.mts files from @prisma/client runtime
  find "$DEPLOY_PKG" -path "*/@prisma/client*/runtime/*" \
    \( -name "*.d.ts" -o -name "*.d.mts" \) -type f -delete 2>/dev/null || true

  # -- Aggressive pruning: remove non-runtime files from node_modules ------
  info "Pruning non-runtime files..."
  find "$DEPLOY_PKG" -name "*.map" -type f -delete 2>/dev/null || true
  find "$DEPLOY_PKG" -name "*.nft.json" -type f -delete 2>/dev/null || true
  find "$DEPLOY_PKG/node_modules" \( \
    -name "README*" -o -name "LICENSE*" -o -name "CHANGELOG*" \
    -o -name "HISTORY*" -o -name "*.md" \
  \) -type f -delete 2>/dev/null || true
  ok

  # -- Copy runtime scripts ------------------------------------------------
  mkdir -p "$DEPLOY_PKG/scripts/db"
  cp scripts/start.sh "$DEPLOY_PKG/scripts/"
  cp scripts/provision-lakebase.mjs "$DEPLOY_PKG/scripts/"
  cp scripts/seed-benchmarks.mjs "$DEPLOY_PKG/scripts/"
  cp scripts/validate-endpoints.mjs "$DEPLOY_PKG/scripts/"
  cp "$SCRIPT_DIR/scripts/check-endpoint-readiness.mjs" "$DEPLOY_PKG/scripts/"
  cp scripts/db-preflight.mjs "$DEPLOY_PKG/scripts/"
  cp scripts/db/repair.mjs "$DEPLOY_PKG/scripts/db/"
  cp scripts/db/repair-sql.mjs "$DEPLOY_PKG/scripts/db/"
  mkdir -p "$DEPLOY_PKG/lib/dbx"
  cp "$SCRIPT_DIR/lib/dbx/model-admission.mjs" "$DEPLOY_PKG/lib/dbx/"

  # -- Copy prisma schema + write production config -------------------------
  mkdir -p "$DEPLOY_PKG/prisma"
  cp prisma/schema.prisma "$DEPLOY_PKG/prisma/"
  # Production config without dotenv dependency (env vars set by start.sh)
  cat > "$DEPLOY_PKG/prisma.config.ts" <<'PRISMACONF'
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env["DATABASE_URL"] },
});
PRISMACONF

  # -- Bundle prisma CLI + all transitive deps ------------------------------
  info "Bundling Prisma CLI..."
  if [ ! -d "node_modules/prisma" ]; then
    die "node_modules/prisma not found. Run npm install first."
  fi
  # Trace the full transitive dependency tree from local node_modules.
  # This avoids npm registry calls and uses the exact installed versions.
  local prisma_deps
  prisma_deps=$(node -e "
const fs=require('fs'),path=require('path');
const nm=path.join(process.cwd(),'node_modules');
const seen=new Set();
function trace(pkg){
  if(seen.has(pkg))return;
  seen.add(pkg);
  try{
    const p=JSON.parse(fs.readFileSync(path.join(nm,pkg,'package.json'),'utf8'));
    for(const d of Object.keys(p.dependencies||{}))trace(d);
  }catch{}
}
trace('prisma');
trace('pg');
console.log([...seen].join('\n'));
")
  if [ -z "$prisma_deps" ]; then
    die "Could not resolve prisma dependency tree."
  fi
  local dep_count=0
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    [ ! -d "node_modules/$dep" ] && continue
    local dest_dir="$DEPLOY_PKG/node_modules/$dep"
    mkdir -p "$(dirname "$dest_dir")"
    cp -a "node_modules/$dep" "$dest_dir"
    dep_count=$((dep_count + 1))
  done <<< "$prisma_deps"
  # Prune non-runtime files from prisma deps
  find "$DEPLOY_PKG/node_modules/prisma" "$DEPLOY_PKG/node_modules/@prisma" \
    \( -name "*.map" -o -name "*.nft.json" -o -name "README*" -o -name "LICENSE*" \
    -o -name "CHANGELOG*" -o -name "HISTORY*" -o -name "*.md" \) \
    -type f -delete 2>/dev/null || true
  mkdir -p "$DEPLOY_PKG/node_modules/.bin"
  cat > "$DEPLOY_PKG/node_modules/.bin/prisma" <<'PRISMABIN'
#!/bin/sh
exec node "$(dirname "$0")/../prisma/build/index.js" "$@"
PRISMABIN
  chmod +x "$DEPLOY_PKG/node_modules/.bin/prisma"
  ok "${dep_count} packages"

  info "Downloading Linux schema engine..."
  local engine_hash
  engine_hash=$(npx prisma version 2>/dev/null | grep "Engines Hash" | awk '{print $NF}')
  if [ -z "$engine_hash" ]; then
    engine_hash=$(npx prisma version 2>/dev/null | grep "Default Engines Hash" | awk '{print $NF}')
  fi

  if [ -n "$engine_hash" ]; then
    local engine_url="https://binaries.prisma.sh/all_commits/${engine_hash}/debian-openssl-3.0.x/schema-engine.gz"
    local engine_dest="$DEPLOY_PKG/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x"
    if curl -sSfL "$engine_url" | gunzip > "$engine_dest" 2>/dev/null; then
      chmod +x "$engine_dest"
      ok "$(du -h "$engine_dest" | cut -f1 | tr -d ' ')"
    else
      warn "Could not download Linux schema engine. prisma db push may fail on the target."
      ok "skipped"
    fi
  else
    warn "Could not determine Prisma engine hash. Linux engine not bundled."
    ok "skipped"
  fi

  # -- Copy benchmark data (for optional seed) -----------------------------
  if [ -d "data/benchmark" ]; then
    mkdir -p "$DEPLOY_PKG/data/benchmark"
    cp data/benchmark/*.json "$DEPLOY_PKG/data/benchmark/" 2>/dev/null || true
  fi

  # -- NO package.json -- prevents platform from running npm install -------

  # -- Write .prebuilt marker file -----------------------------------------
  echo "assembled=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_PKG/.prebuilt"
  echo "zero-egress=true" >> "$DEPLOY_PKG/.prebuilt"

  # -- Report pre-compression size -----------------------------------------
  local pkg_size pkg_files
  pkg_size=$(du -sh "$DEPLOY_PKG" | cut -f1)
  pkg_files=$(find "$DEPLOY_PKG" -type f | wc -l | tr -d ' ')
  printf "  %-48s" "Pre-compression:"
  printf "%s / %s files\n" "$pkg_size" "$pkg_files"

  # -- Compress into tar.gz ------------------------------------------------
  info "Compressing bundle..."
  local bundle_path="$DEPLOY_WRAPPER/bundle.tar.gz"
  mkdir -p "$DEPLOY_WRAPPER"
  create_zero_egress_archive "$bundle_path"
  local bundle_size
  bundle_size=$(du -h "$bundle_path" | cut -f1 | tr -d ' ')
  ok "$bundle_size"

  # -- Split into <10MB chunks (Databricks Apps per-file limit) ------------
  info "Splitting into ${CHUNK_SIZE_MB}MB chunks..."
  split -b "${CHUNK_SIZE_MB}m" "$bundle_path" "${bundle_path}.part-"
  rm -f "$bundle_path"
  local chunk_count
  chunk_count=$(find "$DEPLOY_WRAPPER" -name "bundle.tar.gz.part-*" | wc -l | tr -d ' ')
  ok "${chunk_count} chunks"

  # -- Copy bootstrap.sh and app.yaml into wrapper -------------------------
  cp scripts/bootstrap.sh "$DEPLOY_WRAPPER/bootstrap.sh"
  # app.yaml is copied later by the caller after prepare_app_yaml

  # -- Write .prebuilt marker in wrapper -----------------------------------
  echo "assembled=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_WRAPPER/.prebuilt"
  echo "zero-egress=true" >> "$DEPLOY_WRAPPER/.prebuilt"

  # -- Report final wrapper size -------------------------------------------
  local wrapper_size wrapper_files
  wrapper_size=$(du -sh "$DEPLOY_WRAPPER" | cut -f1)
  wrapper_files=$(find "$DEPLOY_WRAPPER" -type f | wc -l | tr -d ' ')
  printf "\n  %-48s" "Zero-egress package:"
  printf "%s / %s files\n" "$wrapper_size" "$wrapper_files"
}

# -------------------------------------------------------------------------
# Step 1: Check prerequisites
# -------------------------------------------------------------------------
check_prerequisites() {
  printf "\n  Checking prerequisites...\n"

  info "Databricks CLI..."
  if ! command -v databricks &>/dev/null; then
    printf "MISSING\n"
    die "Databricks CLI not found.\n  Install: https://docs.databricks.com/dev-tools/cli/install.html"
  fi
  local cli_ver
  cli_ver=$(databricks version 2>/dev/null || databricks --version 2>/dev/null || echo "unknown")
  ok "$cli_ver"

  info "CLI profile..."
  ok "${DATABRICKS_CONFIG_PROFILE:-DEFAULT}"

  info "Authentication..."
  local user_json
  if ! user_json=$(databricks current-user me --output json 2>/dev/null); then
    printf "FAILED\n"
    die "Not authenticated. Run:\n  databricks auth login --host https://your-workspace.cloud.databricks.com"
  fi
  USER_EMAIL=$(echo "$user_json" | json_val "['userName']")
  ok "$USER_EMAIL"

  info "Workspace host..."
  DATABRICKS_HOST=""
  if command -v databricks &>/dev/null; then
    DATABRICKS_HOST=$(databricks auth describe --output json 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('host',''))" 2>/dev/null || true)
  fi
  if [ -z "$DATABRICKS_HOST" ]; then
    DATABRICKS_HOST=$(databricks auth describe 2>/dev/null \
      | grep -i "Host:" | head -1 | awk '{print $NF}' || echo "")
  fi
  if [ -z "$DATABRICKS_HOST" ]; then
    die "Could not determine workspace host. Check your CLI profile."
  fi
  DATABRICKS_HOST="${DATABRICKS_HOST%/}"
  ok "$DATABRICKS_HOST"
}

# -------------------------------------------------------------------------
# Step 2: Select a SQL Warehouse
# -------------------------------------------------------------------------
select_warehouse() {
  printf "\n  Discovering SQL Warehouses...\n"

  local wh_json
  if ! wh_json=$(databricks warehouses list --output json 2>/dev/null); then
    die "Failed to list SQL Warehouses. Check your permissions."
  fi

  local wh_count
  wh_count=$(echo "$wh_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
wh = data if isinstance(data, list) else data.get('warehouses', [])
print(len(wh))
")

  if [ "$wh_count" -eq 0 ]; then
    die "No SQL Warehouses found in this workspace. Create one first."
  fi

  echo "$wh_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
wh = data if isinstance(data, list) else data.get('warehouses', [])
for i, w in enumerate(wh, 1):
    state = w.get('state', 'UNKNOWN')
    name  = w.get('name', 'Unnamed')
    print(f'    {i}) {name} ({state})')
"

  if [ -n "$ARG_WAREHOUSE" ]; then
    local result
    result=$(echo "$wh_json" | python3 -c "
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
    if [ -z "$result" ]; then
      die "Warehouse '$ARG_WAREHOUSE' not found."
    fi
    WAREHOUSE_ID="${result%%|*}"
    WAREHOUSE_NAME="${result#*|}"
    printf "  -> %s (via --warehouse flag)\n" "$WAREHOUSE_NAME"
  else
    printf "  Enter number [1]: "
    read -r choice
    choice="${choice:-1}"

    local result
    result=$(echo "$wh_json" | python3 -c "
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
    if [ -z "$result" ]; then
      die "Invalid selection. Enter a number from the list."
    fi
    WAREHOUSE_ID="${result%%|*}"
    WAREHOUSE_NAME="${result#*|}"
    printf "  -> %s\n" "$WAREHOUSE_NAME"
  fi
}

# -------------------------------------------------------------------------
# Step 3: Create the app (if it doesn't exist) and configure it
#
# New apps: created with user_api_scopes via the create endpoint, then
# resources are bound via create-update.
#
# Existing apps: create-update sets both resources and scopes idempotently.
#
# The app.yaml references resources via valueFrom: keys, which the platform
# resolves to environment variables at runtime.
# -------------------------------------------------------------------------
APP_SCOPES='["sql","catalog.tables:read","catalog.schemas:read","catalog.catalogs:read","files.files","dashboards.genie"]'

# -------------------------------------------------------------------------
# Lakebase: auto-resolve the postgres resource binding.
#
# Resolution order (first hit wins):
#   1. Explicit --lakebase-branch + --lakebase-database from the operator
#      → use them as-is; just discover the endpoint path.
#   2. The Databricks App already has a postgres resource bound (from a
#      previous deploy) → reuse the same branch + database (keyed by app-name).
#   3. Auto-provision a fresh Lakebase project named after --app-name
#      (or --lakebase-project-id), using the default `databricks_postgres`
#      database that ships with every new project.
#
# Side effects: populates LAKEBASE_BRANCH, LAKEBASE_DATABASE, and
# LAKEBASE_ENDPOINT_PATH; sets LAKEBASE_AUTOPROVISIONED=true on path (3) so
# downstream steps (scale-to-zero, bootstrap-user default, success banner)
# can branch on it.
# -------------------------------------------------------------------------
sanitize_lakebase_project_id() {
  # Lakebase project IDs are restricted to [a-z0-9-]{1,63} and must start
  # with a letter. Build a deterministic ID from the app name so re-deploys
  # land on the same project.
  local input="$1"
  RAW_INPUT="$input" python3 - <<'PY'
import os, re, sys
raw = os.environ.get("RAW_INPUT", "").strip().lower()
s = re.sub(r'[^a-z0-9-]', '-', raw)
s = re.sub(r'-+', '-', s).strip('-')
if not s:
    s = "forge-app"
if not s[0].isalpha():
    s = "app-" + s
s = s[:63].rstrip('-')
print(s or "forge-app")
PY
}

resolve_lakebase_endpoint_path() {
  # Find the read-write endpoint on the given branch path and cache it in
  # LAKEBASE_ENDPOINT_PATH. Skipped when LAKEBASE_ENDPOINT_PATH is already
  # populated (e.g. just minted by the auto-provision path).
  local branch_path="$1"
  if [ -n "$LAKEBASE_ENDPOINT_PATH" ]; then
    return
  fi
  local endpoints_json
  if ! endpoints_json=$(databricks postgres list-endpoints "$branch_path" -o json 2>&1); then
    die "Failed to list Lakebase endpoints on $branch_path.\n  $endpoints_json"
  fi
  LAKEBASE_ENDPOINT_PATH=$(LAKEBASE_ENDPOINTS_JSON="$endpoints_json" python3 <<'PY'
import json, os, sys
raw = os.environ.get("LAKEBASE_ENDPOINTS_JSON", "")
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)
items = data if isinstance(data, list) else data.get("endpoints", []) or []
if not items:
    sys.exit(0)
best = None
for ep in items:
    status = ep.get("status", {}) or {}
    if status.get("current_state") == "ACTIVE" and status.get("endpoint_type") == "ENDPOINT_TYPE_READ_WRITE":
        best = ep
        break
if best is None:
    best = items[0]
name = best.get("name", "")
if name:
    print(name)
PY
)
  if [ -z "$LAKEBASE_ENDPOINT_PATH" ]; then
    die "Could not parse a Lakebase endpoint from list-endpoints on $branch_path."
  fi
}

# -------------------------------------------------------------------------
# Lakebase: bootstrap grants for the app service principal.
#
# Lakebase auto-creates a Postgres role for the app SP on first bind, but
# the public schema is owned by the deploying user, so the SP has zero
# rights on it. We need to:
#   1. Install pgvector + databricks_auth as the project owner.
#   2. Make sure the SP role exists.
#   3. Grant the SP CONNECT + USAGE/CREATE on public + table/sequence
#      privileges + ALTER DEFAULT PRIVILEGES for future tables.
#   4. Transfer ownership of any pre-existing public tables to the SP so
#      Prisma can ALTER/DROP them (mirrors .deploy_local.sh).
#
# Caller-must-be-owner: if the deploying user is not the project owner
# (e.g. a teammate re-deploys), skip with a warning — they can't run the
# grants, and the original deploy presumably already did.
#
# Runs after configure_app so the postgres binding is live and Lakebase
# has had a chance to mint the SP role.
# -------------------------------------------------------------------------
# -------------------------------------------------------------------------
# Default LAKEBASE_BOOTSTRAP_USER to the deploying user when:
#   - the operator did NOT pass --lakebase-bootstrap-user (any value,
#     including the empty string opt-out), AND
#   - this script auto-provisioned the Lakebase project on this run, so
#     we know the deployer is the project owner and can be granted SQL
#     Editor access without surprising anyone.
#
# This guarantees the deployer can open the SQL Editor against their own
# deploy without an extra flag. Power users who don't want this can pass
# --lakebase-bootstrap-user "" to opt out explicitly.
# -------------------------------------------------------------------------
default_bootstrap_user() {
  if [ "$LAKEBASE_BOOTSTRAP_USER_SET" = "true" ]; then
    return
  fi
  if [ "$LAKEBASE_AUTOPROVISIONED" != "true" ]; then
    return
  fi
  if [ -z "$USER_EMAIL" ]; then
    return
  fi
  LAKEBASE_BOOTSTRAP_USER="$USER_EMAIL"
  info "Lakebase bootstrap user (auto)..."
  ok "$USER_EMAIL"
}

bootstrap_lakebase_sp_grants() {
  info "Bootstrapping Lakebase grants for app SP..."

  if [ -z "$LAKEBASE_ENDPOINT_PATH" ] || [ -z "$LAKEBASE_DATABASE" ]; then
    printf "FAILED\n"
    die "Internal error: LAKEBASE_ENDPOINT_PATH or LAKEBASE_DATABASE not set before bootstrap."
  fi

  # 1. Extract the SP client ID — this is the SP's Postgres role name.
  local app_json sp_client_id
  if ! app_json=$(databricks apps get "$APP_NAME" -o json 2>&1); then
    printf "FAILED\n"
    die "Failed to read app metadata to discover SP client ID.\n  $app_json"
  fi
  sp_client_id=$(APP_JSON="$app_json" python3 -c "
import sys, json, os
d = json.loads(os.environ['APP_JSON'])
print(d.get('service_principal_client_id', ''))
")
  if [ -z "$sp_client_id" ]; then
    printf "FAILED\n"
    die "App '$APP_NAME' has no service_principal_client_id yet. Re-run after the app's compute state stabilises."
  fi

  # 2. Resolve the actual Postgres database name from the database
  #    resource. Lakebase's resource ID (the last path segment) and the
  #    Postgres database name often differ -- a project's default DB
  #    resource is "databricks-postgres" (with a dash) while the real DB
  #    is "databricks_postgres" (with an underscore). We MUST connect to
  #    the underscore name and grant on the underscore name; the dashed
  #    resource ID is not a valid Postgres identifier in libpq.
  #
  #    Source of truth: status.postgres_database on the database resource.
  local db_name db_res_json
  if ! db_res_json=$(databricks postgres get-database "$LAKEBASE_DATABASE" -o json 2>&1); then
    # Older CLI versions / API rollouts may not expose get-database;
    # fall back to list-databases + match on resource name.
    local parent_branch
    parent_branch=$(printf "%s" "$LAKEBASE_DATABASE" | awk -F'/' '{print $1"/"$2"/"$3"/"$4}')
    local list_json
    if ! list_json=$(databricks postgres list-databases "$parent_branch" -o json 2>&1); then
      printf "FAILED\n"
      die "Failed to read Lakebase database $LAKEBASE_DATABASE for db-name resolution.\n  $db_res_json\n  $list_json"
    fi
    db_name=$(LB_LIST_JSON="$list_json" TARGET="$LAKEBASE_DATABASE" python3 - <<'PY'
import json, os, sys
raw = os.environ.get("LB_LIST_JSON", "")
target = os.environ.get("TARGET", "")
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)
items = data if isinstance(data, list) else data.get("databases", []) or []
for d in items:
    if d.get("name") == target:
        st = d.get("status") or {}
        pg = st.get("postgres_database") or st.get("database_id") or ""
        if pg:
            print(pg)
            sys.exit(0)
PY
)
  else
    db_name=$(DB_JSON="$db_res_json" python3 - <<'PY'
import json, os, sys
try:
    d = json.loads(os.environ.get("DB_JSON", ""))
except Exception:
    sys.exit(0)
st = d.get("status") or {}
pg = st.get("postgres_database") or st.get("database_id") or ""
if pg:
    print(pg)
PY
)
  fi
  # Last-resort fallback: use the path's last segment with any dashes
  # converted to underscores (matches Lakebase's default naming rule
  # where the auto-created "databricks-postgres" resource maps to the
  # "databricks_postgres" Postgres DB).
  if [ -z "$db_name" ]; then
    db_name=$(printf "%s" "$LAKEBASE_DATABASE" | awk -F'/' '{print $NF}' | tr '-' '_')
  fi
  if [ -z "$db_name" ]; then
    printf "FAILED\n"
    die "Could not resolve a Postgres database name from $LAKEBASE_DATABASE."
  fi

  # 3. Discover the endpoint host (needed to build a libpq URL).
  local endpoint_json endpoint_host
  if ! endpoint_json=$(databricks postgres get-endpoint "$LAKEBASE_ENDPOINT_PATH" -o json 2>&1); then
    printf "FAILED\n"
    die "Failed to read Lakebase endpoint details.\n  $endpoint_json"
  fi
  endpoint_host=$(ENDPOINT_JSON="$endpoint_json" python3 -c "
import sys, json, os
d = json.loads(os.environ['ENDPOINT_JSON'])
status = d.get('status') or {}
hosts = status.get('hosts') or {}
print(hosts.get('host') or status.get('host') or '')
")
  if [ -z "$endpoint_host" ]; then
    printf "FAILED\n"
    die "Could not determine endpoint host for $LAKEBASE_ENDPOINT_PATH. The endpoint may still be warming up — wait a minute and retry."
  fi

  # 4. Mint a short-lived deployer credential.
  local cred_json deployer_token
  if ! cred_json=$(databricks postgres generate-database-credential "$LAKEBASE_ENDPOINT_PATH" -o json 2>&1); then
    printf "FAILED\n"
    die "Failed to mint Lakebase deployer credential.\n  $cred_json"
  fi
  deployer_token=$(CRED_JSON="$cred_json" python3 -c "
import sys, json, os
d = json.loads(os.environ['CRED_JSON'])
print(d.get('token') or d.get('password') or '')
")
  if [ -z "$deployer_token" ]; then
    printf "FAILED\n"
    die "generate-database-credential returned no token."
  fi

  # 5. Build the deployer DATABASE_URL.
  local deployer_url
  deployer_url=$(USER_EMAIL="$USER_EMAIL" \
                 DEPLOYER_TOKEN="$deployer_token" \
                 ENDPOINT_HOST="$endpoint_host" \
                 DB_NAME="$db_name" \
                 python3 -c "
import os, urllib.parse
u = urllib.parse.quote(os.environ['USER_EMAIL'], safe='')
p = urllib.parse.quote(os.environ['DEPLOYER_TOKEN'], safe='')
h = os.environ['ENDPOINT_HOST']
d = os.environ['DB_NAME']
print(f'postgresql://{u}:{p}@{h}/{d}?sslmode=require&uselibpqcompat=true')
")

  # 5b. Resolve the Lakebase project owner. A teammate (non-owner) re-deploying
  #     has no Postgres login role on this database when native login is
  #     disabled, so the connection below is rejected outright ("password
  #     authentication failed") rather than connecting-but-lacking-CREATE. The
  #     grants were already applied by the owner's original deploy and are
  #     idempotent, so in that case we skip-warn instead of dying (mirrors the
  #     NOT_OWNER path that only fires on a successful connect).
  local project_path project_owner
  project_path=$(printf "%s" "$LAKEBASE_ENDPOINT_PATH" | awk -F'/' '{print $1"/"$2}')
  project_owner=$(databricks postgres get-project "$project_path" -o json 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print((d.get('status') or {}).get('owner', ''))
except Exception:
    print('')
" 2>/dev/null || true)

  # 6. Run the SQL bootstrap via node + pg with retry (matches .deploy_local.sh
  #    pattern lines 326-347 to absorb endpoint cold-start delays).
  if ! command -v node &>/dev/null; then
    printf "FAILED\n"
    die "node is required to run the Lakebase SP-grant bootstrap. Install Node.js >= 18 and retry."
  fi

  local attempts=0 max=5 interval=3 sp_setup_ok=false sp_setup_err=""
  while [ "$attempts" -lt "$max" ]; do
    # IMPORTANT: under `set -e`, a bare `var=$(failing-cmd)` exits the
    # shell immediately, before we reach the `$?` capture and the retry
    # logic below. Wrap with `|| sp_exit=$?` so the failure is captured
    # in a variable instead.
    local sp_exit=0
    sp_setup_err=$(DATABASE_URL="$deployer_url" \
                   SP_CLIENT_ID="$sp_client_id" \
                   DB_NAME="$db_name" \
                   node -e "
const pg = require('pg');
(async () => {
  const role = process.env.SP_CLIENT_ID;
  const dbName = process.env.DB_NAME;
  const safeRole = '\"' + role.replace(/\"/g, '\"\"') + '\"';
  const safeDb = '\"' + dbName.replace(/\"/g, '\"\"') + '\"';
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  try {
    // Tight statement / lock timeouts so a single bad query can't hang
    // the entire bootstrap (e.g. ALTER OWNER TO blocked by a cloud_admin
    // monitoring query).
    await pool.query(\"SET statement_timeout = '10s'\");
    await pool.query(\"SET lock_timeout = '3s'\");

    // Ownership check: bail out cleanly if the caller can't run grants.
    const own = await pool.query(
      \"SELECT pg_has_role(current_user, oid, 'USAGE') AS owner FROM pg_database WHERE datname = current_database()\"
    );
    const isOwner = own.rows[0] && own.rows[0].owner;
    // has_database_privilege on CREATE is also a good proxy.
    const canCreate = await pool.query(
      \"SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS ok\"
    );
    if (!canCreate.rows[0] || !canCreate.rows[0].ok) {
      console.log('NOT_OWNER');
      return;
    }

    // Install extensions as project owner so start.sh's CREATE EXTENSION vector is a no-op.
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS databricks_auth');
    } catch (_) {
      // Some Lakebase versions install databricks_auth eagerly; CREATE may
      // 42710 (already exists) or 42501 (cannot install) — both are fine.
    }

    // Ensure the SP role exists. Lakebase usually mints it on first connect
    // via the postgres binding; this is a defensive no-op if so.
    const roleExists = await pool.query(
      'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = \$1) AS ok', [role]
    );
    if (!roleExists.rows[0] || !roleExists.rows[0].ok) {
      // databricks_create_role is the Lakebase-blessed way to provision an
      // SP role. If unavailable, the SP will materialize on its first connect.
      try {
        await pool.query(\"SELECT databricks_create_role(\$1, 'service_principal')\", [role]);
      } catch (e) {
        console.log('  Note: SP role does not yet exist and databricks_create_role is unavailable; it will be created on first app connect.');
      }
    }

    // Idempotent grants.
    await pool.query('GRANT CONNECT ON DATABASE ' + safeDb + ' TO ' + safeRole);
    await pool.query('GRANT USAGE, CREATE ON SCHEMA public TO ' + safeRole);
    await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO ' + safeRole);
    await pool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + safeRole);
    await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO ' + safeRole);
    await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ' + safeRole);

    // Attempt to transfer ownership of pre-existing tables to the SP.
    // On Lakebase, the deploying user can do this on a FRESH database
    // (deployer owns objects and ALTER OWNER TO targets the SP role
    // they implicitly created). On a REUSED database (--keep-database),
    // PostgreSQL requires the deployer be a member of the new SP role
    // with SET ROLE privilege — Lakebase does NOT grant this. Those
    // ALTERs fail with \"must be able to SET ROLE ...\" and are silently
    // skipped. App start will then fail when Prisma tries to DROP
    // objects it doesn't own (idx_embeddings_hnsw, etc.). See release
    // notes on the --keep-database limitation.
    const { rows: tables } = await pool.query(
      \"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner <> \$1\",
      [role]
    );
    let xferTables = 0, xferSkipped = 0;
    for (const { tablename } of tables) {
      const safeT = '\"' + tablename.replace(/\"/g, '\"\"') + '\"';
      try {
        await pool.query('ALTER TABLE public.' + safeT + ' OWNER TO ' + safeRole);
        xferTables++;
      } catch (_) { xferSkipped++; }
    }
    if (xferTables > 0) {
      console.log('  Transferred ownership of ' + xferTables + ' table(s) to the SP.');
    }
    if (xferSkipped > 0) {
      console.log('  REUSE_OWNERSHIP_GAP:' + xferSkipped);
    }
    console.log('OK');
  } finally {
    try { await pool.end(); } catch (_) {}
  }
  // Force a hard exit. pg.Pool sometimes leaves a TCP keepalive socket
  // open after pool.end() that prevents node from exiting on its own.
  // Without this, deploy.sh hangs forever in the command substitution
  // (\`var=\$(node -e ...)\`) even though the bootstrap completed.
  process.exit(0);
})().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
" 2>&1) || sp_exit=$?
    if [ "$sp_exit" -eq 0 ]; then
      if echo "$sp_setup_err" | grep -q '^NOT_OWNER$'; then
        printf "SKIP\n"
        warn "Skipping SP grant bootstrap — the deploying user is not the Lakebase project owner. Assuming a prior deploy already applied the grants. If the app fails to push Prisma schema on startup, the original project owner needs to re-run ./deploy.sh."
        return
      fi
      sp_setup_ok=true
      break
    fi
    if [ "$attempts" -lt "$((max - 1))" ]; then
      sleep "$interval"
    fi
    attempts=$((attempts + 1))
  done

  if [ "$sp_setup_ok" != "true" ]; then
    # A non-owner teammate cannot authenticate to Lakebase at all (no Postgres
    # login role) — treat a persistent auth/role failure the same as NOT_OWNER:
    # the owner's original deploy already applied the idempotent grants.
    if [ -n "$project_owner" ] && [ "$project_owner" != "$USER_EMAIL" ] &&
       echo "$sp_setup_err" | grep -Eqi 'password authentication failed|no pg_hba|role .* does not exist|permission denied'; then
      printf "SKIP\n"
      warn "Skipping SP grant bootstrap — '$USER_EMAIL' is not the Lakebase project owner ('$project_owner') and has no DB login role. Assuming the owner's original deploy applied the grants. If the app fails to push the Prisma schema on startup, '$project_owner' needs to re-run ./deploy.sh."
      return
    fi
    printf "FAILED\n"
    die "Failed to apply SP grants on Lakebase after $max attempts. Last error:\n  $sp_setup_err\n\nThis blocks the app from running 'prisma db push' on startup. Confirm the endpoint $LAKEBASE_ENDPOINT_PATH is ACTIVE and re-run ./deploy.sh."
  fi

  # Surface --keep-database limitation: if some pre-existing tables could
  # not be re-owned by the new SP, Prisma db push will fail at app start
  # (\"must be owner of <index>\"). PostgreSQL requires the deployer be a
  # member of the new SP role with SET ROLE option to transfer ownership;
  # Lakebase does NOT grant this option automatically. We surface the
  # warning here so the operator can react BEFORE the app crashes.
  local gap_count
  gap_count=$(echo "$sp_setup_err" | sed -n 's/.*REUSE_OWNERSHIP_GAP:\([0-9][0-9]*\).*/\1/p' | head -1)
  if [ -n "$gap_count" ] && [ "$gap_count" -gt 0 ]; then
    ok "$sp_client_id ($gap_count pre-existing tables not re-owned)"
    warn "Detected $gap_count pre-existing table(s) owned by a previous deployer/SP that the new SP cannot take over.
  This usually happens after ./deploy.sh --destroy --keep-database followed by a fresh deploy.
  PostgreSQL requires the deployer to be a member of the new SP role with ADMIN OPTION
  to transfer ownership; Lakebase does NOT grant that option, so the SP can READ/WRITE
  existing tables but cannot ALTER/DROP them.

  Impact: the app will CRASH at startup when Prisma db push tries to drop drift
  indexes (idx_embeddings_hnsw etc.) it does not own.

  Workarounds (pick one):
    a) Run \`./deploy.sh --destroy --destroy-database\` to wipe and start fresh.
    b) Manually grant the deployer role membership on the new SP via Postgres SQL
       editor: GRANT \"<new-sp-uuid>\" TO \"<deployer-email>\" WITH ADMIN OPTION;
       Then re-run \`./deploy.sh\` to retry the ownership transfer."
    return
  fi

  ok "$sp_client_id"
}

# -------------------------------------------------------------------------
# Lakebase: report on configured scale-to-zero.
#
# IMPORTANT: scale-to-zero (`suspend_timeout_duration` on the default
# endpoint settings) is fixed at project-creation time. Lakebase's
# update-project / update-endpoint APIs reject `suspend_timeout_duration`
# in the update_mask, so once a project exists, the value is immutable.
#
# Auto-provisioning therefore folds scale-to-zero into the create-project
# spec (see resolve_lakebase_binding). This helper only:
#   - Reports the configured value (read-only) on every deploy, so the
#     operator sees what they're paying for.
#   - If the operator passes --lakebase-scale-to-zero-seconds N on a
#     reuse path and the live value differs, emits a warning explaining
#     that they must destroy and re-create the project to change it.
# -------------------------------------------------------------------------
configure_lakebase_scale_to_zero() {
  if [ -z "$LAKEBASE_BRANCH" ]; then
    return
  fi
  local project_path
  project_path=$(printf "%s" "$LAKEBASE_BRANCH" | awk -F'/' '{print $1"/"$2}')
  if [ -z "$project_path" ]; then
    return
  fi
  local project_json
  if ! project_json=$(databricks postgres get-project "$project_path" -o json 2>&1); then
    return
  fi
  local current_seconds
  current_seconds=$(PROJECT_JSON="$project_json" python3 - <<'PY'
import json, os, re, sys
try:
    d = json.loads(os.environ.get("PROJECT_JSON", ""))
except Exception:
    sys.exit(0)
st = d.get("status") or d.get("spec") or {}
des = st.get("default_endpoint_settings") or {}
raw = des.get("suspend_timeout_duration", "")
m = re.match(r"^(\d+)s?$", str(raw))
if m:
    print(m.group(1))
PY
)
  if [ -z "$current_seconds" ]; then
    return
  fi
  if [ "$current_seconds" -eq 0 ]; then
    info "Lakebase scale-to-zero..."
    printf "disabled (always-on)\n"
  else
    info "Lakebase scale-to-zero..."
    printf "%ss (project default)\n" "$current_seconds"
  fi

  if [ "$LAKEBASE_SCALE_TO_ZERO_SET" = "true" ] && [ "$LAKEBASE_AUTOPROVISIONED" != "true" ]; then
    if [ "$LAKEBASE_SCALE_TO_ZERO_SECONDS" -ne "$current_seconds" ]; then
      warn "--lakebase-scale-to-zero-seconds ${LAKEBASE_SCALE_TO_ZERO_SECONDS} requested, but the existing project is fixed at ${current_seconds}s.
  Lakebase does not support changing suspend_timeout_duration on an existing project.
  To take effect, destroy this project (./deploy.sh --destroy --destroy-database) and re-deploy with the new value, OR migrate to a fresh project (--lakebase-project-id NEW)."
    fi
  fi
}

wait_for_endpoint_active() {
  # Poll the cached LAKEBASE_ENDPOINT_PATH until status.current_state == ACTIVE.
  # Only meaningful right after auto-create-project — reused endpoints are
  # already warm. Skip silently when LAKEBASE_AUTOPROVISIONED is false.
  if [ "$LAKEBASE_AUTOPROVISIONED" != "true" ]; then
    return
  fi
  if [ -z "$LAKEBASE_ENDPOINT_PATH" ]; then
    return
  fi
  info "Waiting for Lakebase endpoint to become ACTIVE..."
  # Cold-create endpoints take 30–60s; budget ~120s with 5s interval.
  local attempts=0 max=24 state="" detail_json=""
  while [ "$attempts" -lt "$max" ]; do
    if detail_json=$(databricks postgres get-endpoint "$LAKEBASE_ENDPOINT_PATH" -o json 2>/dev/null); then
      state=$(ENDPOINT_JSON="$detail_json" python3 -c "
import sys, json, os
data = json.loads(os.environ.get('ENDPOINT_JSON', '{}'))
print((data.get('status') or {}).get('current_state', ''))
" 2>/dev/null || echo "")
      if [ "$state" = "ACTIVE" ]; then
        ok "$state"
        return
      fi
    fi
    sleep 5
    attempts=$((attempts + 1))
  done
  printf "FAILED\n"
  die "Lakebase endpoint $LAKEBASE_ENDPOINT_PATH did not reach ACTIVE within $((max * 5))s (last state: '${state:-unknown}'). Wait a minute and re-run ./deploy.sh."
}

resolve_lakebase_binding() {
  # ---- Path 1: explicit branch + database from the operator -------------
  if [ -n "$LAKEBASE_BRANCH" ] && [ -n "$LAKEBASE_DATABASE" ]; then
    info "Lakebase binding (explicit)..."
    ok "$LAKEBASE_BRANCH"
    resolve_lakebase_endpoint_path "$LAKEBASE_BRANCH"
    return
  fi

  # ---- Path 2: reuse the binding already attached to the app -----------
  info "Lakebase binding for \"$APP_NAME\"..."
  local app_json
  if app_json=$(databricks apps get "$APP_NAME" -o json 2>/dev/null); then
    local pg
    pg=$(APP_JSON="$app_json" python3 - <<'PY'
import json, os, sys
data = json.loads(os.environ['APP_JSON'])
for r in data.get('resources', []) or []:
    pg = r.get('postgres')
    if pg and pg.get('branch') and pg.get('database'):
        print(json.dumps({'branch': pg['branch'], 'database': pg['database']}))
        sys.exit(0)
PY
)
    if [ -n "$pg" ]; then
      LAKEBASE_BRANCH=$(echo "$pg" | python3 -c "import sys,json; print(json.load(sys.stdin)['branch'])")
      LAKEBASE_DATABASE=$(echo "$pg" | python3 -c "import sys,json; print(json.load(sys.stdin)['database'])")
      ok "reused $LAKEBASE_BRANCH"
      resolve_lakebase_endpoint_path "$LAKEBASE_BRANCH"
      return
    fi
  fi

  # ---- Path 3: auto-provision a Lakebase project + default database -----
  if [ -z "$LAKEBASE_PROJECT_ID" ]; then
    LAKEBASE_PROJECT_ID=$(sanitize_lakebase_project_id "$APP_NAME")
  fi
  printf "auto-provisioning %s\n" "$LAKEBASE_PROJECT_ID"

  local project_path="projects/$LAKEBASE_PROJECT_ID"
  if databricks postgres get-project "$project_path" -o json &>/dev/null; then
    info "Lakebase project \"$LAKEBASE_PROJECT_ID\"..."
    ok "already exists"
  else
    # Pick a scale-to-zero default. Lakebase fixes
    # suspend_timeout_duration at create-project time -- no update API
    # works -- so this is the operator's one chance to set it.
    local stz_seconds="300"
    if [ "$LAKEBASE_SCALE_TO_ZERO_SET" = "true" ]; then
      stz_seconds="$LAKEBASE_SCALE_TO_ZERO_SECONDS"
    fi
    info "Creating Lakebase project \"$LAKEBASE_PROJECT_ID\" (scale-to-zero ${stz_seconds}s)..."
    local create_json
    create_json=$(LAKEBASE_PROJECT_ID="$LAKEBASE_PROJECT_ID" \
                   APP_NAME="$APP_NAME" \
                   BUDGET_POLICY_ID="$BUDGET_POLICY_ID" \
                   STZ_SECONDS="$stz_seconds" \
                   python3 - <<'PY'
import json, os
spec = {"display_name": f"{os.environ['APP_NAME']} (auto-provisioned)"}
bp = os.environ.get("BUDGET_POLICY_ID", "").strip()
if bp:
    spec["budget_policy_id"] = bp
try:
    stz = int(os.environ.get("STZ_SECONDS", "0"))
except Exception:
    stz = 0
# Only set when the operator actually wants scale-to-zero. Lakebase's
# project-level default (24h) kicks in when we omit the field, but for
# Forge apps we always want a tighter default to keep idle DBU spend low.
if stz >= 0:
    spec["default_endpoint_settings"] = {"suspend_timeout_duration": f"{stz}s"}
print(json.dumps({"spec": spec}))
PY
)
    local create_err
    if ! create_err=$(databricks postgres create-project "$LAKEBASE_PROJECT_ID" \
                       --json "$create_json" 2>&1); then
      printf "FAILED\n"
      die "Failed to auto-provision Lakebase project '$LAKEBASE_PROJECT_ID'.\n  $create_err\n\nPass --lakebase-project-id ID to pick a different name, or --lakebase-branch + --lakebase-database to bind an existing project."
    fi
    LAKEBASE_AUTOPROVISIONED=true
    ok "created"
  fi

  # Discover branch. Prefer the branch explicitly marked
  # `status.default == true` (Lakebase guarantees exactly one). Fall
  # back to the canonical 'production' name, then to the first entry
  # only as a last resort. This protects against routing the app to a
  # non-production branch (e.g. a developer sandbox) when a project
  # has multiple branches.
  info "Discovering Lakebase branch..."
  local branches_json branch_id
  if ! branches_json=$(databricks postgres list-branches "$project_path" -o json 2>&1); then
    printf "FAILED\n"
    die "Failed to list branches on $project_path.\n  $branches_json"
  fi
  branch_id=$(LB_BRANCHES_JSON="$branches_json" python3 - <<'PY'
import json, os, sys
raw = os.environ.get("LB_BRANCHES_JSON", "")
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)
items = data if isinstance(data, list) else data.get("branches", []) or []

def branch_id_of(b):
    bid = (b.get("status") or {}).get("branch_id")
    if bid:
        return bid
    name = b.get("name", "")
    parts = name.split("/")
    return parts[3] if len(parts) >= 4 else ""

# 1) status.default == true (Lakebase marks exactly one).
for b in items:
    if (b.get("status") or {}).get("default") is True:
        bid = branch_id_of(b)
        if bid:
            print(bid)
            sys.exit(0)
# 2) Canonical 'production' name (or legacy 'main').
for canonical in ("production", "main"):
    for b in items:
        if branch_id_of(b) == canonical:
            print(canonical)
            sys.exit(0)
# 3) Last resort: first entry.
for b in items:
    bid = branch_id_of(b)
    if bid:
        print(bid)
        sys.exit(0)
PY
)
  if [ -z "$branch_id" ]; then
    die "No branch found in Lakebase project '$LAKEBASE_PROJECT_ID'."
  fi
  LAKEBASE_BRANCH="projects/$LAKEBASE_PROJECT_ID/branches/$branch_id"
  ok "$branch_id"

  # Discover or create the default databricks_postgres database.
  info "Discovering Lakebase database..."
  local databases_json db_id
  if ! databases_json=$(databricks postgres list-databases "$LAKEBASE_BRANCH" -o json 2>&1); then
    printf "FAILED\n"
    die "Failed to list databases on $LAKEBASE_BRANCH.\n  $databases_json"
  fi
  db_id=$(LB_DBS_JSON="$databases_json" python3 - <<'PY'
import json, os, sys
raw = os.environ.get("LB_DBS_JSON", "")
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)
items = data if isinstance(data, list) else data.get("databases", []) or []
# Prefer the canonical default; otherwise fall back to whatever's there.
for d in items:
    name = d.get("name", "")
    parts = name.split("/")
    if len(parts) >= 6 and parts[5] == "databricks_postgres":
        print("databricks_postgres")
        sys.exit(0)
for d in items:
    name = d.get("name", "")
    parts = name.split("/")
    if len(parts) >= 6:
        print(parts[5])
        sys.exit(0)
PY
)
  if [ -z "$db_id" ]; then
    info "Creating Lakebase database \"databricks_postgres\"..."
    local create_db_err
    if ! create_db_err=$(databricks postgres create-database \
         "$LAKEBASE_BRANCH" \
         --json '{"spec": {}}' \
         databricks_postgres 2>&1); then
      printf "FAILED\n"
      die "Failed to create database 'databricks_postgres' on $LAKEBASE_BRANCH.\n  $create_db_err"
    fi
    db_id="databricks_postgres"
    ok "created"
  else
    ok "$db_id"
  fi
  LAKEBASE_DATABASE="$LAKEBASE_BRANCH/databases/$db_id"

  resolve_lakebase_endpoint_path "$LAKEBASE_BRANCH"

  # Hard-fail guard: every code path above must populate both LAKEBASE_BRANCH
  # and LAKEBASE_DATABASE. If they're still empty, refuse to proceed rather
  # than silently deploy without a postgres resource (the failure mode that
  # crashed the app on startup with "FATAL: Lakebase resource binding env
  # vars missing").
  if [ -z "$LAKEBASE_BRANCH" ] || [ -z "$LAKEBASE_DATABASE" ]; then
    die "Could not resolve a Lakebase binding for app '$APP_NAME'.
  Pass --lakebase-branch + --lakebase-database explicitly to bind an
  existing project, or unset both flags to let deploy.sh auto-provision."
  fi
}

create_app() {
  printf "\n"
  info "App \"$APP_NAME\"..."

  local existing_state
  existing_state="$(get_app_compute_state)"

  if [ "$existing_state" = "DELETING" ]; then
    printf "WAIT  (currently deleting)\n"
    if ! wait_for_app_absent; then
      die "App is still deleting and could not be recreated yet. Wait a few minutes and retry."
    fi
    info "App \"$APP_NAME\"..."
  fi

  if [ "$existing_state" = "MISSING" ] || [ "$existing_state" = "DELETING" ]; then
    local create_json
    create_json=$(APP_NAME="$APP_NAME" APP_DESC="$APP_DESC" BUDGET_POLICY_ID="$BUDGET_POLICY_ID" python3 -c "
import json, os
body = {
    'name': os.environ['APP_NAME'],
    'description': os.environ['APP_DESC'],
    'user_api_scopes': ['sql','catalog.tables:read','catalog.schemas:read','catalog.catalogs:read','files.files','dashboards.genie'],
}
budget_policy_id = os.environ.get('BUDGET_POLICY_ID', '').strip()
if budget_policy_id:
    body['budget_policy_id'] = budget_policy_id
print(json.dumps(body))
")
    local create_err
    if ! create_err=$(databricks apps create --json "$create_json" --no-compute --no-wait 2>&1); then
      if echo "$create_err" | grep -q "unknown flag.*--no-compute"; then
        if ! create_err=$(databricks apps create --json "$create_json" --no-wait 2>&1); then
          printf "FAILED\n"
          die "Failed to create app.\n  $create_err"
        fi
      else
        printf "FAILED\n"
        die "Failed to create app.\n  $create_err"
      fi
    fi
    ok "created with scopes"
  else
    ok "already exists"
  fi
}

wait_for_stable_state() {
  local state
  state=$(databricks apps get "$APP_NAME" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

  if [ "$state" = "ACTIVE" ] || [ "$state" = "STOPPED" ]; then
    return
  fi

  info "Waiting for compute to stabilise..."
  local attempts=0
  while [ $attempts -lt 30 ]; do
    sleep 10
    state=$(databricks apps get "$APP_NAME" --output json 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")
    if [ "$state" = "ACTIVE" ] || [ "$state" = "STOPPED" ]; then
      ok "$state"
      return
    fi
    attempts=$((attempts + 1))
  done
  ok "proceeding ($state)"
}

configure_app() {
  info "Configuring resources and scopes..."

  local update_json
  update_json=$(WAREHOUSE_ID="$WAREHOUSE_ID" \
    ENDPOINT="$ENDPOINT" FAST_ENDPOINT="$FAST_ENDPOINT" \
    EMBEDDING_ENDPOINT="$EMBEDDING_ENDPOINT" REVIEW_ENDPOINT="$REVIEW_ENDPOINT" \
    REASONING_ENDPOINT_2="$REASONING_ENDPOINT_2" GENERATION_ENDPOINT="$GENERATION_ENDPOINT" \
    SQL_ENDPOINT="$SQL_ENDPOINT" LIGHTWEIGHT_ENDPOINT="$LIGHTWEIGHT_ENDPOINT" \
    BUDGET_POLICY_ID="$BUDGET_POLICY_ID" \
    LAKEBASE_BRANCH="$LAKEBASE_BRANCH" LAKEBASE_DATABASE="$LAKEBASE_DATABASE" \
    python3 -c "
import json, os
resources = [
    {'name': 'sql-warehouse', 'sql_warehouse': {'id': os.environ['WAREHOUSE_ID'], 'permission': 'CAN_USE'}},
    {'name': 'serving-endpoint', 'serving_endpoint': {'name': os.environ['ENDPOINT'], 'permission': 'CAN_QUERY'}},
    {'name': 'serving-endpoint-fast', 'serving_endpoint': {'name': os.environ['FAST_ENDPOINT'], 'permission': 'CAN_QUERY'}},
    {'name': 'serving-endpoint-embedding', 'serving_endpoint': {'name': os.environ['EMBEDDING_ENDPOINT'], 'permission': 'CAN_QUERY'}},
    {'name': 'serving-endpoint-review', 'serving_endpoint': {'name': os.environ['REVIEW_ENDPOINT'], 'permission': 'CAN_QUERY'}},
]
if os.environ.get('REASONING_ENDPOINT_2', ''):
    resources.append({'name': 'serving-endpoint-reasoning-2', 'serving_endpoint': {'name': os.environ['REASONING_ENDPOINT_2'], 'permission': 'CAN_QUERY'}})
if os.environ.get('GENERATION_ENDPOINT', ''):
    resources.append({'name': 'serving-endpoint-generation', 'serving_endpoint': {'name': os.environ['GENERATION_ENDPOINT'], 'permission': 'CAN_QUERY'}})
if os.environ.get('SQL_ENDPOINT', ''):
    resources.append({'name': 'serving-endpoint-sql', 'serving_endpoint': {'name': os.environ['SQL_ENDPOINT'], 'permission': 'CAN_QUERY'}})
if os.environ.get('LIGHTWEIGHT_ENDPOINT', ''):
    resources.append({'name': 'serving-endpoint-lightweight', 'serving_endpoint': {'name': os.environ['LIGHTWEIGHT_ENDPOINT'], 'permission': 'CAN_QUERY'}})
branch = os.environ.get('LAKEBASE_BRANCH', '').strip()
database = os.environ.get('LAKEBASE_DATABASE', '').strip()
if branch and database:
    resources.append({
        'name': 'postgres',
        'postgres': {
            'branch': branch,
            'database': database,
            'permission': 'CAN_CONNECT_AND_CREATE',
        },
    })
body = {'resources': resources, 'user_api_scopes': ['sql','catalog.tables:read','catalog.schemas:read','catalog.catalogs:read','files.files','dashboards.genie']}
budget_policy_id = os.environ.get('BUDGET_POLICY_ID', '').strip()
if budget_policy_id:
    body['budget_policy_id'] = budget_policy_id
print(json.dumps(body))
")

  local update_err
  if ! update_err=$(databricks apps update "$APP_NAME" \
       --json "$update_json" 2>&1); then
    printf "FAILED\n"
    die "Failed to configure app resources and scopes.\n  $update_err"
  fi
  ok
}

# -------------------------------------------------------------------------
# Apply tag assignments to the Databricks App
#
# The Apps create/update API does not expose a "tags" field, so tags are
# applied through the workspace tag-assignments endpoint. The PUT call is
# a full replace of the entity's tags, mirroring how CUSTOM_TAGS_JSON is
# treated for the Lakebase project.
# -------------------------------------------------------------------------
apply_app_tags() {
  if [ -z "$CUSTOM_TAGS_JSON" ]; then
    return
  fi

  info "Tagging app..."

  local tag_body
  tag_body=$(CUSTOM_TAGS_JSON="$CUSTOM_TAGS_JSON" python3 -c "
import json, os
src = json.loads(os.environ['CUSTOM_TAGS_JSON'])
out = [{'tag_key': t['key'], 'tag_value': t['value']} for t in src]
print(json.dumps({'tag_assignments': out}))
")

  local tag_err
  if ! tag_err=$(databricks api put \
       "/api/2.0/tags/tag-assignments/app/${APP_NAME}" \
       --json "$tag_body" 2>&1); then
    warn "Failed to apply app tags (continuing)."
    printf "  %s\n" "$tag_err"
    return
  fi

  local tag_count
  tag_count=$(echo "$CUSTOM_TAGS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
  ok "${tag_count} tags"
}

# -------------------------------------------------------------------------
# Step 5: Upload source code (or zero-egress package)
# -------------------------------------------------------------------------
upload_code() {
  WORKSPACE_PATH="/Workspace/Users/${USER_EMAIL}/${APP_NAME}"

  # Defensive cleanup: prior versions of .databricksignore did not exclude
  # .git/, so existing deployments may have a stale (and over-10MB)
  # .git directory mirrored into the workspace. Remove it best-effort
  # before sync so `databricks apps deploy` does not choke on pack files.
  # Silent on failure (no .git present = success).
  databricks workspace delete "$WORKSPACE_PATH/.git" --recursive >/dev/null 2>&1 || true

  local sync_source="."
  local sync_flags=""
  local sync_label="diff"

  if [ "$ARG_ZERO_EGRESS" = "true" ]; then
    info "Uploading zero-egress package..."
    # A prior source deployment may have left package.json and the rest of the
    # application tree at this path. RAW imports only overwrite matching files,
    # so replace the workspace directory before uploading the wrapper package.
    local cleanup_err
    if ! cleanup_err=$(databricks workspace delete "$WORKSPACE_PATH" --recursive 2>&1); then
      case "$cleanup_err" in
        *RESOURCE_DOES_NOT_EXIST*) ;;
        *) die "Failed to clear stale workspace source before zero-egress upload: $cleanup_err" ;;
      esac
    fi
    # Upload each file individually via workspace import (RAW format).
    # databricks sync respects .gitignore/.databricksignore from the CWD
    # which excludes .deploy-pkg-ze/ and silently uploads nothing.
    # workspace import --format RAW bypasses all ignore-file logic and
    # treats every file as a raw binary, avoiding notebook interpretation.
    if ! databricks workspace mkdirs "$WORKSPACE_PATH" >/dev/null 2>&1; then
      die "Failed to recreate workspace path for zero-egress upload"
    fi
    local ze_count=0
    for f in "$DEPLOY_WRAPPER"/* "$DEPLOY_WRAPPER"/.*; do
      [ -f "$f" ] || continue
      local fname
      fname=$(basename "$f")
      case "$fname" in .|..) continue ;; esac
      if ! databricks workspace import "$WORKSPACE_PATH/$fname" \
             --file "$f" --format RAW --overwrite 2>/dev/null; then
        die "Failed to upload $fname"
      fi
      ze_count=$((ze_count + 1))
    done
    ok "${ze_count} files"
    return
  elif [ "$ARG_FULL_SYNC" = "true" ]; then
    # Explicit --full: clear snapshots and do a complete upload
    rm -rf .databricks/sync-snapshots 2>/dev/null || true
    sync_flags="--full"
    sync_label="full"
    if [ -f ".databricksignore" ]; then
      sync_flags="--full --exclude-from .databricksignore"
    fi
    info "Uploading source code (full sync)..."
  else
    # Default: diff sync — only changed files since last deploy
    if [ -f ".databricksignore" ]; then
      sync_flags="--exclude-from .databricksignore"
    fi
    info "Uploading source code (diff sync — only changed files)..."
  fi

  if ! databricks sync $sync_flags "$sync_source" "$WORKSPACE_PATH"; then
    if [ "$sync_label" = "diff" ]; then
      warn "Diff sync failed. Retrying with full sync..."
      rm -rf .databricks/sync-snapshots 2>/dev/null || true
      sync_flags="--full"
      if [ -f ".databricksignore" ]; then
        sync_flags="--full --exclude-from .databricksignore"
      fi
      if ! databricks sync $sync_flags "$sync_source" "$WORKSPACE_PATH"; then
        die "Full sync also failed.\n  Try manually: databricks sync $sync_flags $sync_source $WORKSPACE_PATH"
      fi
    else
      die "Failed to upload code.\n  Try manually: databricks sync $sync_flags $sync_source $WORKSPACE_PATH"
    fi
  fi
  ok
}

# -------------------------------------------------------------------------
# Step 6: Start compute (must be active before deploying)
# -------------------------------------------------------------------------
start_compute() {
  info "App compute..."

  local state
  state=$(databricks apps get "$APP_NAME" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

  if [ "$state" = "ACTIVE" ]; then
    ok "already running"
    return
  fi

  databricks apps start "$APP_NAME" --no-wait &>/dev/null || true
  printf "starting"

  local attempts=0
  while [ $attempts -lt 30 ]; do
    sleep 10
    state=$(databricks apps get "$APP_NAME" --output json 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")
    if [ "$state" = "ACTIVE" ]; then
      printf "\r  %-48s" "App compute..."
      ok "running"
      return
    fi
    printf "."
    attempts=$((attempts + 1))
  done

  printf "\r  %-48s" "App compute..."
  printf "TIMEOUT\n"
  die "Compute did not start within 5 minutes.\n  Check the Databricks Apps UI for details."
}

# -------------------------------------------------------------------------
# Step 7: Deploy
# -------------------------------------------------------------------------
wait_for_deployment_readiness() {
  local deployment_id="$1"
  local max_attempts="${DEPLOY_READINESS_MAX_ATTEMPTS:-60}"
  local poll_seconds="${DEPLOY_READINESS_POLL_SECONDS:-10}"
  local attempts=0
  local deployment_state="UNKNOWN"
  local active_deployment_id=""
  local active_deployment_state="UNKNOWN"
  local app_state="UNKNOWN"
  local deployment_json=""
  local app_json=""

  info "Waiting for deployment $deployment_id to become RUNNING..."
  while [ "$attempts" -lt "$max_attempts" ]; do
    deployment_json="$(databricks apps get-deployment \
      "$APP_NAME" "$deployment_id" --output json 2>/dev/null || true)"
    if [ -n "$deployment_json" ]; then
      deployment_state="$(printf '%s' "$deployment_json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
status = data.get("status", "UNKNOWN")
print(status.get("state", "UNKNOWN") if isinstance(status, dict) else status)
' 2>/dev/null || echo "UNKNOWN")"
    fi

    app_json="$(databricks apps get "$APP_NAME" --output json 2>/dev/null || true)"
    if [ -n "$app_json" ]; then
      active_deployment_id="$(printf '%s' "$app_json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
active = data.get("active_deployment") or {}
print(active.get("deployment_id") or active.get("deploymentId") or "")
' 2>/dev/null || true)"
      active_deployment_state="$(printf '%s' "$app_json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
active = data.get("active_deployment") or {}
status = active.get("status", "UNKNOWN")
print(status.get("state", "UNKNOWN") if isinstance(status, dict) else status)
' 2>/dev/null || echo "UNKNOWN")"
      app_state="$(printf '%s' "$app_json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
status = data.get("app_status", "UNKNOWN")
print(status.get("state", "UNKNOWN") if isinstance(status, dict) else status)
' 2>/dev/null || echo "UNKNOWN")"
    fi

    case "$deployment_state" in
      FAILED|CANCELLED|CANCELED)
        printf "FAILED\n"
        die "Deployment $deployment_id entered terminal state $deployment_state.
  View logs: databricks apps logs $APP_NAME --follow"
        ;;
    esac
    if [ "$active_deployment_id" = "$deployment_id" ]; then
      case "$app_state" in
        CRASHED|UNAVAILABLE|FAILED)
          printf "FAILED\n"
          die "Deployment $deployment_id reached app_status $app_state.
  View logs: databricks apps logs $APP_NAME --follow"
          ;;
      esac
    fi

    if [ "$deployment_state" = "SUCCEEDED" ] \
      && [ "$active_deployment_id" = "$deployment_id" ] \
      && [ "$active_deployment_state" = "SUCCEEDED" ] \
      && [ "$app_state" = "RUNNING" ]; then
      ok "deployment $deployment_id running"
      return 0
    fi

    attempts=$((attempts + 1))
    if [ "$attempts" -lt "$max_attempts" ]; then
      sleep "$poll_seconds"
    fi
  done

  printf "TIMEOUT\n"
  die "Deployment $deployment_id timed out after $max_attempts readiness checks.
  Last deployment status: $deployment_state
  Last active deployment: ${active_deployment_id:-none} ($active_deployment_state)
  Last app_status: $app_state
  View logs: databricks apps logs $APP_NAME --follow"
}

deploy_app() {
  info "Deploying..."

  local deploy_output
  if ! deploy_output=$(databricks apps deploy "$APP_NAME" \
       --source-code-path "$WORKSPACE_PATH" --mode SNAPSHOT \
       --no-wait --output json 2>&1); then
    printf "FAILED\n"
    die "Deployment failed.\n  $deploy_output"
  fi
  local deployment_id
  deployment_id="$(printf '%s' "$deploy_output" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("deployment_id") or data.get("deploymentId") or data.get("id") or "")
' 2>/dev/null || true)"
  if [ -z "$deployment_id" ]; then
    printf "FAILED\n"
    die "Deployment started but the CLI returned no deployment ID.
  Response: $deploy_output"
  fi
  wait_for_deployment_readiness "$deployment_id"
}

# -------------------------------------------------------------------------
# Print success banner
# -------------------------------------------------------------------------
print_success() {
  local app_url="${DATABRICKS_HOST}/apps/${APP_NAME}"

  printf "\n"
  printf "  ==========================================================\n"
  printf "    Databricks Forge is live!\n"
  printf "    URL: %s\n" "$app_url"
  printf "\n"
  printf "    App name:     %s\n" "$APP_NAME"
  printf "    Deploy mode:  %s\n" "$( [ "$ARG_ZERO_EGRESS" = "true" ] && echo "zero-egress (split archive)" || echo "source (remote build)" )"
  printf "\n"
  printf "    Resources:\n"
  printf "      SQL Warehouse:    %s\n" "$WAREHOUSE_NAME"
  printf "      Premium model:    %s\n" "$ENDPOINT"
  printf "      Fast model:       %s\n" "$FAST_ENDPOINT"
  printf "      Embedding model:  %s\n" "$EMBEDDING_ENDPOINT"
  printf "      Review model:     %s\n" "$REVIEW_ENDPOINT"
  if [ -n "$REASONING_ENDPOINT_2" ]; then
    printf "      Reasoning 2:      %s\n" "$REASONING_ENDPOINT_2"
  fi
  if [ -n "$GENERATION_ENDPOINT" ]; then
    printf "      Generation:       %s\n" "$GENERATION_ENDPOINT"
  fi
  if [ -n "$SQL_ENDPOINT" ]; then
    printf "      SQL/Codex:        %s\n" "$SQL_ENDPOINT"
  fi
  if [ -n "$LIGHTWEIGHT_ENDPOINT" ]; then
    printf "      Lightweight:      %s\n" "$LIGHTWEIGHT_ENDPOINT"
  fi
  if [ -n "$ALLOWED_MODELS" ]; then
    printf "      Allowed models:   %s\n" "$ALLOWED_MODELS"
  fi
  if [ -n "$LAKEBASE_BOOTSTRAP_USER" ]; then
    printf "      Bootstrap user:   %s\n" "$LAKEBASE_BOOTSTRAP_USER"
  fi
  # Postgres binding: always populated by resolve_lakebase_binding (the
  # hard-fail guard there prevents reaching this banner with empty values).
  printf "      Postgres branch:  %s\n" "$LAKEBASE_BRANCH"
  printf "      Postgres database:%s\n" " $LAKEBASE_DATABASE"
  if [ -n "$LAKEBASE_ENDPOINT_NAME" ]; then
    printf "      Postgres endpoint:%s\n" " $LAKEBASE_ENDPOINT_NAME"
  fi
  if [ "$LAKEBASE_AUTOPROVISIONED" = "true" ]; then
    printf "      Auto-provisioned project: %s (created on this run)\n" "$LAKEBASE_PROJECT_ID"
  fi
  printf "      Seed benchmarks:  %s\n" "$( [ "$SEED_BENCHMARKS" = "true" ] && echo "enabled" || echo "disabled" )"
  printf "      Seed all industries: %s\n" "$( [ "$SEED_BENCHMARKS_ALL_INDUSTRIES" = "true" ] && echo "enabled" || echo "disabled" )"
  printf "      Seed industry filter: %s\n" "${SEED_BENCHMARK_INDUSTRIES:-none}"
  printf "      Metric views:     %s\n" "$( [ "$ENABLE_METRIC_VIEWS" = "true" ] && echo "enabled" || echo "disabled" )"
  printf "      Fabric / PBI:    %s\n" "$( [ "$ENABLE_FABRIC" = "true" ] && echo "enabled" || echo "disabled" )"
  printf "      Demo mode:       %s\n" "$( [ "$ENABLE_DEMO_MODE" = "true" ] && echo "enabled" || echo "disabled" )"
  printf "      Benchmark admins: %s\n" "${BENCHMARK_ADMINS:-all authenticated users}"
  printf "      Budget policy:    %s\n" "${BUDGET_POLICY_ID:-none}"
  if [ -n "$CUSTOM_TAGS_JSON" ]; then
    printf "      Custom tags:      %s\n" "$CUSTOM_TAGS_JSON"
  else
    printf "      Custom tags:      none\n"
  fi
  printf "\n"
  printf "    User scopes:\n"
  printf "      sql, catalog.tables:read, catalog.schemas:read,\n"
  printf "      catalog.catalogs:read, files.files, dashboards.genie\n"
  printf "  ==========================================================\n"
  printf "\n"
}

# -------------------------------------------------------------------------
# Destroy
# -------------------------------------------------------------------------
destroy() {
  printf "\n  Removing Databricks Forge...\n"

  info "Stopping app..."
  local stop_err
  if ! stop_err=$(databricks apps stop "$APP_NAME" --no-wait 2>&1); then
    case "$stop_err" in
      *"does not exist"*|*"RESOURCE_DOES_NOT_EXIST"*|*"not found"*)
        ok "already stopped"
        ;;
      *)
        ok "stop skipped"
        ;;
    esac
  else
    ok
  fi

  info "Deleting app..."
  local delete_err delete_attempt=0 delete_max=24 delete_sleep=60
  while :; do
    delete_attempt=$((delete_attempt + 1))
    if delete_err=$(databricks apps delete "$APP_NAME" 2>&1); then
      ok "delete requested"
      break
    fi
    case "$delete_err" in
      *"does not exist"*|*"RESOURCE_DOES_NOT_EXIST"*|*"not found"*)
        # App was deleted out-of-band (Databricks UI, prior aborted run,
        # teammate, etc.). DO NOT return — workspace files and the
        # Lakebase project still need cleanup, especially when
        # --destroy-database is set. Fall through to the post-loop
        # cleanup phase via break.
        ok "already deleted"
        break
        ;;
      *"state DELETING"*)
        # Delete really IS in flight server-side — proceed to wait_for_app_absent.
        ok "already deleting"
        break
        ;;
      *"updated less than 20 minutes ago"*|*"pending deployment in progress"*|*"pending update"*)
        # Transient Databricks Apps 20-min lock after a recent update/deploy.
        # The delete has NOT been accepted yet. Retry on a 60s cadence,
        # capped at 24 attempts (24 minutes) so we cover the worst-case
        # full 20-min lock plus a buffer.
        if [ "$delete_attempt" -ge "$delete_max" ]; then
          printf "FAILED\n"
          die "App is still locked by a recent deployment after $((delete_max * delete_sleep / 60))min of retries.\n  $delete_err"
        fi
        if [ "$delete_attempt" -eq 1 ]; then
          printf "\n  Databricks Apps is locked for ~20min after a recent deployment.\n  Retrying delete every %ds (up to %d min)...\n" "$delete_sleep" "$((delete_max * delete_sleep / 60))" >&2
        else
          printf "  retry %d/%d (waiting %ds for lock to clear)\n" "$delete_attempt" "$delete_max" "$delete_sleep" >&2
        fi
        sleep "$delete_sleep"
        ;;
      *)
        printf "FAILED\n"
        die "Failed to delete app.\n  $delete_err"
        ;;
    esac
  done

  if [ "$(get_app_compute_state)" != "MISSING" ]; then
    if ! wait_for_app_absent; then
      die "Delete requested but app still exists after waiting. Retry destroy in a few minutes."
    fi
  fi

  WORKSPACE_PATH="/Workspace/Users/${USER_EMAIL}/${APP_NAME}"
  info "Cleaning workspace files..."
  if databricks workspace delete --recursive "$WORKSPACE_PATH" 2>/dev/null; then ok; else ok "already clean"; fi

  destroy_lakebase_project

  printf "\n  App removed successfully.\n\n"
}

# -------------------------------------------------------------------------
# Optional: delete the auto-provisioned Lakebase project alongside the app.
# Default behaviour is to PRESERVE the project (data > convenience). The
# operator can opt into deletion via the prompt or non-interactive flags:
#   --destroy-database  → soft delete (recoverable)
#   --purge-database    → hard delete (immediate, unrecoverable)
#   --keep-database     → skip the prompt, preserve
# -------------------------------------------------------------------------
destroy_lakebase_project() {
  # Resolve the project ID the same way resolve_lakebase_binding() does:
  # explicit --lakebase-project-id wins, otherwise derive from app name.
  local project_id="${LAKEBASE_PROJECT_ID:-}"
  if [ -z "$project_id" ]; then
    project_id=$(sanitize_lakebase_project_id "$APP_NAME")
  fi
  local project_path="projects/$project_id"

  # If the exact-name project doesn't exist, look for projects that were
  # auto-provisioned with a uniqueness suffix (e.g. `forge-demo-69aa11f1`).
  # The Lakebase auto-provision picks `<app>-<8 hex>` when the bare name
  # is taken, so a destroy that derives the bare name would otherwise
  # leave the suffixed project orphaned.
  local project_json
  if ! project_json=$(databricks postgres get-project "$project_path" -o json 2>/dev/null); then
    local candidates
    candidates=$(databricks postgres list-projects -o json 2>/dev/null | python3 -c "
import json, re, sys
try:
    projects = json.load(sys.stdin) or []
except Exception:
    sys.exit(0)
prefix = sys.argv[1] + '-'
pat = re.compile(r'^' + re.escape(sys.argv[1]) + r'-[0-9a-f]{8}$')
for p in projects:
    name = p.get('name') or ''
    if pat.match(name):
        print(name)
" "$project_id" 2>/dev/null || true)
    if [ -z "$candidates" ]; then
      return
    fi
    local match_count
    match_count=$(printf "%s\n" "$candidates" | wc -l | tr -d ' ')
    if [ "$match_count" -gt 1 ]; then
      warn "Multiple suffixed Lakebase projects matched '$project_id-*':
$(printf "    %s\n" "$candidates" | sed -e "s/^/    /")
  Skipping deletion. Re-run with --lakebase-project-id <name> to pick one."
      return
    fi
    project_id=$(printf "%s\n" "$candidates" | head -1)
    project_path="projects/$project_id"
    info "Lakebase project (auto-discovered)..."
    ok "$project_id (suffixed)"
    project_json=$(databricks postgres get-project "$project_path" -o json 2>/dev/null) || return
  fi

  local should_delete=false
  if [ "$KEEP_DATABASE" = "true" ]; then
    printf "\n  Lakebase project '%s' preserved (--keep-database).\n" "$project_id"
    return
  elif [ "$DESTROY_DATABASE" = "true" ]; then
    should_delete=true
  else
    # Interactive prompt. Default to N (preserve).
    printf "\n  Lakebase project still exists:\n"
    printf "    Project:   %s\n" "$project_path"
    printf "    Database:  databricks_postgres\n"
    if [ -n "$LAKEBASE_ENDPOINT_PATH" ]; then
      printf "    Endpoint:  %s\n" "$LAKEBASE_ENDPOINT_PATH"
    fi
    printf "  This contains ALL Forge data (runs, scans, embeddings, demo sessions, etc).\n"
    printf "  Delete the project? [y/N]: "
    local answer=""
    # 60s timeout. If non-interactive (no TTY), default to N.
    if [ -t 0 ]; then
      if ! IFS= read -r -t 60 answer; then
        printf "\n  (no answer — keeping Lakebase project)\n"
        return
      fi
    else
      printf "\n  (non-interactive — keeping Lakebase project; pass --destroy-database or --keep-database to silence this)\n"
      return
    fi
    case "$answer" in
      y|Y|yes|YES) should_delete=true ;;
      *) printf "  Lakebase project preserved.\n"; return ;;
    esac
  fi

  if [ "$should_delete" != "true" ]; then
    return
  fi

  local delete_args=("$project_path")
  local delete_kind="soft"
  if [ "$PURGE_DATABASE" = "true" ]; then
    delete_args+=("--purge")
    delete_kind="hard / immediate"
  fi

  info "Deleting Lakebase project ($delete_kind)..."
  local delete_err manual_purge_flag=""
  if [ "$PURGE_DATABASE" = "true" ]; then
    manual_purge_flag=" --purge"
  fi
  if ! delete_err=$(databricks postgres delete-project "${delete_args[@]}" 2>&1); then
    printf "FAILED\n"
    warn "Failed to delete Lakebase project '$project_id'.
  $delete_err
  Delete manually with:
    databricks postgres delete-project ${project_path}${manual_purge_flag}"
    return
  fi
  ok "$delete_kind"
}

# -------------------------------------------------------------------------
# Main
# -------------------------------------------------------------------------
main() {
  install_app_yaml_restore_traps

  printf "\n"
  printf "  Databricks Forge -- Deployment\n"
  printf "  ==================================\n"

  check_prerequisites

  if [ "$ARG_DESTROY" = true ]; then
    destroy
    exit 0
  fi

  build_custom_tags_json
  probe_and_resolve_endpoints
  select_warehouse
  create_app
  wait_for_stable_state
  resolve_lakebase_binding
  wait_for_endpoint_active
  configure_lakebase_scale_to_zero
  configure_app
  apply_app_tags
  bootstrap_lakebase_sp_grants
  default_bootstrap_user
  prepare_app_yaml

  if [ "$ARG_ZERO_EGRESS" = "true" ]; then
    assemble_zero_egress
    # Patch app.yaml command from scripts/start.sh to bootstrap.sh
    python3 -c "
from pathlib import Path
text = Path('app.yaml').read_text()
text = text.replace('scripts/start.sh', 'bootstrap.sh')
Path('app.yaml').write_text(text)
"
    cp app.yaml "$DEPLOY_WRAPPER/app.yaml"
  fi

  upload_code
  start_compute
  deploy_app
  print_success
}

main
