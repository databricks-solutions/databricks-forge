# Release Notes -- 2026-03-11

**Databricks Forge v0.23.0**

---

## New Features

### Engine Portability Architecture
Introduced a dependency injection (DI) layer that enables all four primary engines (Comment, Genie, Dashboard, Health Check) to be extracted and run as standalone components without Databricks infrastructure. Engines now accept optional `deps` objects with injectable `LLMClient`, `Logger`, and review functions.

### Port Interfaces (`lib/ports/`)
New abstract TypeScript interfaces for all cross-cutting concerns: `LLMClient`, `SqlExecutor`, `SkillResolver`, `Logger`, and `EngineProgressTracker`. Default Databricks implementations live in `lib/ports/defaults/` and wire ports to `model-serving`, `sql.ts`, `logger`, and `skills/resolver`.

### Shared Toolkit (`lib/toolkit/`)
Relocated 6 shared utilities from engine-specific paths to a single `lib/toolkit/` module: `concurrency`, `parse-llm-json`, `llm-cache`, `sql-rules`, `token-budget`, and `retry`. All 39 consumer files updated to import from the new paths. Deprecated re-export stubs maintained at the original paths for backward compatibility.

### Unified SQL Engine (`lib/sql-engine/`)
New composable generate/validate/review/fix pipeline that centralises SQL quality infrastructure. Accepts an `LLMClient` port and provides standardised access to SQL rules, validation, and review.

---

## Improvements

### Comment Engine DI
The Comment Engine now accepts `CommentEngineDeps` with optional pre-built `SchemaContext`, industry context, and `LLMClient`. When a pre-built schema context is provided, Phase 0+1 (metadata fetch + classification) is skipped entirely, enabling use without a Databricks SQL warehouse.

### Dashboard Engine DI
The Dashboard Engine now accepts `DashboardEngineDeps` with optional `LLMClient`, `Logger`, `reviewAndFixSql`, and `isReviewEnabled`. All 15 internal logger calls routed through the injectable logger.

### Genie Engine DI
The Genie Engine now accepts `GenieEngineDeps` with optional `LLMClient` and `Logger`. All 14 internal logger calls and helper functions (`processDomain`, `inferJoinsFromUseCaseSql`) routed through the injectable logger.

### Health Check DI
The Health Check evaluators now support injectable `reviewBatch` and `isReviewEnabled` functions via `setHealthCheckReviewFn()` and `setHealthCheckReviewEnabledFn()`. A `resetHealthCheckDeps()` function restores defaults.

### Standard Engine Contract
Documented the target specification for all engines (`lib/ports/ENGINE_CONTRACT.md`) covering required capabilities: DI, AbortSignal, progress callbacks, structured counters, caching, batching, concurrency, facade separation, and polling APIs.

---

## Other Changes

- Updated AGENTS.md with new folder contract, infrastructure entries, and engine portability architecture section
- 107 files changed across the codebase, 2628 insertions, 1646 deletions
- Zero test regressions: all 777 tests pass
- Zero lint errors, zero typecheck errors, clean Prettier formatting

---

## Commits (1)

| Hash | Summary |
|---|---|
| `dbe503e` | Refactor engine architecture for portability and dependency injection |

**Uncommitted changes:** Version bump (0.22.0 -> 0.23.0) and this release notes file.
