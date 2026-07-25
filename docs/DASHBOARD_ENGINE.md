# Dashboard Engine

> AI/BI (Lakeview) dashboard recommendation generator.

## Overview

The Dashboard Engine generates Databricks AI/BI dashboard recommendations from
pipeline results or ad-hoc table selections. It produces full
`SerializedLakeviewDashboard` JSON payloads that can be deployed directly to the
workspace via the Lakeview REST API.

## Modes

The engine operates in two modes:

| Aspect | Pipeline mode | Ad-hoc mode |
|--------|---------------|-------------|
| Trigger | After pipeline completion (background) or manual "Generate" | Ask Forge intent or `POST /api/dashboard/generate` |
| Input | Run use cases, metadata, Genie recommendations, discovered dashboards | Tables, optional SQL blocks, widget descriptions, conversation summary |
| Use cases | Real pipeline use cases | Synthetic from conversation context |
| Genie enrichment | Yes (measures, dimensions, filters) | No |
| Enhancement detection | Yes (flags existing dashboards) | No |
| Deploy | Via deploy API after review | Optional inline deploy |

---

## Engine Flow

### Pipeline Mode

```
runDashboardRecommendations(ctx, runId)
    │
    ├── Load owner/run-scoped persisted Genie semantic manifests
    ├── Fail closed if any requested domain lacks a manifest
    │
    ├── runDashboardEngine(input)
    │     │
    │     ├── Group use cases by canonical Genie domain
    │     │
    │     ├── For each domain:
    │     │     ├── LLM call → DashboardDesignV2
    │     │     ├── Resolve manifest-backed dataset sources
    │     │     ├── Execute and validate dataset SQL
    │     │     ├── assembleLakeviewDashboard(design)
    │     │     ├── Validate the serialized dashboard contract
    │     │     └── buildDashboardRecommendation()
    │     │
    │     └── Return DashboardEngineResult
    │
    └── saveDashboardRecommendations()
```

Domain selection uses the same canonical normalization as Genie. Customer,
client, consumer, and CRM labels converge on `Customer Insights`; sales,
revenue, order, and commerce converge on `Sales Analytics`; supply, supplier,
vendor, inventory, and procurement converge on `Supply Chain`; finance,
billing, payment, and invoice converge on `Finance`; and marketing, campaign,
and attribution converge on `Marketing`. Other labels are title-cased.
Dashboard grouping, explicit domain filters, persisted manifest lookup, and
manual regeneration all compare the normalized key, so equivalent labels
cannot split a Genie domain or bypass manifest coverage.

**Upgrade note.** Recommendations and tracked dashboards written before this
normalization still hold raw alias domains such as `Procurement`. Filtered
regeneration therefore replaces the trimmed requested aliases *and* the
canonical domain they collapse into, so alias rows cannot survive while the
canonical re-insert still satisfies the run+domain unique constraint. Deployment
resolves its tracked target by exact label first and by canonical key second, so
a pre-change tracked dashboard is updated in place rather than duplicated. No
backfill migration is required.

### Ad-hoc Mode

```
runAdHocDashboardEngine(input)
    │
    ├── Fetch metadata for given tables
    ├── Build synthetic use cases from context
    ├── Same LLM pipeline + validation as pipeline mode
    ├── Optionally deploy through the guarded draft lifecycle
    └── Return AdHocDashboardResult
```

---

## Validation and Fail-Closed Behavior

All dataset SQL goes through validation before a recommendation is persisted:

1. **Schema allowlist** -- `validateSqlExpression()` from
   `lib/genie/schema-allowlist.ts` checks table and column references against
   metadata. `strictColumnCheck=true` for dashboards.

2. **LLM review** (optional) -- `reviewAndFixSql()` from
   `lib/ai/sql-reviewer.ts` when `isReviewEnabled("dashboard")` or
   `isReviewEnabled("adhoc-dashboard")`. Fixes SQL and re-validates against the
   allowlist.

3. **Dataset execution** -- each query executes with a bounded result. Returned
   aliases and data types are checked against every widget field binding.

4. **Serialized contract validation** -- validates dataset references, widget
   aliases/types, page structure, and the complete Lakeview payload.

The engine fails closed per domain. It does not silently drop a bad required
dataset or widget from that domain. Valid sibling domains are persisted, while
invalid domains retain structured validation failures. A mixed run completes
with partial success using the normal `completed` status plus
`validationFailures`; a run with failures and no valid recommendations fails.

`validationStatus = "valid"` has one meaning in persisted recommendations:
the complete current provenance already passes
`isDashboardValidationDeployable()`. The engine checks this invariant before a
recommendation reaches persistence, and deployment checks it again after
loading. A status string without the current validator version, timestamp, and
required passed evidence is not deployable.

---

## Lakeview Assembler

`DashboardDesignV2` in `lib/dashboard/design-ir.ts` is the version `2` typed
intermediate representation for datasets, pages, widgets, filters, parameters,
expected fields, source kind, and value formats. The LLM emits this constrained
IR, not Lakeview JSON. `lib/dashboard/legacy-design-adapter.ts` keeps old
`DashboardDesign` JSON readable.

`assembleLakeviewDashboard(design)` converts the typed design into
the `SerializedLakeviewDashboard` format expected by the Lakeview REST API.

Every page uses the 12-column `GRID_V1` contract:
- **Title and subtitle** at the top
- **KPI counters** in rows of 3 (4 columns each)
- **"Trends & Analysis"** section with charts on the 12-column grid
- **"Details"** section with table widgets
- **Global filters** on a separate page (`PAGE_TYPE_GLOBAL_FILTERS`)

The serialized contract has two explicit modes:

- `forge-assembled` is the default for pipeline and ad-hoc recommendations. It
  enforces Forge's generated grid, counter aggregation, query-field, filter,
  and encoding conventions.
- `imported-lakeview` accepts the native parameter-filter binding shape used by
  the prebuilt WAF Lakeview JSON while retaining structural, dataset,
  reference, layout, and binding checks. It is a narrow compatibility mode
  used only by `POST /api/assessment/dashboard`; other dashboard generation
  and deployment must not opt into it.

---

## Dataset Source Policy

`FORGE_METRIC_FIRST_DASHBOARD_SOURCES` defaults off. When enabled, analytical
datasets prefer a valid manifest metric view that covers every requested
measure and dimension. Deterministic code renders explicit `MEASURE()` SQL.
Detail datasets, unsupported calculations, invalid/unverified metric views,
rendering failures, and uncovered fields use grounded table SQL. Each
recommendation records `governed`, `table`, or `mixed`.

The source flag changes preference only. Schema allowlisting, static lint,
`EXPLAIN`, bounded execution, result-contract validation, and dashboard
contract validation remain mandatory in both modes.

---

## Deployment

1. `POST /api/runs/[runId]/dashboard-engine/[domain]/deploy` with optional
   `{ publish, embedCredentials }`; destination and owner are server-derived
2. Load recommendation from Lakebase
3. Require `validationStatus = "valid"`, the current validator version, a valid
   timestamp, and passed required dataset/design/contract lifecycle evidence.
   Optional skipped evidence such as `LLM_REVIEW_DISABLED` is allowed; failed,
   stale, incomplete, legacy, or evidence-free provenance returns `422`
4. Select create versus update before mutation. Typed improvements bind the
   exact discovered dashboard ID, verify its live fingerprint immediately
   before update, and never create a duplicate on conflict.
5. Create/update an unpublished draft using app M2M for the
   server-controlled `/Shared/Forge Dashboards/` destination.
6. When `FORGE_DASHBOARD_DRAFT_READBACK=true`, fetch the draft, verify ID,
   display name, destination, warehouse, counts, and serialized contract.
7. Publish only after successful read-back, then fetch and verify observed
   publication state before persisting `publishedAt`.
8. Persist the tracked row and recommendation evidence before activity events.

The draft-readback flag defaults off. Its legacy fallback is explicitly
draft-only: mandatory Release 1 contract validation still runs, but no
read-back is claimed. A publication request fails before mutation unless the
flag is enabled; unsafe direct publication is never used.

Publication failure returns `502`, retains the valid draft ID, and persists
`publish_failed`. Read-back mismatch returns `422`, retains and tracks the
draft, and does not publish. Activities represent persisted outcomes:
`dashboard_draft_deployed`, `dashboard_readback_failed`,
`dashboard_published`, `dashboard_publish_failed`, and `dashboard_improved`.

`POST /api/dashboard/generate` handles the same typed lifecycle failures for
its app-M2M deployment. A read-back mismatch records `dashboard_draft_deployed`
plus `dashboard_readback_failed` against the created dashboard ID with caller
identity, evidence stage, and failed evidence codes only, then returns `422`
with the evidence. An observed-but-untrackable mutation returns `502` with no
audit, because there is no dashboard ID to attribute. A publication request
with draft read-back disabled returns `409` before mutation. Ad-hoc dashboards
have no run scope, so these branches log audit events without writing tracked
rows or recommendation publication state.

The Lakeview API client lives in `lib/dbx/dashboards.ts`.

---

## Dependency Injection

```typescript
interface DashboardEngineDeps {
  llm: LLMClient;
  logger: Logger;
  reviewAndFixSql?: typeof reviewAndFixSql;
  isReviewEnabled?: typeof isReviewEnabled;
}
```

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboard/generate` | POST | Ad-hoc generation from tables + Ask Forge context |
| `/api/runs/[runId]/dashboard-engine/generate` | POST | Start async pipeline dashboard generation (optional domain filter) |
| `/api/runs/[runId]/dashboard-engine/generate/status` | GET | Poll generation status |
| `/api/runs/[runId]/dashboard-engine/[domain]/preview` | GET | Lakeview JSON preview for a domain |
| `/api/runs/[runId]/dashboard-engine/[domain]/deploy` | POST | Deploy a domain's dashboard to Databricks |
| `/api/runs/[runId]/dashboard-recommendations` | GET | List recommendations and tracked dashboards for a run |

Run routes use `loadRunOrRespond`: reads require owner/view access and
generation/deployment requires owner/edit access. Caller identity is derived
from request headers, never accepted from request bodies. Tracked dashboard
owner rows always use `guard.user.email`. Run-scoped lists inherit the run's
owner-plus-ACL authorization.

Dashboard API identity is explicit and stable for the whole lifecycle:

- pipeline, ad-hoc, and workspace-shared WAF assets deployed under the
  server-controlled `/Shared/Forge Dashboards/` path are Forge-owned;
  create/update, draft read-back, publish, and publication read-back all use
  app M2M (`getAppHeaders`) with no OBO fallback;
- external/user-owned discovery, improvement base reads, and live-fingerprint
  verification use the exact request OBO token with no app fallback; after
  that user-scoped verification, the Forge-owned shared-path deployment
  mutation still uses app M2M;
- `embed_credentials` defaults to `false`;
- app M2M permission failures retain the bounded Databricks diagnostic instead
  of being reported as the known Apps OBO `dashboards`-scope limitation.

---

## UI

| Component | Purpose |
|-----------|---------|
| `components/pipeline/dashboards-tab.tsx` | Run-level dashboard recommendations: list, select, deploy, regenerate, detail sheet |
| `components/pipeline/dashboard-deploy-modal.tsx` | Deploy modal: workspace path, publish option, sequential deploy |

---

## Data Model

| Table | Purpose |
|-------|---------|
| `ForgeDashboardRecommendation` | Per-domain recommendation: design, serialized JSON, owner, validation status/evidence, use case IDs, type |
| `ForgeDashboard` | Deployed dashboard tracking: run, domain, dashboard ID, status, URL |

Evidence records contract and dataset-execution outcomes without persisting raw
rows. Async generation emits `dashboard_validated` only after valid
recommendations are saved, or `dashboard_validation_failed` after the failed
job outcome is recorded. Run cascades remove recommendations and tracked
dashboards during factory reset.

Pipeline ordering is
`SQL → Genie/metric validation → persisted semantic manifest → Dashboard`.
Business Value runs in parallel. Mixed dashboard generation persists valid
sibling domains and structured failures; zero-valid output fails the job.

---

## File Reference

| File | Purpose |
|------|---------|
| `lib/dashboard/engine.ts` | Pipeline mode orchestrator |
| `lib/dashboard/adhoc-engine.ts` | Ad-hoc mode orchestrator |
| `lib/dashboard/types.ts` | All TypeScript types (design, Lakeview, recommendation) |
| `lib/dashboard/prompts.ts` | System message and prompt builder |
| `lib/dashboard/assembler.ts` | Lakeview JSON assembler and layout |
| `lib/dashboard/validation.ts` | EXPLAIN validation and metric view checks |
| `lib/dashboard/engine-status.ts` | In-memory job status tracker |
| `lib/pipeline/steps/dashboard-recommendations.ts` | Pipeline step integration |
| `lib/dbx/dashboards.ts` | Lakeview REST API client |
| `lib/genie/schema-allowlist.ts` | Schema allowlist validation (shared with Genie) |
| `lib/ai/sql-reviewer.ts` | LLM-based SQL review (shared) |
