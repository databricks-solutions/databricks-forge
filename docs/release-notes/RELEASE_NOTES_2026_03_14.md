# Release Notes -- 2026-03-14

**Databricks Forge v0.32.0 → v0.37.3**

---

## v0.32.0 -- Demo Mode

### New Features

#### Demo Mode -- Synthetic Data Generator for Field Engineering & Sales

A complete demo data generation system that creates customer-specific synthetic
datasets in Unity Catalog for live demonstrations.

**Research Engine** -- LLM-powered company research with three depth presets
(Quick / Balanced / Full) that scrapes company websites, discovers investor
relations documents, processes uploaded PDFs, auto-detects industry, and runs
multi-pass strategic analysis to identify priorities, data assets, and
customer-specific nomenclature.

**Data Engine** -- SQL-first synthetic data generation that designs relational
schemas from industry outcome maps, generates dimension and fact tables with
embedded data narratives (trends, spikes, anomalies, seasonal patterns), and
writes directly to Unity Catalog managed Delta tables (2,000--10,000 rows).

Key capabilities:
- 6-step wizard accessible from Settings (Company Info, Research Results,
  Catalog Selection, Schema Review, Generation Progress, Complete)
- Auto-industry detection with on-the-fly outcome map generation for
  industries not in the built-in registry
- Demo scoping by division, department, or functional area
- Per-session cleanup (DROP TABLE/SCHEMA + Lakebase record deletion)
- Real-time progress tracking with per-table phase visibility

Enablement: `./deploy.sh --enable-demo-mode` or `FORGE_DEMO_MODE_ENABLED=true`
in `.env.local`.

See `docs/DEMO_MODE.md` for the full team guide.

### Other Changes

- Updated `AGENTS.md` with Demo Mode architecture documentation
- Added `ForgeDemoSession` Prisma model and Lakebase CRUD operations
- Extended `ForgeOutcomeMap` with `enrichmentJson` for custom LLM-generated
  industry outcome maps
- Added async `getMasterRepoEnrichmentAsync()` fallback to custom enrichment
- Integrated `demo_research`, `demo_generate`, `demo_cleanup` activity actions
- Added `prisma.forgeDemoSession.deleteMany()` to factory reset

---

## v0.32.1 -- Demo Mode Comprehensive Fix

### Improvements

#### Customer Insight Page
New dedicated page at `/demo/sessions/{sessionId}` with a polished, presentation-ready view of all research output -- company overview, SWOT analysis, industry landscape, data strategy, demo flow, killer moments, and competitive positioning. Each section renders conditionally based on the research preset used.

#### PPTX and PDF Export
Research results can now be exported as a branded PPTX slide deck (10--12 slides) or a PDF document from the Customer Insight Page or the sessions table. Both formats skip sections where data is unavailable.

#### Demo Sessions Listing Page
New `/demo` page with a full sessions table replacing the previous inline list in Settings. Supports row-click navigation, export actions, and delete with confirmation.

#### Sidebar Navigation
Demo section appears in the sidebar when `FORGE_DEMO_MODE_ENABLED=true`, with a `useDemoModeEnabled()` hook and `requiresDemoMode` flag for consistent feature gating.

#### Research Progress Timeline
Step-by-step timeline in the wizard with completed/active/pending phase indicators, elapsed timer, and human-readable detail messages at every micro-boundary.

#### Industry Dropdown
Replaced the free-text industry input with a Select dropdown fetching from `/api/industries`, preventing ID normalization mismatches.

#### Enrichment-Only Generation
Outcome map logic now has three cases: skip if both outcome and enrichment exist, generate enrichment only if outcome exists but enrichment is missing, and full generation only when neither exists. Prevents unnecessary regeneration.

### Bug Fixes

- **FK constraint violation** -- removed `upsertJobStatus` calls from both demo engine-status modules; demo jobs now use in-memory tracking only (no writes to `ForgeBackgroundJob` which has an FK to `ForgeRun`).
- **Missing table descriptions** -- seed and fact generation now apply `COMMENT ON TABLE` and `ALTER TABLE ... ALTER COLUMN ... COMMENT` via `buildTableCommentDDL`/`buildColumnCommentDDL` after each table creation.
- **LLM token limit failure** -- changed seed and fact generation from `resolveEndpoint("generation")` to `resolveEndpoint("sql")` for 128K output capacity models.
- **Health endpoint caching** -- moved `demoModeEnabled` into the base (unauthenticated) response object in `/api/health` so the demo flag is always available.
- **Industry ID normalization** -- added `normalizeIndustryId()` with kebab-case, starts-with, and name-based fuzzy matching to prevent "Water Utility" vs "water-utilities" mismatches.

### Other Changes

- Simplified `demo-settings.tsx` to a link card pointing to `/demo`
- Replaced free-text catalog/schema inputs with `CatalogBrowser` component + "Create new catalog" toggle
- Added `DemoIcon` SVG to sidebar icon set
- Updated `docs/DEMO_MODE.md` with all new features, routes, and file references
- Dense progress messages throughout the Research Engine analytical pipeline

---

## v0.33.0 -- Launch Discovery from Demo Sessions

### New Features

#### Launch Discovery & Estate Scan from Demo Sessions
After demo data generation completes, users can now launch a Discovery Pipeline
or Estate Scan directly from both the wizard completion step and the session
detail page. Buttons call the existing `/api/runs` and `/api/environment-scan`
endpoints with the generated schema scope, customer name, and industry pre-filled.

#### Session Detail Page Redesign
The demo session detail page has been redesigned with:
- Dark hero banner with customer name, industry badge, schema FQN, and live KPI stats
- Sticky command bar with Launch Discovery, Estate Scan, and Export actions
- Collapsible research sections with accent-colored borders and contextual icons
- SWOT analysis rendered as a 2x2 color-coded grid
- Market forces with urgency badges, demo flow as a vertical timeline
- Killer moments, competitive positioning, and executive talking points sections

### Bug Fixes

- **Data Engine cascade failure** -- Failed dimension tables (e.g. `dim_date`) are
  now filtered out before fact generation, preventing cascading
  `TABLE_OR_VIEW_NOT_FOUND` errors across all downstream fact tables.
- **Spark datetime pattern errors** -- Added explicit rules to demo SQL constraints
  and global `DATABRICKS_SQL_RULES` forbidding `'u'`, `'e'`, `'c'`, `'L'` patterns
  in `DATE_FORMAT()` which cause `DATETIME_PATTERN_RECOGNITION` errors on Databricks.
- **Smart fact retry** -- The `TABLE_OR_VIEW_NOT_FOUND` retry in fact generation now
  parses the missing table name, removes it from the dimension context, and adds an
  explicit constraint telling the LLM not to reference it.
- **Export 500 errors** -- Added try-catch with structured logging to the demo export
  API route. Both PPTX and PDF generators now use optional chaining on all
  LLM-parsed array properties (priorities, urgency signals, SWOT, market forces,
  benchmarks, asset details) preventing crashes on partial research results.

---

## v0.34.0 -- Mining & Resources Industry

### New Features

#### Mining & Resources Industry Outcome Map
Added a dedicated industry outcome map for **Mining & Resources**, covering the strategic priorities of major miners such as BHP Group, Rio Tinto, Fortescue, and South32.

- **Base outcome map** (`mining.ts`) with 6 strategic objectives, 10 priorities, and 30 reference use cases spanning mine operations, safety, logistics, ESG, exploration, and business functions.
- **Enrichment data** (`mining.enrichment.ts`) with 30 benchmarked use cases (KPI targets, benchmark impacts, model types, data asset criticality mappings) and 30 Reference Data Assets covering the full mining value chain.
- **Sub-verticals**: Iron Ore, Coal, Copper & Base Metals, Gold & Precious Metals, Lithium & Battery Minerals, Alumina & Aluminium, Nickel & Cobalt, Manganese & Alloys.
- **Industry aliases** updated so "mining", "metals and mining", "iron ore", "base metals", "precious metals", "battery minerals", etc. now resolve to the dedicated mining outcome map instead of falling back to Energy & Utilities.
- "Mining" removed from Energy & Utilities sub-verticals to avoid overlap.

---

## v0.34.1 -- Demo Engine SQL Robustness

### Improvements

#### Demo Engine SQL Robustness (6 new constraint rules)
Added six critical SQL constraint rules to `DEMO_DATA_SQL_CONSTRAINTS`: INTERVAL+DATE casting, safe modulo with `GREATEST()`, BIGINT overflow prevention, `get()` instead of `element_at()`, `rand()` misuse guard, and self-referencing table prohibition.

#### Schema Design Performance
Switched schema design from the `reasoning` endpoint to `generation`, reduced `maxTokens` from 32K to 16K, and simplified the prompt to target 8-12 lean demo tables instead of 35+ enterprise-scale models.

#### Inline Table Comments
Table descriptions are now included as `COMMENT` clauses directly in `CREATE TABLE` statements, eliminating redundant post-creation `COMMENT ON TABLE` DDL round-trips.

#### Cascading Failure Resilience
Fact table generation now checks if all referenced dimension tables failed, and skips doomed fact tables early instead of generating SQL that references non-existent tables.

#### Research Summary Redesign
Replaced the flat stat boxes with a polished editorial layout: icon stat ribbon, numbered priority list, two-column nomenclature grid, and compact header with status indicator.

#### Schema Review Redesign
Replaced visual chaos with structured cards: pill-style data asset chips, narrative cards with pattern badges, divided nomenclature table, and accent-bordered demo highlight cards.

#### Smart PDF and PPTX Page Breaks
PDF `drawTable()` now paginates rows across pages with header repetition. PDF and PPTX use case detail rendering creates continuation pages/slides instead of silently dropping overflow fields.

### Bug Fixes

- **CatalogBrowser catalog selection** -- Schema mode now shows a "Select" button on catalog rows, allowing catalog-level selection in the demo wizard with auto-generated schema name.
- **Generation timer missing** -- Added elapsed timer to `GenerationProgressStep` and total wizard time display on `CompleteStep`.
- **Clickable demo sources** -- Added `url` field to `ResearchSource` interface, populated from website-scrape, strategic-crawl, and IR-crawler passes. Sources on the session detail page are now clickable links to original URLs.

---

## v0.34.2 -- Lakebase Scale-to-Zero Fix

### Bug Fixes

- **Lakebase scale-to-zero provisioning** -- Split the combined `no_suspension` + `suspend_timeout_duration` PATCH into two sequential API calls. The Lakebase API requires these fields to be updated independently; the combined update_mask was silently ignored, leaving the timeout at the API default (300s) regardless of the configured value. Now the first call disables suspension, the second sets the custom timeout, with graceful fallback if the timeout call fails.

---

## v0.34.3 -- Research Engine Speed

### Improvements

#### Research Engine speed optimization for balanced preset

The balanced research preset now routes LLM calls through generation-tier
models (Claude Sonnet 4.6, Gemini Flash, Llama Maverick) instead of
hardcoding to Claude Opus 4.6. This reduces wall-clock time from ~8.5
minutes to ~2-3 minutes for a typical balanced run. The full preset retains
reasoning-tier (Opus) routing for maximum quality.

Key changes:

- Added per-preset `modelTier` to `ResearchBudget` (quick=classification,
  balanced=generation, full=reasoning).
- Refactored `resolveResearchEndpoint()` to accept an optional tier,
  delegating non-reasoning tiers to the queue-depth-aware task router.
- Lowered balanced `maxTokensPerPass` from 32,000 to 16,000 (outputs are
  structured JSON that rarely exceeds 8K tokens).
- Parallelized embedding with the industry classification and outcome map
  pipeline to eliminate serial wait.

### Bug Fixes

- **Enrichment-only generation used reasoning tier** -- `runEnrichmentOnlyGeneration` documented "uses the generation tier (faster)" but actually called the reasoning endpoint. Now correctly routes to generation tier.
- **Industry classification used reasoning tier** -- A 512-token classification task was being sent to Opus. Now always routes to classification tier regardless of budget.

---

## v0.35.0 -- Auto-Launch Discovery + Strategic Persona

### New Features

#### Auto-Launch Discovery After Demo Data Generation
The Demo Data Wizard now automatically creates and executes a Discovery Pipeline with Environment Scan enabled as soon as data generation completes. Users no longer need to manually click separate "Launch Discovery" and "Run Estate Scan" buttons -- the wizard handles it in one seamless flow, redirecting directly to the run page. A manual fallback button appears if auto-launch fails.

#### Strategic Persona Questions in Ask Forge
The Strategic (C-level) persona in Ask Forge now generates context-aware executive questions: total business value, ROI prioritisation, board-level summaries, strategic alignment gaps, and transformation roadmaps. Previously the strategic persona fell through to the analyst branch, producing data-quality and PII questions instead of executive insights.

### Improvements

#### Shared Strategic Fallback Questions
Moved `FALLBACK_QUESTIONS_STRATEGIC` from the client-side component to the shared `suggested-question-defaults.ts` module so both server-side dynamic question generation and client-side fallbacks use the same set of C-level questions.

#### Wizard Step Labels
Updated the final wizard step label from "Done" to "Launch" and the description to "Launching discovery pipeline..." to reflect the new auto-launch behaviour.

---

## v0.35.1 -- SQL Review Quality

### Bug Fixes

- **SQL reviewer severity inflation** -- The LLM-based SQL reviewer was classifying stylistic and idiom issues (e.g. missing COLLATE, no explicit window frame) as "error" severity, which forced expensive fix cycles on functional SQL. Added explicit severity classification guidance so only runtime failures (syntax errors, hallucinated columns, wrong JOINs) produce `fixed_sql`. Warnings and info issues are reported but no longer trigger rewrites. Affects all engines: pipeline, dashboard, and Genie.

- **Missing skill injection in pipeline SQL generator** -- The `{skill_reference}` placeholder was computed by the pipeline SQL generation step but never actually inserted into the `USE_CASE_SQL_GEN_PROMPT` template. The generator was operating without the SQL craft knowledge from the skills system. Now wired correctly.

### Improvements

#### Databricks SQL dialect context block
Added a compact quick-reference of Databricks SQL dialect differences (e.g. `PERCENTILE_APPROX` not `MEDIAN`, `array_join(collect_list(...))` not `STRING_AGG`, named window limitations) directly in the pipeline SQL generator prompt. This reduces first-pass errors from generators unfamiliar with Databricks idioms.

#### Pre-response self-check for SQL generators
New `DATABRICKS_SQL_SELF_CHECK` exported from `lib/toolkit/sql-rules.ts` -- a structured checklist (correctness, performance, readability, Databricks idioms) that the generator must verify before responding. Injected into the pipeline SQL generation prompt.

#### Enhanced SQL review fix logging
When the reviewer applies a fix in the pipeline, logs now include `qualityScore`, `verdict`, `issueCount`, and the top 3 issues sorted by severity. This improves observability for diagnosing persistent review failures.

---

## v0.35.2 -- Demo Data & Pipeline Speed

### Bug Fixes

- **Demo Data Generator: CTE column scoping error** -- Added a CTE Column Scoping rule to the SQL generation prompt so the LLM no longer references aliased-away column names in downstream CTEs. Also wired the runtime SQL error into the reviewer so retry attempts are informed fixes instead of blind re-reviews.

- **Demo Wizard: auto-launch without pause** -- The completion step no longer auto-launches the discovery pipeline immediately. Users now see the generation summary (tables, rows, duration) and must click "Start Discovery Run" to proceed.

- **Pipeline SQL generation: excessive review latency** -- Removed the per-use-case LLM review call during pipeline SQL generation. EXPLAIN validation and column-hallucination checks still catch runtime errors; the review was adding ~10-15s per use case for mostly cosmetic warnings.

- **SQL generation progress bar premature completion** -- Fixed the progress interpolation range (67-95 changed to 67-79) so the UI no longer marks SQL generation as "done" when only half the use cases are processed.

### Other Changes

- `ReviewOptions` in `lib/ai/sql-reviewer.ts` now supports an optional `runtimeError` field, injected as a priority section in the review prompt for any consumer that needs error-targeted fixes.

---

## v0.36.0 -- Build Mode Selector

### New Features

#### Build Mode Selector

A new shared `BuildModeSelector` component gives users an explicit choice between **Full Engine** (recommended) and **Quick Build** before generating a Genie Space. This replaces the previous behavior where Ask Forge auto-started a fast build and Schema Scan / Upload Requirements pages only offered the full engine.

The selector is now available in all three creation entry points:
- **Ask Forge** (GenieBuilderModal) -- shows a choice screen before building
- **Scan Schema** page -- replaces the single "Generate" button
- **Upload Requirements** page -- replaces the single "Generate" button

Full Engine is highlighted as the recommended default.

### Improvements

#### Instant space visibility after deployment
Deployed Genie Spaces now appear immediately in the Genie Studio listing without requiring a manual "Sync Spaces". The deploy flow writes the new space to `ForgeGenieSpaceCache` alongside the existing `ForgeGenieSpace` tracking entry.

#### Build progress tiles for all build modes
Synchronous fast builds now create an in-memory server-side job, so a progress tile with a progress bar appears on the Genie Studio page while the build runs. Previously, fast builds from Ask Forge were invisible to Genie Studio.

#### Accurate card titles after generation
Generate job tiles now show the actual space name from the recommendation instead of the generic "Genie Space Ready" fallback. Title and domain are backfilled from the recommendation on both synchronous and asynchronous completion paths.

#### Deploy status propagation
After deploying from the build page or Ask Forge modal, the generate job tile badge correctly updates from "Ready" to "Deployed". Both the build page and GenieBuilderModal now PATCH the generate job with the deployed space ID.

### Bug Fixes

- **Card shows "Genie Space Ready" instead of space name** -- Title and domain are now backfilled from the recommendation when the generate job completes.
- **Card stays "Ready" after deployment** -- Both the build page and GenieBuilderModal now mark the generate job as deployed via PATCH.
- **Deployed space invisible until sync** -- `upsertCachedSpaces` is called in `runDeploy()` after `trackGenieSpaceCreated()`.
- **Unused `Zap` imports** -- Removed from Schema Scan and Upload Requirements pages after replacing buttons with `BuildModeSelector`.

---

## v0.36.1 -- Rename Demo Sessions to Demo Studio

### Improvements

#### Rename "Demo Sessions" to "Demo Studio"

The Demo section has been rebranded from "Demo Sessions" to "Demo Studio" across
the sidebar navigation, page heading, and session detail breadcrumbs for a more
polished, product-oriented feel.

---

## v0.36.2 -- Consolidate Release Notes (One File Per Day)

### Improvements

#### Release Notes Consolidation
Merged 38 release notes files down to 12 (one per day). Days that previously
had multiple suffix files (e.g. `b`, `c`, `d` ... `l`) now have a single file
with versioned subsections. Updated the release notes generation and gogo ship
rules to append new versions to the existing day's file instead of creating
suffix files.

---

## v0.36.3 -- Demo Session Launch Fix

### Bug Fixes

- **Demo session catalog/schema not persisted** -- The demo session was created
  with empty `catalogName` and `schemaName` during the research step, and the
  generate route never wrote them back to the database. Launching Discovery or
  Estate Scan from the session detail page produced UC metadata scope `.` (empty),
  failing immediately at metadata extraction. The generate route now persists
  `catalogName` and `schemaName` when transitioning the session to "generating".
- **"View full research briefing" opens in same window** -- The link in the
  wizard completion step now opens the session detail page in a new browser tab
  instead of navigating away from the wizard via `router.push`.
- **mkdocs nav stale release note references** -- Removed deleted suffix release
  note files from `mkdocs.yml` navigation that were causing 404s on the docs site.

---

## v0.37.0 -- Sales Briefing Redesign

### Improvements

#### Demo Session Detail Page: Sales-First Briefing Experience

Complete redesign of the `/demo/sessions/[sessionId]` page from a long research
dump into an executive sales briefing optimised for 90-second scanability.

**New information architecture:**
- **Briefing header** with account thesis, best wedge, why-now signal, confidence
  badge, and three-tier CTAs (Start Discovery / Open Talk Track / View Evidence)
- **Meeting Summary Strip** -- 5 compact cards (Top Priority, Best Use Case,
  Main Risk, Best Buyer, Proof Strength) for instant pre-meeting context
- **Tab-based navigation** replacing vertical scroll: Summary, Opportunities,
  Talk Track, Evidence, Sources
- **Sticky sidebar rail** (desktop) with account thesis, top 3 opportunities,
  quick actions, export, and confidence/source stats

**Summary tab** includes Executive Brief card (who they are / what they care
about / what is likely broken / best opening angle), "So what this means for us"
callout, Priorities & Gaps, Compact SWOT (2x2 mini-grid, no pastel fills), and
Industry Trends as chips with collapsible detail.

**Opportunities tab** transforms Killer Moments into ranked opportunity cards
with business pain, value hypothesis, discovery hook, linked data assets,
confidence, urgency, ideal buyer, and "Use in Talk Track" CTA.

**Talk Track tab** provides persona-based selling guidance (CEO, COO, CIO/CTO,
Head of Digital, Risk/Compliance) with what they care about, what to say,
expected objection, proof to use, and best next question.

**Evidence tab** structures claims with confidence levels, evidence counts,
freshness indicators, and supporting source snippets.

**Data Readiness** redesign replaces cryptic asset IDs with relevance scores,
criticality badges, quick-win flags, and linked use cases.

**Component architecture** -- 11 new modular components:
`ResearchHeader`, `MeetingSummaryStrip`, `ExecutiveBriefCard`, `CompactSwot`,
`SummaryTab`, `OpportunitiesTab` / `OpportunityCard`, `PersonaTalkTrack`,
`EvidenceList`, `SourceList`, `DataReadinessList`, `StickyBriefRail`.

Page reduced from 850 lines in a single file to 210 lines orchestrating
focused components. Desktop layout uses max-w-[1440px] with main content +
288px sticky right rail; mobile stacks cleanly with preserved tabs.

---

## v0.37.1 -- SEC EDGAR False Match Fix

### Bug Fixes

- **SEC EDGAR matches wrong company for non-US domains** -- The Research Engine's
  SEC EDGAR fallback used an overly loose name-matching algorithm that checked if
  the domain name *contained* the first word of any SEC title. For companies like
  "O REILLY AUTOMOTIVE INC", the first word is `"o"` -- a single character that
  matches virtually any domain. An Australian company's website was incorrectly
  matched to O'Reilly Automotive (CIK 0000898173), injecting a completely
  unrelated 10-K filing into the research context.

  Three fixes applied:
  1. **Country-code TLD guard** -- `isNonUsDomain()` detects `.com.au`, `.co.uk`,
     `.de`, and 40+ other ccTLDs and skips SEC EDGAR entirely for non-US domains.
  2. **Scored prefix matching** -- Replaced the naive `.includes()` with
     `findBestEdgarMatch()` that normalizes both names (stripping spaces and
     punctuation), requires prefix alignment, scores candidates by overlap ratio,
     and rejects matches below 40% similarity.
  3. **Exact ticker match priority** -- Ticker symbols are checked first as the
     highest-confidence match before falling back to name comparison.

- **Dead EDGAR search API calls** -- Removed two unused `efts.sec.gov` search
  index fetches that were executed but whose responses were never consumed.

---

## v0.37.2 -- Genie Studio Workflow Fixes

### Bug Fixes

- **Persona not defaulting on navigation** -- Navigating from Genie Studio "Describe Your Space" to Ask Forge now correctly sets the genie-builder persona via a useEffect that syncs from URL params, resetting the conversation state for a fresh chat.
- **Aggressive genie-builder guardrail** -- Softened the GENIE_BUILDER_PERSONA_OVERLAY prompt so it treats all user messages as input for building a Genie Space instead of refusing with "Let's stay focused on building your Genie Space."
- **Inline sources removed from chat** -- SourceCardList has been removed from the chat for all personas. Sources remain in the right-hand context panel with clickable navigation links for table, use case, genie, and environment sources.
- **Missing build mode prompt** -- The "Create Genie Space" action in Ask Forge now opens the GenieBuilderModal (Fast vs Full Engine choice) instead of silently starting a fast build.
- **Build cards invisible with no spaces** -- Build progress cards now render when no synced spaces exist by including job count in the empty-state condition.
- **Text overflow on build cards** -- Added min-w-0, truncate, and shrink-0 to card flex containers and text elements to prevent content from bleeding out of card boundaries.
- **Deployed card still visible** -- Build job cards are now filtered by `deployedSpaceId` to prevent duplicate cards after deployment.
- **Build toast persists forever** -- Deployed toast now auto-dismisses after 10 seconds and includes an X close button.
- **Misleading "Run AI Comments" advice** -- Removed the hardcoded link from health check UI. Made `tables-have-column-configs` and `format-assistance-configured` fixable with `column_intelligence` strategy. Extended the fixer to enable `enable_format_assistance` and `enable_entity_matching` on existing columns.
- **Fix strategy metadata retrieval broken** -- `buildMetadataForSpace` used `Array.isArray(result)` on the SqlResult object (always false) and named property access on positional arrays. Fixed to iterate `result.rows` with positional indexing, unblocking all SQL-generating fix strategies (benchmarks, trusted assets, semantic expressions).
- **Health check categories always expanded** -- Accordion now defaults to expanding only categories with failing checks. Added status icons (green check, red X, amber warning) to category triggers.
- **Targeted improve crash** -- The "Improve with Genie Engine" targeted path now includes `updatedSerializedSpace` in the result. The UI safely falls back through `recommendation?.serializedSpace`, `updatedSerializedSpace`, and `originalSerializedSpace`.

### Improvements

#### Benchmark Test Runner Redesign
Replaced the cramped 3-column step tile grid with a horizontal flow layout featuring numbered step badges, connecting arrows, staggered entrance animations, and a single CTA button.

#### Context Panel Source Navigation
Sources in the right-hand context panel now include clickable external-link icons that navigate to the relevant page (table detail, use cases, genie, environment) based on source kind.

---

## v0.37.3 -- Ask Forge & Health Check Fixes

### Bug Fixes

- **Ask Forge source noise in chat** -- Removed `enforceSourceCitations` which
  appended a raw `### Sources` block (e.g. `[1] [GENERATED INTELLIGENCE] (use_case)`)
  to the answer text when the LLM omitted inline citations. Sources are already
  shown in the right-hand context panel; the duplicate text in the chat was noisy
  and unhelpful.

- **Genie builder modal stays open** -- The "Create Genie Space" action in Ask
  Forge kept the modal open during generation with its own progress UI. Refactored
  `GenieBuilderModal` to use `useGenieBuild().startBuild()` with async mode,
  closing the modal immediately after Quick/Full selection and showing a persistent
  build progress toast instead.

- **Column config changes invisible in Preview** -- The health check "Preview
  Changes" diff viewer only detected added/removed tables, not modifications to
  `column_configs` on existing tables. Added `diffColumnConfigs()` that compares
  column descriptions, synonyms, and flags within matched tables, with a new
  "Column Configs" section showing added/modified/removed columns in amber/green/red.

- **Benchmark fix only adds 3 questions** -- The health check fix for "Benchmark
  questions exist (5+ recommended)" passed `useCases: []` and used the default
  `BENCHMARKS_PER_BATCH` of 4. After validation drops, this yielded ~3 benchmarks.
  Increased the fix target to 8 benchmarks per batch, comfortably exceeding the
  5+ threshold after validation.

---

## All Commits

| Hash | Summary |
|---|---|
| *(pending)* | feat: Demo Mode wizard with Research Engine and Data Engine |
| *(pending)* | fix: Demo Mode comprehensive enhancements -- insight page, export, progress, industry matching, FK fix, table comments |
| *(uncommitted)* | fix: demo engine robustness, export null safety, session detail UX redesign |
| *(pending)* | feat: add Mining & Resources industry outcome map with enrichment |
| *(pending)* | fix: demo engine overhaul -- SQL robustness, schema speed, wizard UX, exports |
| *(pending)* | fix: split Lakebase scale-to-zero into two PATCH calls for reliable timeout |
| *(uncommitted)* | perf: research engine speed -- tiered model routing, lower token budgets, parallel embedding |
| *(pending)* | feat: auto-launch discovery after demo generation + fix strategic persona questions |
| `24c5d79` | fix: reduce SQL review severity inflation and inject missing skill reference into pipeline generator |
| *(uncommitted)* | fix: demo data retry, wizard pause, pipeline SQL speed, progress bar accuracy |
| *(pending)* | feat: build mode selector + fix Genie Studio card visibility/title/deploy status |
| *(pending)* | chore: rename Demo Sessions to Demo Studio across UI |
| *(pending)* | chore: consolidate release notes into single files per day |
| `7c546aa` | fix: persist demo session catalog/schema so Launch Discovery works |
| *(pending)* | fix: SEC EDGAR false match for non-US domains -- ccTLD guard, scored matching, dead code cleanup |
| `80422be` | fix: Ask Forge source noise, Genie modal toast, health check column diff, benchmark count |
| `c4ce20d` | fix: update mkdocs nav to consolidated release notes |
