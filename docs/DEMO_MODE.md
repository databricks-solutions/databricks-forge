# Demo Mode

> Team guide for Field Engineering and Sales -- generate custom synthetic
> demo datasets tailored to a specific customer, industry, and business
> division.

Demo Mode researches a target company using LLM-powered intelligence,
designs a relational data model from industry outcome maps, and writes
realistic demo data directly to Unity Catalog managed Delta tables. The
entire workflow runs from a 6-step wizard accessible from the **Demo
Sessions** sidebar entry or from **Settings**.

---

## Table of Contents

1. [Enabling Demo Mode](#enabling-demo-mode)
2. [Research Presets](#research-presets)
3. [Wizard Walkthrough](#wizard-walkthrough)
4. [Demo Scope](#demo-scope)
5. [Genie Mode](#genie-mode)
6. [Customer Insight Page](#customer-insight-page)
7. [Exporting Research](#exporting-research)
8. [After Generation](#after-generation)
9. [Managing Sessions](#managing-sessions)
10. [Architecture](#architecture)
11. [API Reference](#api-reference)
12. [Troubleshooting](#troubleshooting)
13. [File Reference](#file-reference)

---

## Enabling Demo Mode

Demo Mode is **disabled by default** and is now a workspace-shared runtime
toggle persisted to Lakebase (`ForgeAppConfig` singleton). Any authenticated
user can flip it from the Settings page; **no redeploy is needed**.

### From the UI (preferred)

1. Open **Settings** in the sidebar.
2. Find the **Feature Flags** card (between "About" and "Data Management").
3. Toggle **Demo Mode** on.
4. The page reloads and the **Demo** section appears in the sidebar.

The toggle is workspace-shared, so the change becomes visible to every user
on their next page load. Toggle events are recorded to the activity log
(`app_config_updated`) for audit.

### Seeding via env var (optional)

`FORGE_DEMO_MODE_ENABLED=true` only **seeds the initial value** on first
read of the singleton row. After that the Settings UI is the source of
truth. Use this when you want a deployment to come up with Demo Mode
already on:

Local dev — add to `.env.local`:

```
FORGE_DEMO_MODE_ENABLED=true
```

Databricks Apps deployment:

```bash
./deploy.sh --enable-demo-mode
```

Combine with other flags as normal:

```bash
./deploy.sh \
  --warehouse "My SQL Warehouse" \
  --enable-demo-mode \
  --enable-metric-views \
  --reasoning-endpoint-2 "databricks-claude-opus-4-6"
```

### Verification

Once enabled (via UI or env var seed):
- A **Demo** section appears in the sidebar with a "Demo Sessions" link.
- The **Settings** page shows a Demo Mode card with a quick link.
- Navigate to `/demo` to see the full sessions listing.

If the section does not appear:
- Confirm the singleton row's `demoModeEnabled` is `true` — check
  `/api/health` (response includes `"demoModeEnabled": true`) or
  `/api/settings/feature-flags`.
- Hard-refresh the browser to clear cached settings state.
- The flag is cached in process memory for 30s; in multi-pod setups the
  toggle takes up to 30s to fully propagate (acceptable because Demo Mode
  is a feature-visibility gate, not a security boundary).

### Disabling

Flip the **Demo Mode** toggle off in Settings. The env var is ignored
once the singleton row exists. To force the env var to re-seed (e.g. after
testing), use the Settings page's **Data Management → Delete all data**
action, which drops `ForgeAppConfig` and lets the env var seed it again
on next read.

---

## Research Presets

The wizard offers three research depth levels. Choose based on how much
time you have and how polished the demo needs to be.

| Preset | Sources | Analysis | Estimated Time | Best For |
|---|---|---|---|---|
| **Quick** | Website only | Single synthesis pass (+ best-effort evidence-linking) | 25--55 s | Fast standups, internal testing |
| **Balanced** | Website + investor docs | Phase-1 fan-out (landscape ∥ key-quotes ∥ source-summaries) → combined strategy-narrative → Phase-5 fan-out (persona-talk-track ∥ evidence-linking) | 75--180 s | Customer meetings with reasonable prep time |
| **Full** | Website + IR docs + uploads | Phase-1 fan-out → deep-dive → data strategy → demo narrative → Phase-5 fan-out. Produces consultant-grade executive brief, 6 opportunities, 5 persona talk tracks, and a quote-backed evidence register | 3--5 min | High-stakes executive demos, QBRs |

All presets allow industry selection from a dropdown of known industries,
or auto-detection from website content when left as "Auto-detect". If the
detected industry has no built-in outcome map, the engine generates one
from scratch and persists it for reuse. If an outcome map exists but has
no enrichment data, only the enrichment layer is generated (faster).

---

## Wizard Walkthrough

### Step 1: Company Info

| Field | Required | Notes |
|---|---|---|
| Customer Name | Yes | e.g. "Rio Tinto", "ANZ Bank" |
| Website URL | No | Scraped for company context. Division-specific subpages are also probed. |
| Industry | No | Select from dropdown or leave as "Auto-detect from website". |
| Research Depth | Yes | Quick / Balanced / Full (see above). |
| Division / Scope | No | Narrows the demo to a business unit. See [Demo Scope](#demo-scope). |
| Demo Objective | No | Free text describing what the demo should emphasise. |
| **Genie Mode** | No | Toggle. Biases every data-engine pass toward a rich, Genie-Space-optimised schema and, after data generation, auto-deploys a Genie Space bound to `<catalog>.<schema>`. See [Genie Mode](#genie-mode). |
| Additional Documents | No | Upload PDFs, paste strategy excerpts, annual report text. Only used in Full mode. |

Click **Start Research** to kick off the Research Engine.

### Step 2: Research Results

The wizard shows a step-by-step timeline with real-time progress:

- **Gathering Sources** -- website scraping, IR document discovery
- **Classifying Industry** -- LLM-based, closed-list industry pick from the registered v2 outcome maps (with `normalizeIndustryId` closest-match fallback). The wizard never invents or auto-generates outcome maps; missing registry coverage shows up as a server-side warning, not a per-customer LLM workaround.
- **Industry Landscape / Key Quotes / Source Summaries** -- Phase-1 fan-out runs in parallel (Balanced + Full)
- **Analytical Passes** -- varies by preset: Quick = 1 synthesis pass; Balanced = combined strategy-narrative; Full = deep-dive → data strategy → demo narrative
- **Persona Talk Tracks / Evidence Linking** -- Phase-5 fan-out runs in parallel; the evidence-linking pass retrieves verbatim quotes from the `company_research` pgvector store to ground every `sourced` claim

Each step shows a detail message (e.g. "Scraping https://riotinto.com -- 45K chars",
"Classified as Manufacturing (92% confidence)").

When complete, a summary card shows key stats with a **View Full Insights**
button that opens the Customer Insight Page.

### Step 3: Catalog Selection

Two modes:

1. **Browse existing** -- use the Catalog Browser to select an existing
   catalog and schema. Click a schema to select it.
2. **Create new** -- toggle "Create new catalog", enter a name, and click
   **Validate Permissions** to pre-check access.

Common errors and what to do:

| Error | Resolution |
|---|---|
| "You don't have permission to create catalogs" | Use an existing catalog, or ask your admin to grant `CREATE CATALOG`. |
| "Cannot create schema in this catalog" | You need `USE CATALOG` + `CREATE SCHEMA` on the target catalog. |

### Step 4: Schema Review

Review the data assets, narratives, and nomenclature the Data Engine will
use. This is a read-only preview.

### Step 5: Generation Progress

Each table shows its current phase: Pending → Generating SQL → Executing →
Completed/Failed. Failed tables are retried up to 2 times with LLM
review-and-fix. Table and column descriptions are applied automatically
after each table is created.

### Step 6: Complete

Summary shows the fully qualified catalog.schema path, table/row counts,
and suggested next steps.

---

## Demo Scope

Scope narrows the demo from a full enterprise view to a specific unit.

| Field | Effect |
|---|---|
| **Division** | e.g. "Aluminium Division", "Wealth Management". Focuses research on that business unit. |
| **Functional Focus** | Asset families to include (e.g. "Commercial & Customer", "Operations & OT"). |
| **Departments** | Auto-maps to asset families. HR → Workforce, Finance → Finance & Regulatory, etc. |
| **Demo Objective** | Free text that shapes the narrative design and killer moments. |

---

## Genie Mode

Genie Mode is a toggle on **Step 1: Company Info** that turns the wizard into
a one-click **"rich demo dataset + deployed Genie Space"** pipeline.

### What Genie Mode does

When enabled, every data-engine pass is biased toward a schema that showcases
well in Genie Spaces, and after validation the engine auto-deploys a real
Genie Space bound to the generated `<catalog>.<schema>`.

| Surface | Standard wizard | Genie Mode |
|---|---|---|
| Row counts | 2K–10K per table | **8K–50K per table** (`DEMO_GENIE_ROW_BAND`) |
| Table count | 8–12 | **12–18** (`DEMO_GENIE_TABLE_BAND`) |
| Schema bias | Star-ish; domain coverage | Strong star schema: ≥ 3 fact tables + conformed date/customer/product dimensions |
| Column bias | Domain-appropriate | Extra measures (amount, qty, margin, discount) + hierarchical dims (region → country → store, category → subcategory) |
| Narrative | Talk-track / killer moments | Biased toward **question-answerability** -- narratives map to specific Genie questions |
| Post-validation | Done | **Pass 5: Genie Deploy** runs the ad-hoc Genie Engine and creates a Genie Space |

### Pass 5: Genie Deploy

`lib/demo/data-engine/passes/genie-deploy.ts` runs only when `genieMode=true`
**and** at least one fact table produced rows. On failure it records
`genieDeployError` and the surrounding data-generation result is still
returned successfully.

Steps:

1. Collect the fully-qualified names of every successfully-generated table
2. Call `runFastGenieEngine` (the ad-hoc engine) with `qualityPreset: "balanced"`
3. Call `createGenieSpace` with `authMode: "obo"` -- the user's OBO token is
   required so the space is owned by the logged-in user, not the app SP
4. Seed `ForgeGenieSpaceCache` via `upsertCachedSpaces` +
   `updateCachedSpaceDiscovery` so `/genie` shows the new space immediately
   (no manual sync required)
5. Call `trackGenieSpaceCreated` so the space appears in the Forge tracking tables
6. Emit a `demo_genie_space_deployed` activity log entry

### OBO token requirement

The wizard's `POST /api/demo/generate` route captures
`x-forwarded-access-token` at request time and threads it through
`DataEngineInput.oboToken`. This is non-negotiable: the Genie Create /
Conversation APIs return `RESOURCE_DOES_NOT_EXIST` when called as the service
principal. See `.cursor/rules/genie-obo-auth.mdc` and AGENTS.md
("Genie Conversation API MUST use OBO tokens").

### UI surfaces

- **Wizard Step 1** -- "Genie Mode" toggle card with sparkle icon
- **Wizard Step 5 (Generation Progress)** -- progress messages prefixed with
  `Genie:` during the deploy pass; overall progress runs 95→99% during the
  deploy band
- **Wizard Step 6 (Complete)** -- violet "Genie Space" card with
  **Open in Databricks** and **View in Forge** buttons; "Failed" state when
  deploy errors
- **Session detail page** (`/demo/sessions/{id}`) -- same Genie Space card
  rendered above the Data Window card for any Genie-Mode session

### When to use Genie Mode

Pick Genie Mode when the demo's hero surface is Genie. Skip it when you only
need a schema for the discovery pipeline or environment scan -- the standard
bands are faster (smaller row counts) and the extra Genie deploy pass adds
~30–60 s.

---

## Customer Insight Page

Navigate to `/demo/sessions/{sessionId}` (or click a session row, or
"View Full Insights" in the wizard) to see the full research output as a
presentation-ready page.

Sections (shown when data is available):

- **Company Overview** -- stated priorities, inferred priorities, urgency signals, strategic gaps
- **SWOT Analysis** -- strengths, weaknesses, opportunities, threats (4-card grid)
- **Industry Landscape** -- market forces with urgency indicators, competitive dynamics, regulatory pressures
- **Key Benchmarks** -- metrics, impacts, and sources in tabular form
- **Data Strategy** -- matched assets with relevance scores, maturity assessment, prioritised use cases
- **Demo Flow** -- numbered step-by-step talk track with transitions
- **Killer Moments** -- hero cards with scenario, insight, expected reaction
- **Competitive Positioning** -- competitor angles and opportunities
- **Executive Talking Points** -- per-asset headlines with benchmark tie-ins
- **Data Narratives** -- stories embedded in the demo data
- **Sources** -- all gathered sources with type, status, and size

Quick preset shows Data Narratives and Sources only. Balanced adds
Industry Landscape and Strategy. Full shows all sections.

---

## Exporting Research

From the Customer Insight Page or the sessions table, export research as:

- **PPTX** -- branded slide deck (10--12 slides) suitable for internal
  prep or customer-facing presentations
- **PDF** -- document-style report with the same content sections

Both formats use Databricks Forge branding and skip sections where data
is not available (e.g. Quick preset exports are shorter).

Download URL: `GET /api/demo/sessions/{id}/export?format=pptx|pdf`

---

## After Generation

The generated data lives at `<catalog>.<schema>` as managed Delta tables
with table and column descriptions applied.

Use it with any Forge feature:

1. **Discovery Pipeline** -- point a new pipeline run at the demo
   catalog/schema.
2. **Genie Studio** -- create Genie Spaces from the demo schema.
3. **AI/BI Dashboards** -- generate executive-ready dashboards.
4. **Ask Forge** -- explore the demo data conversationally.
5. **AI Comments** -- generate catalog documentation for the demo schema.

---

## Managing Sessions

### Viewing Past Sessions

Navigate to `/demo` (sidebar: Demo → Demo Sessions) to see all sessions
in a table view with customer name, industry, status, catalog path, table
and row counts, and creation date.

### Deleting Demo Data

Click the delete action on any session. This:
1. Runs `DROP TABLE IF EXISTS` for every table created by that session
2. Drops the schema if it's empty after table drops
3. Deletes the `ForgeDemoSession` record from Lakebase
4. Logs a `demo_cleanup` activity event

Only tables tracked by that specific session are dropped.

### Factory Reset

`Settings → Delete All Data` also clears all demo sessions from Lakebase
(but does **not** drop Unity Catalog objects -- use per-session delete for
that).

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Demo Wizard (6 steps)                │
│   Company Info → Research → Catalog → Review → Gen   │
└───────────┬──────────────────────────┬───────────────┘
            │                          │
            ▼                          ▼
┌───────────────────────┐  ┌───────────────────────────┐
│    Research Engine     │  │       Data Engine          │
│                        │  │                           │
│  Pass 0: Sources       │  │  Pass 0: Narrative Design │
│  Pass 3.25: Industry   │  │  Pass 1: Schema Design    │
│  Pass 3.5: Outcome Map │  │  Pass 2: Seed Generation  │
│  Phase-1 fan-out:      │  │  Pass 3: Fact Generation  │
│   landscape ∥ quotes   │  │  Pass 4: Validation       │
│   ∥ source-summaries   │  │                           │
│  Analysis (Q/B/F)      │  │                           │
│  Phase-5 fan-out:      │  │                           │
│   persona ∥ evidence   │  │                           │
└───────────────────────┘  └───────────────────────────┘
            │                          │
            ▼                          ▼
┌───────────────────────┐  ┌───────────────────────────┐
│  ResearchEngineResult  │  │  Unity Catalog Delta      │
│  (stored in Lakebase)  │  │  Tables (direct write)    │
└───────────────────────┘  └───────────────────────────┘
```

### Research Engine Passes

| Pass | Name | Preset | Tier | Purpose |
|---|---|---|---|---|
| 0 | Source Collection | All | -- | Website scrape, IR discovery, doc parsing (parallel) |
| 3.25 | Industry Classification | All (if needed) | classification | Auto-detect industry from sources |
| 3.5 | Outcome Map / Enrichment | All (if needed) | reasoning / generation | 3-case: skip if both exist, generate enrichment if outcome-only, full generation if neither |
| 4Q | Quick Synthesis | Quick | generation | Single-pass: assets + nomenclature + narratives |
| 4a | Industry Landscape | Balanced, Full | reasoning | Market forces, benchmarks, competitive dynamics (cached by `industryId::subVertical`, 24h TTL) |
| 4b | Key Quotes Extraction | Balanced, Full | classification | Pull 8--15 verbatim, executive-worthy quotes per source; dedup by normalized text |
| 4c | Source Summaries | Balanced, Full | classification | Two-sentence summary + 3 key takeaways per source for the Ingested Sources panel |
| 5B | Strategy & Narrative | Balanced | reasoning | Combined strategic profile + data strategy + demo narrative + executive brief |
| 5 | Company Deep-Dive | Full | reasoning | SWOT, stated/inferred priorities, urgency signals, executive brief |
| 6 | Data Strategy Mapping | Full | reasoning | Map priorities to data assets with criticality scoring |
| 7 | Demo Narrative Design | Full | reasoning | Expanded killer moments (problem, hypothesis tree, quantified impact, discovery Qs, risk of inaction) |
| 8 | Persona Talk Tracks | Balanced, Full | reasoning | 5 executive personas: provocative opening, 3 objections + responses, discovery ladder, close signal |
| 9 | Evidence Linking | All | -- (RAG only) | Retrieve verbatim quotes from `company_research` pgvector index to ground `sourced` claims; downgrade to `inferred` when no match |

### Tiered Evidence Model

Every consultant-grade output (executive brief, company profile priorities,
killer moments, persona talk tracks) carries an `evidence[]` array where each
item has one of three tiers:

| Tier | Fields | Meaning |
|---|---|---|
| `sourced` | `claim`, `quote`, `sourceUrl`, `sourceTitle` | Verbatim attribution from an ingested research source. Quotes are filled by the evidence-linking pass via pgvector retrieval over the `company_research` index (filtered by `customerName`). |
| `benchmark` | `claim`, `benchmarkLabel`, `benchmarkRange` | Industry-standard figure (e.g. "Mining asset-utilisation 68--78%"). Produced directly by analysis passes; never linked to a customer URL. |
| `inferred` | `claim`, `rationale` | Reasoned hypothesis with an explicit rationale. Claims requested as `sourced` but ungrounded by the evidence-linking pass are downgraded here. |

The Customer Insight Page renders tier counts in the summary strip
("3s · 5b · 2i") and provides a per-tier filter on the Evidence Register.
The PPTX and PDF exports include a dedicated Evidence Register section with
up to 20--25 items.

### New Result Fields

`ResearchEngineResult` exposes the following optional top-level fields that
power the consultant-grade UI and exports:

| Field | Type | Produced By |
|---|---|---|
| `executiveBrief` | `ExecutiveBrief` | `company-deep-dive` (Full) or `strategy-and-narrative` (Balanced) |
| `personaTalkTracks` | `PersonaTalkTrack[]` (5 entries) | `persona-talk-track` pass (Balanced + Full) |
| `sourceSummaries` | `SourceSummary[]` | `source-summaries` pass (Balanced + Full) |
| `keyQuotes` | `KeyQuote[]` | `key-quotes-extraction` pass (Balanced + Full) |

Expanded `KillerMoment` fields (emitted by `demo-narrative` for Full,
`strategy-and-narrative` for Balanced): `problemStatement`, `hypothesisTree`,
`quantifiedImpact` (low/mid/high + unit), `kpiDelta`, `riskOfInaction`,
`discoveryQuestions`, `measureOfSuccess`, `evidence[]`, `idealBuyerPersona`,
`timeToValue`.

### Source Recency Bias

The Research Engine biases every LLM pass toward newer material so a 2016
annual report cannot outrank a 2024 report on pure similarity.

| Layer | Where | What it does |
|---|---|---|
| Date extraction | `lib/demo/research-engine/date-extraction.ts` | Pulls `publishedAt` from sitemap `lastmod`, SEC filing dates, HTTP `Last-Modified`, HTML meta tags / JSON-LD, URL or filename year regex, and a first-500-char text-body scan. Tags a confidence: `high`, `medium`, `low`, or `unknown`. |
| Source type | `lib/demo/types.ts` (`ResearchSource`) | Carries `publishedAt`, `publishedYear`, and `dateConfidence` through every downstream pass. |
| Per-pass ordering | `lib/demo/research-engine/engine.ts` | Sorts the `perSourceData` manifest by `recencyWeight(source) * volume` so the newest material wins the token budget in `key-quotes`, `source-summaries`, `company-deep-dive`, and `strategy-and-narrative`. |
| RAG retrieval | `lib/embeddings/retriever.ts` | `company_research` chunks carry `publishedAt` + `ttlDays=365` in `metadataJson`; `freshnessMultiplier` applies a graded decay (full weight within 2 years, soft decay to 0.25 by year 5). |
| Evidence linking | `lib/demo/research-engine/passes/evidence-linking.ts` | Runs retrieval with `enforceSourcePriority: true` and a higher `minScore` of 0.58 so stale passages get downgraded to `inferred` rather than attached to a claim. |
| Prompt guidance | `lib/demo/research-engine/prompts.ts` | Source manifests include a `Published: YYYY-MM-DD (confidence)` line, and prompts are instructed to prefer recent sources and flag anything older than 3 years as historical context. |
| UI | `components/demo/session/source-list.tsx`, `evidence-list.tsx` | Every source and every sourced evidence chip shows the publication year. Anything older than 3 years gets a red "Stale: YYYY" badge. |

Tuning constants live in `lib/demo/research-engine/recency.ts` -- edit
`RECENT_YEARS` / `HARD_FLOOR_YEARS` / `STALE_YEARS` there to make the bias
stronger or weaker.

### Data Engine Passes

| Pass | Name | Tier | Purpose |
|---|---|---|---|
| 0 | Narrative Design | reasoning | Design 3--5 data stories with temporal patterns (anchored to the active `DemoDateWindow`) |
| 1 | Schema Design | reasoning | Design dimension + fact tables from matched assets |
| 2 | Seed Generation | sql | DDL + INSERT for dimension tables (sequential) + COMMENT ON; all timestamps inside the window |
| 3 | Fact Generation | sql | CTAS for fact tables (concurrent) + COMMENT ON; rows distributed across the window with a bias toward the last 90 days |
| 4 | Validation | -- | Row counts, FK integrity, and **date freshness** probe per fact table (MIN, MAX, rows_last_90d) |
| 4b | Fact Freshness Auto-Fix | sql | Single-shot regeneration for any fact table whose dates fall outside the window; re-validated before the engine returns |

### `DemoDateWindow` -- rolling FY + YTD anchor

Every Data Engine run computes a single date window (`lib/demo/data-engine/date-window.ts`)
that fixes the legs of all generated data in time so demos never drift into a
stale year (the common "all data is 2024" failure mode).

| Field | Example | Meaning |
|---|---|---|
| `startDate` | `2025-01-01` | First day of the most recently completed fiscal year |
| `endDate` | `2026-04-17` | Today |
| `dateRangeDays` | `471` | Inclusive span of the window |
| `fyLabel` | `FY2025 + YTD FY2026` | Human label shown in the session chip |
| `fiscalYearStartMonth` | `1` | 1-12; default January (calendar FY), overridable per session |

Safety rail: if the current fiscal year has fewer than 60 days elapsed at run
time (see `MIN_CURRENT_FY_DAYS`), the window is extended back one additional
FY so narratives have more than a thin stub of YTD data to work with.

The window is propagated into every generation prompt via placeholders
(`{start_date}`, `{end_date}`, `{fy_label}`, `{date_range_days}`) inside a
shared `DATA RECENCY` block and is persisted on the session as part of
`dataModelJson` so the session UI can render a "Data window" chip and a
per-fact-table MIN → MAX coverage row with a **Stale** badge when the MAX
falls more than 60 days behind today.

### Status Tracking

Both engines use in-memory `Map` for fast polling (2s intervals) with
`AbortController` support for cancellation. Final status is persisted on
`ForgeDemoSession` in Lakebase. Demo jobs do **not** write to
`ForgeBackgroundJob` (which has an FK to `ForgeRun`).

---

## API Reference

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/demo/research` | Start Research Engine (fire-and-forget) |
| GET | `/api/demo/research/status?sessionId=X` | Poll research job status |
| POST | `/api/demo/generate` | Start Data Engine (fire-and-forget) |
| GET | `/api/demo/generate/status?sessionId=X` | Poll generation job status |
| POST | `/api/demo/validate-catalog` | Pre-check catalog/schema permissions |
| POST | `/api/demo/upload` | Upload PDF/text documents for research |
| GET | `/api/demo/sessions` | List all demo sessions |
| GET | `/api/demo/sessions/:id` | Session detail + research result |
| DELETE | `/api/demo/sessions/:id` | Cleanup: DROP tables + delete session |
| GET | `/api/demo/sessions/:id/export?format=pptx\|pdf` | Export research as PPTX or PDF |

All routes return 404 when Demo Mode is disabled (toggle in **Settings → Feature Flags**, or seed via `FORGE_DEMO_MODE_ENABLED=true` on first boot). The toggle itself lives at `/api/settings/feature-flags` (GET + PATCH, owned by all authenticated users).

---

## Troubleshooting

### "Demo mode is not enabled"

All API routes return this when the feature gate is off. Open **Settings
→ Feature Flags** and toggle Demo Mode on; the page reloads and the demo
APIs become available. (No restart required — the env var only seeds the
initial value on first boot.)

### Research takes too long

Switch to **Quick** preset for 20--45 second research. Full preset can
take 2--3 minutes due to 4 sequential reasoning-tier LLM calls.

### "You don't have permission to create catalogs"

The service principal (or your PAT in local dev) needs `CREATE CATALOG`
on the metastore. Alternatively, select an existing catalog using the
Catalog Browser.

### Tables fail during generation

The Data Engine retries failed SQL up to 2 times using LLM review-and-fix.
If a table still fails:
- Check the SQL warehouse is running and not at capacity
- The generated SQL uses Databricks-specific functions (`EXPLODE`,
  `SEQUENCE`, `RAND`) -- ensure the warehouse supports these

### "Empty LLM response content (finishReason=length)"

The SQL generation model hit its output token limit. The Data Engine now
uses the `sql` tier (routing to models with 128K output capacity) to
prevent this. If you still see this, the table design may be too complex --
try reducing the target row count.

### No industry outcome map found

If the target industry isn't in the built-in registry, the engine
auto-generates one. If only the enrichment is missing, only that layer is
generated (~30s). Full generation takes ~60-120s. Generated maps are
persisted for reuse.

### Demo data looks too uniform

Ensure you're using **Balanced** or **Full** preset. Quick mode produces
simpler narratives. Also check that you provided a website URL -- without
it, the engine has less context for nomenclature and realistic values.

---

## File Reference

### Core

| File | Purpose |
|---|---|
| `lib/demo/config.ts` | Async `isDemoModeEnabled()` feature gate backed by the `ForgeAppConfig` singleton (30s in-memory cache); `setDemoModeEnabled()` + `invalidateDemoModeCache()` for the UI toggle. `FORGE_DEMO_MODE_ENABLED` env var seeds the row on first read. |
| `lib/demo/types.ts` | All shared types (ResearchPreset, DemoScope, TableDesign, etc.) |
| `lib/demo/scope.ts` | Department → asset family resolution, schema name builder |
| `lib/demo/cleanup.ts` | UC object cleanup (DROP TABLE/SCHEMA) |

### Research Engine

| File | Purpose |
|---|---|
| `lib/demo/research-engine/engine.ts` | `runResearchEngine()` orchestrator with parallel fan-outs (Phase-1 and Phase-5) + `normalizeIndustryId()` |
| `lib/demo/research-engine/types.ts` | Input, deps, result, intermediate analysis types (`Evidence`, `ExecutiveBrief`, `PersonaTalkTrack`, `KeyQuote`, `SourceSummary`, expanded `KillerMoment`) |
| `lib/demo/research-engine/prompts.ts` | All prompt templates (incl. `KEY_QUOTES_PROMPT`, `SOURCE_SUMMARIES_PROMPT`, `PERSONA_TALK_TRACK_PROMPT`, `INDUSTRY_CLASSIFICATION_PROMPT`). The closed-list classification prompt forbids inventing new industry ids -- every customer is mapped onto one of the registered v2 industries. |
| `lib/demo/research-engine/engine-status.ts` | In-memory status tracking (no ForgeBackgroundJob) |
| `lib/demo/research-engine/industry-cache.ts` | In-memory LRU cache (24h TTL) for `industry-landscape` outputs keyed by `industryId::subVertical` |
| `lib/demo/research-engine/passes/key-quotes.ts` | `runKeyQuotesExtraction()` -- verbatim executive-worthy quote extraction |
| `lib/demo/research-engine/passes/source-summaries.ts` | `runSourceSummaries()` -- per-source 2-sentence summary + 3 takeaways |
| `lib/demo/research-engine/passes/persona-talk-track.ts` | `runPersonaTalkTrack()` -- 5-persona objection-handling talk tracks |
| `lib/demo/research-engine/passes/evidence-linking.ts` | `runEvidenceLinking()` -- RAG-backed quote attachment via pgvector `company_research` index |
| `lib/demo/research-engine/passes/*.ts` | Other pass implementations (industry-classification, quick-synthesis, industry-landscape, company-deep-dive, data-strategy-mapping, demo-narrative). Outcome-map and enrichment auto-generation passes were removed in May 2026 -- the registry is now authoritative. |

### Data Engine

| File | Purpose |
|---|---|
| `lib/demo/data-engine/engine.ts` | `runDataEngine()` orchestrator |
| `lib/demo/data-engine/types.ts` | Input, deps, result types |
| `lib/demo/data-engine/prompts.ts` | Prompt templates for schema/SQL generation |
| `lib/demo/data-engine/engine-status.ts` | In-memory status tracking (no ForgeBackgroundJob) |
| `lib/demo/data-engine/passes/*.ts` | Individual pass implementations (with COMMENT ON after creation) |

### Export

| File | Purpose |
|---|---|
| `lib/export/demo-research-pptx.ts` | `generateDemoResearchPptx()` -- branded slide deck |
| `lib/export/demo-research-pdf.ts` | `generateDemoResearchPdf()` -- document-style report |

### Persistence

| File | Purpose |
|---|---|
| `lib/lakebase/demo-sessions.ts` | CRUD for `ForgeDemoSession` |
| `lib/lakebase/outcome-maps.ts` | `getCustomEnrichment()`, `setCustomEnrichment()` |
| `prisma/schema.prisma` | `ForgeDemoSession` model, `enrichmentJson` on `ForgeOutcomeMap` |

### UI

| File | Purpose |
|---|---|
| `app/demo/page.tsx` | Demo Sessions listing page (table, wizard launcher) |
| `app/demo/sessions/[sessionId]/page.tsx` | Customer Insight Page (full research view) |
| `components/demo/demo-wizard.tsx` | 6-step wizard modal |
| `components/demo/demo-settings.tsx` | Settings page card (link to /demo) |
| `components/demo/steps/*.tsx` | Individual step components |
| `components/pipeline/sidebar-nav.tsx` | Demo section (conditional on `demoModeEnabled`) |

### API Routes

| File | Purpose |
|---|---|
| `app/api/demo/research/route.ts` | Start research |
| `app/api/demo/generate/route.ts` | Start data generation |
| `app/api/demo/validate-catalog/route.ts` | Permission pre-check |
| `app/api/demo/upload/route.ts` | Document upload |
| `app/api/demo/sessions/route.ts` | List sessions |
| `app/api/demo/sessions/[sessionId]/route.ts` | Session detail + delete |
| `app/api/demo/sessions/[sessionId]/export/route.ts` | PPTX/PDF export |
