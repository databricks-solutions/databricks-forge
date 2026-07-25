# Release Notes -- 2026-03-19

**Databricks Forge v0.39.0 → v0.39.3**

---

## v0.39.0 -- Migrate Genie Benchmarks to Official Eval API

### New Features
#### Genie Eval API Integration
Replaced the entire custom Genie benchmark system (SQL similarity, result-set comparison, LLM judge) with the official Databricks Genie Eval API (Beta). The five new endpoints (`createEvalRun`, `getEvalRun`, `listEvalRuns`, `listEvalResults`, `getEvalResultDetails`) handle execution, comparison, and scoring server-side. All benchmark runs now produce `GOOD/BAD/NEEDS_REVIEW` assessments with 25+ `ScoreReason` categories from Databricks LLM judge + result-set comparison.

### Improvements
#### Simplified Benchmark Architecture
Removed ~430 lines of custom comparison logic from the benchmark API route, replacing it with a thin proxy to the Eval API (~160 lines). Deleted all client-side SQL similarity, result-set matching, and LLM judge code. The Genie API is now the single source of truth for run state -- no more in-memory job trackers.

#### Richer Failure Categorization
The old `FailureCategory` enum (10 values) is replaced by `ScoreReason` (25+ values) from the Eval API, providing much more precise failure diagnoses. Each ScoreReason maps to specific health check fix strategies for targeted improvement.

#### Enhanced Benchmark UI
The benchmarks page now displays GOOD/BAD/NEEDS_REVIEW assessment badges, ScoreReason chips with human-readable labels, side-by-side SQL comparison (expected vs actual), and execution result tables. History tab fetches directly from the Eval API with Lakebase enrichments.

#### Eval-Aware Auto-Improve Loop
The auto-improve loop now uses `runEval()` instead of the old `runBenchmarks()`, polling the Eval API for completion. Three-space architecture, stagnation detection, and sequential fix evaluation all work with the new async eval flow.

### Other Changes
- New `lib/genie/eval-types.ts` with all Genie Eval API types (1:1 with REST API)
- Updated `ForgeSpaceBenchmarkRun` Prisma model: added `evalRunId`, `status`, `numCorrect`, `numNeedsReview`, `accuracy`; removed `totalQuestions`, `passedCount`, `failedCount`, `errorCount`
- Updated `AGENTS.md` and `docs/GENIE_HEALTHCHECK_ENGINE.md` to document new eval API architecture
- Rewrote all benchmark-feedback tests for ScoreReason-based mapping (30 tests)

---

## v0.39.1 -- Fix synthetic question IDs sent to Genie Eval API

### Bug Fixes
- **Benchmark eval run fails with "Curated question with ID 'q-0' not found"** -- The benchmarks API route was not returning the real `id` field from serialized space questions. The UI generated synthetic fallback IDs (`q-0`, `q-1`, ...) which the Genie Eval API rejected. Now the API passes through real question IDs, and the UI disables individual selection for questions without IDs while still allowing "Run All" (which omits `questionIds`, letting the API evaluate every benchmark question).

---

## v0.39.2 -- Expose full eval result details (execution results, column types, error states)

### Bug Fixes
- **Benchmark execution results not rendering** -- The `sql_execution_result` from the Genie Eval API has a nested structure (`manifest.schema.columns`, `result.data_array`) but the UI was looking for flat top-level fields. Added proper typed interfaces (`SqlExecutionResult`, `SqlExecutionResultManifest`, `SqlExecutionResultColumn`, etc.) and rewrote `ExecutionResultTable` to correctly navigate the nested structure.

### Improvements
- Execution result tables now show column types, total row counts, truncation indicators, error states, and pending/running execution status.
- Increased visible row limit from 10 to 20, with overflow indicator.
- NULL values now render with distinct italic styling.

---

## v0.39.3 -- Benchmark detail UI overhaul matching Databricks native eval experience

### Improvements
#### Side-by-side "Model output" / "Ground truth" panels
Restructured benchmark result cards to use a two-column layout matching the Databricks native eval UI. Each column is a self-contained `ResponsePanel` with SQL + execution result table paired together, replacing the old vertically-stacked layout.

#### SQL syntax highlighting via CodeMirror
Replaced plain `<pre>` SQL blocks with the existing `SqlEditor` component (CodeMirror, read-only mode) providing syntax highlighting, line numbers, and proper monospace rendering.

#### Collapsible SQL
Long SQL statements (>8 lines) are collapsed by default with a "... N more lines" toggle, matching the Databricks UI pattern.

#### Copy-to-clipboard buttons
Each response panel now has a copy button for the SQL/text content with visual feedback.

#### Response type badges and row numbers
Each panel shows an "SQL" or "TEXT" badge. Execution result tables now include a `#` row number column and use Databricks-style labeling ("Model output" / "Ground truth SQL answer").

---

## All Commits

| Hash | Summary |
|---|---|
| `9db17cc` | feat: benchmark detail UI overhaul matching Databricks native eval experience |
| `b5fb30a` | fix: expose full eval result details with proper SqlExecutionResult types |
| `853b4ce` | fix: pass real benchmark question IDs to Genie Eval API instead of synthetic fallbacks |
| `d671224` | feat: migrate Genie benchmarks to official Databricks Eval API |
