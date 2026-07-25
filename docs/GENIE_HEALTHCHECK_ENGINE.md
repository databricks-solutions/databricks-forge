# Genie Health Check Engine

> Technical guide for Genie Space discovery, deterministic health checking,
> optimization review with diff preview, and the benchmark feedback loop
> in Databricks Forge.

The Health Check Engine discovers Genie Spaces in the workspace (with OBO
authentication), scores them against a configurable checklist of best practices,
offers automated fixes via the existing Genie Engine passes with an intermediate
optimization review and diff preview step, and supports an iterative benchmark
feedback loop to validate real-world accuracy.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Space Discovery & Stale Validation](#space-discovery--stale-validation)
3. [Health Check Pipeline](#health-check-pipeline)
4. [YAML Check DSL](#yaml-check-dsl)
5. [Evaluator Functions](#evaluator-functions)
6. [Registry & Merge Logic](#registry--merge-logic)
7. [Scoring Algorithm](#scoring-algorithm)
8. [Custom Check Configuration](#custom-check-configuration)
9. [Fix Workflow](#fix-workflow)
10. [Optimization Review & Diff Preview](#optimization-review--diff-preview)
11. [Fix Strategy Router](#fix-strategy-router)
12. [Metadata Building for Off-Platform Spaces](#metadata-building-for-off-platform-spaces)
13. [Benchmark Feedback Loop](#benchmark-feedback-loop)
14. [Improvement Logic (Feedback-to-Fix)](#improvement-logic-feedback-to-fix)
15. [Critical User Journeys (CUJs)](#critical-user-journeys-cujs)
16. [Data Model](#data-model)
17. [API Reference](#api-reference)
18. [UI Components](#ui-components)
19. [Hardening & Performance](#hardening--performance)
20. [File Reference](#file-reference)

---

## Architecture Overview

The system is split into four interconnected stages forming an
iterative improvement cycle:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         IMPROVEMENT PIPELINE                               │
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ DISCOVER     │─▶│ DIAGNOSE     │─▶│ FIX          │─▶│ REVIEW        │  │
│  │ Workspace    │  │ Health Check │  │ Engine Passes │  │ Optimization  │  │
│  │ scan + OBO   │  │ (pure func)  │  │ (LLM + det.) │  │ Review + Diff │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────┬───────┘  │
│                           ▲                                    │          │
│                           │         ┌───────────────┐          │          │
│                           │         │ VERIFY        │◀─────────┘          │
│                           │         │ Benchmark Loop│                     │
│                           │         │ (Conv. API)   │                     │
│                           │         └──────┬────────┘                     │
│                           └────────────────┘                              │
│                      (iterate until satisfied)                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Discovery Layer

All read operations use **OBO (On-Behalf-Of) authentication** -- the logged-in
user's token is forwarded to the Databricks API. This ensures that spaces are
only visible if the user has permission to access their underlying tables.

The `/api/genie-spaces` route cross-references workspace spaces against Lakebase
tracked spaces to filter out **stale** entries (tracked spaces whose backing
Genie Space has been deleted). Stale spaces are excluded from the UI but their
Lakebase records remain intact for potential redeployment via pipeline runs.

The `/api/genie-spaces/discover` endpoint performs bulk metadata extraction
and health scoring in a single call, replacing the former `health-batch`
endpoint. It uses bounded concurrency (5 parallel tasks) and the in-memory
space cache.

### Health Check Layer (Diagnose)

```
┌─────────────────────────────────────────────────────┐
│  Check Definitions (YAML)                           │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ default-checks  │  │ user-custom-checks       │  │
│  │ .yaml (built-in)│  │ (Lakebase / settings UI) │  │
│  └────────┬────────┘  └────────────┬─────────────┘  │
│           └──────────┬─────────────┘                │
│                      ▼                              │
│  ┌─────────────────────────────────────────┐        │
│  │  Registry (merges defaults + overrides) │        │
│  └────────────────────┬────────────────────┘        │
│                       ▼                             │
│  ┌─────────────────────────────────────────┐        │
│  │  Evaluator Engine (deterministic)       │        │
│  │  count | exists | length | ratio |      │        │
│  │  pattern | range | unique | jsonpath    │        │
│  └────────────────────┬────────────────────┘        │
│                       ▼                             │
│  ┌─────────────────────────────────────────┐        │
│  │  SpaceHealthReport                      │        │
│  └─────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

Key design decisions:
- **OBO auth** for all Genie API reads -- user-scoped permissions, no SP privilege escalation
- **No LLM calls** for evaluation -- all checks are deterministic pure functions
- **YAML-driven** -- checks are declarative and user-configurable
- **Extensible** -- users add custom checks via settings UI or YAML import
- **Additive-only** fixes -- the fixer never removes existing space content
- **Review before apply** -- all fixes go through an Optimization Review step with diff preview

---

## Space Discovery & Stale Validation

When the Genie Spaces page loads, the system performs two passes:

### Pass 1: List & Filter (GET /api/genie-spaces)

1. Fetch workspace spaces via `listGenieSpaces()` (OBO auth)
2. Fetch tracked spaces from Lakebase via `listTrackedGenieSpaces()`
3. Build a set of workspace space IDs
4. Filter tracked spaces: keep only those whose `spaceId` exists in the workspace set (or are trashed)
5. Return merged list plus `staleCount` for UI notification
6. Lakebase records for stale spaces are **not deleted** -- they remain available for redeployment from the pipeline runs page

### Pass 2: Discover (POST /api/genie-spaces/discover)

1. UI sends an array of active space IDs to the discover endpoint
2. For each space (bounded concurrency = 5):
   a. Fetch `serialized_space` via `getGenieSpace()` (OBO auth, cached in space cache)
   b. Extract `SpaceMetadata` via `extractSpaceMetadata()` (table count, measure count, filter count, etc.)
   c. Run `runHealthCheck()` to produce a `SpaceHealthReport`
3. Return a map of `spaceId → { metadata, healthReport }`
4. UI enriches space cards with metadata counts and health grade badges

### Space Metadata Extraction

`lib/genie/space-metadata.ts` provides shared utilities for extracting structured
metadata from a `serialized_space` JSON string:

```typescript
interface SpaceMetadata {
  tableCount: number;
  metricViewCount: number;
  measureCount: number;
  sampleQuestionCount: number;
  filterCount: number;
  expressionCount: number;
  joinCount: number;
  exampleSqlCount: number;
  benchmarkCount: number;
  instructionLength: number;
  tables: string[];
  metricViews: string[];
}
```

Three entry points:
- `extractSpaceMetadata(raw: string)` -- parse + extract in one call
- `extractMetadataFromParsed(space: SerializedSpace)` -- extract from already-parsed object
- `parseSerializedSpace(raw: string)` -- safe JSON parse returning `null` on failure

---

## Health Check Pipeline

Step-by-step flow from API call to `SpaceHealthReport`:

1. **Fetch space** -- `getGenieSpace(spaceId)` returns `serialized_space` JSON (OBO auth)
2. **Load config** -- `getHealthCheckConfig()` loads user overrides from Lakebase
3. **Resolve registry** -- `resolveRegistry(overrides, custom, weights)` merges
   defaults + user overrides + custom checks
4. **Run evaluators** -- for each enabled check, call `runEvaluator(space, check)`
5. **Compute category scores** -- `passed / total * 100` per category
6. **Compute overall score** -- weighted average of category scores
7. **Assign grade** -- A (90+), B (80-89), C (70-79), D (60-69), F (<60)
8. **Collect quick wins** -- from failed checks, sorted by severity, capped at 5
9. **Return report** -- `SpaceHealthReport` with all results

The entire pipeline is a **pure function** with no side effects. Health score
persistence is fire-and-forget after the report is returned.

---

## YAML Check DSL

Each check is a declarative YAML block in `lib/genie/health-checks/default-checks.yaml`.

### Check Definition Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier for the check |
| `category` | string | Yes | Must match a defined category key |
| `description` | string | Yes | Human-readable description shown in UI |
| `severity` | `critical` \| `warning` \| `info` | Yes | Determines ordering and UI treatment |
| `fixable` | boolean | Yes | Whether the fix workflow can address this |
| `fix_strategy` | string | If fixable | Maps to a fix strategy in `space-fixer.ts` |
| `evaluator` | string | Yes | One of the 13 registered evaluator types |
| `path` | string | Depends | JSONPath-like dot notation into `serialized_space` |
| `paths` | string[] | For `no_empty_field` | Multiple paths to check |
| `field` | string | For `ratio`/`nested_ratio` | Field to check on each item |
| `params` | object | Yes | Evaluator-specific parameters |
| `quick_win` | string | No | Actionable text shown when check fails |
| `condition_path` | string | For `conditional_count` | Path to check before evaluating |
| `condition_min` | number | For `conditional_count` | Minimum count to trigger evaluation |

### Category Definitions

```yaml
categories:
  data_sources:
    label: "Data Sources"
    weight: 25
  instructions:
    label: "Instructions"
    weight: 25
  semantic_richness:
    label: "Semantic Richness"
    weight: 25
  quality_assurance:
    label: "Quality Assurance"
    weight: 25
```

Weights determine how much each category contributes to the overall score.
Users can override weights via the settings API.

---

## Evaluator Functions

Located in `lib/genie/health-checks/evaluators.ts`. Each evaluator is a pure
function: `(space, checkDef) => CheckResult`.

### `count`
Count items at `path` and check against `min` / `max`.
- **Params:** `min` (default 0), `max` (optional)
- **Pass:** `count >= min && count <= max`
- **Example:** Check for at least 5 example SQL pairs

### `range`
Like `count` with an additional `warn_above` threshold.
- **Params:** `min`, `max`, `warn_above`
- **Pass:** within range AND below warn threshold

### `exists`
Check if a path resolves to a non-null value.
- **Pass:** at least one value found at path

### `length`
Check string length at a path.
- **Params:** `min`, `max`

### `ratio`
What fraction of items at `path` have a non-empty `field`.
- **Params:** `min_ratio` (0.0 to 1.0)
- **Pass:** `ratio >= min_ratio`
- **Edge case:** Empty arrays vacuously pass

### `nested_ratio`
Like `ratio` but for nested arrays (e.g., `tables[*].column_configs`).
Flattens the resolved array before counting.
- **Params:** `min_ratio`

### `pattern`
Validate all values match a regex.
- **Params:** `regex`
- **Special path:** `__all_ids__` collects all `id` fields recursively

### `unique`
Check all values are unique (no duplicates).
- **Special path:** `__all_ids__` collects all `id` fields recursively

### `no_empty_field`
Verify no items have empty/missing values at given paths.
- **Uses `paths`** (array) instead of single `path`

### `conditional_count`
Only evaluate if a condition is met (e.g., only check join specs if >= 2 tables).
- **Params:** inherits from `count`, plus `condition_path`, `condition_min`
- **Pass:** if condition not met, check is skipped (passes)

### `jsonpath`
Reserved for advanced user-defined checks using arbitrary JSONPath expressions.

### `sql_quality`
LLM-powered SQL quality review using the dedicated review endpoint
(`serving-endpoint-review`). Collects SQL snippets from the specified `paths`,
batch-reviews them via `reviewBatch()`, and passes if the average quality
score meets the threshold and no individual snippet fails.
- **Params:** `min_score` (default 60, scale 0-100)
- **Uses `paths`** (array of paths to SQL string values)
- **Async:** queued during synchronous health check run, resolved via
  `enrichReportWithSqlQuality()` after the initial report
- **Feature-gated:** only runs when `serving-endpoint-review` is configured

---

## Registry & Merge Logic

Located in `lib/genie/health-checks/registry.ts`.

### Merge Precedence

1. Load `default-checks.yaml` (bundled, immutable, cached in memory)
2. Load user overrides from Lakebase `ForgeHealthCheckConfig` table
3. Merge rules:
   - User `enabled: false` disables a built-in check
   - User `params` are shallow-merged (override individual thresholds)
   - User `severity` replaces the default severity
   - Custom checks are appended after built-in checks
4. Category weight overrides applied to category definitions
5. Validation: custom checks must reference valid categories and evaluators

### Cache Behavior

Default checks are parsed once from YAML and cached in a module-level variable.
Call `clearRegistryCache()` to force a reload (used in tests).

---

## Scoring Algorithm

```
overallScore = Σ(categoryScore × categoryWeight) / Σ(categoryWeight)

categoryScore = (passedChecks / totalChecks) × 100  (or 100 if no checks)

grade:
  90-100 → A
  80-89  → B
  70-79  → C
  60-69  → D
  0-59   → F
```

Quick wins are collected from failed checks that have `quick_win` defined,
sorted by severity (critical → warning → info), and capped at 5.

---

## Custom Check Configuration

Users can configure health checks via:

1. **Settings API** (`PUT /api/genie-spaces/health-config`) -- programmatic
2. **YAML import** -- upload a YAML file with check definitions

### Override Types

```typescript
interface UserCheckOverride {
  checkId: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
  severity?: "critical" | "warning" | "info";
}

interface UserCustomCheck {
  id: string;
  category: string;
  description: string;
  severity: Severity;
  evaluator: EvaluatorType;
  path: string;
  field?: string;
  params: Record<string, unknown>;
  quick_win?: string;
}
```

---

## Fix Workflow

When health checks reveal issues, the Fix Workflow generates improvements
using Forge's existing Genie Engine passes.

### Fix Execution Flow

1. User navigates to the **Space Detail Page** (`/genie/[spaceId]`) and opens the **Health** tab
2. User clicks "Fix" (individual check) or "Fix All"
3. API (`POST /api/genie-spaces/[id]/fix`) receives list of failed check IDs
4. `resolveFixStrategies()` groups checks by `fix_strategy`
5. For off-platform spaces, `buildMetadataForSpace()` queries `information_schema`
6. Relevant engine passes run (using existing pass modules)
7. Results are merged into the space (**additive only** -- nothing removed)
8. API returns `originalSerializedSpace`, `updatedSerializedSpace`, `changes[]`, and `strategiesRun[]`
9. **Optimization Review** is displayed (see next section) with prioritized suggestions
10. User selects/deselects suggestions, previews diff, then clicks "Apply to Space" or "Clone and Apply"
11. `updateGenieSpace()` pushes changes to Databricks (or clone is created first)
12. Health check re-runs automatically, score refreshes

---

## Optimization Review & Diff Preview

Both the Health Fix and Benchmark Improve workflows route through an
intermediate **Optimization Review** step before any changes are applied.

### Optimization Review (`components/genie/optimization-review.tsx`)

Displays the generated changes as a selectable list:

1. **Strategy summary** -- count of suggestions and strategies used
2. **Priority badges** -- each change is categorized as high (joins/measures),
   medium (instructions/filters), or low (other) priority
3. **Select/deselect** -- users can toggle individual suggestions with checkboxes
4. **Preview Changes** -- opens the diff viewer
5. **Apply to Space** -- pushes the updated `serialized_space` to the existing space
6. **Clone and Apply** -- creates a clone first, then applies (safe for off-platform spaces)

### Diff Preview (`components/genie/space-diff-viewer.tsx`)

Side-by-side comparison of the current vs proposed `serialized_space`:

- JSON is pretty-printed before diffing
- Line-level diff with green highlights for additions and red for removals
- Change summary card showing sections affected with +added / ~modified counts
- Line count stats (total lines added/removed)

### Flow Integration

Both fix and benchmark-improve APIs return the same shape:

```typescript
interface FixResult {
  originalSerializedSpace: string;
  updatedSerializedSpace: string;
  changes: Array<{
    section: string;
    description: string;
    added: number;
    modified: number;
  }>;
  strategiesRun: string[];
}
```

The Space Detail page and Benchmarks page both consume this payload and
render `OptimizationReview` → `SpaceDiffViewer` before any apply action.

---

## Fix Strategy Router

Located in `lib/genie/space-fixer.ts`.

| Fix Strategy | Engine Pass | LLM? |
|---|---|---|
| `column_intelligence` | Pass 1 (Column Intelligence) | Yes (fast) |
| `semantic_expressions` | Pass 2 (Semantic Expressions) | Yes (premium) |
| `join_inference` | Join Inference | Yes (fast) |
| `trusted_assets` | Pass 3 (Trusted Assets) | Yes (premium) |
| `instruction_generation` | Pass 4 (Instruction Generation) | Yes (fast) |
| `benchmark_generation` | Pass 5 (Benchmark Generation) | Yes (premium) |
| `entity_matching` | Deterministic enablement | No |
| `sample_questions` | Generate from existing examples | No |

### Fixable Health Checks

The following health checks are marked as fixable and mapped to fix
strategies. When the user clicks "Fix All", the system groups these
checks by strategy and runs only the necessary engine passes:

| Check ID | Fix Strategy | What It Fixes |
|---|---|---|
| `join-specs-have-comments` | `join_inference` | Adds relationship comments to join specs |
| `example-sqls-have-usage-guidance` | `trusted_assets` | Generates usage guidance for example SQL queries |
| `expressions-have-instructions` | `semantic_expressions` | Adds usage instructions to dimension expressions |
| `measures-have-display-names` | `trusted_assets` | Adds human-readable display names to measures |
| `expressions-have-display-names` | `semantic_expressions` | Adds display names to dimension expressions |
| `filters-have-display-names` | `trusted_assets` | Adds display names to filters |
| `measures-have-comments` | `trusted_assets` | Adds purpose comments to measures |
| `filters-have-comments` | `trusted_assets` | Adds usage comments to filters |
| `measure-synonyms-defined` | `trusted_assets` | Adds colloquial synonyms to measures |
| `filter-synonyms-defined` | `trusted_assets` | Adds synonyms to filters |
| `expression-synonyms-defined` | `semantic_expressions` | Adds synonyms to expressions |

The Genie Engine assembler now populates `display_name`, `comment`, and
`instruction` fields automatically during space generation, so
engine-generated spaces rarely need these fixes. They are primarily
useful for imported or manually created spaces.

---

## Metadata Building for Off-Platform Spaces

Off-platform spaces have no Forge `MetadataSnapshot`. Before running engine
passes:

1. Extract table FQNs from `serialized_space.data_sources.tables[*].identifier`
2. Query `information_schema.columns` for each table
3. Build a `MetadataSnapshot` with `tables`, `columns`, empty `foreignKeys`
4. Build `SchemaAllowlist` via `buildSchemaAllowlist()`
5. This enables grounded generation for all LLM passes

---

## Benchmark Feedback Loop

An iterative cycle for validating and improving Genie Space quality:

```
┌──────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Run      │─▶│ Label   │─▶│ Improve  │─▶│ Review   │─▶│ Apply    │
│benchmarks│  │results  │  │(targeted │  │(Opt.Rev. │  │+ re-score│
└──────────┘  └─────────┘  │ passes)  │  │ + Diff)  │  └────┬─────┘
     ▲                      └──────────┘  └──────────┘       │
     └───────────────────────────────────────────────────────┘
                      (repeat until satisfied)
```

### Components

1. **Benchmark questions** -- loaded from `serialized_space.benchmarks.questions`
2. **Run** -- `createEvalRun()` submits questions to the Genie Eval API; polls `getEvalRun()` until DONE
3. **Evaluation** -- Databricks server-side LLM judge + result-set comparison produces `GOOD/BAD/NEEDS_REVIEW` assessments with `ScoreReason[]`
4. **Label** -- user marks correct/incorrect with optional feedback
5. **Improve** -- feedback analyzed for patterns, targeted fixes generated
6. **Review** -- `OptimizationReview` displayed with selectable suggestions and diff preview
7. **Apply** -- user chooses "Apply to Space" or "Clone and Apply" from the review step
8. **History** -- all runs persisted in `ForgeSpaceBenchmarkRun`

### Eval API Assessment

Each benchmark result is evaluated server-side by the Genie Eval API, which provides:

- **Assessment**: `GOOD`, `BAD`, or `NEEDS_REVIEW`
- **ScoreReason[]**: 25+ categories (e.g. `LLM_JUDGE_MISSING_JOIN`, `RESULT_MISSING_ROWS`, `SINGLE_CELL_DIFFERENCE`)
- **Side-by-side responses**: expected vs actual SQL + execution results

Previously used a client-side 3-tier comparison; now fully delegated to the Eval API:

1. **High SQL similarity** (>=90%) -- the Genie-generated SQL closely
   matches the expected SQL. Automatically marked as pass.
2. **Result-set comparison** -- when SQL similarity is moderate, the actual
   query result (column count, row count) is compared against the expected
   result. Passes if both match within tolerance.
3. **Basic SQL similarity** (>=60%) -- fallback threshold for structural
   similarity. Below this threshold, the test is marked as failed.

### Failure Diagnostics

Each failed test includes rich diagnostic information:

- **`failureCategory`** -- classifies the root cause (e.g. `wrong_tables`,
  `missing_join`, `wrong_aggregation`, `wrong_filter`, `wrong_column`,
  `syntax_error`)
- **`comparisonMethod`** -- which evaluation tier determined the outcome
  (`sql_similarity`, `result_set`, `basic_similarity`)
- **`sqlSimilarity`** -- percentage score (0-100) of SQL structural similarity
- **`failureReason`** -- human-readable explanation of what went wrong

These diagnostics are displayed in the test runner UI and inform the
feedback-to-fix analysis.

---

## Improvement Logic (Feedback-to-Fix)

Located in `lib/genie/benchmark-feedback.ts`.

The `analyzeFeedbackForFixes()` function maps `ScoreReason` values from the Eval API
directly to health check IDs for targeted fixes. Each of the 25+ `ScoreReason` values
maps to specific check IDs (e.g. `LLM_JUDGE_MISSING_JOIN` -> `join-specs-for-multi-table`).
Escalation rules: 3+ failures -> `text-instruction-exists`, 5+ -> `benchmarks-exist`.

The function maps labeled failures to check IDs:

| Failure Pattern | Detected Via | Fix Check ID |
|---|---|---|
| Join issues | "join" in feedback or expected SQL | `join-specs-for-multi-table` |
| Time/date issues | "time", "date", "period" in feedback | `filters-defined` |
| Aggregation issues | "sum", "count", "average" in feedback | `measures-defined` |
| User-provided SQL | `expectedSql` present | `example-sqls-minimum` |
| Multiple failures (3+) | Count of failures | `text-instruction-exists` |
| No specific pattern | Fallback | `measures-defined`, `filters-defined`, `example-sqls-minimum` |

---

## Critical User Journeys (CUJs)

### CUJ 1: Diagnose and Fix an Off-Platform Space

1. User navigates to `/genie` -- stale spaces are auto-filtered; toast shows "N spaces no longer found"
2. Discovery runs in the background, enriching cards with metadata counts and health grades
3. An off-platform space shows a **D** grade with "3 fixable issues"
4. User clicks the grade badge to open the Health Detail Sheet
5. User clicks **Fix** in the sheet -- navigated to `/genie/[spaceId]?tab=health` (Space Detail Page)
6. On the Health tab, user clicks **Fix All** -- API runs relevant engine passes
7. **Optimization Review** is displayed with prioritized suggestions and strategy summary
8. User reviews suggestions, clicks **Preview Changes** to see side-by-side diff
9. User clicks **Apply to Space** (or **Clone and Apply** to preserve the original)
10. Changes pushed to Databricks, health check re-runs: **D → B**
11. User navigates to **Benchmarks** tab and clicks **Open Test Runner**
12. Benchmarks run (SSE real-time progress), 7/10 pass
13. User labels 3 failures with feedback
14. User clicks **Improve** -- **Optimization Review** shown again with benchmark-driven suggestions
15. User applies, re-runs benchmarks: 9/10 pass (95%)

### CUJ 2: Customize Health Checks for Organization

1. Admin calls `PUT /api/genie-spaces/health-config` with overrides:
   - Disable `column-synonyms-defined` (not relevant for their use case)
   - Raise `example-sqls-minimum` threshold from 5 to 10
   - Add custom check: "At least 3 metric views configured"
2. All spaces are re-scored with the new configuration
3. Spaces that previously scored A might now show B due to stricter thresholds

### CUJ 3: Iterate on a Forge-Generated Space

1. User deploys a Genie Space from the pipeline -- sees **B** grade on `/genie` page
2. Clicks space card to open **Space Detail Page** (`/genie/[spaceId]`)
3. **Overview** tab shows key stats (tables, measures, filters, benchmarks) and quick actions
4. Navigates to **Configuration** tab to inspect the full `serialized_space` in an accordion layout
5. Opens **Benchmarks** tab → **Open Test Runner**: 7/10 pass
6. Labels 3 failures: "Wrong join", "Missing time filter", "Sum vs Count"
7. Clicks **Improve** -- **Optimization Review** shown with 3 high-priority suggestions
8. Previews diff, clicks **Apply to Space**
9. Re-runs benchmarks: 10/10 pass
10. Returns to **Health** tab -- score is now **A**

### CUJ 4: Clone a Space for Experimentation

1. User opens **Space Detail Page** for a production space
2. On **Overview** tab, clicks **Clone**
3. Clone created in Databricks, user is redirected to the new clone's detail page
4. User runs health checks, applies fixes, runs benchmarks on the clone without affecting the original
5. Alternatively, from the **Optimization Review** step, user clicks **Clone and Apply** to create a clone with proposed changes already applied

---

## Data Model

### ForgeSpaceBenchmarkRun

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `spaceId` | string | Genie Space ID |
| `evalRunId` | string | Genie Eval API run ID |
| `runAt` | datetime | When the run was executed |
| `status` | string | `DONE`, `EVALUATION_FAILED`, etc. |
| `numQuestions` | int | Number of benchmark questions |
| `numCorrect` | int | Questions assessed as GOOD |
| `numNeedsReview` | int | Questions needing manual review |
| `accuracy` | float | `numCorrect / numQuestions * 100` |
| `resultsJson` | JSON string | `EvalResultDetail[]` |
| `feedbackJson` | JSON string | User labels + feedback text |
| `improvementsApplied` | boolean | Whether improvements were applied from this run |
| `improvementSummary` | string | Description of improvements made |

### ForgeSpaceHealthScore

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `spaceId` | string | Genie Space ID |
| `score` | int | 0-100 overall score |
| `grade` | string | A through F |
| `checksJson` | JSON string | `HealthCheckItem[]` |
| `triggeredBy` | string | "manual", "post_fix", "post_benchmark" |
| `measuredAt` | datetime | When the score was recorded |

### ForgeHealthCheckConfig

| Field | Type | Description |
|---|---|---|
| `id` | string | Always "singleton" |
| `overridesJson` | JSON string | `UserCheckOverride[]` |
| `customChecksJson` | JSON string | `UserCustomCheck[]` |
| `categoryWeightsJson` | JSON string | `Record<string, number>` |
| `updatedAt` | datetime | Last update timestamp |

---

## API Reference

### Discovery & Detail

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/genie-spaces` | List workspace spaces + filtered tracked spaces (stale excluded) |
| `POST` | `/api/genie-spaces/discover` | Bulk metadata extraction + health scoring (replaces `health-batch`) |
| `GET` | `/api/genie-spaces/[id]/detail` | Full space detail: serialized_space, metadata, health report, tracking info |

### Health Check

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/genie-spaces/[id]/health` | Run health check on a single space |
| `POST` | `/api/genie-spaces/health-batch` | Batch health check (legacy, superseded by discover) |
| `GET` | `/api/genie-spaces/[id]/health-history` | Health score trending data |

### Fix Workflow

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/genie-spaces/[id]/fix` | Generate fixes for failed checks (returns original + updated for review) |
| `POST` | `/api/genie-spaces/[id]/apply` | Apply reviewed serialized_space to the space |
| `POST` | `/api/genie-spaces/[id]/clone` | Clone space (for safe fixing or experimentation) |

### Benchmark Feedback Loop

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/genie-spaces/[id]/benchmarks` | Load benchmark questions |
| `POST` | `/api/genie-spaces/[id]/benchmarks/run` | Create eval run (returns evalRunId) |
| `GET` | `/api/genie-spaces/[id]/benchmarks/run?evalRunId=X` | Poll eval run status; once DONE returns full results |
| `POST` | `/api/genie-spaces/[id]/benchmarks/feedback` | Save labeled results |
| `POST` | `/api/genie-spaces/[id]/benchmarks/improve` | Generate improvements (returns original + updated for review) |
| `GET` | `/api/genie-spaces/[id]/benchmarks/history` | Past eval runs (API + Lakebase enrichments) |

### Configuration

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/genie-spaces/health-config` | Get health check configuration |
| `PUT` | `/api/genie-spaces/health-config` | Update health check configuration |

---

## UI Components

### Genie Spaces List Page (`app/genie/page.tsx`)

- **Refresh button** -- re-fetches workspace spaces and re-runs discovery
- **Stale toast** -- notification when tracked spaces are no longer in the workspace
- **Space cards** with enriched metadata (table count, measures, questions, filters)
- **Health grade badge** -- circular A-F badge, color-coded (green/amber/red)
- **Fixable count** -- "3 fixable issues" text when applicable
- **Test button** -- links to `/genie/[spaceId]/benchmarks`
- **Card click** -- navigates to the Space Detail Page (`/genie/[spaceId]`)
- **Health detail sheet** -- slide-out panel; Fix navigates to detail page health tab
- **Active/Trashed tabs** -- separate views for active and trashed spaces

### Space Detail Page (`app/genie/[spaceId]/page.tsx`)

Central hub for a single Genie Space with four tabs:

- **Overview** -- key stats (tables, measures, questions, filters, joins, benchmarks), domain, status, quick actions (Open in Databricks, Run Benchmarks, Clone, View Run)
- **Configuration** -- embeds `SpaceConfigViewer` to display the full `serialized_space` structure
- **Health** -- inline health report with grade, quick wins, category progress bars, per-check details, Fix/Fix All buttons that trigger the Optimization Review flow
- **Benchmarks** -- link to the benchmark test runner page

### Space Config Viewer (`components/genie/space-config-viewer.tsx`)

Read-only accordion layout displaying all sections of a `SerializedSpace`:
- Data Sources → Tables, Metric Views
- Instructions → Text Instructions, Example Question SQLs, Join Specs
- SQL Snippets → Measures, Filters, Expressions
- Benchmarks → Questions
- Config → Sample Questions
- Count badges on each section header

### Optimization Review (`components/genie/optimization-review.tsx`)

Intermediate review step before any changes are applied:
- Strategy summary with count of suggestions and strategies used
- Priority badges (high/medium/low) on each suggestion
- Select/deselect checkboxes for individual suggestions
- **Preview Changes** button opens the diff viewer
- **Apply to Space** / **Clone and Apply** / **Cancel** actions

### Space Diff Viewer (`components/genie/space-diff-viewer.tsx`)

Side-by-side comparison of current vs proposed `serialized_space`:
- Pretty-printed JSON diff
- Line-level highlights (green=added, red=removed)
- Change summary card with section badges
- Line count stats (added/removed)

### Health Detail Sheet (`components/genie/health-detail-sheet.tsx`)

- Overall score + grade with colored background
- Quick wins section
- Fix All / Run Benchmarks CTAs
- Category breakdown with progress bars
- Individual checks grouped by category with pass/fail icons
- **Fix** action navigates to the Space Detail Page health tab (ensuring the review step is used)

### Benchmark Page (`app/genie/[spaceId]/benchmarks/page.tsx`)

- **Run tab** -- load questions, create eval run via API, poll for progress, results with GOOD/BAD/NEEDS_REVIEW badges, ScoreReason chips, side-by-side SQL, execution results, manual assessment UI
- **History tab** -- past runs with pass rate badges
- Thumbs up/down labeling with optional feedback textarea
- **Improve** button generates targeted fixes and displays **Optimization Review** (no longer auto-applies)
- Back button navigates to the Space Detail Page

---

## Hardening & Performance

| Concern | Implementation |
|---|---|
| **OBO auth** | All Genie API reads use `getHeaders()` (user token) to enforce user-level permissions |
| **Space caching** | In-memory 5min TTL cache in `lib/genie/space-cache.ts` |
| **Discovery concurrency** | Bounded to 5 parallel tasks per discover call |
| **Stale filtering** | Tracked spaces not found in workspace excluded from UI (Lakebase intact) |
| **Rate limiting** | Delegated to Genie Eval API (handles question execution server-side) |
| **Health check cache** | Invalidated on fix apply and benchmark improve |
| **Clone + Fix** | `/api/genie-spaces/[id]/clone` creates a copy before modifying off-platform spaces |
| **Health trending** | `ForgeSpaceHealthScore` persisted on every check, sparkline via history API |
| **Audit trail** | `triggeredBy` field on scores, structured logging via `lib/logger.ts` |
| **Input validation** | `isSafeId()` on all space ID parameters |
| **Batch limits** | 50 max for discover endpoint |

---

## File Reference

| File | Purpose |
|---|---|
| **Core Libraries** | |
| `lib/genie/health-checks/default-checks.yaml` | Built-in check definitions (20 checks, 4 categories) |
| `lib/genie/health-checks/types.ts` | TypeScript types for checks, results, reports |
| `lib/genie/health-checks/evaluators.ts` | 11 deterministic evaluator functions |
| `lib/genie/health-checks/registry.ts` | YAML parser, merge logic, validation |
| `lib/genie/space-health-check.ts` | Scorer -- runs checks, computes scores and grades |
| `lib/genie/space-fixer.ts` | Fix strategy router, metadata builder, pass invocation |
| `lib/genie/space-cache.ts` | In-memory serialized_space cache with TTL |
| `lib/genie/space-metadata.ts` | Shared metadata extraction from serialized_space |
| `lib/genie/eval-types.ts` | Genie Eval API types (1:1 with REST API) |
| `lib/genie/benchmark-feedback.ts` | ScoreReason-to-check-ID mapping for fix targeting |
| `lib/genie/benchmark-runner.ts` | Eval run orchestrator (Genie Eval API) |
| `lib/dbx/genie.ts` | Databricks Genie Spaces REST API client (OBO auth for reads) |
| `lib/lakebase/space-health.ts` | CRUD for health scores, benchmark runs, config |
| **UI Components** | |
| `components/genie/health-detail-sheet.tsx` | Health report slide-out panel |
| `components/genie/space-config-viewer.tsx` | Read-only serialized_space accordion viewer |
| `components/genie/optimization-review.tsx` | Optimization review with selectable suggestions |
| `components/genie/space-diff-viewer.tsx` | Side-by-side current vs proposed config diff |
| **Pages** | |
| `app/genie/page.tsx` | Genie Spaces list with discovery, stale filtering, metadata enrichment |
| `app/genie/[spaceId]/page.tsx` | Space Detail hub (Overview, Configuration, Health, Benchmarks tabs) |
| `app/genie/[spaceId]/benchmarks/page.tsx` | Benchmark test runner with optimization review |
| **API Routes** | |
| `app/api/genie-spaces/route.ts` | List spaces (stale filtering) and create spaces |
| `app/api/genie-spaces/discover/route.ts` | Bulk discovery: metadata extraction + health scoring |
| `app/api/genie-spaces/[spaceId]/detail/route.ts` | Full space detail in one call |
| `app/api/genie-spaces/[spaceId]/health/route.ts` | Health check API |
| `app/api/genie-spaces/health-batch/route.ts` | Batch health check API (legacy) |
| `app/api/genie-spaces/health-config/route.ts` | Health config API |
| `app/api/genie-spaces/[spaceId]/fix/route.ts` | Fix generation API |
| `app/api/genie-spaces/[spaceId]/apply/route.ts` | Apply fix API |
| `app/api/genie-spaces/[spaceId]/clone/route.ts` | Clone space API |
| `app/api/genie-spaces/[spaceId]/benchmarks/route.ts` | Load benchmarks API |
| `app/api/genie-spaces/[spaceId]/benchmarks/run/route.ts` | Create + poll eval runs API |
| `app/api/genie-spaces/[spaceId]/benchmarks/feedback/route.ts` | Feedback API |
| `app/api/genie-spaces/[spaceId]/benchmarks/improve/route.ts` | Improve from feedback API |
| `app/api/genie-spaces/[spaceId]/benchmarks/history/route.ts` | Benchmark history API |
| `app/api/genie-spaces/[spaceId]/health-history/route.ts` | Health score trending API |
| **Tests** | |
| `__tests__/genie/health-checks/evaluators.test.ts` | Evaluator unit tests |
| `__tests__/genie/health-checks/registry.test.ts` | Registry merge logic tests |
| `__tests__/genie/health-checks/space-health-check.test.ts` | End-to-end scorer tests |
| `__tests__/genie/space-fixer.test.ts` | Fix strategy routing tests |
| `__tests__/genie/benchmark-feedback.test.ts` | Feedback analysis tests |
| `__tests__/genie/health-checks/fixtures/spaces.ts` | Test fixture spaces |
