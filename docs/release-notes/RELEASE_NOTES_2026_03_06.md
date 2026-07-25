# Release Notes -- 2026-03-06

**Databricks Forge v0.10.0 → v0.12.0**

---

## v0.10.0 -- Security Hardening + Codebase Decomposition

### New Features

#### SQL Quality Review (LLM-as-Reviewer)
New `lib/ai/sql-reviewer.ts` module uses a dedicated review model (`databricks-gpt-5-4` via `serving-endpoint-review`) to validate generated SQL. Provides `reviewSql()` for single queries, `reviewAndFixSql()` for auto-repair, and `reviewBatch()` for parallel batch review. Opt-in per surface via `isReviewEnabled()`. Shared Databricks SQL quality rules consolidated in `lib/ai/sql-rules.ts`.

#### Shared API Utilities
New `lib/api-utils.ts` provides `handleApiError()`, `requireRun()`, `requireSafeId()`, `assertOk()`, and `isErrorResponse()` -- eliminating ~200 lines of duplicated boilerplate across API routes.

#### Genie Deploy Shared Module
Extracted ~600 lines of DDL rewriting, metric view deployment, validation, and space preparation logic from two API routes into `lib/genie/deploy.ts`.

### Improvements

#### Security Hardening (9 items resolved)
- **HSTS header** -- Added `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` to `next.config.ts`.
- **Rate limiting activated** -- Re-wired `proxy.ts` as Next.js middleware; in-memory sliding-window limiter now active on all `/api/*` routes (3k/min for LLM routes, 12k/min general).
- **Health endpoint tiered response** -- Unauthenticated callers receive only `{ status, version, uptime, timestamp }`; full diagnostics restricted to authenticated users.
- **Error message sanitisation** -- New `lib/error-utils.ts` with `safeErrorMessage()` applied across 80+ API routes. Raw `error.message` no longer leaked to clients in production.
- **Ask Forge prompt injection mitigation** -- User questions wrapped in `---BEGIN USER QUESTION---` / `---END USER QUESTION---` delimiters with marker stripping.
- **CI security audit** -- Added `npm audit --audit-level=critical` step to `.github/workflows/ci.yml`.
- **Sample data audit logging** -- `fetchSampleData()` now logs structured audit context.
- **Per-user run isolation (Phase 1)** -- `listRuns()` accepts optional `userEmail` parameter; `GET /api/runs` and the runs page now scope results to the logged-in user.
- **SECURITY_ARCHITECTURE.md updated** -- 9 items moved to Resolved section.

#### Codebase Decomposition (4 mega files split)
- **`app/runs/[runId]/page.tsx`** (1,493 → 246 lines) -- Extracted 11 components and 2 hooks into `components/pipeline/run-detail/` and `lib/hooks/`.
- **`app/settings/page.tsx`** (1,227 → 248 lines) -- Extracted 9 section components and `useSettingsState` hook into `components/settings/`.
- **`components/pipeline/genie-spaces-tab.tsx`** (1,387 → 211 lines) -- Extracted 7 components and `useGenieSpacesTab` hook.
- **`lib/ai/templates.ts`** (1,433 → 233 lines) -- Split into 9 step-specific modules. Barrel file preserves all existing imports.

#### Dead Code Removal & Type Centralisation
- Deleted unused `lib/api-error.ts`.
- Replaced inline pgvector DDL in backfill route with `ensureEmbeddingSchema()`.
- Centralised `JoinSpecInput` (5 definitions → 1), `SpaceJson` (5 → 1), and `ConversationTurn` (2 → 1).

#### Health Check Test Resilience
Updated `perfectSpace` fixture to satisfy all 20 checks in `default-checks.yaml`. Relaxed `emptySpace` test expectations to accept the correct D/F range. Embedded default checks YAML into the registry for bundled environment compatibility.

### Bug Fixes
- **Missing middleware** -- `proxy.ts` was disconnected from Next.js during a prior cleanup; re-wired via `middleware.ts` to restore auth guard and rate limiting.
- **AlertDialogFooter closing tag** -- Fixed unclosed JSX tag in `data-management-settings.tsx`.
- **IndustryOutcome type mismatch** -- Fixed `undefined` vs `null` coercion in `RunCompletedTabs` props after decomposition.

### Other Changes
- `app.yaml` updated with `serving-endpoint-review` resource binding for SQL quality review model.
- AGENTS.md updated with SQL review infrastructure, model routing, and review endpoint documentation.
- Health check registry now reads YAML from embedded string constant rather than filesystem for Databricks Apps compatibility.

---

## v0.11.0 -- Dashboard Filters + Metric View Integration

### New Features

#### Dashboard Filter Widgets
Dashboards now support interactive filter widgets (`filter-multi-select`, `filter-single-select`, `filter-date-range-picker`). The assembler generates a dedicated `PAGE_TYPE_GLOBAL_FILTERS` page when the LLM proposes filter widgets. Counter widgets sharing a dataset with filters automatically switch to `disaggregated: false` mode with aggregation expressions.

#### Metric View Dashboard Integration
The dashboard prompt now includes a "Metric Views (Governed KPIs)" section when metric view proposals are available. The LLM is instructed to prefer metric views for KPI and trend datasets, using `MEASURE()` syntax.

#### EXPLAIN-Based SQL Validation
A new `validateDatasetSql()` function runs `EXPLAIN` on each dataset SQL query before dashboard assembly, catching column-reference errors and syntax issues that schema-allowlist validation alone cannot detect.

### Improvements

#### Recursive CTE Lineage Traversal
Replaced the multi-round-trip BFS loop in `lib/queries/lineage.ts` with a single `WITH RECURSIVE` SQL query. Reduces lineage walking from O(depth) SQL calls to exactly 2 calls regardless of depth. Falls back gracefully on workspaces without `WITH RECURSIVE` support (requires DBR 17.0+).

### Other Changes
- Applied Prettier formatting across the entire codebase for consistent style
- Added 24 new unit tests covering filter widget assembly, prompt output schema, EXPLAIN validation, and recursive lineage queries

---

## v0.11.1 -- Health Fix Workflow + Context-Aware Strategies

### Bug Fixes

- **Broken health fix workflow** -- The `column_intelligence` fix strategy silently dropped enrichments for columns not already in `column_configs`, set empty descriptions that failed the health check anyway, and always reported a change even when nothing was modified. The fix now creates missing column config entries, guards against empty descriptions, and only reports actual changes.
- **Empty diff in fix preview** -- When no changes were produced, the Optimization Suggestions page showed an identical side-by-side diff. Now shows a clear "No Changes Generated" empty state with guidance.

### Improvements

#### Smart context-aware fix strategies
All 8 health fix strategies now receive synthesized business context extracted from the space itself. LLM-backed strategies generate contextually relevant fixes instead of running blind with empty context.

#### Entity matching uses schema-based extraction
The `entity_matching` strategy now uses `extractEntityCandidatesFromSchema` to identify actual entity candidate columns instead of blindly enabling entity matching on all string columns.

#### LLM-generated sample questions
The `sample_questions` strategy now uses the fast LLM endpoint to generate user-friendly, contextual sample questions instead of copying the first 3 example SQLs verbatim.

#### Table description generation
The `column_intelligence` strategy now also generates table-level descriptions, fixing the gap where `tables-have-descriptions` health check failures could never be addressed.

#### Individual benchmark run buttons
Each benchmark question in the test runner now has a Play button for quick single-question runs.

### Other Changes
- SQL alias extraction and validation enhancements
- SQL rules hardening and skill updates

---

## v0.11.2 -- Automotive & Mobility Outcome Map Enhancement

### Improvements

#### Automotive & Mobility Outcome Map -- Servco Demo Readiness

Comprehensive enhancement of the `automotive-mobility` industry outcome map to close 7 gaps identified against the Servco Australia executive report.

**New Objective: Drive Operational Excellence & Workforce Productivity**
- Workforce Management & Capability Building (4 use cases)
- Multi-Franchise Integration & Standardisation (3 use cases)

**New Priority: Fixed Operations Analytics (Grow Aftersales objective)**
- Fixed absorption & departmental profitability tracking
- Labour rate realisation & technician efficiency analytics
- Service mix & revenue optimisation

**New Use Cases Added to Existing Priorities:**
- Conversational AI & Virtual Sales Assistants
- Customer Data Platform & Unified Customer 360
- Service Loyalty & Prepaid Maintenance Plans
- Used Vehicle Digital Retailing & Superstore Operations

**Updated Arrays:**
- Sub-verticals: added "Used Vehicle Superstores & Independents"
- Suggested domains: added "Workforce & People", "Used Vehicle Operations"
- Suggested priorities: added "Drive Operational Excellence", "Scale Multi-Franchise Operations"

---

## v0.12.0 -- Standalone Metric Views

### New Features

#### Standalone Metric Views
Metric views are now first-class, independently deployable artifacts. A new
`ForgeMetricViewProposal` persistence layer tracks proposals across pipeline
runs, ad-hoc generation, and standalone creation. New REST API endpoints
(`/api/metric-views/*`) support CRUD, generation, and deployment without
requiring a full Genie Engine run.

#### Metric Views Tab
A dedicated **Metric Views** tab on the run detail page (between Use Cases and
Genie Spaces) lets users browse, filter, validate, and deploy metric view
proposals per domain with status badges and bulk actions.

#### Two-Phase Genie Engine
The Genie Engine now runs in two phases: **Phase A** generates and persists
metric views first, then **Phase B** assembles Genie spaces, trusted assets,
instructions, and benchmarks in parallel.

### Improvements

#### Deployment Dependency Validation
Genie space and dashboard deploy routes now auto-detect referenced metric views
and deploy any missing ones as a pre-flight step.

#### Dashboard Engine Reads from New Table
The dashboard engine reads metric view data from the new
`ForgeMetricViewProposal` table first, falling back to legacy
`GenieEngineRecommendation` records for backward compatibility.

### Bug Fixes
- **Snowflake schema join nesting** -- Fixed `UNRESOLVED_COLUMN` errors in
  metric view YAML by implementing `nestSnowflakeJoins()` deterministic
  auto-fix, enhanced LLM prompt guidance for nested joins, and
  `detectFlatSnowflakeJoins()` validation.

### Other Changes
- Genie workbench accordion shows read-only metric view references with a pointer to the dedicated Metric Views tab
- Genie deploy modal includes an informational banner about automatic metric view dependency deployment
- Ad-hoc Genie engine applies the same two-phase pattern for consistency
- 8 new unit tests for `nestSnowflakeJoins` and `detectFlatSnowflakeJoins`

---

## All Commits

| Hash | Summary |
|---|---|
| `ec7b706` | Enhance Genie Spaces user experience with new features and optimizations |
| `a11923b` | Remove unused import from page.tsx |
| `448aac8` | Update health check registry to embed default checks YAML |
| `7e29da4` | Enhance SQL quality review capabilities and update related configurations |
| `f3ec910` | Enhance security and error handling across the application |
| `cb64e26` | Update versioning and enhance CI security checks |
| `5cd76a4` | Refactor health check tests and enhance perfectSpace fixture |
| `ae84676` | Remove middleware.ts file |
| `f155a50` | Standardize error handling across API routes with safeErrorMessage utility |
| `cb39a1e` | Bridge dashboard skills gaps: add filter widgets, metric view integration, EXPLAIN validation, and recursive CTE lineage |
| `e5c5bec` | Fix broken health fix workflow and make all strategies context-aware |
| `f833302` | Enhance SQL alias extraction and validation |
| `7a43f5c` | Skill update and SQL hardening |
| `98e49f1` | Enhance automotive-mobility outcome map for Servco Australia demo |
| `d7bf1a4` | Elevate metric views to first-class standalone artifacts with nested snowflake join support |
