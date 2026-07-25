# Release Notes -- Databricks Forge v0.5.0

**Date:** 25 February 2026

---

## SQL Generation Quality & Grounding

A major focus of this release is dramatically improving the quality, accuracy,
and safety of all LLM-generated SQL across the Genie engine, dashboard engine,
and pipeline.

### Strict Column Validation via Schema Allowlist

`findInvalidIdentifiers()` in `schema-allowlist.ts` now supports a
**strict column check** mode. When enabled, two-part `alias.column` references
are validated against every column in the allowlist -- not just FQN-qualified
references. This catches completely hallucinated columns like
`supplier.ingredient` where `ingredient` does not exist in any table.

A comprehensive `SQL_KEYWORDS` set (200+ entries covering Databricks SQL
functions, geospatial, AI functions, window functions, and pipe syntax) is
used to avoid false positives on SQL syntax that looks like `alias.column`.

Strict mode is now enabled in the assembler for all SQL snippets (measures,
filters, dimensions, join specs) and in per-pass validation across:
- Join inference
- Semantic expressions
- Benchmark generation
- Trusted assets (parameterised queries and UDFs)
- Metric view proposals
- Pipeline use-case SQL generation

### Benchmark Generation: Simplicity over Complexity

The benchmark generation prompt has been completely rewritten to prioritise
**simple, verifiable SQL** over complex analytical queries. Key changes:

- Benchmarks are limited to straightforward `SELECT ... FROM ... WHERE ...
  GROUP BY ... ORDER BY` patterns.
- Max 1 CTE and max 1 window function per query.
- Statistical functions (`REGR_SLOPE`, `CORR`, `STDDEV`, `SKEWNESS`, etc.)
  are explicitly banned from benchmarks -- wrong SQL is worse than no
  benchmarks.
- Oversized benchmark SQL (> 3000 chars) is automatically dropped.
- Previous "SQL PRESERVATION" rules that encouraged reproducing full
  analytical complexity have been removed in favour of accuracy.

### Semantic Expressions: Snippet Complexity Guard

A new `isSnippetTooComplex()` gate rejects SQL snippets that are too complex
for Genie's knowledge store. Snippets should be simple composable building
blocks (single aggregates, CASE WHEN expressions). The guard rejects:

- Snippets longer than 500 characters.
- Snippets containing window functions (`OVER(...)`).
- Snippets containing statistical functions (`REGR_SLOPE`, `CORR`,
  `STDDEV_POP`, `SKEWNESS`, `KURTOSIS`, `CUME_DIST`, etc.).
- Snippets containing subqueries (`SELECT` inside a snippet).

The LLM prompt now explicitly instructs the model that snippets should be
short, reusable expressions (ideally under 200 characters) and provides
concrete good/bad examples.

### Trusted Assets: Functions vs Queries Rebalanced

The trusted assets pass has been rebalanced to produce **parameterised queries
as the primary output** and functions only sparingly:

- Complex analytics (multi-CTE, window functions, statistical analysis) are
  directed to parameterised queries where Genie can learn from the patterns.
- Functions are limited to simple parameterised lookups and entity summaries
  (max 1 CTE, max ~30 lines of SQL body).
- A new `isFunctionTooComplex()` gate rejects functions with > 2 CTEs, > 50
  lines, > 1 window function, or statistical functions.
- Parameter type restriction: Genie certified-answer functions only support
  `STRING`, `INT`, `LONG`, `DOUBLE`, `DECIMAL`, and `BOOLEAN`. Date
  parameters must use `STRING` with a `CAST` inside the function body.
- Quantity rule changed from "at least 1 function per batch" to "0 or 1
  functions per batch" -- producing zero functions is explicitly allowed.

### Metric View Proposals: Multi-Layer Validation

Metric view proposals now go through four layers of validation:

1. **Static YAML validation** -- structural checks (required fields, source
   table, column references) with unknown-alias detection for references like
   `foo.bar` where `foo` is not a declared join alias.
2. **AI function ban** -- a regex scan rejects any metric view expression
   containing `ai_query`, `ai_classify`, `ai_extract`, `ai_gen`,
   `ai_analyze_sentiment`, `ai_similarity`, `ai_forecast`, or `ai_summarize`.
   These are non-deterministic and prohibitively expensive per-row.
3. **LLM repair loop** -- proposals with column/alias errors are
   automatically re-prompted once with the validation errors and correct
   schema context. The repaired YAML/DDL is re-validated and kept only if it
   passes.
4. **SQL dry-run** -- DDL for proposals that pass static validation is
   executed against the warehouse. Permission errors are treated as warnings
   (deploy to a different schema), while SQL errors mark the proposal as
   failed.

The generation prompt now includes a `buildCompactColumnsBlock()` with the
exact available columns and strict grounding rules ("NEVER invent column
names that are not in the AVAILABLE COLUMNS list").

### AI Function Restrictions in SQL Rules

`DATABRICKS_SQL_RULES` and `DATABRICKS_SQL_RULES_COMPACT` in
`lib/ai/sql-rules.ts` now include an explicit rule banning AI functions
(`ai_analyze_sentiment`, `ai_classify`, etc.) from metric view definitions.
This rule propagates to all prompts that import the shared SQL rules.

### Assembler: Payload Size Guardrails

The Genie space assembler now enforces tighter size limits aligned with Genie
best practices:

- **Data objects**: Hard cap of 30 tables + metric views. When exceeded,
  tables are prioritised by join connectivity (tables participating in joins
  are kept first), and metric views are capped at 30% of the budget.
- **SQL snippets**: Capped at 12 each (measures, filters, expressions) with
  a 500-char max per snippet, down from 20 with no size limit.
- **SQL examples**: Capped at 8 with a 4000-char max per example, down from
  10 with no size limit.
- **Instructions**: Hard-truncated to 3000 characters (Genie API recommended
  limit) with block-level truncation rather than a warning.
- **Recommendation counts**: Now reflect the actual post-cap/post-filter
  counts in the serialised space rather than the raw LLM output counts.

---

## Genie Engine & Deployment

### SQL Functions Removed from Genie Spaces

Removed support for SQL functions in Genie spaces. The engine, assembler,
deploy route, and all UI components (deploy modal, space preview, spaces tab)
no longer generate, validate, or deploy SQL functions. This simplifies the
Genie payload and avoids compatibility issues with function DDL across
workspace configurations.

### Domain-Filtered Regeneration

Both the Genie and Dashboard engines now accept an optional `domains` filter
in the POST body. When provided, only the specified domains are regenerated
and the results are merged into the existing recommendations (partial update)
rather than replacing all domains. This enables targeted regeneration without
discarding work already completed for other domains.

### Enhanced Deployment Validation

- Pre-existing metric views are validated with `DESCRIBE TABLE` before
  deployment to catch stale or inaccessible references early.
- Asset visibility polling (`waitForAssetVisibility`) confirms newly created
  views are visible in Unity Catalog before the Genie space payload references
  them.
- Improved error messages surface the root cause when deployment fails
  (permission errors, missing assets, DDL issues).

### DDL Sanitization

- `sanitizeFunctionDdl` now handles double-escaped quotes and normalises
  function identifiers to fully-qualified three-part names.
- `sanitizeSerializedSpace` error handling refactored with structured logging
  of parse failures and a hard error (instead of silent fallback) when the
  space JSON is malformed.

### Genie Space Asset Cleanup

New trash-preview and cleanup APIs allow users to view and remove orphaned
assets (metric views, functions) left behind by previous deployments. The
`GenieSpacesTab` component exposes these options in the UI.

### Validation Issue Display

The `GenieSpacesTab` now renders inline validation issues (e.g. missing
tables, invalid SQL) directly alongside each space, giving users immediate
feedback without needing to open the deploy modal.

### Richer Engine Status

- Genie status endpoint returns `completedDomains`, `totalDomains`,
  `completedDomainNames`, `errorType` (`"auth"` vs `"general"`), and
  `elapsedMs`.
- Dashboard status endpoint returns `domainCount` and `elapsedMs`.
- Both engines support cancellation via `AbortController` and surface
  `EngineCancelledError` cleanly.

---

## Background Job Persistence

### Lakebase-Backed Engine Status

Engine job status (Genie and Dashboard) is now persisted in Lakebase via a
new `ForgeBackgroundJob` model. Key changes:

- **Write-through upsert:** Every status change is written to both in-memory
  state and the `forge_background_jobs` table.
- **Restart recovery:** When in-memory state is missing (e.g. after an app
  restart), the status endpoint falls back to the persisted record.
- **Orphan detection:** On startup, any jobs stuck in `"generating"` status
  are automatically marked as failed so the UI does not show stale progress.

---

## Pipeline Orchestration

### Sequential Background Engines (Genie then Dashboard)

`startBackgroundEngines()` now runs Genie first, then Dashboard, in sequence.
This ensures dashboard recommendations can leverage Genie outputs (e.g.
semantic expressions, metric views) for richer dashboard proposals. Both
engines report domain-level progress through the shared engine-status modules.

---

## Estate Scan & Environment Intelligence

### DESCRIBE TABLE EXTENDED Metadata Enrichment

Replaced `SHOW TBLPROPERTIES` with `DESCRIBE TABLE EXTENDED` in the table
enrichment pipeline. This yields:

- **Reliable row counts** from the Statistics line (e.g. `"26524 bytes, 204
  rows"`) without requiring `ANALYZE TABLE` to have been run. Previously
  `numRows` depended on `spark.sql.statistics.numRows` in TBLPROPERTIES,
  which was often missing.
- **`createdBy`** -- who created the table (e.g. `"Spark"`, a user name).
  Useful for governance and ownership auditing.
- **`lastAccess`** -- when the table was last read or queried. Stored as-is
  from Unity Catalog (may be `"UNKNOWN"` when UC does not track access).
- **`isManagedLocation`** -- ground truth from UC replacing the previous
  heuristic that checked whether `location` started with `s3://`, `gs://`,
  or `abfss://`.

All three new fields are persisted in the `ForgeTableDetail` Lakebase table
and available to exports, the environment page, and LLM intelligence passes.

### New Health Scoring Rule: Table Not Accessed

A new `not_accessed_90d` health rule deducts 10 points from tables that have
not been accessed in over 90 days. The rule only fires when `lastAccess`
contains a real timestamp (not `"UNKNOWN"`), so tables where UC does not
report access data are unaffected.

### Estate Page Enhancements

- The scan form is now conditionally rendered based on whether a scan is
  already in progress.
- Scan polling logic improved to avoid stale state when switching between
  scans or navigating away and back.
- Permission pre-checks (`filterAccessibleScopes`) run before metadata
  extraction to surface access issues early.

---

## Deployment & Infrastructure

### deploy.sh Improvements

- App creation uses `--no-wait` flag to avoid blocking on slow workspace
  provisioning.
- Improved error handling for both `databricks apps create` and
  `databricks apps update` commands with clear failure messages.
- Project ID handling normalised across `deploy.sh`,
  `lib/lakebase/provision.ts`, and `scripts/provision-lakebase.mjs`.

### SCIM API Retry Logic

`/api/2.0/preview/scim/v2/Me` calls in Lakebase provisioning now retry with
exponential backoff on transient failures, improving reliability during first
deployment when the workspace SCIM endpoint may not be immediately available.

### Proxy Script Removed

The standalone `proxy.ts` file has been deleted. Databricks Apps proxy
behaviour is handled via platform-injected environment variables
(`DATABRICKS_HOST`, `DATABRICKS_APP_PORT`) and the existing fetch-with-timeout
infrastructure in `lib/dbx/`.

---

## UI & Layout

### Theme and Header Layout

- `app/layout.tsx` updated with `ThemeProvider`, `ThemeToggle`, `SidebarNav`,
  and `MobileNav` integration.
- Desktop header alignment changed to `md:justify-end` for cleaner toolbar
  positioning.

### Genie Deploy Modal State Reset

The `GenieDeployModal` now resets its internal state each time it is opened,
preventing stale deployment results or error messages from a previous session
from appearing.

### Contextual Help System

A new `InfoTip` / `LabelWithTip` component pair (`components/ui/info-tip.tsx`)
provides hover-tooltip explanations for KPIs, table headers, form fields, and
config options. All tooltip copy is centralised in `lib/help-text.ts` for
consistent wording and future localisation. `TooltipProvider` is now in the
root layout so tooltips work on every page without per-page wrappers.

### Help Page

New `/help` route with a quick-start guide (4 steps) and a collapsible FAQ
covering common questions about pipeline behaviour, data access, exports,
Genie Spaces, and estate scans.

### Header & Navigation Polish

- Desktop header now displays the current page title for wayfinding.
- Mobile header shows "Forge" branding between the hamburger and theme
  toggle.
- Global error page (`app/global-error.tsx`) respects `prefers-color-scheme`
  for dark mode and includes a "Go to Dashboard" link alongside "Try Again".

### Config Form Inline Validation

The discovery config form now shows inline field errors (red border + helper
text) for Business Name and UC Metadata when validation fails on submit.
Errors clear as the user types or selects sources. Toast notification is
retained as a secondary signal.

### Compare Page Empty State

When no completed runs exist, the Compare page now shows a dedicated empty
state with guidance and a CTA to start a new discovery, instead of empty
dropdowns.

### Loading Skeleton Alignment

- Run detail skeleton updated to 5 summary cards (`md:grid-cols-5`) matching
  the actual page layout.
- Configure skeleton now includes a placeholder for the Tips card.
- New `app/outcomes/ingest/loading.tsx` for the outcome map ingest wizard.
- New `app/help/loading.tsx` for the help page.

### Accessibility Improvements

- `aria-live="polite"` added to pipeline step progress, estate scan progress,
  Genie engine generation status, and dashboard engine generation status so
  screen readers announce dynamic updates.
- `aria-label` added to all icon-only buttons (estate back, Genie error
  dismiss, domain badge removal, Genie cancel generation).
- Config form fields set `aria-invalid` when validation errors are present.
