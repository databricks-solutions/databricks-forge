# Quick Start

Deploy Databricks Forge to your workspace, verify it, and complete first-run
setup.

## Before you begin

Forge deploys a Databricks App and an isolated Lakebase Autoscaling project.
It also binds a SQL warehouse and Databricks Model Serving endpoints. A normal
first deployment takes approximately five minutes; service availability varies
by cloud and region.

Forge is a community-maintained Field Engineering accelerator. It is not an
official Databricks product and is not covered by Databricks Support. See
[Support](https://github.com/databricks-solutions/databricks-forge/blob/main/SUPPORT.md).

## Check prerequisites

You need:

- A Databricks workspace with Unity Catalog enabled
- A running Serverless or Pro SQL warehouse
- Permission to create or manage Databricks Apps
- Permission to create Lakebase Autoscaling projects, or an existing Lakebase
  branch and database you can bind
- Permission to use the selected SQL warehouse
- Access to at least one supported Databricks Model Serving model
- Node.js 20.9 or later
- Python 3
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/install.html)
  0.205 or later

Install the CLI on macOS:

```bash
brew install databricks
```

Or use the official installer:

```bash
curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh
```

Confirm the local tools:

```bash
node --version
python3 --version
databricks version
```

The recommended user-authorization path requires **Databricks Apps -
On-Behalf-Of User Authorization** in the workspace preview settings. The deploy
script configures the required application scopes.

## Clone and authenticate

```bash
git clone https://github.com/databricks-solutions/databricks-forge.git
cd databricks-forge
databricks auth login --host https://your-workspace.cloud.databricks.com
databricks current-user me
```

For a named CLI profile:

```bash
databricks auth login \
  --host https://your-workspace.cloud.databricks.com \
  --profile forge
```

## Deploy

Run the guided deployment:

```bash
./deploy.sh
```

The script:

1. Checks CLI authentication.
2. Lists available SQL warehouses and asks you to choose one.
3. Probes supported model endpoints and selects available defaults.
4. Creates or updates the `databricks-forge` Databricks App.
5. Creates an isolated Lakebase project on first deployment.
6. Installs required database extensions and grants the app service principal.
7. Binds resources, configures user scopes, uploads the source, and deploys.

To avoid the warehouse prompt:

```bash
./deploy.sh --warehouse "Serverless Starter Warehouse"
```

To use a named profile:

```bash
./deploy.sh --profile forge
```

To run a second isolated instance:

```bash
./deploy.sh --app-name forge-demo
```

For all deployment, model, Lakebase, cost-governance, and zero-egress options,
see [Deployment and Operations](DEPLOYMENT.md).

## Verify the deployment

Open the app URL printed by `deploy.sh`. You should see the Forge home page.

Verify the health endpoint:

```bash
APP_URL=$(databricks apps get databricks-forge --output json | jq -r '.url')
curl -fsS "$APP_URL/api/health" | jq .
```

A healthy response reports:

```json
{
  "status": "healthy",
  "warehouse": "connected",
  "database": "connected"
}
```

If you used a custom `--app-name`, replace `databricks-forge` in the command.

View startup and runtime logs:

```bash
databricks apps logs databricks-forge --follow
```

## First-run checklist

1. Open **Settings** and review feature flags, model routing, and AI output
   language.
2. Confirm the signed-in user can browse the intended Unity Catalog catalogs
   and schemas.
3. Run a small discovery against one schema before scanning a large estate.
4. Keep Demo Mode disabled unless the workspace is specifically used for
   synthetic demonstrations.
5. Review
   [Security Architecture](https://github.com/databricks-solutions/databricks-forge/blob/main/SECURITY_ARCHITECTURE.md)
   before enabling optional data sampling or sharing the app broadly.

Users need the Unity Catalog permissions required for the metadata they select,
including `USE CATALOG`, `USE SCHEMA`, and relevant metadata/table access.
Lineage features additionally require access to `system.access.table_lineage`.

## Update Forge

Pull the latest organization-hosted release and rerun the same deploy command:

```bash
git switch main
git pull --ff-only
./deploy.sh
```

The script detects the existing app and Lakebase binding. Startup runs the
database preflight and applies safe additive schema changes before serving
traffic.

If an update fails, inspect app logs and redeploy the last known-good Git tag:

```bash
git fetch --tags
git switch --detach v1.0.4
./deploy.sh
```

Return to current development with:

```bash
git switch main
```

## Remove Forge safely

Remove the app:

```bash
./deploy.sh --destroy
```

The script then asks whether to remove the associated Lakebase project. The
default is **keep**, preserving application data.

For non-interactive cleanup:

```bash
# Remove the app and preserve Lakebase data.
./deploy.sh --destroy --keep-database

# Remove the app and soft-delete the Lakebase project.
./deploy.sh --destroy --destroy-database
```

`--purge-database` permanently deletes the Lakebase project and is
irreversible. Use it only after independently confirming that no data must be
retained.

## Troubleshooting

### Authentication fails

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
databricks current-user me
```

If you use multiple workspaces, pass `--profile` consistently.

### No warehouse appears

Confirm a Serverless or Pro warehouse exists and that your user can view and
use it:

```bash
databricks warehouses list
```

### Lakebase creation is denied

Your user must be able to create Lakebase Autoscaling projects. If Lakebase is
not available in the workspace region, bind an existing supported project with
`--lakebase-branch` and `--lakebase-database`, or use the documented local
development path.

### A preferred model is unavailable

The deploy script probes endpoints and falls back by role. Specify a model
explicitly only when it is available in your cloud and region:

```bash
./deploy.sh --endpoint "available-model-name"
```

### The app starts but health is degraded

Inspect:

```bash
databricks apps logs databricks-forge --follow
databricks warehouses get <warehouse-id>
```

Check warehouse access, Lakebase startup, resource bindings, and model endpoint
availability in the logs.

### Local development

For local development or zero-egress environments, follow
[Local Development](DEPLOYMENT.md#local-development). The setup uses your
Databricks CLI OAuth session and writes `.env.local`; do not commit that file.

## Next steps

- Follow the [User Guide](USER_GUIDE.md).
- Understand the [Architecture](ARCHITECTURE.md).
- Review the
  [Security Architecture](https://github.com/databricks-solutions/databricks-forge/blob/main/SECURITY_ARCHITECTURE.md).
- Learn how the [engines](ENGINES.md) work.
- Read
  [Support](https://github.com/databricks-solutions/databricks-forge/blob/main/SUPPORT.md)
  before opening an issue.
