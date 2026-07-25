# Metric View Engine

> Subdomain-level metric view generation, validation, and deployment.

## Overview

The Metric View Engine generates Databricks Unity Catalog
[metric views](https://docs.databricks.com/en/sql/language-manual/sql-ref-syntax-ddl-create-metric-view.html)
(YAML v1.1) from pipeline results. It discovers existing metric views in scope,
classifies them as reuse/improve/new, generates proposals with multi-table joins,
validates against the schema allowlist, and deploys via DDL execution.

The engine is **enabled by default**.  Set `FORGE_METRIC_VIEWS_ENABLED=false`
to explicitly disable it.

Release 2 adds a typed source-of-truth behind
`FORGE_TYPED_METRIC_VIEW_MODEL` (default `false`). When disabled, generation
uses the Release 1 YAML path; canonical parsing, runtime probes, validation
provenance, and deployment gates still run. Rows containing only legacy
YAML/DDL remain readable through the compatibility adapter.

---

## Architecture

```
Discovery                    Planning                   Generation
discoverExisting ──►  LLM classify per subdomain ──►  LLM generate YAML v1.1
  MetricViews()        (reuse / improve / new)           proposals
                                                            │
                                                            ▼
                                                     Post-processing
                                                     ├── Strip FQN prefixes
                                                     ├── Nest snowflake joins
                                                     ├── Qualify nested alias refs
                                                     ├── Auto-fix collisions
                                                     ▼
                                                     Validation
                                                     ├── Schema allowlist
                                                     ├── Column references
                                                     ├── Dry-run DDL (temp view)
                                                     ├── Optional LLM repair
                                                     ▼
                                                     Persistence + Deploy
```

---

## Engine Flow

### Phase 1: Discovery

`discoverExistingMetricViews(scope)` in `lib/metric-views/discovery.ts`:

1. Queries `information_schema` for tables with `table_type = 'METRIC_VIEW'`
2. Runs `SHOW CREATE TABLE` per metric view to extract the YAML body
3. Parses YAML to extract dimensions, measures, join targets, and source table
4. Returns `ExistingMetricViewDetail[]`

`filterRelevantExistingViews()` narrows the list to views whose source tables
overlap with the current scope.

### Phase 2: Planning (Engine V2)

`runMetricViewEngineV2()` in `lib/metric-views/engine.ts`:

1. Groups use cases by subdomain via `mapSubdomainsToTables()`
2. Runs a planning pre-pass where the LLM classifies each subdomain's needs:
   - **reuse** -- existing metric view is sufficient
   - **improve** -- existing view needs enhancement
   - **new** -- no existing view covers this subdomain
3. Generates proposals per subdomain
4. Merges all proposals into the output

The typed IR is `MetricViewDefinition` in
`lib/metric-views/definition.ts`. `parseMetricViewYaml()` and
`serializeMetricViewYaml()` form its canonical boundary.
`lib/metric-views/capabilities.ts` validates YAML capability versions and
required features; the supported source format is metric-view YAML `1.1`.
`lib/metric-views/legacy-adapter.ts` converts old proposal text into the IR and
renders IR back to compatibility YAML/DDL.

### Phase 3: Generation

`runMetricViewProposals()` in `lib/genie/passes/metric-view-proposals.ts`:

1. Builds schema and column context from metadata
2. LLM generates 1-3 proposals per domain (YAML v1.1 format)
3. Post-processing pipeline:
   - Strip FQN prefixes from SQL
   - Nest snowflake joins (detect and restructure flat joins)
   - Qualify nested alias references
4. Auto-fix pass:
   - Rename shadowed measures, dimensions, join aliases
   - Fix materialization references
5. Validate against schema allowlist and column references
6. LLM repair for remaining column/alias errors
7. Create a uniquely named temporary metric view in the target schema
8. Probe representative measures with `MEASURE()`
9. Drop the temporary view in `finally`, including failed probes
10. Persist compact validation evidence and validator version
11. Optional SQL review when `isReviewEnabled("genie-metric-views")`

### Phase 4: Deployment

Proposals can be deployed individually or in batch:

Only proposals with `validationStatus: "valid"` and complete Release 1
provenance are deployable. Provenance must use `metric-view-probes-v1`, include
a parseable validation timestamp, and contain the stable passed
static/create/atomic-measure-probe/cleanup lifecycle codes. `unverified`,
warning/error, legacy, incomplete, skipped/failed, and evidence-free proposals
fail closed.

The legacy `dryRunMetricViewDdl` compatibility wrapper remains fail-closed for
cleanup. A failed temporary-view `DROP` returns a non-null error beginning with
`Failed to drop temp validation view`; callers must not assume every non-null
result means temporary-view creation failed.

1. `sanitizeMetricViewDdl()` rewrites DDL for the target schema
2. Execute `CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML AS $$...$$`
3. Update deployment status in Lakebase
4. `patchSpaceWithMetricViews()` adds deployed FQNs to the Genie Space's
   `data_sources.metric_views`

`improve` is an in-place typed update, not a create with a new label. The
proposal stores the exact existing FQN, typed base definition, additive diff,
and merged definition fingerprint. Deployment requires an OBO token, reads the
live definition immediately before `ALTER VIEW`, rejects drift with `409`, and
never falls back to creating a duplicate. `reuse` performs no mutation.

### Semantic asset manifest

After metric-view validation, `lib/semantic-assets/manifest.ts` builds a
version `1` per-domain `SemanticAssetManifest` containing verified metric-view
assets plus governed Genie measures, dimensions, and filters. Each metric-view
asset records FQN, proposal identity, validation/deployment state, typed
measures and dimensions, representative `MEASURE()` queries, and source tables.
The manifest is persisted in the existing Genie recommendation/pass-output
JSON; Release 2 adds no manifest table.

The dependency chain is:

`SQL generation → Genie semantic generation/metric validation → manifest persistence → Dashboard generation`

Business Value remains parallel. Dashboard does not start after a failed,
cancelled, empty, or incompletely persisted semantic stage.

---

## Metric View Proposal Shape

```typescript
interface MetricViewProposal {
  name: string;                    // snake_case identifier
  description: string;
  definition?: MetricViewDefinition; // typed canonical model
  yaml: string;                    // YAML body (version 1.1)
  ddl: string;                     // Full CREATE OR REPLACE VIEW DDL
  sourceTables: string[];
  hasJoins: boolean;
  hasFilteredMeasures: boolean;
  hasWindowMeasures: boolean;
  hasMaterialization: boolean;
  validationStatus: "valid" | "warning" | "error" | "unverified";
  validationIssues: string[];
  validatorVersion?: string;
  validationEvidence?: ValidationEvidence[];
  validatedAt?: string;
  classification?: "reuse" | "improve" | "new";
  rationale?: string;
  existingFqn?: string;            // For reuse/improve
  improveDiff?: MetricViewImproveDiff;
  improveBaseDefinition?: MetricViewDefinition;
  subdomain?: string;
}
```

YAML v1.1 supports: `version`, `source`, `filter`, `dimensions`, `measures`,
`joins` (star and snowflake patterns), and optional `materialization`.

---

## Genie Engine Integration

The Metric View Engine runs as a parallel pass within the Genie Engine when
`isMetricViewsEnabled()` and `config.generateMetricViews` are both true:

1. `discoverExistingMetricViews()` for the schema scope
2. `runMetricViewEngineV2()` with measures, dimensions, and joins from earlier
   Genie passes (column intelligence, semantic expressions)
3. `saveMetricViewProposals()` persists proposals to Lakebase
4. The Genie assembler converts proposals to `DataSourceMetricView[]` and adds
   them to `data_sources.metric_views` in the serialized space (capped at ~30%
   of `MAX_DATA_OBJECTS`)

### Dependency Management

Before deploying a Genie Space that references metric views:

- `checkMetricViewDependencies(fqns, access)` identifies which are deployed vs
  missing; proposal lookup is always restricted to the authenticated caller's
  owned/shared proposal IDs, including explicit-FQN checks
- `ensureMetricViewsDeployed(fqns, access, targetSchema)` auto-deploys missing
  proposals using the authenticated owner/shared proposal scope
- `extractMetricViewFqnsFromSpace()` extracts FQNs from the serialized space
- `rewriteDashboardMetricViewFqns()` handles FQN rewrites when target schema differs

---

## Lightweight Seed

`buildLightweightSeed()` in `lib/metric-views/seed.ts` provides a deterministic
fallback when LLM generation is not available:

- Numeric columns -> SUM/AVG measures
- Date columns -> DATE_TRUNC dimensions
- String columns -> categorical dimensions
- Adds a `row_count` measure

---

## Feature Gates

| Setting | Source | Default |
|---------|--------|---------|
| `FORGE_METRIC_VIEWS_ENABLED` | `deploy.sh --enable-metric-views` | `true` |
| `FORGE_TYPED_METRIC_VIEW_MODEL` | Environment | `false` |
| `GenieEngineConfig.generateMetricViews` | Per-run Genie config | `true` (when feature enabled) |
| `/api/health` | Health endpoint | Reports `metricViewsEnabled` |

The pure rollout helpers live in `lib/config/semantic-uplift-flags.ts`.
Disabling the typed flag changes only the generation source-of-truth; it never
bypasses Release 1 parsing, temporary creation, probes, cleanup, or provenance.

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/metric-views` | GET | List proposals by `runId` or `schemaScope` |
| `/api/metric-views/generate` | POST | Standalone generation from tables |
| `/api/metric-views/[id]` | GET | Get proposal by ID |
| `/api/metric-views/[id]` | PATCH | Atomically update YAML/DDL, set `unverified`, and clear stale evidence/version/timestamp |
| `/api/metric-views/[id]` | DELETE | Delete proposal |
| `/api/metric-views/[id]/deploy` | POST | Deploy proposal to target schema |
| `/api/metric-views/[id]/repair` | POST | Auto-fix + optional LLM repair |
| `/api/metric-views/check-dependencies` | POST | Check deployment dependencies |
| `/api/runs/[runId]/genie-engine/[domain]/metric-views` | POST | Execute DDL and add to Genie Space |

All routes resolve the caller server-side. Lists are restricted to proposals
owned by the caller plus proposal IDs shared through
`metric_view_proposal` ACL entries. Detail, edit, repair, and deploy operations
use the consolidated metric-view proposal guard; view shares are read-only,
edit shares may repair/deploy/update, and deletion and sharing remain
owner-only. Run-derived dependency checks also authorize the run before reading
proposal metadata. Explicit-FQN dependency checks apply the same owner/shared
proposal scope before returning any proposal ID, DDL, or derived metadata.

---

## UI

| Component | Purpose |
|-----------|---------|
| `components/pipeline/metric-views-tab.tsx` | Run-level proposals: list, deploy, repair, expand YAML/DDL |
| `components/pipeline/metric-view-deploy-modal.tsx` | Deploy multiple proposals with schema selection |
| `components/pipeline/metric-view-dependency-modal.tsx` | Resolve missing metric views before Genie deploy |
| `components/genie/genie-defaults-settings.tsx` | Settings toggle for metric views |

---

## Data Model

| Table | Purpose |
|-------|---------|
| `ForgeMetricViewProposal` | Proposal record: run, domain, schema, YAML, DDL, status, deployed FQN |

Validation evidence contains stage/status/code/message plus bounded operational
metadata such as duration, temporary artifact reference, observed schema, and
row count; raw query rows are never persisted. Factory reset explicitly deletes
`ForgeMetricViewProposal`, including standalone rows with `runId = null`.
Successful validation, failed validation, and successful deployment emit
`metric_view_validated`, `metric_view_validation_failed`, and
`metric_view_deployed` only after their outcomes are persisted. Permission-
limited full probes emit `metric_view_validation_unverified`; they never emit a
false validation success. Repair runs static checks, temporary create,
representative `MEASURE()` probes, and cleanup against the final repaired
definition, then replaces all stale validation metadata atomically.
Persisted Release 2 outcomes additionally emit one structured
`semantic_manifest_built` event per completed semantic run and
`metric_view_improve_planned` when persisted pass output contains improve
plans. Both occur only after recommendation/pass-output persistence.

Metric view data also appears in:
- `ForgeGenieRecommendation.metricViewProposals` (JSON) -- proposals per Genie recommendation
- `ForgeGenieSpace.metricViews` -- deployed metric views per space
- `ForgeEnvironmentScan.metricViewCount` -- discovery counts
- `ForgeDiscoveredAsset` -- metric views as discovered assets

---

## File Reference

| File | Purpose |
|------|---------|
| `lib/metric-views/engine.ts` | V2 engine orchestrator (planning + generation) |
| `lib/metric-views/types.ts` | All TypeScript types |
| `lib/metric-views/discovery.ts` | Discover existing metric views from UC |
| `lib/metric-views/config.ts` | Feature gate (`isMetricViewsEnabled`) |
| `lib/metric-views/seed.ts` | Lightweight deterministic seed |
| `lib/metric-views/subdomain-mapper.ts` | Use case to subdomain grouping |
| `lib/metric-views/index.ts` | Public API |
| `lib/genie/passes/metric-view-proposals.ts` | LLM generation, validation, auto-fix, repair |
| `lib/genie/deploy.ts` | DDL deployment and space patching |
| `lib/genie/metric-view-dependencies.ts` | Dependency checking and auto-deploy |
| `lib/lakebase/metric-view-proposals.ts` | Persistence CRUD |
