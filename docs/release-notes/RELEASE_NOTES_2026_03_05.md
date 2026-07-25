# Release Notes -- 2026-03-05

**Databricks Forge v0.7.0 → v0.9.0**

---

## v0.7.0 -- Microsoft Fabric / Power BI Connector

### New Features

#### Microsoft Fabric / Power BI Connector
A new end-to-end integration for scanning, understanding, and migrating Power BI estates to Databricks-native artifacts. Key capabilities:

- **Connections management** -- Add and test Microsoft Entra ID (Azure AD) service principal connections with AES-256-GCM encrypted secret storage. Supports both Admin Scanner API (tenant-wide) and Per-Workspace API (reduced scope) access levels.
- **Fabric scan engine** -- Orchestrated scanner pulls workspaces, datasets (tables, measures, relationships, expressions), reports (tiles, dataset bindings), and Fabric artifacts (Lakehouses, Warehouses, Dataflows Gen2, etc.) into Lakebase with real-time progress tracking.
- **Migration wizard** -- Sequential 4-step migration pipeline: (1) Gold schema proposal with LLM-enhanced DDL, (2) DAX-to-SQL measure translation with confidence scoring, (3) Lakeview dashboard generation, (4) Genie Space generation.
- **Type mapping & name normalization** -- Power BI data types mapped to Databricks Spark SQL types. PBI identifiers normalized to UC-safe snake_case with full name-mapping ledger.
- **DAX-to-SQL translator** -- Hybrid approach: deterministic templates for simple DAX patterns and LLM-assisted translation with confidence scoring for complex expressions.
- **Ask Forge RAG integration** -- Scanned Fabric metadata embedded into the vector store. Off-platform resources appear in Ask Forge with a distinct "PBI" badge.
- **Mock fixtures** -- Hardcoded Admin Scanner API response fixture for local development and CI testing.

#### Sidebar Navigation Sections
The left navigation is now organized into four labelled sections -- **Explore**, **Deploy**, **Migrate**, and **Admin** -- separated by subtle dividers.

### Improvements

#### Ask Forge Multi-SQL Block Navigation
SQL blocks in assistant responses are now tracked as an array, allowing users to navigate between multiple SQL queries within a single answer.

#### Run SQL from Answer Stream
Users can now execute SQL directly from rendered assistant answers via an inline "Run SQL" action.

#### Analyst Persona
The `AssistantPersona` type now includes `"analyst"` alongside `"business"` and `"tech"`. New business-focused suggested questions are included for the analyst role.

#### Outcome Map Template Download
The Outcome Map ingest page now offers a downloadable structured markdown template.

#### Metric View Snake_case Naming and Display Names
Metric view dimension and measure `name` fields are now generated as SQL-friendly snake_case identifiers. A new `display_name` field provides the human-readable label. A new `autoRenameShadowedMeasures` function deterministically renames measures that shadow source column names.

#### Fast Genie Engine: LLM-Generated Expressions
The fast (ad-hoc) Genie engine now generates measures, filters, and dimensions via a lightweight LLM call instead of purely rule-based heuristics. Falls back to the original rule-based path if the LLM call fails.

#### Expanded Key Synonym Dictionary
The canonical join-key synonym dictionary expanded from 5 key groups to 25. A generic fallback now also matches any shared column ending in `_id` or `_key`.

#### Time Period Date Column Prioritization
`generateTimePeriods` now prioritizes date columns by business relevance and caps the number of date columns processed per space (default 6).

#### Schema Allowlist: SQL Comment Stripping
`findInvalidIdentifiers` now strips SQL comments before scanning for identifier references.

#### Lineage Table Metadata Enrichment
New `fetchTableInfoBatch` function retrieves `tableType` and `dataSourceFormat` from `information_schema.tables` for lineage-discovered tables.

#### Smart Enrichment Skipping for Non-Physical Tables
`enrichTablesInBatches` now uses `tableType` to skip DESCRIBE operations for non-physical table types (VIEW, FOREIGN, MATERIALIZED_VIEW).

#### Quality Gate: Deployment Warning UX
The Genie deployment API routes no longer hard-block requests based on quality gate decisions. Instead, the `GenieBuilderModal` presents a confirmation prompt.

### Bug Fixes

- **Quality gate: missing joins now block deployment** -- `determineQualityGate` returns `"block"` instead of `"warn"` when `no_validated_joins` is present.
- **column_tags / table_tags incorrect column names** -- `getTableTags` and `getColumnTags` now use the correct `catalog_name` and `schema_name` columns.

---

## v0.8.0 -- Genie Space Health Check Engine

### New Features

#### Genie Space Health Check Engine
A deterministic, YAML-driven health check system that scores any Genie Space (Forge-generated or off-platform) against 20 built-in best-practice checks across 4 categories: Data Sources, Instructions, Semantic Richness, and Quality Assurance. Returns a letter grade (A-F) with per-category breakdowns and actionable quick wins.

#### Fix Workflow (Automated Remediation)
Health check failures can be automatically remediated via the existing Genie Engine passes. The fixer maps failed checks to 8 fix strategies, generates improvements, shows a diff preview, and pushes changes back to the Genie Space. Works on off-platform spaces by building MetadataSnapshot from `information_schema`.

#### Benchmark Feedback Loop
An iterative quality improvement cycle: run benchmark questions via the Genie Conversation API (with SSE real-time progress), label results as correct/incorrect with optional feedback, generate targeted improvements based on failure patterns, apply fixes, and re-run.

#### Health Check Configuration
User-configurable health checks via API: disable built-in checks, adjust thresholds, change severity, add custom checks with any of the 11 evaluator types, and override category weights.

### Improvements

#### Card Overflow Fix
Fixed a UX bug where long titles caused badges to spill outside the SpaceCard boundary on the `/genie` page.

#### Space Caching
Added an in-memory cache with 5-minute TTL for `serialized_space` JSON.

#### Benchmark Run Rate Limiting
Added 2-second delay between benchmark questions to avoid Genie API throttling, plus an in-memory lock to prevent concurrent benchmark runs.

#### Clone + Fix for Off-Platform Spaces
New `/api/genie-spaces/[id]/clone` endpoint creates a copy of an off-platform space before applying fixes.

### Other Changes
- Added 3 new Prisma models: `ForgeSpaceBenchmarkRun`, `ForgeSpaceHealthScore`, `ForgeHealthCheckConfig`
- Added 71 unit tests across 5 test files
- Created comprehensive documentation: `docs/GENIE_HEALTHCHECK_ENGINE.md`
- Added `yaml` npm dependency for YAML parsing

---

## v0.9.0 -- Space Discovery + Detail Page + Optimization Review

### New Features

#### Space Discovery & Stale Validation
When the Genie Spaces page loads, the system now cross-references workspace spaces against Lakebase tracked spaces to automatically filter out stale entries. A new `POST /api/genie-spaces/discover` endpoint combines metadata extraction and health scoring in one call using bounded concurrency.

#### Space Detail Page
New dedicated page at `/genie/[spaceId]` with four tabs:
- **Overview** -- key stats, domain, status, and quick actions (Open in Databricks, Run Benchmarks, Clone, View Run)
- **Configuration** -- full `serialized_space` displayed in an accordion layout via the new `SpaceConfigViewer` component
- **Health** -- inline health report with grade, quick wins, category progress bars, per-check details, and Fix/Fix All buttons
- **Benchmarks** -- link to the benchmark test runner

#### Optimization Review Step
Both health fix and benchmark improve workflows now route through an intermediate review step before applying changes. The `OptimizationReview` component displays prioritized suggestions with select/deselect checkboxes, strategy summaries, and three actions: Apply to Space, Clone and Apply, or Cancel.

#### Diff Preview
New `SpaceDiffViewer` component provides a side-by-side comparison of current vs proposed `serialized_space` configurations with line-level highlights and change summary statistics.

#### Space Config Viewer
New read-only accordion component displaying all sections of a `SerializedSpace`: Data Sources, Instructions, SQL Snippets, Benchmarks, and Sample Questions, with count badges on each section header.

### Improvements

#### OBO Authentication for Genie API Reads
Switched `listGenieSpaces()` and `getGenieSpace()` from Service Principal auth to OBO auth. This forwards the logged-in user's token to enforce user-level permissions, resolving 403 `PERMISSION_DENIED` errors.

#### Space Metadata Extraction Utility
New shared module `lib/genie/space-metadata.ts` extracts structured metadata (12 fields) from a `serialized_space` JSON string.

#### Enriched Space Cards
Space cards on the `/genie` list page now display metadata counts (tables, measures, questions, filters).

#### Benchmark Improve No Longer Auto-Applies
The "Improve" action now displays the Optimization Review component instead of automatically applying changes.

### Other Changes
- New API routes: `GET /api/genie-spaces/[spaceId]/detail`, `POST /api/genie-spaces/discover`
- Space card clicks navigate to the new detail page
- Clone button exposed on Space Detail overview tab and in Optimization Review

---

## All Commits

| Hash | Summary |
|---|---|
| `5af5abe` | Enhance Ask Forge SQL handling and improve outcome map functionality |
| `0bf018c` | Refactor persona handling and enhance assistant functionality |
| `6d61a8a` | Increment version to 0.6.2 and update release notes |
| `e7c315d` | Update timestamps for app.yaml and assembler.ts in sync-snapshots |
| `1c1017c` | Update quality gate logic and enhance metric view definitions |
| `fe2ae22` | Refactor quality gate handling and enhance deployment logic |
| `cdfb55c` | Enhance Fabric integration and add incremental scan support |
| `59735c7` | Refactor logging statements for improved clarity and consistency |
| `f2b6fbf` | Refactor and clean up imports and state management in various components |
