# Forge Analysis -- How the Discovery Engine Works

> A comprehensive guide to the analysis pipeline, scoring methodology, prompt engineering, and data flow behind Databricks Forge.

---

## Table of Contents

- [Overview](#overview)
- [Architecture Diagram](#architecture-diagram)
- [Industry Outcome Maps](#industry-outcome-maps)
- [Pipeline Flow](#pipeline-flow)
- [Step 1: Business Context Generation](#step-1-business-context-generation)
- [Step 2: Metadata Extraction](#step-2-metadata-extraction)
- [Step 3: Table Filtering](#step-3-table-filtering)
- [Step 4: Use Case Generation](#step-4-use-case-generation)
- [Step 5: Domain Clustering](#step-5-domain-clustering)
- [Step 6: Scoring & Deduplication](#step-6-scoring--deduplication)
- [Step 7: SQL Generation](#step-7-sql-generation)
- [Scoring Methodology](#scoring-methodology)
- [AI & Statistical Function Registry](#ai--statistical-function-registry)
- [Prompt Engineering](#prompt-engineering)
- [Data Sampling](#data-sampling)
- [Export Pipeline](#export-pipeline)
- [Privacy Model](#privacy-model)
- [Constants & Tuning Parameters](#constants--tuning-parameters)

---

## Overview

Databricks Forge discovers data-driven use cases from Unity Catalog metadata using a 7-step LLM-powered pipeline. The engine:

1. Understands your business through AI-generated strategic context
2. Scans Unity Catalog metadata (table names, columns, types, foreign keys)
3. Filters out technical/system tables
4. Generates both AI and Statistical use cases in parallel
5. Organises use cases into business domains and subdomains
6. Scores, deduplicates, and ranks every use case
7. Generates runnable SQL for each use case

When an **Industry Outcome Map** is active, steps 1, 4, and 6 are enriched with curated strategic context, reference use cases, and KPIs from that industry's playbook. The user can select an industry manually, or **the system will auto-detect the best matching industry** from the business context generated in Step 1. The app ships with 10 built-in maps and supports ingesting custom maps via the Outcome Map Ingestor (see [Industry Outcome Maps](#industry-outcome-maps)).

All LLM calls use direct REST calls to Databricks Model Serving (chat completions API). The SQL Warehouse is used only for metadata queries and generated SQL execution. **No data rows are read by default** -- only structural metadata (see [Privacy Model](#privacy-model)).

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATABRICKS FORGE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  Next.js  │───▶│  API Routes   │───▶│   Pipeline   │                  │
│  │  Frontend │◀───│  /api/runs/*  │◀───│   Engine     │                  │
│  └──────────┘    └──────────────┘    └──────┬───────┘                  │
│       │               │                      │                          │
│       │          ┌────┴────┐       ┌────────┴────────┐                 │
│       │          │Lakebase │       │  8 Pipeline Steps │                 │
│       │          │ (Prisma)│       └────────┬────────┘                 │
│       │          └────┬────┘                │                          │
│       │               │              ┌──────┴──────┐                   │
│       │     ┌─────────┤              │             │                   │
│       │     │         │        ┌─────┴──┐   ┌─────┴──────┐            │
│  ┌────┴────┐│  ┌──────┴──┐    │ Model  │   │information_ │            │
│  │ Exports ││  │ Outcome │    │Serving │   │  schema     │            │
│  │Excel/PDF││  │  Maps   │    │ (LLM)  │   │  (metadata) │            │
│  │PPTX/SQL ││  │(custom) │    └────────┘   └────────────┘            │
│  └─────────┘│  └─────────┘                                            │
│             │                                                          │
│  ┌──────────┴────────────┐                                            │
│  │ Industry Outcome Maps │  10 built-in + user-uploaded custom maps   │
│  │ (prompt enrichment)   │  Injected into Steps 1, 4, 6              │
│  └───────────────────────┘                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                     ┌──────────────┴──────────────┐
          ┌──────────────┴──────────────┐  ┌──────────────────┐
          │    Databricks SQL Warehouse   │  │  Model Serving   │
          │  ┌────────────────────────┐   │  │  (Chat           │
          │  │ information_schema     │   │  │   Completions)   │
          │  │ (Unity Catalog)        │   │  │  Direct REST API │
          │  └────────────────────────┘   │  └──────────────────┘
          └───────────────────────────────┘
```

---

## Industry Outcome Maps

**Files:** `lib/domain/industry-outcomes.ts` (built-in data + types), `lib/domain/industry-outcomes-server.ts` (async DB-aware functions + auto-detection), `lib/domain/outcome-map-parser.ts` (AI parser), `lib/lakebase/outcome-maps.ts` (persistence)

**Purpose:** Provide curated strategic knowledge -- objectives, priorities, reference use cases, KPIs, and personas -- for specific industries. This knowledge enriches the LLM prompts so generated use cases are strategically aligned with real industry playbooks.

### How it works

An industry outcome map can be activated in two ways:

1. **Manual selection** -- the user picks an industry from the config form dropdown before starting a run.
2. **Auto-detection** -- if the user leaves the industry field empty, the pipeline engine automatically matches the LLM-generated `businessContext.industries` string (from Step 1) against all available outcome maps using keyword matching on industry names and sub-verticals. If a confident match is found, the industry is set on the run and persisted to Lakebase. Manual selection always takes precedence.

Once an industry is active (whether manual or auto-detected), the outcome map is injected into three pipeline steps:

| Step | What's injected | Template variable | Effect |
| --- | --- | --- | --- |
| **Step 1** (Business Context) | Industry narrative: objectives, why-change context | `{industry_context}` | LLM generates business context informed by industry-specific challenges and strategic priorities |
| **Step 4** (Use Case Generation) | Reference use cases with descriptions | `{industry_reference_use_cases}` | LLM uses proven industry use cases as inspiration, grounded in the customer's actual schema |
| **Step 6** (Scoring) | Industry-specific KPIs | `{industry_kpis}` | LLM aligns scores with industry-recognised value drivers |

> **Note:** When auto-detection is used, the run detail page displays an "auto-detected" badge next to the industry name so the user can see it was not manually chosen.

### Built-in maps (10 industries)

| ID | Industry | Sub-verticals |
| --- | --- | --- |
| `banking` | Banking & Payments | Retail Banking, Commercial Banking, Wealth Management, Payments, Capital Markets |
| `insurance` | Insurance | Life & Annuity, Property & Casualty, Health Insurance, Reinsurance |
| `hls` | Health & Life Sciences | Healthcare Providers, Pharma & Biotech, MedTech, Payers |
| `rcg` | Retail & Consumer Goods | Retail, Consumer Goods, Travel & Hospitality |
| `manufacturing` | Manufacturing & Automotive | Automotive, Semiconductors, Industrial Machinery, Chemicals |
| `energy-utilities` | Energy & Utilities | Oil & Gas, Electricity Generation, T&D, Mining |
| `communications` | Communications | Telco, Cable, Satellite, IoT |
| `media-advertising` | Media & Advertising | Streaming, Publishing, Ad Tech |
| `digital-natives` | Digital Natives | SaaS, Fintech, E-commerce, Marketplace |
| `games` | Gaming | Console/PC, Mobile, Live Service |

### Outcome Map Ingestor

**Page:** `/outcomes/ingest`

Users can upload custom industry outcome maps in markdown format. The ingestor workflow:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  1. Upload   │────▶│  2. AI Parse │────▶│  3. Review   │────▶│  4. Save │
│  .md file or │     │  PARSE_      │     │  & Edit      │     │  to      │
│  paste text  │     │  OUTCOME_MAP │     │  (inline)    │     │  Lakebase│
└──────────────┘     └──────────────┘     └──────────────┘     └──────────┘
```

1. **Upload** -- drag-and-drop a `.md` file or paste markdown content
2. **AI Parse** -- the `PARSE_OUTCOME_MAP` prompt template sends the markdown to the LLM, which extracts structured JSON matching the `IndustryOutcome` type
3. **Review & Edit** -- the user sees the extracted objectives, priorities, use cases, KPIs, and personas with inline editing to fix any parsing errors
4. **Save** -- the parsed outcome map is persisted to the `forge_outcome_maps` Lakebase table and immediately available in the industry dropdown and pipeline prompts

### Data structure (`IndustryOutcome`)

```
IndustryOutcome
  ├── id: string                    (e.g. "banking")
  ├── name: string                  (e.g. "Banking & Payments")
  ├── subVerticals: string[]
  ├── suggestedDomains: string[]    (auto-populated into config form)
  ├── suggestedPriorities: string[] (auto-populated into config form)
  └── objectives: IndustryObjective[]
        ├── name: string            (e.g. "Drive Growth")
        ├── whyChange: string       (narrative context)
        └── priorities: StrategicPriority[]
              ├── name: string      (e.g. "Hyper Personalization")
              ├── useCases: ReferenceUseCase[]
              │     ├── name
              │     ├── description
              │     └── businessValue (optional)
              ├── kpis: string[]
              └── personas: string[]
```

### Dynamic registry

At runtime, the system merges built-in and custom outcome maps:

- **Client components** (config form, outcomes browser) fetch from `/api/outcome-maps/registry`
- **Server-side pipeline steps** use `getIndustryOutcomeAsync()` from `industry-outcomes-server.ts`
- Custom maps with the same ID as a built-in map override the built-in version
- If the database is unavailable, the system falls back to built-in maps only

### Lakebase table

| Column | Type | Description |
| --- | --- | --- |
| `outcome_map_id` | TEXT PK | UUID |
| `industry_id` | TEXT UNIQUE | Kebab-case ID (e.g. "pharma-custom") |
| `name` | TEXT | Display name |
| `raw_markdown` | TEXT | Original uploaded markdown |
| `parsed_json` | TEXT | Serialised `IndustryOutcome` JSON |
| `use_case_count` | INT | Total reference use cases extracted |
| `created_by` | TEXT | User who uploaded |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last modification |

---

## Pipeline Flow

```
┌─────────────────┐
│  User Config     │  Business name, UC scope, priorities, AI model, industry
└────────┬────────┘
         ▼
┌─────────────────┐    ┌─────────────────┐
│ 1. Business     │◀───│ Industry Outcome │  {industry_context} injected
│    Context      │    │ Map (optional)   │  when industry is selected
│    (5-10%)      │    └─────────────────┘
│                 │  LLM generates strategic context: goals, value chain,
│                 │  revenue model, industry classification
│                 │  ──▶ BusinessContext JSON
└────────┬────────┘
         ▼
┌─────────────────┐
│ AUTO-DETECT     │  If industry not manually selected:
│ INDUSTRY        │  Match businessContext.industries against all outcome maps
│                 │  using keyword matching on names + sub-verticals.
│                 │  If match found → set config.industry, persist to Lakebase
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. Metadata     │  SQL queries against information_schema:
│    Extraction   │  tables, columns, foreign keys, comments
│    (10-20%)     │  ──▶ MetadataSnapshot (schema markdown)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. Table        │  LLM classifies each table as BUSINESS or TECHNICAL
│    Filtering    │  Batches of 100, fail-open strategy
│    (20-30%)     │  ──▶ Filtered table FQN list
└────────┬────────┘
         ▼
┌─────────────────┐     ┌─────────────┐
│ 4. Use Case     │────▶│ AI batch    │  ai_forecast, ai_classify, etc.
│    Generation   │     └─────────────┘
│    (30-45%)     │     ┌─────────────┐
│  (parallel)     │────▶│ Stats batch │  anomaly detection, simulation, etc.
└────────┬────────┘     └─────────────┘
         │  ◀── 20 tables/batch, 3 concurrent batches
         │  ◀── {industry_reference_use_cases} injected when industry selected
         ▼
┌─────────────────┐
│ 5. Domain       │  1. Assign domains (target: total/10, min 3, max 25)
│    Clustering   │  2. Assign subdomains per domain (2-10 per domain)
│    (45-55%)     │  3. Merge small domains (< 3 use cases) into larger ones
└────────┬────────┘
         ▼
┌─────────────────┐
│ 6. Scoring &    │  LLM scores: priority (0.3), feasibility (0.2), impact (0.5)
│    Dedup        │  LLM deduplicates overlapping use cases
│    (55-65%)     │  Sort by overall score, cap at 200, re-number with domain prefix
│                 │  ◀── {industry_kpis} injected when industry selected
└────────┬────────┘
         ▼
┌─────────────────┐
│ 7. SQL          │  LLM generates runnable SQL per use case
│    Generation   │  Schema-aware, FK-aware, optional sample data
│    (65-95%)     │  3 concurrent generations per wave
└────────┬────────┘
         ▼
┌─────────────────┐
│  Persist to     │  Use cases saved to Lakebase
│  Lakebase       │  Pipeline marked complete (100%)
└────────┬────────┘
         ▼
┌─────────────────┐
│  Export          │  Excel, PowerPoint, PDF, SQL Notebooks
└─────────────────┘
```

---

## Step 1: Business Context Generation

**File:** `lib/pipeline/steps/business-context.ts`

**Purpose:** Generate a structured understanding of the customer's business before analysing their data.

**How it works:**
1. A single Model Serving call with the `BUSINESS_CONTEXT_WORKER_PROMPT` template
2. If an industry is selected (manually), `{industry_context}` is injected into the prompt with objectives, why-change narratives, and sub-vertical context from the outcome map
3. The LLM acts as a "Principal Business Analyst" and returns structured JSON
4. User-supplied overrides (strategic goals, business domains) take precedence over LLM output
5. On failure, returns safe defaults with user overrides preserved
6. **After Step 1 completes**, if no industry was manually selected, the engine runs **auto-detection**: it matches `businessContext.industries` against all outcome maps (built-in + custom) using keyword scoring on industry names and sub-verticals. If a match scores above the confidence threshold, `config.industry` is set on the run and persisted to Lakebase with an `industryAutoDetected` flag. This ensures that Steps 4 and 6 can still benefit from industry enrichment even when the user didn't manually choose one.

**Output structure (`BusinessContext`):**

| Field | Description | Example |
| --- | --- | --- |
| `industries` | Industry classification | "Financial Services, Insurance" |
| `strategicGoals` | Top strategic goals | "Reduce fraud losses below 0.8%..." |
| `businessPriorities` | Mapped from user selection | "Increase Revenue, Mitigate Risk" |
| `strategicInitiative` | Key initiative areas | "Digital transformation of claims..." |
| `valueChain` | End-to-end value chain | "Customer Acquisition → Underwriting → ..." |
| `revenueModel` | How the business generates revenue | "Premium-based with investment income" |
| `additionalContext` | Extra industry/regulatory context | "Subject to Solvency II regulations..." |

**Why this matters:** Every subsequent LLM call includes this business context. It grounds the AI's understanding so use cases, domains, and scores are relevant to the specific customer -- not generic.

---

## Step 2: Metadata Extraction

**File:** `lib/pipeline/steps/metadata-extraction.ts`

**Purpose:** Scan Unity Catalog `information_schema` to build a complete picture of the customer's data landscape.

**How it works:**
1. Parse the `ucMetadata` config string (e.g. `"main.finance, main.marketing"`) into catalog/schema pairs
2. For each scope, execute SQL queries against:
   - `information_schema.tables` -- table names, types, comments
   - `information_schema.columns` -- column names, data types, nullability, comments
   - `information_schema.table_constraints` + `referential_constraints` -- foreign key relationships
3. Build a **schema markdown** representation for LLM consumption
4. Build a **foreign key markdown** showing relationships between tables

**No LLM calls** -- this step is pure SQL.

**Schema markdown format** (fed to all subsequent prompts):

```
### catalog.schema.customers
| Column | Type | Nullable | Comment |
|--------|------|----------|---------|
| customer_id | BIGINT | NO | Primary key |
| name | STRING | NO | Customer full name |
| segment | STRING | YES | Market segment |
...
```

**Foreign key markdown format:**

```
- catalog.schema.orders.customer_id → catalog.schema.customers.customer_id
- catalog.schema.order_items.order_id → catalog.schema.orders.order_id
```

---

## Step 3: Table Filtering

**File:** `lib/pipeline/steps/table-filtering.ts`

**Purpose:** Separate business-relevant tables from system/technical tables to focus the analysis.

**How it works:**
1. If ≤ 5 tables total, skip filtering (all are kept)
2. Otherwise, batch tables into groups of **100**
3. Each batch is sent to the LLM with `FILTER_BUSINESS_TABLES_PROMPT`
4. The LLM classifies each table as `BUSINESS` or `TECHNICAL` with a reason
5. **Fail-open strategy:** if a batch fails, all tables in that batch are included

**LLM persona:** "Senior Data Architect"

**Classification guidance given to the LLM:**

| Category | Examples | Classification |
| --- | --- | --- |
| Customer, order, product tables | `customers`, `orders`, `products` | BUSINESS |
| Audit logs, system tables | `__audit_log`, `_delta_log` | TECHNICAL |
| ETL staging tables | `stg_*`, `tmp_*` | TECHNICAL |
| Reference/lookup tables | `country_codes`, `currencies` | BUSINESS |
| Ambiguous | Any table where unsure | BUSINESS (default) |

**Output format:** CSV `table_fqn, classification, reason`

---

## Step 4: Use Case Generation

**File:** `lib/pipeline/steps/usecase-generation.ts`

**Purpose:** Generate concrete, actionable use cases from the filtered metadata.

This is the core creative step. The engine generates two categories of use cases in parallel.

When an industry is selected, both the AI and Statistical prompts receive `{industry_reference_use_cases}` -- a curated list of proven use cases from the industry outcome map. The LLM uses these as strategic inspiration but grounds every generated use case in the actual table schemas provided. Reference use cases are not copied verbatim.

### Parallel generation strategy

```
filtered tables (e.g. 80 tables)
    │
    ├── Batch 1 (tables 1-20)  ──┬──▶ AI use cases    ──┐
    │                             └──▶ Stats use cases  ──┤
    ├── Batch 2 (tables 21-40) ──┬──▶ AI use cases    ──┤  All batches
    │                             └──▶ Stats use cases  ──┤  merged
    ├── Batch 3 (tables 41-60) ──┬──▶ AI use cases    ──┤
    │                             └──▶ Stats use cases  ──┘
    └── Batch 4 (tables 61-80) ──── (queued, max 3 concurrent)
```

- **Batch size:** 20 tables per batch
- **Concurrency:** Up to 3 batches processed simultaneously
- **Per batch:** Two parallel LLM calls (AI + Statistical)
- **Failure handling:** `Promise.allSettled` -- failed batches are skipped, successful ones kept

### AI use cases (`AI_USE_CASE_GEN_PROMPT`)

Leverages Databricks AI functions:

| Function | Business Value |
| --- | --- |
| `ai_forecast` | Time-series forecasting (demand, revenue, churn) |
| `ai_classify` | Categorisation (sentiment, risk tier, fraud flag) |
| `ai_query` | Free-form LLM analysis (summarisation, extraction) |
| `ai_analyze_sentiment` | Customer feedback, social media analysis |
| `ai_extract` | Structured data from unstructured text |
| `ai_similarity` | Duplicate detection, recommendation engines |
| `ai_summarize` | Document/report summarisation |
| `ai_translate` | Multi-language content processing |
| `vector_search` | Semantic search, RAG applications |

### Statistical use cases (`STATS_USE_CASE_GEN_PROMPT`)

Leverages Databricks SQL analytical functions:

| Category | Functions |
| --- | --- |
| Central Tendency | `AVG`, `MEDIAN`, `MODE` |
| Dispersion | `STDDEV_POP`, `VAR_POP`, `RANGE` |
| Distribution Shape | `SKEWNESS`, `KURTOSIS` |
| Percentiles | `PERCENTILE_APPROX`, `NTILE` |
| Trend Analysis | `REGR_SLOPE`, `REGR_R2`, `CORR` |
| Time Series | `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE` |
| OLAP | `ROLLUP`, `CUBE`, `GROUPING SETS` |

### Use case output structure

Each generated use case contains:

| Field | Description |
| --- | --- |
| `name` | Short descriptive name |
| `type` | "AI" or "Statistical" |
| `analyticsTechnique` | Specific function/technique used |
| `statement` | Business problem statement |
| `solution` | Technical approach description |
| `businessValue` | Expected ROI and impact |
| `beneficiary` | Who benefits (team, department) |
| `sponsor` | Likely executive sponsor |
| `tablesInvolved` | Fully-qualified table names used |

---

## Step 5: Domain Clustering

**File:** `lib/pipeline/steps/domain-clustering.ts`

**Purpose:** Organise use cases into meaningful business domains and subdomains.

### Three-phase process

```
Phase 1: Assign Domains
────────────────────────
All use cases ──▶ LLM assigns domain name to each
                  Target: total_use_cases / 10 domains
                  Min 3, Max 25 domains
                  Single-word names (e.g. "Finance", "Marketing")

Phase 2: Assign Subdomains
────────────────────────────
Per domain (≥ 2 use cases) ──▶ LLM assigns subdomain
                                2-10 subdomains per domain
                                Two-word names (e.g. "Fraud Detection", "Revenue Optimisation")

Phase 3: Merge Small Domains
─────────────────────────────
Domains with < 3 use cases ──▶ LLM suggests merge target
                                Maps small domain → nearest large domain
                                Output: JSON {"SmallDomain": "TargetDomain"}
```

**Why merge?** Domains with only 1-2 use cases are too granular to be actionable. Merging produces cleaner groupings for executive reporting.

---

## Step 6: Scoring & Deduplication

**File:** `lib/pipeline/steps/scoring.ts`

**Purpose:** Score every use case on three dimensions, remove duplicates, and rank.

When an industry is selected, the scoring prompt receives `{industry_kpis}` -- a list of industry-specific KPIs and personas mapped to each strategic priority. Use cases that directly address these KPIs receive higher strategic alignment scores from the LLM.

### Scoring process

```
For each domain:
    │
    ├── 1. Score via LLM ──▶ priority_score, feasibility_score,
    │                         impact_score, overall_score (each 0-1)
    │
    └── 2. Deduplicate via LLM ──▶ identify overlapping/redundant use cases
                                     mark as "keep" or "remove" with reason

Then globally:
    │
    ├── 3. Sort by overall_score descending
    ├── 4. Cap at 200 use cases
    └── 5. Re-number with domain prefix (e.g. FIN-001-ab12cd34)
```

### Scoring dimensions

| Dimension | Weight | What it measures |
| --- | --- | --- |
| **Priority** | 0.3 | Alignment with stated business priorities and strategic goals |
| **Feasibility** | 0.2 | Technical feasibility given available data, schema quality, and table relationships |
| **Impact** | 0.5 | Expected business impact: revenue, cost savings, risk reduction, operational efficiency |

**Formula:**

```
overall_score = priority × 0.3 + feasibility × 0.2 + impact × 0.5
```

### Score tiers

| Tier | Range | Interpretation |
| --- | --- | --- |
| **High** | ≥ 0.70 | Strong strategic fit, high impact, technically viable |
| **Medium** | 0.40 -- 0.69 | Moderate value, may need additional data or refinement |
| **Low** | < 0.40 | Limited immediate value, exploratory or long-term |

### LLM personas

- **Scoring:** "Chief Investment Officer" -- evaluates ROI, feasibility, strategic alignment
- **Deduplication:** Reviews for overlapping use cases that solve the same problem with similar techniques

### ID format after re-numbering

```
{DOMAIN_PREFIX}-{SEQUENCE}-{HASH}

Examples:
  FIN-001-ab12cd34   (Finance domain, highest score)
  MKT-003-ef56gh78   (Marketing domain, 3rd highest)
  OPS-012-ij90kl12   (Operations domain, 12th)
```

---

## Step 7: SQL Generation

**File:** `lib/pipeline/steps/sql-generation.ts`

**Purpose:** Generate runnable Databricks SQL for each use case.

### Process

```
Use cases grouped by domain
    │
    ├── Domain: Finance (10 use cases)
    │   ├── Wave 1: [UC-1, UC-2, UC-3]  ──▶ 3 concurrent Model Serving calls
    │   ├── Wave 2: [UC-4, UC-5, UC-6]  ──▶ 3 concurrent Model Serving calls
    │   ├── Wave 3: [UC-7, UC-8, UC-9]  ──▶ 3 concurrent Model Serving calls
    │   └── Wave 4: [UC-10]             ──▶ 1 Model Serving call (streaming)
    │
    ├── Domain: Marketing (7 use cases)
    │   └── ... (processed after Finance)
    ...
```

- **Concurrency:** 3 SQL generations per wave
- **Domain ordering:** smallest domains first (to show progress quickly)

### Per-use-case context sent to LLM

The SQL generation prompt includes:

1. **Business context** -- industry, goals, priorities
2. **Use case details** -- name, statement, solution, technique, tables
3. **Scoped schema** -- only columns for the tables involved in this use case
4. **Foreign keys** -- only relationships relevant to the involved tables
5. **Function documentation** -- AI functions (for AI use cases) or statistical functions (for statistical use cases)
6. **Sample data** (optional) -- actual rows from each involved table (see [Data Sampling](#data-sampling))

### SQL generation rules enforced via prompt

All SQL generation imports shared rules from `lib/ai/sql-rules.ts`
(`DATABRICKS_SQL_RULES`) to ensure consistency across pipeline SQL, Genie
trusted assets, benchmarks, and dashboard queries.

| Rule | Why |
| --- | --- |
| Use only columns that exist in the provided schema | Prevents hallucinated column names |
| Use CTEs for readability | Structured, maintainable output |
| Add `LIMIT 10` to final output | Safe for exploration, prevents runaway queries |
| Correct JOIN syntax with proper ON clauses | Ensures valid multi-table queries |
| For AI use cases: use `ai_query()` with proper `modelParameters` | Leverages Databricks Model Serving |
| Output raw SQL only -- no markdown, no explanation | Clean output for notebook cells |
| Never use `MEDIAN()` -- use `PERCENTILE_APPROX(col, 0.5)` | Not supported in Databricks SQL |
| Use `DECIMAL(18,2)` for financial calculations | Avoids floating-point precision errors |
| Use `ORDER BY ... LIMIT N` for top-N (not RANK) | RANK ties can return more than N rows |
| Filter early, aggregate late | Better query performance |

### Output

Each use case gets:
- `sqlCode` -- the generated SQL (or `null` on failure)
- `sqlStatus` -- `"generated"` or `"failed"`

**Rejection threshold:** LLM responses shorter than 20 characters are treated as failures.

---

## Scoring Methodology

### Formula

```
overall = priority × 0.3 + feasibility × 0.2 + impact × 0.5
```

Impact is weighted highest (0.5) because Forge is designed to surface the most valuable opportunities. Feasibility is weighted lowest (0.2) because data availability can change -- a high-impact use case is worth pursuing even if it requires some data preparation.

### What the LLM evaluates for each dimension

**Priority (0.3 weight):**
- Does this use case directly support the stated business priorities?
- Is it aligned with the strategic goals and initiatives?
- Would an executive sponsor champion this?

**Feasibility (0.2 weight):**
- Do the required tables and columns exist?
- Is the data schema well-structured (proper types, FKs, comments)?
- Is the analytics technique (e.g. `ai_forecast`) appropriate for the available data?

**Impact (0.5 weight):**
- What is the expected business value (revenue, cost savings, risk reduction)?
- How many people/processes does this affect?
- Is the impact measurable and attributable?

### Volume cap

The pipeline caps output at **200 use cases**. This is a practical limit for:
- Export formatting (Excel, PowerPoint, notebooks)
- Executive readability
- Ensuring quality over quantity

---

## AI & Statistical Function Registry

**File:** `lib/ai/functions.ts`

The function registry serves two purposes:
1. **Prompt injection** -- tells the LLM exactly which functions are available on Databricks
2. **Use case categorisation** -- determines whether a use case is "AI" or "Statistical"

### AI functions (12 registered)

| Function | Category | Example use case |
| --- | --- | --- |
| `ai_analyze_sentiment` | NLP | Customer feedback analysis |
| `ai_classify` | Classification | Risk tier assignment, fraud flagging |
| `ai_extract` | Extraction | Pull entities from unstructured text |
| `ai_fix_grammar` | Text | Clean customer-facing content |
| `ai_forecast` | Time Series | Demand forecasting, revenue projection |
| `ai_mask` | Privacy | PII redaction in reports |
| `ai_parse_document` | Document AI | Invoice processing, contract analysis |
| `ai_query` | General LLM | Summarisation, Q&A, reasoning |
| `ai_similarity` | Similarity | Duplicate detection, recommendations |
| `ai_summarize` | Summarisation | Report generation, digest creation |
| `ai_translate` | Translation | Multi-language content processing |
| `vector_search` | Semantic Search | RAG, knowledge base search |

### Statistical functions (35+ registered, 9 categories)

| Category | Functions |
| --- | --- |
| Central Tendency | `AVG`, `MEDIAN`, `MODE`, `MEAN` |
| Dispersion | `STDDEV_POP`, `STDDEV_SAMP`, `VAR_POP`, `VAR_SAMP` |
| Distribution Shape | `SKEWNESS`, `KURTOSIS` |
| Percentiles | `PERCENTILE_APPROX`, `PERCENTILE_CONT`, `NTILE` |
| Trend Analysis | `REGR_SLOPE`, `REGR_INTERCEPT`, `REGR_R2`, `CORR`, `COVAR_POP` |
| Correlation | `CORR`, `COVAR_POP`, `COVAR_SAMP` |
| Ranking | `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE` |
| Time Series | `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE` |
| OLAP | `ROLLUP`, `CUBE`, `GROUPING SETS`, `GROUPING` |

---

## Prompt Engineering

**File:** `lib/ai/templates.ts`

All prompts follow a consistent structure:

```
PERSONA → CONTEXT → TASK → RULES → OUTPUT FORMAT → HONESTY CHECK
```

### Prompt catalog

| Template | Persona | Task | Output |
| --- | --- | --- | --- |
| `BUSINESS_CONTEXT_WORKER_PROMPT` | Principal Business Analyst | Infer business context from org name | JSON (7 fields) |
| `FILTER_BUSINESS_TABLES_PROMPT` | Senior Data Architect | Classify tables as business/technical | CSV |
| `AI_USE_CASE_GEN_PROMPT` | Principal Data Scientist | Generate AI use cases | CSV (11 columns) |
| `STATS_USE_CASE_GEN_PROMPT` | Principal Data Scientist | Generate statistical use cases | CSV (11 columns) |
| `DOMAIN_FINDER_PROMPT` | Business Strategist | Assign domains to use cases | CSV |
| `SUBDOMAIN_DETECTOR_PROMPT` | Business Strategist | Assign subdomains within a domain | CSV |
| `DOMAINS_MERGER_PROMPT` | Business Strategist | Merge small domains into larger ones | JSON map |
| `SCORE_USE_CASES_PROMPT` | Chief Investment Officer | Score priority/feasibility/impact | CSV |
| `REVIEW_USE_CASES_PROMPT` | Quality Analyst | Identify duplicates and low-value items | CSV |
| `USE_CASE_SQL_GEN_PROMPT` | Principal SQL Engineer | Generate runnable Databricks SQL | Raw SQL |
| `PARSE_OUTCOME_MAP` | Data Extraction Expert | Parse markdown outcome map into structured JSON | JSON (`IndustryOutcome`) |

### Variable injection

All prompts use `{placeholder}` syntax. Common variables:

| Variable | Source | Used in |
| --- | --- | --- |
| `{business_name}` | User config | All prompts |
| `{business_context}` | Step 1 output | Steps 3-7 |
| `{schema_markdown}` | Step 2 output | Steps 3-4, 7 |
| `{foreign_keys_markdown}` | Step 2 output | Steps 4, 7 |
| `{ai_functions_summary}` | Function registry | Step 4 (AI), Step 7 (AI) |
| `{statistical_functions_summary}` | Function registry | Step 4 (Stats), Step 7 (Stats) |
| `{use_cases_csv}` | Previous step output | Steps 5-6 |
| `{sample_data_section}` | Optional row samples | Step 7 |
| `{industry_context}` | Industry outcome map | Step 1 (when industry selected) |
| `{industry_reference_use_cases}` | Industry outcome map | Step 4 (when industry selected) |
| `{industry_kpis}` | Industry outcome map | Step 6 (when industry selected) |
| `{markdown_content}` | Uploaded markdown file | `PARSE_OUTCOME_MAP` (ingestor) |

### Honesty checks

Every prompt includes an honesty check that asks the LLM to self-assess:
- **JSON prompts:** Must include `honesty_score` (0-100) and `honesty_justification`
- **CSV prompts:** Must append `honesty_score` and `honesty_justification` columns

These are logged for quality monitoring but do not affect pipeline execution.

---

## Data Sampling

**Configuration:** Settings page → "Data Sampling" → 0 (disabled), 5, 10, 25, or 50 rows per table

When enabled, Step 7 (SQL Generation) fetches actual rows from each table involved in a use case:

```
For each use case:
    For each table in tablesInvolved:
        SELECT * FROM catalog.schema.table LIMIT {sampleRowsPerTable}
        Format results as markdown table
    Inject into prompt as {sample_data_section}
```

### Sample data format in prompt

```
### Sample Data

#### catalog.schema.customers (5 rows)
| customer_id | name       | segment    | created_date |
|-------------|------------|------------|--------------|
| 1001        | Acme Corp  | Enterprise | 2024-01-15   |
| 1002        | Beta Inc   | SMB        | 2024-02-20   |
...
```

### Trade-offs

| Aspect | Sampling Disabled (default) | Sampling Enabled |
| --- | --- | --- |
| **Privacy** | Metadata only | Reads row-level data |
| **SQL accuracy** | Based on schema + column names | Based on actual data patterns |
| **Run time** | Faster | Slower (1 query per table per use case) |
| **Data sent to LLM** | Schema only | Schema + sample rows |
| **Storage** | None | Not stored (in-memory only during generation) |

---

## Export Pipeline

After the discovery pipeline completes, results can be exported in four formats:

```
┌──────────────┐
│  Completed   │
│  Pipeline    │
│  Run         │
└──────┬───────┘
       │
       ├──▶ Excel (.xlsx)      ── 3 sheets: Summary, Use Cases, Domains
       │                          Filterable table, conditional formatting
       │
       ├──▶ PowerPoint (.pptx) ── Title, executive summary, TOC,
       │                          per-domain dividers + summaries,
       │                          individual use case slides with scores
       │
       ├──▶ PDF (.pdf)         ── A4 landscape, branded cover page,
       │                          executive summary, domain breakdown,
       │                          individual use case pages with score bars
       │
       └──▶ SQL Notebooks      ── Jupyter .ipynb format, one per domain,
            (.ipynb)               deployed to Databricks Workspace,
                                   markdown documentation + runnable SQL cells,
                                   deep-linked from the UI
```

### Notebook structure

Each domain gets its own notebook:

```
┌─────────────────────────────────────────┐
│  📘 domain_name.ipynb                   │
├─────────────────────────────────────────┤
│  [Markdown] Title + generation metadata │
│  [Markdown] Domain overview             │
│                                         │
│  For each use case in this domain:      │
│    [Markdown] Use case header           │
│      - Statement, Solution              │
│      - Business Value, Beneficiary      │
│      - Technique, Scores                │
│    [SQL] Generated SQL code             │
│                                         │
│  [Markdown] Footer + disclaimer         │
└─────────────────────────────────────────┘
```

---

## Privacy Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA ACCESS MODEL                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEFAULT (sampling disabled):                                    │
│                                                                  │
│    ✅ information_schema.tables      (table names, types)        │
│    ✅ information_schema.columns     (column names, data types)  │
│    ✅ information_schema.constraints (foreign key relationships) │
│    ❌ Actual table data              (never accessed)            │
│                                                                  │
│  WITH DATA SAMPLING ENABLED:                                     │
│                                                                  │
│    ✅ All of the above                                           │
│    ⚠️  SELECT * FROM table LIMIT N   (sample rows read)          │
│       → Sent to AI model for SQL generation                     │
│       → NOT persisted (in-memory only during Step 7)            │
│       → NOT included in exports                                  │
│                                                                  │
│  LLM calls:                                                      │
│    ✅ Model Serving REST API          (business context + prompts) │
│    ❌ No direct model API calls      (all routed through SQL)    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Constants & Tuning Parameters

These values control pipeline behaviour and can be adjusted in the source code:

### Batch sizes and concurrency

| Parameter | Value | File | Purpose |
| --- | --- | --- | --- |
| Table filtering batch size | 100 | `table-filtering.ts` | Tables per LLM classification call |
| Tables per use-case batch | 20 | `usecase-generation.ts` | Tables included in each generation prompt |
| Max concurrent UC batches | 3 | `usecase-generation.ts` | Parallel Model Serving calls for generation |
| Max concurrent SQL generations | 3 | `sql-generation.ts` | Parallel Model Serving calls for SQL (streaming) |

### Clustering and scoring

| Parameter | Value | File | Purpose |
| --- | --- | --- | --- |
| Min use cases per domain | 3 | `domain-clustering.ts` | Domains below this are merged |
| Target domain count | total / 10 | `domain-clustering.ts` | Suggested number of domains |
| Max domains | 25 | `domain-clustering.ts` | Upper bound on domain count |
| Max subdomains per domain | 10 | `domain-clustering.ts` | Upper bound on subdomains |
| Volume cap | 200 | `scoring.ts` | Maximum use cases after deduplication |
| Priority weight | 0.3 | `scoring.ts` | Weight in overall score formula |
| Feasibility weight | 0.2 | `scoring.ts` | Weight in overall score formula |
| Impact weight | 0.5 | `scoring.ts` | Weight in overall score formula |

### Score tiers

| Tier | Threshold | Colour in exports |
| --- | --- | --- |
| High | ≥ 0.70 | Green (`#2EA44F`) |
| Medium | ≥ 0.40 | Amber (`#E8912D`) |
| Low | < 0.40 | Red (`#FF3621`) |

### LLM configuration

| Parameter | Value | Notes |
| --- | --- | --- |
| Default model | `databricks-claude-opus-4-7` | Configurable per run |
| SQL rejection threshold | 20 chars | Responses shorter than this are treated as failures |
| Sample rows range | 0 -- 50 | 0 = disabled, configurable in Settings |

---

## Data Flow Summary

```
User Input                    Pipeline                         Output
──────────                    ────────                         ──────

Business Name    ──┐
UC Scope         ──┤
Priorities       ──┤
Strategic Goals  ──┼──▶  BusinessContext (LLM)
AI Model         ──┤       + {industry_context}
Industry (opt)   ──┘          │
                              ▼
                        MetadataSnapshot (SQL)
                              │
                              ▼
                        Filtered Tables (LLM)
                              │
                              ▼
                     ┌────────┴────────┐
                     │                 │
                  AI Use Cases    Stats Use Cases
                  (LLM, parallel) (LLM, parallel)
                  + {industry_reference_use_cases}
                     │                 │
                     └────────┬────────┘
                              │
                              ▼
                        Domain Assignment (LLM)
                        Subdomain Assignment (LLM)
                        Small Domain Merge (LLM)
                              │
                              ▼
                        Scoring (LLM, per domain)
                        + {industry_kpis}
                        Deduplication (LLM, per domain)
                        Sort + Cap + Re-number
                              │
                              ▼
                        SQL Generation (LLM, per use case)
                              │
                              ▼
                     ┌────────┴────────┐
                     │   Lakebase DB   │
                     └────────┬────────┘
                              │
                  ┌───────────┼───────────┬──────────┐
                  ▼           ▼           ▼          ▼
               Excel       PowerPoint    PDF      Notebooks
              (.xlsx)       (.pptx)     (.pdf)    (.ipynb)
```
