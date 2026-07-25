# Release Notes -- Databricks Forge v0.6.0

**Date:** 27 February 2026

---

## Ask Forge -- Conversational Data Intelligence Assistant

The headline feature of this release is **Ask Forge**, a RAG-powered
conversational AI assistant that lets users ask natural-language questions about
their Unity Catalog data estate and receive grounded, actionable answers.

### Conversational Engine

A full pipeline orchestrates every question through five stages:

1. **Intent classification** -- A lightweight LLM call (fast serving endpoint)
   classifies each question into one of five intents: `business`, `technical`,
   `dashboard`, `navigation`, or `exploration`. A regex-based heuristic
   provides instant fallback when the LLM is unavailable.
2. **Dual-strategy context building** -- Context is assembled from two
   independent sources:
   - *Direct Lakebase queries* (always available): business context from the
     latest completed run, estate summary from the latest scan, and all
     deployed dashboards and Genie Spaces.
   - *Vector semantic search* (when embeddings are enabled): pgvector cosine
     similarity retrieval across 12 embedding kinds, scoped by intent.
3. **Table enrichment** -- Fully-qualified table names are extracted from RAG
   chunks (via metadata, sourceId, and regex fallback). For each table, deep
   metadata is fetched: owner, size, row count, health score, domain/tier,
   data quality issues, recommendations, last write operation, and
   upstream/downstream lineage.
4. **LLM streaming** -- The premium serving endpoint generates a grounded
   markdown response streamed in real-time via SSE. The system prompt enforces
   strict rules: never assume or invent table/column names, only reference what
   exists in the retrieved context, cite sources with `[1]`, `[2]` markers,
   and follow `DATABRICKS_SQL_RULES` for all SQL.
5. **Post-processing** -- SQL blocks are extracted from the response, dashboard
   intent is detected (charts, widgets, visualisations), existing dashboards
   and Genie Spaces are looked up, and context-aware action cards are generated.

### Action Cards

Every response includes actionable next steps based on what the assistant found:

| Condition | Actions |
|-----------|---------|
| SQL in the response | **Run this SQL**, **Deploy as Notebook** |
| SQL + dashboard intent | **Deploy as Dashboard** |
| Table FQNs referenced | **View Referenced Tables**, **Create Genie Space** |
| 2+ tables referenced | **View ERD** |
| Matching Genie Space | **Ask Genie: {Space Title}** |

### SQL Execution & Deployment

- **Run SQL dialog** -- Review, edit, and execute proposed SQL against the
  configured warehouse. Results are displayed in a scrollable table with
  column types, row counts, duration, and CSV export.
- **Fix loop** -- When SQL execution fails, "Ask Forge to fix" pre-fills the
  chat with the failing SQL and error message for conversational repair.
- **Deploy as Notebook** -- One-click deployment to a Databricks workspace
  notebook with customisable title and path.
- **Deploy as Dashboard** -- Preview the dashboard proposal (title, tables,
  widgets) and deploy via the existing dashboard engine.

### Context Panel

A right-hand panel (desktop) displays live metadata for every table referenced
in the response:

- **Rich table cards** -- Health score (colour-coded badge), domain/tier, row
  count, freshness, PII column count, sensitivity level, governance score,
  owner, write history, column list (with PII highlighting), data quality
  issues, related use cases (with scores), and LLM-generated insights
  (severity-coded).
- **Lineage summary** -- Upstream and downstream table relationships per table.
- **RAG sources** -- Expandable source cards showing kind-specific icons,
  provenance badges (Platform, Insight, Generated, Uploaded, Template), cosine
  similarity scores, and metadata details.
- **ERD viewer** -- Full-screen interactive entity-relationship diagram filtered
  to referenced tables plus their 1-hop neighbours.
- **"Ask Forge about this table"** -- One-click deep-dive into any referenced
  table from the context panel.

### Interaction Logging & Feedback

Every interaction is persisted to the `ForgeAssistantLog` table in Lakebase:

- Session ID, question, classified intent and confidence, RAG chunk IDs,
  full response text, first SQL block, token usage, and response duration.
- **Thumbs up/down feedback** on each response, stored via a dedicated
  feedback endpoint for future model improvement.

### Keyboard Shortcut

**Cmd+J / Ctrl+J** toggles the Ask Forge page from anywhere in the app. A
header button with the shortcut badge provides visual discoverability.

---

## Metadata Genie -- Unity Catalog Intelligence via Genie Spaces

A new **Metadata Genie** feature creates curated Genie Spaces from
`system.information_schema`, enabling natural-language exploration of Unity
Catalog metadata through the Databricks Genie conversational interface.

### Generation Flow

1. **Probe** -- Verifies access to `system.information_schema` and optionally
   `system.access.table_lineage`. Returns available catalogs and table counts
   for scope selection.
2. **Industry detection** -- LLM identifies the organisation's industry and
   business domains from table/schema names, mapping to a canonical outcome
   map for contextual intelligence.
3. **AI description generation** -- Fetches up to 500 undocumented tables and
   generates short business descriptions in batches of 50 via the fast model,
   enriching the `mdg_tables` curated view.
4. **Space building** -- Assembles a complete `SerializedSpace` payload:
   data sources (curated views), join specifications, sample questions, text
   instructions, example SQL, and SQL snippets (measures, filters,
   expressions).

### Curated Views

10 metadata views are generated as DDL and deployed to a user-chosen
`catalog.schema`:

`mdg_catalogs`, `mdg_schemas`, `mdg_tables` (with AI descriptions),
`mdg_columns`, `mdg_views`, `mdg_volumes`, `mdg_table_tags`,
`mdg_column_tags`, `mdg_table_constraints`, `mdg_table_privileges`, plus an
optional `mdg_lineage` view when lineage access is available.

Views support catalog scope filtering and exclude system catalogs/schemas.

### Deployment

- Choose a target `catalog.schema` via the catalog browser.
- Schema is created automatically if it does not exist.
- Views are deployed via DDL execution.
- The Genie Space is created or updated via the REST API.
- Direct link to the deployed Genie Space on success.

### Management

- List all Metadata Genie spaces with status, table count, and deployed URL.
- Trash spaces (with optional view cleanup via `DROP VIEW` DDL).
- Expandable preview of tables, sample questions, SQL examples, measures,
  filters, dimensions, joins, and instructions.

---

## Embedding & Vector Search Infrastructure

A complete embedding and vector search system has been built from scratch,
powering Ask Forge, semantic search, question routing, and RAG retrieval
across the entire application.

### Embedding Pipeline

- **Model:** `databricks-gte-large-en` via Model Serving (1024-dim vectors).
- **Batching:** 16 texts per request with retry on 429/5xx and exponential
  backoff.
- **Storage:** pgvector extension in Lakebase with an HNSW cosine similarity
  index for sub-50ms search.
- **12 embedding kinds:** `table_detail`, `column_profile`, `table_health`,
  `lineage_context`, `environment_insight`, `data_product`, `use_case`,
  `business_context`, `genie_recommendation`, `genie_question`,
  `outcome_map`, `document_chunk`.
- **Text composition:** Dedicated composing functions per kind produce
  structured text optimised for embedding quality.
- **Document chunking:** Sliding window (512 tokens, 64 overlap) with
  sentence/paragraph boundary alignment.
- **Delta re-embedding:** Content-hash-based diffing avoids redundant
  re-embedding when data has not changed.

### Embedding Sources

| Source | Trigger | Kinds Embedded |
|--------|---------|----------------|
| Estate scan | After scan completion | table_detail, column_profile, table_health, lineage_context, environment_insight, data_product |
| Pipeline run | After run completion | use_case, business_context |
| Genie engine | After recommendations | genie_recommendation, genie_question |
| Outcome maps | After ingest | outcome_map |
| Knowledge Base | After upload | document_chunk |

### Search Scopes

`estate`, `usecases`, `genie`, `insights`, `documents`, `all` -- each scope
maps to a subset of embedding kinds for focused retrieval.

### Backfill

`POST /api/embeddings/backfill` rebuilds all embeddings from current Lakebase
data (scans, runs, Genie recommendations, outcome maps, documents) in a
single operation.

### Embedding Status

The Ask Forge page displays a collapsible knowledge base status bar showing
total vector count, breakdown by scope and kind, and a "Rebuild Embeddings"
button. A warning banner appears when the embedding endpoint is not configured.

---

## Semantic Search (Cmd+K)

A global command palette provides instant semantic search across all embedded
data.

- **Trigger:** Cmd+K / Ctrl+K from anywhere in the app.
- **Scopes:** All, Tables, Use Cases, Genie, Insights, Documents.
- **Filters:** Run ID, scan ID, catalog, domain, tier.
- **Results:** Grouped by kind with relevance scores and provenance badges.
- **Navigation:** Click-through to runs, scans, table detail pages, documents,
  and Knowledge Base.
- **Question routing:** High-confidence matches are routed to existing Genie
  Spaces for direct natural-language querying.

---

## Knowledge Base -- Document Upload for RAG

Users can upload documents to enrich the assistant's knowledge and improve
RAG retrieval quality.

- **Formats:** PDF, Markdown (.md), plain text (.txt), up to 20 MB per file.
- **Categories:** Strategy Pack, Data Dictionary, Governance Policy,
  Architecture Docs, Other.
- **Processing:** Documents are chunked (512 tokens, 64 overlap), embedded
  via `databricks-gte-large-en`, and stored as `document_chunk` embeddings.
- **Status tracking:** Processing, ready, failed, empty states per document.
- **UI:** Drag-and-drop upload, category selector, document list with status
  badges and delete.
- **RAG provenance:** Document chunks are cited as `[UPLOADED DOCUMENT: filename]`
  in assistant responses, clearly distinguishing user-uploaded content from
  platform metadata.

---

## Asset Discovery

An optional pipeline step that scans the Databricks workspace for existing
analytics assets before generating recommendations.

### Scanned Assets

- **Genie Spaces** -- Existing spaces and their table coverage.
- **AI/BI Dashboards** -- Deployed dashboards and their datasets.
- **Metric Views** -- Metric view definitions in Unity Catalog.

### Pipeline Integration

Asset Discovery runs after metadata extraction (step 2b) and feeds results
into downstream steps:

- **Genie Engine:** Detects whether to enhance existing spaces or create new
  ones.
- **Dashboard Engine:** Deduplicates against existing dashboards.
- **Use case scoring:** Provides `asset_context` to scoring prompts.
- **Estate scan:** Runs before LLM intelligence passes.

### Configuration

Toggled via the Settings page and per-run in the pipeline config form
(`assetDiscoveryEnabled`). Results are displayed in a dedicated **Existing
Assets** tab on the run detail page.

---

## Settings Page

A new Settings page (`/settings`) centralises configuration for all features:

- **Pipeline defaults:** Sample rows, export format, notebook path, discovery
  depth, depth configs.
- **Genie Engine:** Max tables per space, max auto spaces, LLM refinement,
  benchmarks, metric views, time periods, trusted assets, fiscal year, entity
  matching.
- **Estate Scan:** Toggle during pipeline runs.
- **Asset Discovery:** Toggle during pipeline runs.
- **Semantic Search & RAG:** Toggle for search bar, Knowledge Base, and RAG
  retrieval.
- **Genie deploy auth:** On-behalf-of vs service principal.
- **Reset:** Clear local settings or delete all Lakebase data.

Settings are persisted in `localStorage` and applied as defaults across
pipeline configuration, engine execution, and search behaviour.

---

## Genie & Dashboard Engine Concurrency

The background engine execution model has been refactored for improved
throughput:

- **Concurrent execution:** Genie and Dashboard engines now run in parallel
  via `Promise.allSettled` instead of sequentially. The Dashboard Engine
  tolerates missing Genie data and uses whatever recommendations exist in
  Lakebase at the time it runs.
- **Independent progress:** Each engine has its own status module for
  domain-level progress tracking, enabling the UI to show independent
  progress indicators.

---

## Lakebase Connection Resilience

The Prisma client infrastructure has been substantially reworked for
production reliability on Databricks Apps:

- **PostgreSQL adapter:** Migrated from direct connection string to
  `@prisma/adapter-pg` with `pg.Pool` for connection pooling.
- **Credential rotation:** `withPrisma()` detects auth errors and
  automatically invalidates and rotates the client (up to 2 retries).
  Proactive refresh is scheduled ~5 minutes before credential expiry.
- **Startup resilience:** Exponential backoff (up to 4 attempts, `1s * 2^i`
  delays) when verifying new connections during rotation.
- **Database readiness:** `isDatabaseReady()` lets API routes return 503
  during cold-start instead of blocking on initialisation.
- **Cooldown protection:** 10-second cooldown after successful rotation
  prevents overlapping rotation attempts.
- **Pool error recovery:** Pool-level errors automatically clear the cached
  client and credentials so the next request creates a fresh pool.
- **Dual mode:** Static URL for local development; auto-provisioned OAuth
  credentials on Databricks Apps with graceful fallback.

---

## Production Startup Script

A new `scripts/start.sh` handles production deployment on Databricks Apps:

1. Auto-provisions Lakebase Autoscale when service principal credentials are
   available and no `DATABASE_URL` is set.
2. Runs `prisma db push` with retries (up to 15 attempts, 3s apart) to handle
   cold-start latency.
3. Creates the pgvector extension and `forge_embeddings` table when the
   embedding endpoint is configured.
4. Starts the Next.js standalone server with the provisioned database URL.

---

## Run Detail Page Improvements

- **Interactive summary cards:** Clicking "Total Use Cases" switches to the
  Use Cases tab; clicking "Domains" or "Coverage" opens the Overview tab with
  Insights expanded.
- **Conditional data fetching:** Summary-only payload (`?fields=summary`) is
  used while use cases are still loading, reducing initial page weight.
- **Background engine indicators:** Pulsing badge on Genie and Dashboard tabs
  while engines are generating, with polling for real-time status updates.
- **Collapsible insight sections:** Charts and run details are grouped into
  expandable sections (Insights, Run Details) for cleaner layout.

---

## UI Polish

### Tab Component Redesign

- Focus ring (`focus-visible:ring-[3px]`), hover state (`hover:bg-accent/50`),
  and active indicator via `after:` pseudo-element (bottom bar for horizontal,
  right bar for vertical).
- New `line` variant with transparent background and indicator-only styling.
- Focus capture handler on `TabsContent` prevents scroll-jump on keyboard
  navigation.

### Chart Tooltip Theming

All Recharts tooltips now use CSS theme variables (`--color-card`,
`--color-border`, `--color-card-foreground`) for consistent appearance in
light and dark mode. Applied across score distribution, domain breakdown,
type split, step duration, and score radar charts.

### Dashboard & API Performance

- **Conditional payload:** Run API returns summary-only data when
  `?fields=summary` is requested, deferring full use case payloads.
- **Deferred fetching:** Use cases, lineage FQNs, and scan IDs are only
  fetched after a run completes.
- **Parallel fetching:** `Promise.allSettled` for concurrent data loading.
- **HTTP caching:** Completed runs use `s-maxage=300, stale-while-revalidate=60`;
  in-progress runs use `no-store`.

---

## New Prisma Models

| Model | Table | Purpose |
|-------|-------|---------|
| `ForgeAssistantLog` | `forge_assistant_logs` | Ask Forge interaction logging and feedback |
| `ForgeMetadataGenieSpace` | `forge_metadata_genie_spaces` | Metadata Genie space state and config |
| `ForgeDocument` | `forge_documents` | Knowledge Base document metadata |
| `ForgeDiscoveredAsset` | `forge_discovered_assets` | Asset Discovery results |

The `forge_embeddings` table (raw SQL, not Prisma-managed) stores all vector
embeddings with a pgvector HNSW index.
