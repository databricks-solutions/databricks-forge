# Genie Engine

> Technical guide for the multi-pass, LLM-powered Genie Space generator in
> Databricks Forge.

The Genie Engine analyses Unity Catalog metadata, pipeline use cases, and
optional sample data to produce production-grade Databricks Genie Spaces.
Each space includes a complete knowledge store with measures, filters,
dimensions, join relationships, text instructions, trusted assets,
benchmarks, and metric view proposals -- all grounded to the physical schema.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Model Routing](#model-routing)
3. [Pipeline Integration](#pipeline-integration)
4. [Engine Passes (0-6)](#engine-passes)
5. [Schema Grounding](#schema-grounding)
6. [Assembler & SerializedSpace v2](#assembler--serializedspace-v2)
7. [Configuration](#configuration)
8. [Global Settings vs Per-Run Config](#global-settings-vs-per-run-config)
9. [Adding Business Context](#adding-business-context)
10. [Entity Matching & Sample Data](#entity-matching--sample-data)
11. [Time Periods & Fiscal Year](#time-periods--fiscal-year)
12. [Trusted Assets](#trusted-assets)
13. [Metric Views](#metric-views)
14. [Benchmarks](#benchmarks)
15. [Conversation API & Testing](#conversation-api--testing)
16. [Deployment](#deployment)
17. [Inline Editing](#inline-editing)
18. [Legacy Fallback](#legacy-fallback)
19. [Best Practices](#best-practices)
20. [Troubleshooting](#troubleshooting)
21. [File Reference](#file-reference)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Genie Workbench UI                     │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Overview  │  │ Engine Config │  │   Space Preview      │  │
│  │ (deploy)  │  │  (per-run)    │  │   (edit, inspect)    │  │
│  └──────────┘  └───────────────┘  └──────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ REST API
┌─────────────────────────▼───────────────────────────────────┐
│                     Genie Engine                            │
│  Pass 0  Table Selection & Domain Grouping                  │
│  Pass 1  Column Intelligence (LLM + entity extraction)      │
│  Pass 2  Semantic SQL Expressions (time periods + LLM)      │
│  Pass 3  Trusted Asset Authoring (parameterized queries)     │
│  Pass 4  Instruction Generation (context, rules, guidance)  │
│  Pass 5  Benchmark Generation (test questions + SQL)        │
│  Pass 6  Metric View Proposals (YAML + DDL)                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                     Assembler                               │
│  SerializedSpace v2 payload construction                    │
│  Schema allowlist validation on every identifier            │
│  30-table limit enforcement                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
     Lakebase        Databricks       Space Preview
   (persistence)    Genie API          (UI)
                   (deploy)
```

The engine produces **one Genie Space per business domain**. Domains are
derived from the use cases generated in earlier pipeline steps. Each space
contains every knowledge store object the Databricks Genie API supports.

---

## Model Routing

All pipelines in Forge use a **dual-endpoint strategy** to balance quality
and speed. SQL-critical and creatively demanding passes run on the premium
model (Claude Opus) while classification, enrichment, and metadata passes run
on a faster model (Claude Sonnet) at 3-5x lower latency.

### Endpoint Configuration

| Env Variable | Resource Key | Default | Purpose |
|---|---|---|---|
| `DATABRICKS_SERVING_ENDPOINT` | `serving-endpoint` | `databricks-claude-opus-4-7` | Premium model for SQL generation and quality-critical passes |
| `DATABRICKS_SERVING_ENDPOINT_FAST` | `serving-endpoint-fast` | Falls back to premium | Fast model for classification and enrichment tasks |

The fast endpoint is **opt-in**: if `serving-endpoint-fast` is not configured
as an app resource, `getFastServingEndpoint()` returns the premium endpoint and
all pipelines behave identically to before. Speed optimization is unlocked
simply by adding the resource binding.

The premium endpoint is set per-run via `run.config.aiModel`. The fast
endpoint is resolved from the `DATABRICKS_SERVING_ENDPOINT_FAST` env var
(injected from the `serving-endpoint-fast` app resource binding).

### Pipeline-Wide Routing Summary

| Pipeline | Steps on Fast | Steps on Premium |
|---|---|---|
| Discovery | Business context, table filtering, domain clustering, dedup | Use case generation, scoring, calibration, SQL generation |
| Estate Scan | All 8 intelligence passes | -- |
| Genie Engine | Column intelligence, join inference, instructions | Semantic expressions, trusted assets, benchmarks, metric views |
| Dashboard Engine | -- | All (quality-critical) |
| Outcome Map Parser | All (structural parsing) | -- |

See [PIPELINE.md](PIPELINE.md#model-routing) for the full discovery pipeline
routing table.

### Pass-to-Model Assignment

| Pass | Model | Rationale |
|---|---|---|
| Pass 0 (Table Selection) | None (CPU) | Deterministic grouping |
| Pass 1 (Column Intelligence) | **Fast** | Structured metadata enrichment |
| Pass 2 (Semantic Expressions) | **Premium** | Complex SQL generation |
| Pass 2.5 (Join Inference) | **Fast** | Column name pattern matching |
| Pass 3 (Trusted Assets) | **Premium** | SQL parameterization must preserve CTE structure |
| Pass 4 (Instructions) | **Fast** | Short text generation (1-2 sentences) |
| Pass 5 (Benchmarks) | **Premium** | SQL generation with expected answers |
| Pass 6 (Metric Views) | **Premium** | YAML + DDL generation |

### Concurrency Architecture

Domains are processed with bounded concurrency (up to 10 in parallel).
Within each domain, the pass dependency graph is optimized for maximum
parallelism:

```
[Pass 1 (fast) || Pass 2 (premium)]
              |
         Join Assembly (CPU)
              |
[Pass 3 (premium) || Pass 4 (fast) || Pass 5 (premium) || Pass 6 (premium)]
```

Within-pass batches (column intelligence, trusted assets, benchmarks) also
run with bounded concurrency (up to 3 batches in parallel).

All LLM calls are cached in-memory (10-minute TTL) and retried on 429/5xx
errors with exponential backoff (2 retries, 1s/2s backoff).

---

## Pipeline Integration

The Genie Engine runs as **Step 10** of the Forge discovery pipeline
(`lib/pipeline/steps/genie-recommendations.ts`). It is triggered automatically
after Business Value Analysis completes and runs in the background.

**Inputs received from earlier steps:**

| Input | Source Step |
|---|---|
| `PipelineRun` (config, business context) | Step 1: Business Context |
| `MetadataSnapshot` (tables, columns, FKs, metric views) | Step 2: Metadata Extraction |
| `UseCase[]` (scored, domain-assigned, with SQL) | Steps 4-8 |
| `SampleDataCache` (optional row samples) | Step 2 (when data sampling enabled) |

**Outputs written to Lakebase:**

- `forge_genie_recommendations` -- one row per domain with the serialized
  space JSON, counts, and engine pass outputs (column enrichments, benchmarks,
  metric view proposals)
- `forge_genie_engine_configs` -- versioned engine config per run

The engine can also be **re-run on demand** from the Genie Workbench UI
via `POST /api/runs/{runId}/genie-engine/generate`. This allows customers to
edit the config and regenerate without re-running the full pipeline.

---

## Engine Passes

### Pass 0: Table Selection & Domain Grouping

**Module:** `lib/genie/passes/table-selection.ts`

Groups use cases by their assigned domain and selects the most relevant
tables for each domain. This pass is deterministic (no LLM calls).

**Logic:**

1. Group use cases by `domain` field
2. For each domain, collect all `tablesInvolved` across its use cases
3. Apply `tableGroupOverrides` from config (manually reassign tables)
4. Rank tables by use-case frequency (how many use cases reference them)
5. Enforce `maxTablesPerSpace` cap (default 25, Genie limit is 30)
6. Identify metric views in the same catalog.schema as domain tables
7. Extract subdomains from use case metadata

**Output:** `DomainGroup[]` -- each with domain name, subdomains, table list,
metric view list, and associated use cases.

### Pass 1: Column Intelligence

**Module:** `lib/genie/passes/column-intelligence.ts`

Analyses columns across all domain tables to produce enrichments (descriptions,
synonyms, hidden flags) and identify entity matching candidates.

**Two sub-phases:**

1. **Entity extraction** (`lib/genie/entity-extraction.ts`) -- identifies
   columns suitable for Genie's entity matching feature. Uses sample data
   when available; falls back to schema heuristics. Criteria: string type,
   bounded cardinality (<=100 distinct values), not PII, not UUID-like.

2. **LLM enrichment** (when `llmRefinement` is on) -- sends a batch of
   column names + types + sample values to the model and asks for business
   descriptions, synonyms, and hidden recommendations.

**Output:** `ColumnEnrichment[]` and `EntityMatchingCandidate[]`.

Column enrichments flow into the assembler where they become column-level
metadata on `data_sources.tables[].columns[]` in the serialized space.

### Pass 2: Semantic SQL Expressions

**Module:** `lib/genie/passes/semantic-expressions.ts`

Generates SQL snippets for the knowledge store: measures (aggregates),
filters (WHERE clauses), and dimensions (GROUP BY expressions).

**Three sources combined:**

1. **Auto time periods** (`lib/genie/time-periods.ts`) -- standard date
   filters (Last 7/30/90 Days, MTD, QTD, YTD, Last Fiscal Year) and
   dimensions (Month, Quarter, Year, Day of Week) for every date/timestamp
   column. Fiscal year start month is configurable.

2. **LLM-generated expressions** (when `llmRefinement` is on) -- the model
   analyses the schema and use cases to propose business-relevant measures
   (e.g. `SUM(revenue)`, `COUNT(DISTINCT customer_id)`), filters, and
   dimensions with synonyms and instructions.

3. **Custom expressions from config** -- customer-defined measures, filters,
   and dimensions are merged in directly.

Each expression includes `synonyms` (colloquial names users might type) and
`instructions` (guidance for Genie on when to use the expression).

**Output:** `EnrichedSqlSnippetMeasure[]`, `EnrichedSqlSnippetFilter[]`,
`EnrichedSqlSnippetDimension[]`.

### Pass 2.5: Join Inference (config-gated)

**Module:** `lib/genie/passes/join-inference.ts`

An LLM-driven pass that discovers implicit table relationships from schema
and column naming conventions. Runs only when fewer than 3 joins are found
from FK metadata + overrides + SQL inference (avoids redundant calls when
relationships are already well-defined).

**Sources of join relationships (in priority order):**

1. **Foreign key metadata** -- from `information_schema` constraints
2. **Config overrides** -- manually specified `joinOverrides`
3. **SQL-inferred joins** -- regex-extracted from use case SQL (`inferJoinsFromUseCaseSql()`)
4. **LLM-inferred joins** -- this pass, schema pattern matching

All joins are assembled into `allJoins` and threaded to Passes 3, 4, 5, and 6.

**Output:** `JoinInferenceOutput` with discovered join conditions.

### Pass 3: Trusted Asset Authoring

**Module:** `lib/genie/passes/trusted-assets.ts`

Converts use case SQL into parameterized trusted queries. Runs in parallel with Pass 4.

**Trusted queries** are parameterized SQL with named parameters, types,
comments, and default values. They become `example_question_sqls` with
`usage_guidance` in the serialized space.

**Note:** SQL functions (UDFs) are no longer generated. Function creation
was removed due to unreliable deployment behaviour.

**Constraints applied to generated SQL:**

- Shared Databricks SQL quality rules (`DATABRICKS_SQL_RULES_COMPACT`)
- SQL preservation rules (must faithfully reproduce source SQL complexity)
- LIMIT values must be integer literals (not parameters)
- Batch size: 2 use cases per LLM call (prevents output truncation)
- SQL examples capped at 3000 chars per use case

**Output:** `TrustedAssetQuery[]`.

### Pass 4: Instruction Generation

**Module:** `lib/genie/passes/instruction-generation.ts`

Builds the `text_instructions` array for the space. Runs in parallel with
Pass 3. Follows [Databricks best practices](https://docs.databricks.com/aws/en/genie/best-practices):
text instructions are a **last resort**, used only for behavioural guidance
that cannot be expressed through SQL expressions or example queries.

**What is included (behavioural guidance):**

- Short domain identity (domain + business name + industry + subdomains)
- Entity matching hint (map coded values to user language)
- Fiscal year / time period conventions
- Clarification question rules from config
- Summary customisation from config
- Business glossary terms from config
- Customer global instructions from config
- Optional LLM-refined domain guidance (1-2 sentences, capped at 150 tokens)

**What is NOT included (handled by structured API fields):**

- SQL quality rules (taught via example SQL queries in `example_question_sqls`)
- Join relationships (structured `join_specs` in SerializedSpace)
- Full business context / strategic goals / value chain
- Measures, filters, dimensions (SQL expressions in knowledge store)

**Character budget:** 3000 chars max. If exceeded, the LLM-refined block
is dropped first, then glossary is reduced to 5 entries, then clarification
rules to 3.

**Output:** `string[]` (text instruction content blocks).

### Pass 5: Benchmark Generation

**Module:** `lib/genie/passes/benchmark-generation.ts`

Generates test questions with expected SQL answers to evaluate Genie
accuracy. Runs in parallel with Pass 6.

**Features:**

- ~9 auto-generated benchmarks per domain (3 per batch, 2 use cases per batch)
- Alternate phrasings per question (2-4 variants)
- Time-period variant questions
- Entity-matching test questions
- Customer-provided benchmarks from config are merged in
- Shared Databricks SQL quality rules (`DATABRICKS_SQL_RULES_COMPACT`)
- SQL examples capped at 3000 chars per use case to prevent truncation
- Maximum 10 benchmarks included in the final SerializedSpace

Each phrasing is emitted as its own entry in the serialized space with a
shared SQL answer, matching how Databricks evaluates per-phrasing accuracy.

**Output:** `BenchmarkInput[]`.

### Pass 6: Metric View Proposals

**Module:** `lib/genie/passes/metric-view-proposals.ts`

Proposes 1-3 metric views per domain with YAML definitions and DDL
conforming to the Databricks Unity Catalog YAML v1.1 specification.
Runs in parallel with Pass 5.

**Inputs from earlier passes:**

- Schema context from the metadata snapshot
- Measures and dimensions from Pass 2
- Join specs (FK-derived + overrides) for star/snowflake schema support
- Column enrichments from Pass 1 (used as YAML comments)
- Date/timestamp columns for window measure candidates

**Features:**

- Embedded YAML v1.1 spec reference in the LLM prompt
- Star/snowflake schema `joins:` blocks from FK metadata
- FILTER clause measures for conditional KPIs (e.g.
  `SUM(amount) FILTER (WHERE status = 'OPEN')`)
- Ratio measures that safely re-aggregate (e.g.
  `SUM(revenue) / COUNT(DISTINCT customer_id)`)
- Seed YAML from Pass 2 measures/dimensions as a starting point for the LLM
- Column enrichment descriptions propagated as YAML `comment` fields
- Materialization recommendations for domains with >10 tables or >3 joins
- Post-generation YAML validation against the schema allowlist
- **Window function prohibition** -- `OVER()` in measure expressions is
  detected during validation and marked as `validationStatus: "error"`
- **MEDIAN() prohibition** -- `PERCENTILE_APPROX(col, 0.5)` must be used

**Output:** `MetricViewProposal[]` -- each with:

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Metric view identifier |
| `description` | `string` | What the metric measures |
| `yaml` | `string` | YAML body (goes between `$$`) |
| `ddl` | `string` | Complete `CREATE OR REPLACE VIEW ... WITH METRICS` DDL |
| `sourceTables` | `string[]` | Tables referenced (source + joined) |
| `hasJoins` | `boolean` | Proposal uses `joins:` block |
| `hasFilteredMeasures` | `boolean` | Proposal uses `FILTER (WHERE ...)` |
| `hasWindowMeasures` | `boolean` | Proposal uses `window:` block |
| `hasMaterialization` | `boolean` | Proposal includes `materialization:` |
| `validationStatus` | `"valid" \| "warning" \| "error"` | YAML validation result |
| `validationIssues` | `string[]` | List of detected issues |

Proposals are displayed in the Space Preview UI with feature badges,
validation status, and a **Deploy Metric View** button.

---

## Schema Grounding

**Module:** `lib/genie/schema-allowlist.ts`

Every table name, column name, and SQL expression produced by the engine is
validated against the **Schema Allowlist** -- a set of identifiers built from
the `MetadataSnapshot` at engine start.

The allowlist contains:

- All table FQNs (catalog.schema.table)
- All column FQNs (catalog.schema.table.column)
- Column data types
- Metric view FQNs

**Validation functions:**

- `isValidTable(allowlist, fqn)` -- exact match
- `isValidColumn(allowlist, fqn)` -- exact match
- `validateSqlExpression(allowlist, sql, context)` -- checks that table/column
  references in SQL are in the allowlist
- `findInvalidIdentifiers(allowlist, identifiers)` -- batch check; automatically
  excludes FQNs that are the target of `CREATE FUNCTION/VIEW/TABLE` statements
  (being defined, not referenced)

**LLM prompt grounding:** `buildSchemaContextBlock(allowlist)` generates a
markdown block listing all tables and columns that is included in every LLM
prompt, ensuring the model can only reference physical schema objects.

This is the **Zero Hallucination Policy**: the LLM is never asked to invent
table or column names. It must only use what exists in the scraped metadata.

---

## Assembler & SerializedSpace v2

**Module:** `lib/genie/assembler.ts`

The assembler takes the aggregated `GenieEnginePassOutputs` for a domain and
builds a complete `SerializedSpace` v2 JSON payload ready for the Databricks
Genie API.

### Payload Structure

```json
{
  "version": 2,
  "config": {
    "sample_questions": [{ "id": "...", "question": ["..."] }]
  },
  "data_sources": {
    "tables": [{
      "identifier": "catalog.schema.table",
      "description": ["Table comment"],
      "columns": [{
        "name": "column_name",
        "description": "Business description",
        "synonyms": ["alias1", "alias2"],
        "hidden": false,
        "entity_matching": true
      }]
    }],
    "metric_views": [{
      "identifier": "catalog.schema.metric_view",
      "description": ["Metric view comment"]
    }]
  },
  "instructions": {
    "text_instructions": [{ "id": "...", "content": ["..."] }],
    "example_question_sqls": [{
      "id": "...",
      "question": ["..."],
      "sql": ["SELECT ..."],
      "usage_guidance": ["Parameter details..."]
    }],
    "join_specs": [{
      "id": "...",
      "left": { "identifier": "catalog.schema.left_table", "alias": "left_table" },
      "right": { "identifier": "catalog.schema.right_table", "alias": "right_table" },
      "sql": [
        "`left_table`.`id` = `right_table`.`id`",
        "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"
      ]
    }],
    "sql_snippets": {
      "measures": [{
        "id": "...", "alias": "total_revenue",
        "sql": ["SUM(revenue)"],
        "synonyms": ["revenue", "sales total"],
        "instructions": ["Use for revenue aggregation"]
      }],
      "filters": [{
        "id": "...", "display_name": "last_30_days",
        "sql": ["order_date >= DATEADD(DAY, -30, CURRENT_DATE())"],
        "synonyms": ["last month", "recent"],
        "instructions": ["Standard 30-day lookback"]
      }],
      "expressions": [{
        "id": "...", "alias": "order_month",
        "sql": ["DATE_TRUNC('MONTH', order_date)"],
        "synonyms": ["monthly", "by month"],
        "instructions": ["Monthly time dimension"]
      }]
    }
  },
  "benchmarks": {
    "questions": [{
      "id": "...",
      "question": ["What was total revenue last month?"],
      "answer": [{ "format": "sql", "content": ["SELECT SUM(revenue) ..."] }]
    }]
  }
}
```

### Assembly Rules

- All arrays are sorted by `id` (Genie API requirement)
- Tables are sorted by `identifier`
- Every identifier is validated against the schema allowlist
- A warning is logged if `tables + metric_views > 30`
- Empty optional sections are omitted (no empty arrays in the payload)
- Deterministic IDs are generated via MD5 hash of `runId:domain:category:index`
- Table descriptions include relationship context from join specs
- `format_assistance: true` is set on monetary/percentage columns
- `text_instructions` are collapsed into a single entry (API limit)
- Join SQL is rewritten to use backtick-quoted alias references
  (`` `alias`.`column` ``), not FQN format
- Self-joins use `_2` suffix on the right alias
- Relationship type is encoded as a SQL comment in `join_specs.sql`
- Benchmark questions are capped at 10 per space

### Enriched Fields (populated by the assembler)

The assembler populates the following fields from engine pass outputs to
satisfy health check requirements and improve Genie query accuracy:

- **`column_configs`** on each `DataSourceTable` -- built from Pass 1
  column enrichments (description, synonyms, hidden flags). This ensures
  the `tables-have-column-configs` health check passes.
- **`display_name`** on measures and expressions -- set from the expression
  name to provide a human-readable label in the Genie UI.
- **`comment`** on measures, filters, and join specs -- measures and
  filters use their `instructions` array; join specs get an auto-generated
  comment describing the relationship (e.g. "Join between orders and
  customers via many-to-one relationship").
- **`instruction`** on expressions -- set from the expression's
  `instructions` array to guide Genie on when to use the expression.
- **`usage_guidance`** on all example SQLs -- generated for both
  parameterized queries (parameter descriptions) and non-parameterized
  queries (general usage context).

### Quality Scoring

The engine uses `runHealthCheck()` from `lib/genie/space-health-check.ts`
to compute the quality score for each generated space. This replaces the
earlier heuristic-based `qualityScore()` fallback and ensures scores are
consistent between the engine output and the Genie Studio health tab.
### Payload Sanitization

**Module:** `lib/dbx/genie.ts` (`sanitizeSerializedSpace()`)

Before sending to the Databricks Genie API, the serialized space is
sanitized to fix known compatibility issues:

1. **Benchmark format casing** -- the `format` field in benchmark answers
   must be uppercase `"SQL"`, not lowercase `"sql"`. Older persisted
   payloads are auto-fixed.
2. **Text instructions collapse** -- the API allows at most one
   `text_instructions` entry. If multiple entries exist, they are
   merged into a single entry with all content concatenated.
3. **Join spec alias injection** -- adds `alias` fields to `left`/`right`
   objects if missing (derived from the last segment of the FQN). Handles
   self-joins by appending `_2` to the right alias.
4. **Join SQL rewriting** -- rewrites FQN-based join conditions
   (`catalog.schema.table.column`) to backtick-quoted alias format
   (`` `alias`.`column` ``).
5. **Relationship type encoding** -- the Genie API protobuf does not
   support a `relationship_type` field on `JoinSpec`. The assembler
   encodes it as a SQL comment `"--rt=FROM_RELATIONSHIP_TYPE_...--"` in
   the `sql` array. Sanitization strips any standalone `relationship_type`
   field and ensures the comment is present.
6. **SQL function stripping** -- any `instructions.sql_functions` entries
   are removed during sanitization (function creation is no longer supported).

---

## Configuration

The `GenieEngineConfig` controls every aspect of space generation. It is
stored per-run in Lakebase and editable via the Engine Config tab.

### Per-Run Configuration (Engine Config tab)

| Setting | Type | Purpose |
|---|---|---|
| `entityMatchingMode` | `"auto" \| "manual" \| "off"` | How entity matching candidates are identified |
| `fiscalYearStartMonth` | `number` (1-12) | First month of the fiscal year |
| `generateTrustedAssets` | `boolean` | Generate parameterized queries |
| `glossary` | `GlossaryEntry[]` | Business terms with definitions and synonyms |
| `customMeasures` | `CustomSqlExpression[]` | Hand-crafted measure SQL |
| `customFilters` | `CustomSqlExpression[]` | Hand-crafted filter SQL |
| `customDimensions` | `CustomSqlExpression[]` | Hand-crafted dimension SQL |
| `tableGroupOverrides` | `TableGroupOverride[]` | Force a table into a specific domain |
| `joinOverrides` | `JoinOverride[]` | Override or add join relationships |
| `entityMatchingOverrides` | `EntityMatchingOverride[]` | Force entity matching on/off per column |
| `clarificationRules` | `ClarificationRule[]` | Rules for Genie to ask follow-up questions |
| `columnOverrides` | `ColumnOverride[]` | Rename, hide, or add synonyms to columns |
| `benchmarkQuestions` | `BenchmarkInput[]` | Customer-defined test questions |
| `globalInstructions` | `string` | Free-text instructions added to every space |
| `summaryInstructions` | `string` | Instructions for how Genie formats summaries |
| `timePeriodDateColumns` | `string[]` | Specific date columns for time period generation |

### Global Settings (Settings page)

These 5 settings are configured once in the Settings page and apply to all
runs. They are merged into the engine config at runtime.

| Setting | Default | Purpose |
|---|---|---|
| `maxTablesPerSpace` | 25 | Maximum tables per Genie space (API limit: 30) |
| `llmRefinement` | On | Enable LLM passes for expressions, instructions, etc. |
| `generateBenchmarks` | On | Auto-generate benchmark questions |
| `generateMetricViews` | On | Propose metric view definitions |
| `autoTimePeriods` | On | Generate standard date filters and dimensions |

---

## Global Settings vs Per-Run Config

The configuration is split into two tiers:

**Global settings** (Settings page, localStorage) control high-level engine
behaviour that rarely changes between runs. These are applied to every run
automatically.

**Per-run config** (Engine Config tab, Lakebase) contains domain-specific
customizations: glossary, SQL expressions, column overrides, join overrides,
clarification rules, and benchmark questions. These are scoped to a single
pipeline run and can be iterated without affecting other runs.

When the Genie Workbench loads, it merges global settings into the run config.
When regenerating, the engine always uses the current global values.

---

## Adding Business Context

Business context is the single most important factor in Genie space quality.
It flows into the engine through multiple channels:

### 1. Pipeline Business Context (automatic)

Generated in Step 1 of the pipeline from the business name and metadata.
Contains:

- **Industries** -- e.g. "Retail, E-commerce"
- **Strategic goals** -- e.g. "Increase customer retention by 15%"
- **Business priorities** -- e.g. "Revenue optimization, cost reduction"
- **Value chain** -- e.g. "Procurement -> Manufacturing -> Sales -> Service"

This is automatically included in text instructions for every space.

### 2. Business Glossary (per-run config)

Define business-specific terms so Genie understands your language:

```
Term: AOV
Definition: Average Order Value -- total revenue divided by order count
Synonyms: average order value, basket size
```

Glossary entries are injected into text instructions and inform the LLM
during expression generation.

### 3. Global Instructions (per-run config)

Free-text instructions appended to every space. Use for:

- Company-specific conventions ("Always use fiscal quarters, not calendar")
- Data quality notes ("The `legacy_orders` table has nulls in `ship_date`
  before 2023")
- Terminology rules ("When users say 'revenue', they mean `net_revenue`,
  not `gross_revenue`")

### 4. Clarification Rules (per-run config)

Teach Genie when to ask follow-up questions:

```
Topic: sales performance
Missing details: time period, region
Question: "Which time period and region would you like to analyse?"
```

### 5. Custom SQL Expressions (per-run config)

When the LLM-generated expressions aren't right, override them:

```
Name: active_customers
SQL: COUNT(DISTINCT CASE WHEN last_order_date >= DATEADD(MONTH, -3, CURRENT_DATE()) THEN customer_id END)
Synonyms: active users, engaged customers
Instructions: Use this for active customer counts, not raw COUNT(*)
```

---

## Entity Matching & Sample Data

Databricks Genie's **entity matching** feature maps conversational language
to data values. For example, "Florida" -> "FL" in a `state_code` column.

### How It Works

1. **Sample data** -- if data sampling is enabled in Settings, the pipeline
   reads a small number of rows per table. These are cached and passed to the
   engine.

2. **Entity extraction** (`lib/genie/entity-extraction.ts`) -- identifies
   columns with bounded cardinality (<=100 distinct values) and string type.
   Excludes PII columns and UUID-like values.

3. **Column enrichment** -- Pass 1 flags columns as `entityMatchingCandidate`.

4. **Assembler** -- sets `entity_matching: true` on the column in the
   serialized space payload.

5. **Instructions** -- Pass 4 generates entity matching guidance text,
   e.g. "The column `state_code` uses 2-letter abbreviations. Users may
   say 'Florida' meaning 'FL'."

### Entity Matching Modes

- **Auto** (default): uses sample data and schema heuristics
- **Manual**: only columns explicitly listed in `entityMatchingOverrides`
- **Off**: no entity matching at all

### Maximizing Entity Matching Quality

- Enable data sampling (Settings > Data Sampling > 10+ rows)
- The more sample rows, the better the entity extraction
- Use `entityMatchingOverrides` to force specific columns on/off
- Review entity candidates in the Column Intelligence section of Space Preview

---

## Time Periods & Fiscal Year

**Module:** `lib/genie/time-periods.ts`

When `autoTimePeriods` is enabled, the engine automatically generates
standard date filters and dimensions for every date/timestamp column.

### Generated Filters

| Filter | SQL Pattern |
|---|---|
| Last 7 Days | `col >= DATEADD(DAY, -7, CURRENT_DATE())` |
| Last 30 Days | `col >= DATEADD(DAY, -30, CURRENT_DATE())` |
| Last 90 Days | `col >= DATEADD(DAY, -90, CURRENT_DATE())` |
| Month to Date | `col >= DATE_TRUNC('MONTH', CURRENT_DATE())` |
| Quarter to Date | `col >= DATE_TRUNC('QUARTER', CURRENT_DATE())` |
| Year to Date | `col >= DATE_TRUNC('YEAR', CURRENT_DATE())` |
| Last Fiscal Year | Adjusted for configured fiscal year start month |

### Generated Dimensions

| Dimension | SQL Pattern |
|---|---|
| Month | `DATE_TRUNC('MONTH', col)` |
| Quarter | `DATE_TRUNC('QUARTER', col)` |
| Year | `YEAR(col)` |
| Day of Week | `DAYOFWEEK(col)` |

### Fiscal Year

Set `fiscalYearStartMonth` (1-12) to align time periods with your reporting
calendar. When set to a non-January month, the fiscal year filter adjusts
accordingly.

---

## Trusted Assets

Trusted assets provide verified, parameterized SQL that Genie can use to
answer questions with guaranteed accuracy.

### Trusted Queries

Generated from use case SQL in Pass 3. Each query has:

- **Question**: the natural language prompt
- **SQL**: parameterized query with named parameters
- **Parameters**: name, type (String/Date/Numeric), comment, default value
- **Usage guidance**: when and how to use the query

Example:

```sql
-- Question: What were sales for a given product category last month?
SELECT category, SUM(amount) as total_sales
FROM catalog.schema.orders o
JOIN catalog.schema.products p ON o.product_id = p.id
WHERE p.category = :category
  AND o.order_date >= DATEADD(MONTH, -1, DATE_TRUNC('MONTH', CURRENT_DATE()))
GROUP BY category
-- Parameter: category (String) - Product category name [default: 'Electronics']
```

### Trusted Functions (UDFs) — REMOVED

SQL function creation has been removed from the Genie Engine. Functions
proved unreliable to create and use as part of Genie space deployment.
All use cases that previously generated UDFs now produce parameterized
queries instead.

API endpoint:

```
POST /api/runs/{runId}/genie-engine/{domain}/functions
Body: { "ddl": "CREATE OR REPLACE FUNCTION ...", "name": "..." }
```

---

## Metric Views

When `generateMetricViews` is enabled, Pass 6 proposes metric view
definitions for each domain using the Databricks YAML v1.1 specification.

### Discovery

Existing metric views are discovered during metadata extraction via
`listMetricViews()` in `lib/queries/metadata.ts`. This queries
`information_schema.tables WHERE table_type = 'METRIC_VIEW'` and returns
`MetricViewInfo[]`. Discovered metric views are automatically included in
the space's `data_sources.metric_views` section.

### Proposals

Each proposal conforms to the YAML v1.1 spec and may include:

- **Star schema joins** using the `joins:` block (from FK metadata)
- **FILTER clause measures** for conditional aggregation
- **Ratio measures** that safely re-aggregate at any granularity
- **Window measures** (running totals, period-over-period, YTD)
- **Materialization** recommendations for complex domains
- **Column enrichment comments** as YAML `comment` fields

### YAML Validation

Every proposal is validated against the schema allowlist:

- Required YAML fields: `version`, `source`, `dimensions`, `measures`
- Source table must exist in the metadata
- Join table references must exist in the metadata
- DDL must contain `WITH METRICS`, `LANGUAGE YAML`, and `$$` delimiters

Validation results are surfaced in the UI as badges (`valid`, `warning`,
`error`) with expandable issue lists.

### Deploying Metric Views

Proposed metric views can be deployed directly from the Space Preview UI:

1. Click **Deploy Metric View** on a proposal card
2. The DDL is executed via the SQL Statement Execution API
3. The new metric view is added to the domain's `data_sources.metric_views`
4. The `metricViewCount` and FQN list are updated in Lakebase

API endpoint:

```
POST /api/runs/{runId}/genie-engine/{domain}/metric-views
Body: { "ddl": "CREATE ...", "name": "...", "description": "..." }
```

Proposals with `validationStatus: "error"` have the deploy button disabled.

---

## Benchmarks

Benchmarks are test questions with expected SQL answers used to evaluate
Genie space accuracy.

### Auto-Generated Benchmarks

When `generateBenchmarks` is enabled, Pass 5 generates ~15 benchmarks per
domain covering:

- Core business questions
- Time-period variant questions
- Entity-matching test questions
- Edge cases and ambiguous phrasings
- 2-4 alternate phrasings per question

### Customer-Defined Benchmarks

Add your own benchmarks in the Engine Config tab:

```
Question: What was total revenue last quarter?
Expected SQL: SELECT SUM(amount) FROM orders WHERE order_date >= ...
Alternate phrasings: Q4 revenue, last quarter sales total
```

Customer benchmarks are merged with auto-generated ones. Each alternate
phrasing is emitted as its own entry sharing the same SQL answer.

---

## Conversation API & Testing

**Module:** `lib/dbx/genie.ts`

After deploying a space, you can test it programmatically using the
Genie Conversation API. The client provides:

- `startConversation(spaceId, question)` -- send a question, start a new
  conversation, and poll for a completed response
- `sendFollowUp(spaceId, conversationId, question)` -- send a follow-up
  question in an existing conversation

### Benchmark Test Runner

The benchmark test runner in Genie Studio executes benchmark questions
against deployed spaces via the Conversation API and evaluates results
using a 3-tier comparison:

1. **High SQL similarity** (>=90%) -- the generated SQL closely matches
   the expected SQL. Marked as pass.
2. **Result-set comparison** -- column count and row count from the actual
   query result are compared against the expected query result. Used when
   SQL similarity is moderate.
3. **Basic SQL similarity** (>=60%) -- fallback threshold for structural
   similarity.

Each result includes:

- **Failure category** (e.g. `wrong_tables`, `missing_join`,
  `wrong_aggregation`, `wrong_filter`) -- classifies the root cause
- **Comparison method** (`sql_similarity`, `result_set`, `basic_similarity`)
  -- which tier determined the outcome
- **SQL similarity score** -- percentage match between expected and actual SQL
- **Failure reason** -- human-readable explanation of what went wrong

The test runner UI shows real-time progress ("Running 3/12...") via SSE
and displays failure diagnostics inline on each result card.

API endpoint:

```
POST /api/genie-spaces/{spaceId}/benchmarks/run
Body: { "questionIds": ["..."] }
```

---

## Deployment

### From the Overview Tab

1. Select one or more domains using the checkboxes
2. Click "Deploy Selected"
3. Spaces are created via the Databricks Genie REST API
4. Each deployed space is tracked in Lakebase

### From the Domain Detail Sheet

1. Click a domain row to open the detail sheet
2. Click "Select for Deploy" to add to the selection

### Per-Domain Deploy

The engine also supports per-domain deployment via:

```
POST /api/runs/{runId}/genie-engine/{domain}/deploy
```

This creates or updates the space and tracks it in Lakebase.

### Update vs Create

If a space has been previously deployed for a domain, the engine will
**update** the existing space (PATCH) rather than creating a new one.
This preserves the Genie space ID and any user conversations.

### Trash

Deployed spaces can be trashed (soft delete) from the UI. This calls the
Databricks API to move the space to trash and updates the Lakebase tracking
record.

---

## Inline Editing

The Space Preview tab allows inline editing of the serialized space before
deployment.

### Editable Objects

| Object | Edit | Remove |
|---|---|---|
| Measures | Rename, change SQL | Yes |
| Filters | Rename, change SQL | Yes |
| Dimensions | Rename, change SQL | Yes |
| Sample Questions | Edit text | Yes |
| Text Instructions | Edit content | Yes |

Edits are persisted via:

```
PATCH /api/runs/{runId}/genie-engine/{domain}/space
```

The API parses the stored `serializedSpace` JSON, applies the edit, and saves
the updated JSON back to Lakebase. The space can then be deployed with the
modifications included.

---

## Legacy Fallback

**Module:** `lib/genie/recommend.ts`

The legacy generator is a deterministic, regex-based engine that runs without
LLM calls. It is used as a fallback when:

- The Genie Engine fails
- The AI model endpoint is unavailable
- Older runs pre-date the engine

It produces basic spaces with:

- Tables grouped by domain
- SQL snippets extracted via regex (aggregates, WHERE clauses, GROUP BY)
- Join specs from foreign keys
- Text instructions from business context
- No benchmarks, no metric views, no trusted assets, no column enrichments

New code should always use `runGenieEngine()`.

---

## Best Practices

### 1. Enable Data Sampling

Data sampling dramatically improves entity matching and expression quality.
Set it to at least 10 rows per table in Settings > Data Sampling.

### 2. Curate Your Glossary

A well-defined glossary is the highest-ROI configuration. Define every
business term, acronym, and domain-specific phrase. Include synonyms for
how users actually speak.

### 3. Keep Tables Under 25

The Databricks Genie API supports up to 30 tables per space, but accuracy
degrades beyond ~20. The default of 25 provides headroom while keeping
quality high. Use `tableGroupOverrides` to split large domains.

### 4. Add Clarification Rules

Teach Genie to ask follow-up questions for ambiguous queries. This prevents
incorrect assumptions and produces better answers.

### 5. Define Custom SQL for Critical Metrics

Don't rely solely on LLM-generated expressions for your most important
KPIs. Define custom measures, filters, and dimensions with precise SQL.

### 6. Write Global Instructions

Add company-specific conventions, data quality notes, and terminology rules
as global instructions. These are injected into every space.

### 7. Review and Edit Before Deploying

Use the Space Preview tab to inspect every object. Rename unclear aliases,
remove irrelevant measures, and edit instructions. The inline editor
modifies the serialized space directly.

### 8. Add Benchmark Questions

Customer-defined benchmarks with known-correct SQL provide a quality
baseline. Start with 5-10 critical questions per domain and expand over time.

### 9. Configure Fiscal Year

If your organisation uses a non-January fiscal year, set
`fiscalYearStartMonth` in the Engine Config tab. All auto-generated time
periods will align with your reporting calendar.

### 10. Test After Deploying

After deploying a space, open the **Benchmarks** tab in Genie Studio to
run benchmark tests against the live space. Review failure categories and
SQL similarity scores to identify which areas need improvement. Use
**Fix All** to auto-fix common issues, or manually edit instructions,
measures, and expressions based on the failure diagnostics.

### 11. Iterate

The Genie Engine is designed for iteration. Edit the config, regenerate,
review, edit inline, and deploy. Each cycle improves the space.

---

## Troubleshooting

### LLM JSON Parsing Failures

**Symptom:** `parseLLMJson: unable to extract valid JSON` in logs.

The engine includes a robust multi-strategy JSON parser
(`lib/genie/passes/parse-llm-json.ts`) that handles markdown fences,
preamble text, and malformed output. If parsing still fails, the engine
logs a warning and continues with degraded output for that pass.

### No Domains Generated

**Symptom:** "No domain groups produced" in logs.

This means no use cases have domain assignments. Ensure the pipeline ran
through Step 5 (Domain Clustering) successfully.

### Tables Rejected by Allowlist

**Symptom:** "Assembler rejected unknown table" in logs.

The LLM referenced a table that doesn't exist in the metadata. This is
expected and harmless -- the assembler simply skips it.

### 30-Table Limit Warning

**Symptom:** "Genie space exceeds 30 table/view limit" in logs.

Reduce `maxTablesPerSpace` or use `tableGroupOverrides` to split the domain.

### Genie API Rejects `relationship_type`

**Symptom:** `Cannot find field: relationship_type in message
databricks.datarooms.export.JoinSpec`

The Genie API protobuf does not support a standalone `relationship_type`
field. The assembler encodes it as a SQL comment in the `sql` array. If
you see this error, `sanitizeSerializedSpace` should handle it
automatically. Check that the sanitization runs before the API call.

### Metric View Window Function Error

**Symptom:** `METRIC_VIEW_WINDOW_FUNCTION_NOT_SUPPORTED`

Metric view measure expressions cannot contain `OVER()` clauses. Pass 6
validates for this and marks affected proposals as `error`. If a proposal
slips through, remove the window function from the measure expression.

### LLM Output Truncation

**Symptom:** `parseLLMJson: recovered truncated JSON output` in logs.

The LLM is running out of output tokens. This is mitigated by:

- Using `DATABRICKS_SQL_RULES_COMPACT` (not the full rules) in batch passes
- Small batch sizes (2 use cases per call)
- SQL example truncation at 3000 chars
- `maxTokens: 8192` on batch LLM calls

If truncation persists, reduce batch sizes further in the pass config.

### Empty Measures or Filters

If LLM refinement is off and no custom expressions are defined, the only
source of measures/filters is auto time periods (for date columns). Enable
LLM refinement or add custom SQL expressions.

---

## Related Documentation

- **[GENIE_HEALTHCHECK_ENGINE.md](GENIE_HEALTHCHECK_ENGINE.md)** -- deterministic health scoring, automated fix workflow, optimization review with diff preview, and benchmark feedback loop for any Genie Space (Forge-generated or imported)
- **[SQL_ENGINE.md](SQL_ENGINE.md)** -- grounded SQL generation and validation pipeline used by Genie passes (semantic expressions, benchmarks, trusted assets, metric views)

---

## File Reference

### Core Engine

| File | Purpose |
|---|---|
| `lib/genie/engine.ts` | Main orchestrator -- runs all passes per domain |
| `lib/genie/assembler.ts` | Builds SerializedSpace v2 payload |
| `lib/genie/types.ts` | All TypeScript types and interfaces |
| `lib/genie/schema-allowlist.ts` | Schema grounding and validation |
| `lib/genie/time-periods.ts` | Auto date filter/dimension generation |
| `lib/genie/entity-extraction.ts` | Entity matching candidate identification |
| `lib/genie/engine-status.ts` | In-memory async job status tracker |
| `lib/genie/adhoc-engine.ts` | Ad-hoc fast/full Genie generation from table list |
| `lib/genie/recommend.ts` | Legacy deterministic fallback generator |
| `lib/genie/benchmark-runner.ts` | Benchmark execution via Conversation API |
| `lib/genie/space-health-check.ts` | Deterministic health scorer (see [GENIE_HEALTHCHECK_ENGINE.md](GENIE_HEALTHCHECK_ENGINE.md)) |
| `lib/genie/space-fixer.ts` | Fix strategy router and metadata builder |
| `lib/genie/space-cache.ts` | In-memory serialized_space cache (5min TTL) |
| `lib/genie/space-metadata.ts` | Metadata extraction from serialized_space |
| `lib/genie/benchmark-feedback.ts` | Feedback-to-fix analysis |
| `lib/genie/optimize.ts` | Field-level optimization from benchmark feedback |
| `lib/genie/join-diagnostics.ts` | Join candidate evaluation |
| `lib/genie/domain-normalization.ts` | Domain name normalization |
| `lib/metric-views/engine.ts` | Metric view engine v2 (used by Pass 6) |
| `lib/toolkit/llm-cache.ts` | In-memory LLM response cache + retry logic |
| `lib/toolkit/concurrency.ts` | Bounded-concurrency execution utility |
| `lib/ai/sql-rules.ts` | Shared Databricks SQL quality rules (full + compact) |

### Engine Passes

| File | Pass | Purpose |
|---|---|---|
| `lib/genie/passes/table-selection.ts` | 0 | Domain grouping and table ranking |
| `lib/genie/passes/column-intelligence.ts` | 1 | Column enrichment and entity extraction |
| `lib/genie/passes/semantic-expressions.ts` | 2 | Measures, filters, dimensions |
| `lib/genie/passes/trusted-assets.ts` | 3 | Parameterized queries |
| `lib/genie/passes/instruction-generation.ts` | 4 | Text instructions |
| `lib/genie/passes/benchmark-generation.ts` | 5 | Test questions with expected SQL |
| `lib/genie/passes/metric-view-proposals.ts` | 6 | Metric view YAML and DDL |
| `lib/genie/passes/parse-llm-json.ts` | -- | Robust LLM JSON extraction |

### Databricks API

| File | Purpose |
|---|---|
| `lib/dbx/genie.ts` | Genie Spaces REST API + Conversation API client |

### Persistence

| File | Purpose |
|---|---|
| `lib/lakebase/genie-recommendations.ts` | CRUD for recommendations |
| `lib/lakebase/genie-engine-config.ts` | CRUD for engine config (versioned) |
| `lib/lakebase/genie-spaces.ts` | Tracking deployed spaces |
| `lib/settings.ts` | Global Genie Engine defaults (localStorage) |

### UI Components

| File | Purpose |
|---|---|
| `components/pipeline/genie-workbench.tsx` | Main workbench with tabs (pipeline run context) |
| `components/pipeline/genie-config-editor.tsx` | Per-run config editor |
| `components/pipeline/genie-spaces-tab.tsx` | Overview table and deploy |
| `components/pipeline/genie-space-preview.tsx` | Deep preview with inline edit |
| `components/genie/space-overview-tab.tsx` | Space detail overview tab |
| `components/genie/space-health-tab.tsx` | Health check inline report |
| `components/genie/space-detail-hero.tsx` | Space detail header hero |
| `components/genie/space-config-viewer.tsx` | Read-only accordion config viewer |
| `components/genie/space-benchmarks-tab.tsx` | Benchmark test runner UI |
| `components/genie/space-diff-viewer.tsx` | Side-by-side config diff viewer |
| `components/genie/optimization-review.tsx` | Selectable optimization suggestions |
| `components/genie/import-space-dialog.tsx` | Import external space (JSON paste) |
| `components/genie/health-detail-sheet.tsx` | Health report slide-out panel |
| `components/genie/health-check-settings.tsx` | Health check configuration UI |

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/runs/{runId}/genie-engine/config` | GET, PUT | Load/save engine config |
| `/api/runs/{runId}/genie-engine/generate` | POST | Start async generation |
| `/api/runs/{runId}/genie-engine/generate/status` | GET | Poll generation progress |
| `/api/runs/{runId}/genie-engine/{domain}/preview` | GET | Rich domain preview |
| `/api/runs/{runId}/genie-engine/{domain}/space` | PATCH | Inline space edits |
| `/api/runs/{runId}/genie-engine/{domain}/deploy` | POST | Deploy to Databricks |
| `/api/runs/{runId}/genie-engine/{domain}/metric-views` | POST | Execute metric view DDL + update space |
| `/api/runs/{runId}/genie-engine/{domain}/functions` | POST | DEPRECATED (returns 410) |
| `/api/runs/{runId}/genie-engine/{domain}/test` | POST | Test deployed space via Conversation API |
| `/api/runs/{runId}/genie-recommendations` | GET | List all recommendations |
| `/api/genie-spaces` | GET, POST | List/create Genie spaces |
| `/api/genie-spaces/{spaceId}` | PATCH, DELETE | Update/trash a space |

### Pipeline Integration

| File | Purpose |
|---|---|
| `lib/pipeline/steps/genie-recommendations.ts` | Step 8: runs engine and saves results |
