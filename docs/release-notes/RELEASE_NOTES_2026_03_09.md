# Release Notes -- 2026-03-09

**Databricks Forge v0.15.0 → v0.18.0**

---

## v0.15.0 -- Design System Overhaul

### New Features

#### Design System Overhaul
Complete visual redesign moving from scaffold defaults to a branded, intentional design language. The new "Precision Intelligence" aesthetic transforms every surface of the application from a developer workbench into a polished business tool.

#### Typography
Replaced Geist (the Next.js default) with **Plus Jakarta Sans** for body/headings and **JetBrains Mono** for code, creating a distinctive typographic identity.

#### Motion System
Installed `motion` (Framer Motion v11+) and created shared animation variants. The sidebar now uses spring-based collapse/expand, page transitions use fade+slide via `template.tsx`, and dashboard cards enter with staggered animations.

#### Tile Dashboard Layout
Redesigned the home page with an atmospheric hero banner featuring a Databricks diamond texture pattern, an asymmetric tile layout with a hero use-case metric, quick-action cards, secondary KPI tiles, side-by-side recent runs and activity feed, and a refreshed empty state with branded onboarding.

### Improvements

#### Sidebar Atmosphere
Replaced flat `bg-muted/30` with gradient background, stronger active states with left-border accent in Databricks Red, refined section labels, and animated brand text on collapse/expand.

#### Header Refinement
Increased height from 48px to 56px, grouped right-side actions with a visual divider, strengthened page title weight, and added subtle bottom shadow for depth.

#### Consistent Page Layouts
All 23 pages now use `max-w-[1400px]` content constraint, `space-y-8` section spacing, and standardized `PageHeader` component where applicable. New `PageShell` and `PageHeader` shared components enforce consistency.

#### Component Refinements
- **Card**: Added hover transition support and tighter title tracking
- **Badge**: New `brand` variant using Databricks Red with subtle border
- **Button**: Primary buttons now have shadow, hover shadow, and active scale
- **Skeleton**: Brand-tinted shimmer instead of generic grey pulse

#### Error & Status Pages
Refreshed 404 page with branded icon and atmospheric large-number background, refined error boundary with icon treatment and action buttons, and loading skeletons that mirror the new tile layout.

#### Ask Forge
Updated layout margins for the new header height, refined persona toggle and conversation history backgrounds.

---

## v0.16.0 -- LLM Skills System + Genie Detail Page

### New Features

#### LLM Skills System
Introduced a structured knowledge injection framework (`lib/skills/`) that enriches all AI surfaces with domain-specific expertise. Skills are registered in a central registry and resolved at prompt-build time based on context signals (industry, data patterns, intent). Ships with five built-in skill packs: Databricks SQL Patterns, Genie Space Design, Industry Enrichment, Metric View Patterns, and System Tables. Skills are embedded into the vector store for RAG retrieval and injected directly into LLM prompts, improving generation quality across the Genie Engine, Ask Forge, and pipeline steps.

#### Genie Space Detail Page Uplift
Completely redesigned the Genie Space detail page (`app/genie/[spaceId]/page.tsx`) with a tab-based layout featuring a new hero section (`space-detail-hero.tsx`), Overview tab (`space-overview-tab.tsx`) with table/instruction/expression summaries, Health tab (`space-health-tab.tsx`) with inline health checks and fix actions, Benchmarks tab (`space-benchmarks-tab.tsx`), and a refreshed Config Viewer. The page now matches the app's Precision Intelligence design language.

#### Genie Space Improvement Workflow
Added a background improvement job system (`lib/genie/improve-jobs.ts`) with new API routes (`/api/genie-spaces/[spaceId]/improve` and `/api/genie-spaces/improve-status`). Users can trigger space improvements from the detail page and poll for progress, with status indicators and result surfacing in the UI.

#### SQL Extraction in Space Fixer
Enhanced the space fixer (`lib/genie/space-fixer.ts`) with SQL extraction and reference handling capabilities, enabling more precise automated fixes when resolving health check failures.

### Improvements

#### Design Restoration -- Outcomes & Ask Forge
Restored the design-overhaul UX to the Outcomes page, Use-Case Table, and Ask Forge chat interface that had been lost during branch merges.

#### Dynamic Application Naming
Updated `lib/lakebase/provision.ts` to support a `FORGE_APP_NAME` environment variable for `PROJECT_ID_BASE` and display name.

#### Layout & Spacing Consistency
Updated layout and spacing across multiple pages (Fabric, Environment, Metadata Genie, Run Detail) for consistent margins, padding, and content constraints matching the design system.

#### Trusted Assets Pass Enhancements
Expanded the trusted assets pass (`lib/genie/passes/trusted-assets.ts`) with richer generation logic and better handling of SQL patterns.

#### Benchmark Generation Improvements
Enhanced the benchmark generation pass with more robust question generation and better context handling for improved Genie Space benchmark coverage.

---

## v0.17.0 -- LLM Skills Overhaul (8 Modules, 12 Surfaces)

### New Features

#### LLM Skills Overhaul -- 8 Modules, 12 Blind Surfaces Wired
Comprehensive overhaul of the in-app LLM skills system. Created four new skill modules (Databricks Data Modeling, AI Functions, SQL Scripting, Dashboard SQL) and substantially rewrote four existing modules (SQL Patterns, Genie Design, Metric View Patterns, System Tables). Extended the type system with new `GeniePass` values (`exampleQueries`, `joinInference`) and `PipelineStep` value (`dashboard-design`). Wired the skill resolver into 12 previously blind LLM surfaces so every AI-powered generation path now benefits from structured domain knowledge.

### Improvements

#### SQL Generation Craft Skills
Rewrote `databricks-sql-patterns` to focus purely on SQL generation craft: window function recipes, CTE composition patterns, date idioms, lambda/higher-order function patterns, and a comprehensive anti-patterns catalogue.

#### Databricks Data Modeling Skill
New dedicated skill covering star schema design, keys and constraints, Liquid Clustering best practices, SCD Type 1/2 patterns, and data modeling anti-patterns. Wired into table-filtering and SQL generation pipeline steps.

#### Databricks AI Functions Skill
New skill covering `ai_query` rules and structured output, the cost-optimisation funnel, and all task-specific AI functions (`ai_classify`, `ai_extract`, `ai_forecast`, `vector_search`, `http_request`, `remote_query`, `read_files`).

#### Databricks SQL Scripting Skill
New skill for procedural SQL: `BEGIN...END` blocks, variable declaration, control flow, exception handling, stored procedures with `IN`/`OUT`/`INOUT` parameters, and recursive CTE patterns.

#### Dashboard SQL Skill
New skill for Lakeview dashboard dataset SQL rules, widget field matching constraints, 6-column grid layout rules, and metric view SQL compliance.

#### Enhanced Genie Design Skill
Added five new chunks: snippet expression complexity rules, alias-based join inference patterns, auto-generated date filters, question style guidelines, and instruction anti-patterns.

#### Enhanced Metric View Patterns Skill
Added star/snowflake join YAML examples, common gotchas, and window measure examples (YTD, rolling, period-over-period).

#### Enhanced System Tables Skill
Added deeper coverage: job/pipeline monitoring, storage/compute metrics, and data product observability patterns.

#### Skill Resolver Wired to 12 LLM Surfaces
Previously blind surfaces now receive skill context: SQL Reviewer, Pipeline SQL Generation, Dashboard Engine, Genie Example Query Generation, Genie Join Inference, Genie Adhoc Engine, Genie Optimise, Genie Space Fixer, Health Check Synthesis, Fabric Gold Proposer, Fabric DAX-to-SQL, and Pipeline Table Filtering.

---

## v0.17.1 -- SQL Hallucination Fix

### Bug Fixes

- **False-positive hallucination flags on AI use case SQL** -- The column validator was rejecting valid SQL that used `from_json()` struct field access (e.g. `parsed.confidence`). The validator now recognises column-alias prefixes as struct field access and skips them during validation.

- **String literal content matched as column references** -- Prose inside SQL string literals was being matched by the column reference regex. Added `stripStringLiterals()` to the extraction pipeline.

- **Reviewer fixes introducing new hallucinated columns** -- The SQL reviewer fix prompt now includes an explicit column-grounding constraint.

### Improvements

#### LATERAL VIEW EXPLODE Deprecation
Added rules across all prompt surfaces warning against `LATERAL VIEW EXPLODE` (deprecated Hive syntax that causes parse errors when combined with JOINs).

#### Canonical `from_json()` Alias Naming
Enforced `ai_result` and `parsed_result` as the mandatory alias names for `ai_query()` and `from_json()` outputs respectively.

#### Targeted Fix Guidance for `from_json` Violations
When the hallucination fixer detects `parsed.*` prefix patterns in flagged columns, the error message now includes specific instructions about canonical `from_json()` alias naming.

---

## v0.18.0 -- Pipeline & Engine Performance (17 Areas)

### Improvements

#### Parallelized pipeline steps for faster execution
Domain-clustering (Step 5) and scoring/dedup (Step 6) now process domains in parallel with bounded concurrency, and LLM batches within each step run concurrently via `Promise.all`. Metadata extraction (Step 2) runs all per-scope queries in parallel. Expected 3-5x speedup on steps 2, 5, and 6.

#### Genie Engine pass reordering and concurrency
Metric view proposals now run in parallel with Phase 3 passes instead of sequentially before them. Genie LLM concurrency default raised from 3 to 6. Metric view SQL reviews now run in parallel.

#### Run-level sample data cache
SQL generation (Step 7) now caches sample data per table FQN across use cases within a run, eliminating 50-80% of redundant warehouse queries.

#### Parallelized embedding batches
Embedding generation now runs up to 3 batches concurrently with increased batch size (32, up from 16), reducing embedding phase latency by 2-3x.

#### SQL reviewer LLM cache for Genie surfaces
SQL review calls for `genie-*` surfaces are now routed through the Genie LLM cache, avoiding redundant model serving calls.

#### Buffered prompt log inserts
Prompt log entries are now buffered in memory and flushed via `createMany` every 20 entries or 2 seconds, reducing DB round-trips.

#### Progress update throttling
`updateRunMessage` calls are now debounced to at most one write per 500ms.

#### Reduced SQL generation wave delay
Default `SQL_GEN_WAVE_DELAY_MS` reduced from 2000ms to 500ms.

#### Frontend polling backoff
All status polling now uses progressive backoff (starting at 2s, scaling to 8-10s) instead of fixed intervals.

#### Cache-Control headers on read-heavy API routes
Added `s-maxage` + `stale-while-revalidate` headers to environment/table, table-coverage, outcome-maps, genie-spaces, and aggregate ERD endpoints.

#### Lazy-loaded CodeMirror editor
The SQL editor component is now dynamically imported with `ssr: false`, removing ~200KB from the initial Ask Forge bundle.

#### Batched N+1 update in enrich-pbi
Individual `prisma.update` calls replaced with a single `prisma.$transaction` batch.

#### Deduplicated aggregate estate view queries
Added a 30-second in-memory TTL cache for `getAggregateEstateView()`.

---

## All Commits

| Hash | Summary |
|---|---|
| `0591d98` | Design system overhaul: replace scaffold defaults with branded, intentional UI |
| `c51529c` | Add industry context handling in assistant context builder |
| `8bd4f19` | Enhance evaluation framework and persona handling in assistant |
| `1608d53` | Add resource prefix support for Unity Catalog resources and enable metric view generation |
| `167dbd5` | Restore design-overhaul UX for outcomes page and use-case table |
| `3552a07` | Restore Ask Forge design overhaul from stashed design-system-overhaul branch |
| `18f3c85` | Update PROJECT_ID_BASE and DISPLAY_NAME logic in provision.ts for dynamic app naming |
| `1e299e5` | Uplift Genie Space detail tabs to match app design quality |
| `9e012eb` | Add LLM skills system for structured knowledge injection across all AI surfaces |
| `d95c7b9` | Add SQL extraction and reference handling in space fixer |
| `1884492` | Implement improvement polling and status handling in Genie pages |
| `5b179cb` | Update layout and spacing for consistency across multiple pages |
| `29dcd04` | Refactor OutcomesPage and IngestOutcomeMapPage for improved state management and UI consistency |
| `4aa9c57` | Overhaul LLM skills: 8 skill modules, 12 blind surfaces wired |
| `246a27d` | Fix false-positive hallucination flags and tighten SQL generation quality |
| `307032e` | Improve pipeline and engine performance across 17 areas |
