# Release Notes -- 2026-03-13

**Databricks Forge v0.29.0 → v0.31.2**

---

## v0.29.0 -- Async Genie Builds from Ask Forge

### New Features

#### Async Fire-and-Forget Genie Space Builds from Ask Forge
Ask Forge Genie Space creation is now fully asynchronous, eliminating SSE/upstream request timeouts. When a user triggers "Create Genie Space" from Ask Forge, the build starts in the background and the user can continue their conversation immediately. A persistent progress toast in the bottom-right shows real-time build status with cancel, retry, and deploy actions. Completed builds can be deployed directly from the toast or from Genie Studio.

#### Build Progress Toast with Cancel Support
A new persistent `sonner` toast component tracks Genie Space builds across the application. The toast displays a progress bar, current step message, and percentage. Users can cancel running builds at any time. On completion, the toast transitions to a deploy-ready state with one-click deployment or a link to Genie Studio.

#### Genie Deploy Dialog
A lightweight deploy dialog extracted from the original GenieBuilderModal provides quality gate enforcement, metric view schema selection, and a streamlined deploy flow. Reuses shared deploy logic for consistent behavior across all build surfaces.

#### Source Badges on Genie Studio Job Tiles
Build jobs in Genie Studio now display their origin (Ask Forge, Schema Scan, or Requirements) as a compact badge. Completed jobs also show whether they have been deployed, and conversation context is displayed when available.

#### Build-in-Progress Sidebar Indicator
The Genie Studio navigation item shows a pulsing violet dot when any Genie Space build is actively running, giving users visibility across the entire application.

#### Page Refresh Resilience
Active build job IDs are persisted in localStorage. When the page reloads, the layout-level provider restores progress toasts for any still-running or completed-but-undeployed builds.

### Improvements

#### AbortSignal Threading in Fast Genie Engine
`runFastGenieEngine` now correctly destructures and threads `AbortSignal` through all four async LLM calls (expressions, instructions, example queries, title generation) with step-boundary abort checks. This fixes a bug where cancelling a fast build had no effect.

#### Shared Deploy Utilities
Deploy logic (API call, polling, quality gate, metric view payload, embeddings backfill) has been extracted into `lib/genie/deploy-utils.ts` with both a pure function (`deployGenieSpace`) and a React hook (`useGenieDeploy`). The `PATCH /api/genie-spaces/generate` endpoint allows writing `deployedSpaceId` back to the job store for cross-surface coordination.

#### Unified Build Job Provider
A new `GenieBuildProvider` React context replaces local polling in the Genie Studio page with a shared `useGenieBuildJobs` hook. This eliminates duplicate polling and provides consistent job state across Ask Forge, Genie Studio, and the sidebar nav.

#### Progress Callbacks in Fast Engine
`runFastGenieEngine` now reports progress via `onProgress` callbacks at each step (metadata scraping, expression generation, instruction generation, query generation, assembly, quality checks), enabling real-time progress feedback in the async toast.

---

## v0.29.1 -- Scoped Structured Logging

### Improvements

#### Scoped Structured Logging
Introduced `createScopedLogger` factory that produces loggers carrying immutable structured context -- `origin`, `task`, `module`, `fn`, `runId`, `errorCategory`, and `phase` -- through every log entry. Replaced the flat singleton logger across 51 files covering the full stack:

- **Pipeline Engine** -- root logger per run with per-step children carrying `task` and `module`; automatic lifecycle `start`/`end` entries with `durationMs` via the `logStep` wrapper.
- **All 10 pipeline steps** -- use `ctx.logger` with `fn` and `errorCategory` on every warn/error; removed manual `[step-name]` prefixes and redundant `{ runId }` metadata.
- **Genie, Comment, Dashboard, and Estate Scan engines** -- orchestrators create scoped loggers with `origin` set to `GenieEngine`, `CommentEngine`, `DashboardEngine`, or `EstateScan`; sub-passes receive child loggers.
- **9 high-priority API routes** -- use `apiLogger(route, method, { runId })` for request-scoped logging.
- **8 infrastructure modules** -- `prisma.ts`, `provision.ts`, `embed-pipeline.ts`, `assistant/engine.ts`, `context-builder.ts`, `rate-limiter.ts`, `sql-reviewer.ts`, `llm-cache.ts`.

Key capabilities:
- **`child(extra)`** -- nest loggers by adding task/module context without losing parent context.
- **`timed(message, work)`** -- auto-emit paired `start`/`end` entries with `durationMs`.
- **Error categories** -- standardised `errorCategory` values (`llm_timeout`, `sql_hallucination`, `schema_validation`, `auth`, `db`, `network`, etc.) for pattern matching.
- **Dev breadcrumbs** -- human-readable `origin > task > fn | message (phase)` format with correlation ID tags.
- **Production JSON** -- every entry includes `origin`, `task`, `module`, `fn`, `runId`, `phase`, `errorCategory` for structured querying.
- **Backward compatible** -- the singleton `logger` continues to work; unmigrated files function unchanged.

#### Updated Logger Port Interface
`ScopedLogger` extends `Logger` with `child()`, `timed()`, and `context` -- any code typed `Logger` accepts a `ScopedLogger` without changes.

### Other Changes
- Added optional `logger` field to `PipelineContext` for scoped logger injection.
- Updated 9 test files to include `createScopedLogger` in logger mocks.

---

## v0.29.2 -- Metric View Quality & Review Performance

### Bug Fixes

- **Metric view placeholder catalog references** -- The LLM sometimes copied the literal `catalog.schema` placeholder from the prompt examples into generated DDL, causing `NO_SUCH_CATALOG_EXCEPTION` dry-run failures. The prompt now injects the real catalog.schema scope, and a post-processing safety net replaces any residual placeholders.
- **Trusted-asset batch review parse failures** -- Batch review responses for trusted assets failed to parse 100% of the time due to output truncation and minimal JSON parsing. Replaced `JSON.parse` with `parseLLMJson` (handles truncation recovery, preamble stripping, malformed JSON) and doubled `maxTokens` per item when `requestFix` is true.
- **Metric view dry-run timeout risk** -- `dryRunMetricViewDdl` used default SQL timeouts allowing up to ~10 minutes of polling per proposal. Now uses explicit 30s `waitTimeout` and 35s `submitTimeoutMs` to prevent domain-blocking hangs.

### Improvements

#### SQL Review 429 Overflow Routing
When the `sql`-tier review endpoint (`databricks-gpt-5-4`) enters 429 backoff, the task router now overflows to any unblocked pool endpoint instead of queuing behind the 60s circuit breaker. This allows Claude models to absorb review load during rate-limit storms.

#### Global SQL Review Concurrency Limiter
Added a cross-domain concurrency cap (4 concurrent) on all `reviewChatCompletion` calls. With 8+ domains running reviews in parallel, this prevents burst pressure on the review endpoint and reduces 429 activations.

#### Post-Dry-Run LLM Repair Loop
Metric view proposals that pass static validation but fail dry-run with repairable errors (e.g. `METRIC_VIEW_INVALID_VIEW_DEFINITION`, `UNRESOLVED_COLUMN`) now get a second-chance LLM repair attempt. The repaired DDL is re-validated and re-dry-run before acceptance.

---

## v0.30.0 -- Genie Engine Performance Overhaul

### New Features

#### Hierarchical Domain Progress UI
Added a rich, collapsible per-domain progress panel to the Genie Engine workbench. Each domain shows its current phase (expressions, joins, assets, assembly), a thin progress bar, status icon, and elapsed time. The top-level bar remains for overall progress while the detail panel provides granular visibility into long-running generation jobs.

### Improvements

#### Genie Engine Performance Overhaul
Dramatic runtime reduction targeting sub-5 minutes (from ~17 minutes) through six optimization strategies:
- **Parallel subdomain processing**: Metric view generation now runs up to 3 subdomains concurrently via `mapWithConcurrency` instead of sequentially.
- **Parallel dry-run validation**: All metric view dry-runs execute concurrently via `Promise.all` instead of one-by-one.
- **Smarter model routing**: Opus models restricted to reasoning-only tier; semantic expressions downgraded to classification tier for faster inference.
- **Reduced SQL review overhead**: Metric view and join inference reviews disabled by default (validated by YAML parser + dry-run instead); `SQL_REVIEW_CONCURRENCY` bumped from 4 to 6.
- **Lower token budgets**: `maxTokens` reduced across all passes -- semantic expressions (8K to 4K), trusted assets (32K to 12K), benchmarks (32K to 8K), metric views (32K to 16K), column intelligence (32K to 12K).
- **Skip metric view planning**: New `skipMetricViewPlanning` config option (default: true) eliminates an LLM call per domain.

#### Empty LLM Response Resilience
- Empty content from Model Serving is now detected inside the retry loop, triggering genuine retries with exponential backoff (up to 3 attempts).
- Empty responses are never cached, preventing cache poisoning that caused downstream parse failures.
- Diagnostic logging added in `model-serving.ts` and `sql-reviewer.ts` for traceability.
- Review surface env var is restored in a `finally` block to prevent cross-feature side effects.

---

## v0.31.0 -- Quality Presets + Performance Model Bundle

### New Features

#### Quality Preset System
User-configurable Speed / Balanced / Premium presets that control the Genie Engine's speed-vs-richness trade-off. Each preset defines a `GenerationBudget` governing target counts for measures, filters, dimensions, trusted assets, and benchmarks, along with domain concurrency, review surface enablement, and maxTokens per LLM call. The default preset is **Balanced**. Accessible from the Settings page under the Genie Engine section.

#### Performance Model Bundle
Three new high-throughput models added to the model registry: `databricks-gemini-3-1-flash-lite` (priority 0, classification + lightweight), `databricks-llama-4-maverick` (priority 0, generation + classification), and `databricks-gemini-3-flash` (priority 1, generation + classification + lightweight). A new `DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT` env var and `--lightweight-endpoint` deploy flag bind the 7th model slot.

### Improvements

#### Budget-Driven Generation
All Genie Engine passes (semantic expressions, trusted assets, benchmarks) now accept budget parameters instead of using hardcoded target counts and maxTokens. Worker A/B/C prompts, use case caps, and benchmarks-per-batch are all driven by the resolved budget.

#### Right-Sized Output
Speed preset generates lean spaces (4 measures A / 2 measures B / 4 filters / 4 dimensions, 3 concurrent domains, metric views disabled). Premium produces maximum richness (15/10/12/12, 10 concurrent domains, all review surfaces enabled). Balanced sits in the middle as the recommended default.

#### Cross-Surface Wiring
Quality preset flows through the pipeline Genie workbench, ad-hoc Genie engine (Scan Schema, Upload Requirements), and Ask Forge conversational builder. All surfaces respect the user's chosen preset.

### Bug Fixes
- **Metric view dry-run collision** -- Parallel dry-runs could create `TABLE_OR_VIEW_ALREADY_EXISTS` errors due to identical temp table names. Fixed by appending a UUID suffix to the temp table name.
- **SQL review maxTokens cap** -- Batch review calls were capped at 16,384 tokens, causing truncation on large batches. Increased to 32,768.

### Other Changes
- Deploy script updated with `--lightweight-endpoint` flag, resource binding, env var injection, and success banner.
- Model registry tests expanded with 5 new test cases for performance bundle models (15/15 passing).
- AGENTS.md updated to document quality presets, `GenerationBudget`, performance bundle, and the lightweight endpoint deploy flag.

---

## v0.31.1 -- Model Compatibility Guards

### Bug Fixes

- **Reasoning model content parsing** -- Fixed `e.replace is not a function` and `e.trim is not a function` crashes when Gemini 3 models return array-of-blocks content (reasoning + text blocks) instead of a plain string. New `extractContentText()` safely extracts text from both formats.

- **JSON mode 400 errors** -- Replaced string-matching `supportsJsonResponseFormat()` with a registry-backed lookup. Only GPT-5.x models (verified `supportsJsonMode: true`) now receive `response_format: json_object`. Gemini, Llama, and Claude models no longer trigger `400 BAD_REQUEST` from unsupported JSON mode requests.

- **maxTokens exceeds model limit** -- Added automatic token clamping in both `chatCompletion` and `chatCompletionStream`. Requests for 12288 tokens to Gemini Flash Lite (max 8192) are now silently clamped instead of returning `400 BAD_REQUEST`.

- **GPT-5.4 empty responses (finishReason=length)** -- Doubled the SQL reviewer per-item token budget (1024->2048 review, 2048->4096 fix) and added a 16384 token floor. GPT-5.4's hidden reasoning tokens no longer exhaust the budget before producing visible output.

- **Unknown model rejection** -- `templateFor()` now returns `null` for unrecognised models, and `buildPool()` skips them with a warning log. Prevents undefined-capability models from entering the pool with permissive defaults.

- **Codex model removal** -- Removed `databricks-gpt-5-3-codex` from `KNOWN_MODELS`. All Codex models require the Responses API (AI Gateway beta only) and are not supported until GA.

### Improvements

#### Per-call model observability
Every `chatCompletion` call now logs the endpoint, requested maxTokens, JSON mode, and model capabilities. `resolveEndpoint` logs tier, chosen endpoint, and resolution source at debug level. All Genie Engine passes (semantic expressions, trusted assets, benchmarks, column intelligence, instructions) include the endpoint in their status logs.

#### Verified model capability registry
`KNOWN_MODELS` in `model-registry.ts` now includes `supportsJsonMode` and `maxOutputTokens` for every supported model, sourced from Databricks documentation. New `getModelCapabilities()` public API enables any module to query model limits. Pool startup summary now includes JSON mode support and max output tokens per endpoint.

---

## v0.31.2 -- Progressive 429 Backoff + 8K Token Optimization

### Improvements

#### Progressive 429 Backoff (10s / 20s / 30s)
Replaced the flat 60-second rate-limit backoff with a progressive escalation ladder: first 429 triggers a 10-second pause, second escalates to 20 seconds, and third+ caps at 30 seconds. Successful calls immediately reset the counter and lift the block. Saves ~50 seconds per rate-limit incident.

#### Gemini 3.1 Flash Lite Promoted to Generation Tier
Flash Lite is now the preferred model for all generation tasks (trusted assets, metric views, benchmarks, example queries) in addition to classification and lightweight tiers. Llama Maverick is demoted to overflow/backup (priority 1). Based on testing, Flash Lite is both faster and higher quality.

#### Trusted Asset Prompt Rework for 8K Models
Condensed the trusted assets system prompt by ~50%, reduced batch size from 3 to 2 use cases per LLM call, and lowered default maxTokens from 12,288 to 6,144. Each batch now produces 1-2 complete parameterized queries that fit comfortably within 8K model output limits, eliminating truncated JSON.

#### Metric View YAML-Only Output
The LLM now returns only the YAML body for metric view proposals; the DDL wrapper (`CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML AS $$ ... $$`) is built programmatically via the new `buildMetricViewDdl()` helper. This halves output token usage per proposal. The YAML spec reference embedded in the prompt was condensed from ~140 lines to ~30 lines. Max proposals reduced from 3 to 2 per subdomain.

#### Lower Concurrency Caps for Rate-Limit-Prone Models
Reduced max concurrent requests: Llama Maverick 10→6, GPT-5.4 6→4, Gemini Flash 8→8 (unchanged). Prevents 429 storms on pay-per-token endpoints with tight per-second output token limits.

#### Quality Preset Token Budget Reductions
All three quality presets now use token budgets that fit within the 8,192-token output ceiling of the majority of pool models:
- **Balanced**: trustedAssets 12,288→6,144, benchmarks 6,144→4,096
- **Speed**: trustedAssets 8,192→4,096, benchmarks 4,096→3,072
- **Premium**: trustedAssets 32,768→8,192, benchmarks 8,192→6,144

#### Column Intelligence and Benchmark Default maxTokens Lowered
Hardcoded maxTokens in column intelligence (12,288→6,144) and benchmark generation (8,192→6,144) now leave headroom within 8K model limits. These defaults are used by the ad-hoc Genie Engine which bypasses quality preset budgets.

#### 429 Diagnostics: Raw Retry-After Header Logging
Both regular and streaming LLM call paths now log the raw `Retry-After` header value (or `(none)`) on 429 responses, confirming whether Databricks sends one and enabling future tuning of backoff parameters.

---

## All Commits

| Hash | Summary |
|---|---|
| `f4be01c` | feat: async fire-and-forget Genie Space builds from Ask Forge |
| `2e3f70d` | refactor: introduce scoped logging with origin, module, and error category tracking |
| `21eb93d` | fix: Genie Engine metric view quality and review performance |
| `ea69642` | feat: Genie Engine performance overhaul + hierarchical progress UI + empty response resilience |
| `94f6448` | chore: format codebase with Prettier |
| `2cff418` | feat: quality preset system with performance model bundle |
| `a95199e` | fix: model compatibility guards -- content parsing, JSON mode gate, token clamping, and per-call logging |
| *(pending)* | fix: progressive 429 backoff, Flash Lite generation tier, prompt rework for 8K models |
