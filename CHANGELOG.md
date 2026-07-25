# Changelog

All notable changes to Databricks Forge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-02-22

### Added

- `lib/ai/sql-rules.ts` -- centralised Databricks SQL quality rules (`DATABRICKS_SQL_RULES` and `DATABRICKS_SQL_RULES_COMPACT`) shared across all SQL-generating prompts for consistency.
- Join spec alias injection and SQL rewriting in `lib/genie/assembler.ts` -- generates backtick-quoted alias-based join conditions (`` `alias`.`column` ``) and handles self-joins with `_2` suffix.
- Relationship type encoding as SQL comment (`--rt=FROM_RELATIONSHIP_TYPE_...--`) in join spec `sql` array, working around Genie API protobuf limitation.
- Comprehensive payload sanitisation in `lib/dbx/genie.ts` -- alias injection, join SQL rewriting, relationship type encoding, and `sql_functions` sorting as a universal safety net.
- Window function validation in `lib/genie/passes/metric-view-proposals.ts` -- detects `OVER()` clauses in measure expressions and marks proposals as `error`.
- `CREATE FUNCTION/VIEW/TABLE` exclusion in `lib/genie/schema-allowlist.ts` -- FQNs being defined are no longer flagged as unknown references.
- SQL identifier safety in `lib/queries/metadata.ts` -- `validateIdentifier()` applied to each FQN part in `buildFqnWhereClause`.

### Changed

- **Genie instruction generation** (`lib/genie/passes/instruction-generation.ts`): Rewritten to produce concise behavioural guidance per Databricks best practices. Removed verbose business context, SQL rules, and join instructions from text instructions (these are now handled by structured API fields).
- **Trusted asset authoring** (`lib/genie/passes/trusted-assets.ts`): Reduced batch size to 2, added SQL truncation at 3000 chars, added LIMIT literal rule for UDFs.
- **Benchmark generation** (`lib/genie/passes/benchmark-generation.ts`): Reduced batch size to 2, benchmarks per batch to 3, added SQL truncation, capped benchmarks at 10 per space.
- **Metric view proposals** (`lib/genie/passes/metric-view-proposals.ts`): Added window function and MEDIAN() prohibition rules.
- **Dashboard prompts** (`lib/dashboard/prompts.ts`): Now imports shared `DATABRICKS_SQL_RULES`.
- **SQL generation prompt** (`lib/ai/templates.ts`): Now imports shared `DATABRICKS_SQL_RULES`.
- **Deploy route** (`app/api/runs/[runId]/genie-deploy/route.ts`): Function IDs now use 32-hex UUIDs; sql_functions sorted after patching.
- **SQL execution** (`lib/dbx/sql.ts`): Added optional chaining for DDL statements where `manifest.schema.columns` may be undefined.
- Removed `relationship_type` field from `JoinSpec` type in `lib/genie/types.ts`.
- Removed "Run Benchmark" button from Genie Spaces UI (awaiting Databricks Evaluation API).

### Fixed

- `Cannot find field: relationship_type` -- Genie API protobuf rejects standalone relationship_type field.
- `Cannot read properties of undefined (reading 'map')` -- DDL statements returning null column manifest.
- `Invalid id for sql_function.id` -- function IDs now use lowercase 32-hex UUIDs.
- `INVALID_LIMIT_LIKE_EXPRESSION` -- UDF LIMIT clauses now use integer literals.
- `sql_functions must be sorted by (id, identifier)` -- sorting applied in deploy route and sanitisation.
- `METRIC_VIEW_WINDOW_FUNCTION_NOT_SUPPORTED` -- window functions detected and blocked in metric view proposals.
- `SQL expression references unknown identifiers` -- CREATE DDL targets excluded from validation.
- LLM output truncation in trusted assets and benchmark passes -- reduced batch sizes and SQL input length.
- Join conditions in text instructions displayed FQN format -- now use short alias format.
- Text instructions were too verbose (2900+ chars) -- rewritten to concise behavioural guidance.

## [0.3.0] - 2026-02-17

### Changed

- **LLM integration migrated to Model Serving REST API**: Replaced `ai_query()` SQL function with direct calls to Databricks Model Serving chat completions endpoint (`/serving-endpoints/{endpoint}/invocations`). This eliminates SQL Warehouse overhead for LLM inference, reducing latency and improving reliability.
- **JSON mode for structured outputs**: Table filtering and use case generation now use `response_format: json_object` instead of CSV parsing, improving parse reliability and eliminating regex-based extraction.
- **Streaming support for SQL generation**: Step 7 now uses SSE streaming via Model Serving, improving perceived latency for long SQL generation calls.
- **Token usage tracking**: All LLM calls now capture prompt, completion, and total token counts from Model Serving responses and persist them in prompt logs for cost analysis.
- **Chain-of-thought prompts**: Table filtering and scoring prompt templates now include explicit reasoning workflow sections, improving LLM decision quality.
- **System/user message separation**: Prompts now use the chat completions format with separate system and user messages, providing better prompt hygiene and structural isolation.
- Updated all documentation (AGENTS.md, README.md, SECURITY_ARCHITECTURE.md, FORGE_ANALYSIS.md, FORGE_V1_vs_V2.md, docs/ARCHITECTURE.md, docs/PIPELINE.md, docs/DEPLOYMENT.md) to reflect the new Model Serving architecture.
- Updated Cursor rules (01-architecture, 04-ai-guardrails, 05-testing) for new architecture conventions.

### Added

- `lib/dbx/model-serving.ts` -- new Model Serving client with chat completions, streaming, token usage, and custom error handling.
- `promptTokens`, `completionTokens`, `totalTokens` fields on `ForgePromptLog` Prisma model.

## [0.2.0] - 2026-02-16

### Added

- **Error boundaries**: `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` for graceful error handling
- **Health check endpoint**: `GET /api/health` with database and warehouse connectivity checks
- **Structured logging**: `lib/logger.ts` with JSON output in production, log levels, and correlation IDs
- **Fetch timeouts**: `AbortController`-based timeouts on all Databricks API calls (SQL, OAuth, Workspace)
- **Input validation**: Zod schemas for API route inputs (`POST /api/runs`, `GET /api/metadata`)
- **SQL injection prevention**: Strict identifier regex validation for catalog/schema names
- **UUID validation**: All `runId` params validated as UUIDs before database lookup
- **Security headers**: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
- **Mobile navigation**: Sheet-based hamburger menu for small screens
- **Settings skeleton**: Loading state for settings page during hydration
- **Test infrastructure**: Vitest setup with 45 tests covering scoring, templates, parsers, validation
- **CI pipeline**: GitHub Actions workflow for lint, typecheck, test, and build
- **Versioning**: App version surfaced in `/api/health`, sidebar footer, and pipeline run metadata
- **Database indexes**: Indexes on `ForgeUseCase(runId)`, `ForgeExport(runId)`, `ForgeMetadataCache(cachedAt)`
- **Retry discrimination**: AI agent only retries on 5xx/timeout/network errors, not 4xx
- **Atomic persistence**: Pipeline use case persistence wrapped in Prisma `$transaction`
- **Nested error handling**: Pipeline engine catch block now handles `updateRunStatus` failures

### Changed

- `next.config.ts`: Added `output: 'standalone'`, `reactStrictMode: true`, `poweredByHeader: false`
- Polling in runs list and run detail pages now uses `AbortController` and only polls when runs are active
- Pipeline engine migrated from `console.*` to structured `logger.*` calls

### Fixed

- Docker build failure due to missing `output: 'standalone'` in Next.js config
- Potential SQL injection via unvalidated catalog/schema names in metadata queries
- Race conditions in frontend polling (overlapping fetches, stale closures)
- Non-atomic delete+insert of use cases could leave runs in inconsistent state
- Settings page blank screen during hydration (now shows skeleton loader)

## [0.1.0] - Initial Release

### Added

- Pipeline engine with 7 steps (business context, metadata extraction, table filtering, use case generation, domain clustering, scoring, SQL generation)
- LLM integration via Databricks `ai_query()` with temperature and token control
- Export to Excel, PDF, PowerPoint, and SQL notebooks
- Prompt engineering with JSON output, negative examples, and quantity guidance
- Lakebase persistence with Prisma ORM
- shadcn/ui frontend with dark mode, sidebar navigation
