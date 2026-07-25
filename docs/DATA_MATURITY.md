# Data Maturity Score

The Data Maturity Score is the headline metric Databricks Forge produces for
each estate scan. It is the number an SA quotes in an account review -- a single
0-100 composite that reflects how well a customer's data platform is governed,
architected, operated, and leveraged for analytics.

---

## Overview

| Attribute           | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Range               | 0 -- 100 (integer)                                                    |
| Computation         | Rule-based (deterministic, no LLM)                                    |
| Pillars             | 4, equally weighted at 25 %                                           |
| Source module        | `lib/domain/data-maturity.ts`                                         |
| UI component        | `components/environment/data-maturity-card.tsx`                        |
| Exports             | Excel (`lib/export/environment-excel.ts`), PPTX (`lib/export/executive-briefing.ts`) |

---

## Maturity Levels

The overall score maps to a named level used in badges, exports, and narrative
summaries:

| Score Range | Level          | Badge Colour |
| ----------- | -------------- | ------------ |
| 0 -- 20     | Foundational   | Red          |
| 21 -- 40    | Developing     | Orange       |
| 41 -- 60    | Established    | Yellow       |
| 61 -- 80    | Advanced       | Blue         |
| 81 -- 100   | Leading        | Emerald      |

---

## Architecture

```
                     ┌──────────────────────────┐
                     │   Overall Maturity Score  │
                     │   (weighted average, 0-100)│
                     └────────────┬─────────────┘
                                  │
        ┌─────────────┬───────────┼───────────┬──────────────┐
        │             │           │           │              │
   Governance   Architecture  Operations   Analytics
     (25 %)       (25 %)       (25 %)     Readiness
                                            (25 %)
        │             │           │           │
    5 indicators  5 indicators  6 indicators  5 indicators
                                             (or 2 if no
                                              discovery)
```

Each pillar is scored 0-100 as the **arithmetic mean** of its indicators (each
also 0-100). The overall score is the **weighted average** of the four pillar
scores:

```
overall = governance × 0.25
        + architecture × 0.25
        + operations × 0.25
        + analyticsReadiness × 0.25
```

All scores are clamped to the 0-100 integer range via `Math.max(0, Math.min(100, Math.round(value)))`.

---

## Pillar 1 -- Governance (25 %)

Measures how well the data estate is documented, classified, and governed.

| Indicator              | How It Is Scored                                                         | Range  |
| ---------------------- | ------------------------------------------------------------------------ | ------ |
| Avg Governance Score   | Direct passthrough of the LLM governance pass average (per-table 0-100)  | 0-100  |
| Documentation Coverage | `(tables with comment or generated description / total tables) × 100`    | 0-100  |
| Tag Adoption           | `(tables with Unity Catalog tags / total tables) × 100`                  | 0-100  |
| Ownership Assignment   | `(tables with an owner set / total tables) × 100`                        | 0-100  |
| PII Detection Active   | 80 if PII tables were found, 40 otherwise                               | 40-80  |

**Pillar score** = mean of the five indicators above.

### Rationale

- **Avg Governance Score** comes from the environment intelligence LLM pass that
  evaluates each table's governance posture (naming conventions, documentation,
  access controls).
- **PII Detection** uses a binary signal: if PII has been detected at all, the
  organisation is at least scanning for it (80). If not, either scanning hasn't
  been attempted or the estate genuinely has no PII (conservative score of 40).

---

## Pillar 2 -- Architecture (25 %)

Measures structural quality of the data platform: layering, redundancy, lineage,
and data products.

| Indicator               | How It Is Scored                                                     | Range  |
| ----------------------- | -------------------------------------------------------------------- | ------ |
| Medallion Tier Adoption | `(tables classified by tier / total tables) × 100`                   | 0-100  |
| Tier Diversity          | `min(distinct tier count, 3) × 33`, clamped                         | 0-100  |
| Redundancy              | `100 − min(redundancy pairs × 10, 50)` (lower redundancy is better) | 50-100 |
| Data Products           | `min(data product count, 10) × 10`                                   | 0-100  |
| Lineage Coverage        | `min(lineage edges / total tables × 50, 100)`, or 0 if no lineage   | 0-100  |

**Pillar score** = mean of the five indicators above.

### Rationale

- **Tier Diversity** rewards estates that have adopted the bronze/silver/gold
  (or equivalent) medallion pattern. Three distinct tiers earns full marks.
- **Redundancy** is an inverse metric: each detected redundancy pair costs
  10 points (capped at -50). A clean estate with zero redundancy scores 100.
- **Data Products** caps at 10 because any count beyond that already signals
  strong data product thinking.
- **Lineage Coverage** uses a ratio of edges to tables. Two edges per table
  (representing an upstream and downstream connection) earns full marks.

---

## Pillar 3 -- Operations (25 %)

Measures how well the estate is maintained at runtime: compaction, vacuuming,
health, and modern feature adoption.

| Indicator               | How It Is Scored                                                                        | Range  |
| ----------------------- | --------------------------------------------------------------------------------------- | ------ |
| Avg Health Score        | Direct passthrough of the per-table health score average (see below)                    | 0-100  |
| OPTIMIZE Compliance     | `100 − (tables needing OPTIMIZE / total tables × 100)`                                 | 0-100  |
| VACUUM Compliance       | `100 − (tables needing VACUUM / total tables × 100)`                                   | 0-100  |
| Auto-Optimize Adoption  | `(tables with auto-optimize / total tables) × 100`                                     | 0-100  |
| Liquid Clustering       | `(tables with liquid clustering / total tables) × 100`                                  | 0-100  |
| CDF on Streaming Tables | `(tables with CDF / streaming tables) × 100` if streaming tables exist; else 50 or 80  | 0-100  |

**Pillar score** = mean of the six indicators above.

### CDF scoring detail

When no streaming tables exist, the CDF indicator defaults to a neutral score:
- 80 if CDF-enabled tables exist anyway (proactive adoption)
- 50 otherwise (neutral -- CDF is not applicable)

---

## Pillar 4 -- Analytics Readiness (25 %)

Measures how well the estate is positioned for analytics and AI use cases.
This pillar has **two modes** depending on whether a Discovery pipeline has
been run against the same scope.

### With Discovery Data

| Indicator              | How It Is Scored                                                        | Range  |
| ---------------------- | ----------------------------------------------------------------------- | ------ |
| Use Case Density       | `min(use cases / total tables × 50, 100)`                              | 0-100  |
| Schema Coverage        | `(tables covered by use cases / total tables) × 100`                   | 0-100  |
| Avg Use Case Quality   | `avg use case score × 100` (scores are 0-1 from the scoring pipeline)  | 0-100  |
| AI/Statistical Balance | `100 − |AI% − 50|` (perfect 50/50 split = 100)                         | 0-100  |
| Domain Coverage        | `min(domain count, 8) × 12.5`                                          | 0-100  |

### Without Discovery Data

| Indicator       | Score                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Domain Coverage | `min(domain count, 8) × 12.5`                                         |
| Discovery Runs  | 0 (with hint: "Run a discovery pipeline to unlock analytics readiness scoring") |

**Pillar score** = mean of the indicators in whichever mode applies.

When no discovery data is present, this pillar is heavily penalised (only two
indicators, one of which is always 0), which correctly signals that the
organisation has not yet explored analytical potential.

### Rationale

- **Use Case Density** of 2.0 per table earns full marks -- this represents
  a healthy ratio of identified opportunities to available data assets.
- **AI/Statistical Balance** rewards organisations that have a healthy mix of
  AI/ML and statistical analytics use cases rather than being skewed to one type.
- **Domain Coverage** caps at 8 domains. Beyond 8 distinct business domains,
  the estate has comprehensive cross-functional coverage.

---

## Table Health Score (feeds into Operations pillar)

The per-table health score is a prerequisite for the Operations pillar. It is
computed by a separate rule-based algorithm in `lib/domain/health-score.ts`.

### Algorithm

1. Start at 100.
2. Evaluate 10 rules against each table's metadata and history.
3. For each rule that triggers, subtract its deduction.
4. Final score = `max(0, 100 − sum of deductions)`.

### Rules

| Rule ID                  | Deduction | Condition                                                 |
| ------------------------ | --------- | --------------------------------------------------------- |
| `no_optimize_30d`        | -15       | No OPTIMIZE in the last 30 days                           |
| `no_vacuum_30d`          | -15       | No VACUUM in the last 30 days                             |
| `small_file_problem`     | -20       | Average file size < 32 MB                                 |
| `no_comment`             | -10       | No table description/comment                              |
| `high_partition_count`   | -10       | More than 100 partition columns                           |
| `stale_data_90d`         | -15       | No writes in the last 90 days                             |
| `not_accessed_90d`       | -10       | No reads/queries in the last 90 days                      |
| `no_cdf_with_streaming`  | -10       | Streaming writes detected but CDF not enabled             |
| `outdated_delta_protocol`| -5        | Delta reader version < 2                                  |
| `empty_table`            | -10       | Zero rows (non-view tables only)                          |
| `very_large_table`       | -5        | More than 1 billion rows                                  |

Maximum possible deduction: 125 (but score floors at 0).

### Configurable Thresholds

All time/size thresholds can be overridden via environment variables:

| Environment Variable                   | Default      |
| -------------------------------------- | ------------ |
| `FORGE_HEALTH_OPTIMIZE_WINDOW_DAYS`    | 30           |
| `FORGE_HEALTH_VACUUM_WINDOW_DAYS`      | 30           |
| `FORGE_HEALTH_STALE_WRITE_DAYS`        | 90           |
| `FORGE_HEALTH_STALE_ACCESS_DAYS`       | 90           |
| `FORGE_HEALTH_SMALL_FILE_BYTES`        | 33,554,432 (32 MB) |
| `FORGE_HEALTH_HIGH_PARTITION_COUNT`    | 100          |
| `FORGE_HEALTH_VERY_LARGE_ROW_COUNT`    | 1,000,000,000 |

### Health Score Interpretation

| Score     | Interpretation     |
| --------- | ------------------ |
| 80 -- 100 | Healthy            |
| 60 -- 79  | Needs attention    |
| 0 -- 59   | Critical issues    |

The **average** of all table health scores is passed into the Data Maturity
computation as the "Avg Health Score" indicator in the Operations pillar.

---

## Data Flow

```
Estate Scan Pipeline
        │
        ├── information_schema queries ──────────► TableDetail[]
        ├── DESCRIBE DETAIL/HISTORY ─────────────► TableHistorySummary[]
        ├── LLM governance pass ─────────────────► per-table governance scores
        ├── LLM PII detection pass ──────────────► piiTablesCount
        ├── LLM domain classification ───────────► domainCount, tiers
        ├── LLM redundancy detection ────────────► redundancyPairsCount
        ├── LLM data product identification ─────► dataProductCount
        ├── Lineage BFS walk ────────────────────► lineageEdgeCount
        │
        ▼
  computeAllTableHealth(details, histories)
        │
        ▼
  avgHealthScore ──────────────────────────────┐
                                               │
  All scan metrics ────────────────────────────┤
                                               ▼
                                    computeDataMaturity(inputs)
                                               │
                                               ▼
                                    DataMaturityScore {
                                      overall: 72,
                                      level: "Advanced",
                                      pillars: { ... }
                                    }
```

---

## Where the Score Appears

| Surface                     | Module                                          | Notes                                         |
| --------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Aggregate estate view       | `components/environment/aggregate-summary.tsx`   | Displayed via `DataMaturityCard`               |
| Data Maturity card          | `components/environment/data-maturity-card.tsx`  | Overall score, level badge, 4 pillar bars      |
| Excel export (Summary sheet)| `lib/export/environment-excel.ts`                | Score + all 4 pillar breakdowns                |
| Executive Briefing (PPTX)   | `lib/export/executive-briefing.ts`               | Slide 2: estate overview with maturity score   |
| Help page                   | `app/help/page.tsx` via `lib/help-text.ts`       | Tooltip description of the metric              |

---

## Analytics Maturity (separate concept)

There is a **second**, complementary maturity assessment generated by the
environment intelligence LLM (Pass 9). This is distinct from the rule-based
Data Maturity Score:

| Attribute        | Data Maturity Score              | Analytics Maturity Assessment        |
| ---------------- | -------------------------------- | ------------------------------------ |
| Computation      | Rule-based (deterministic)       | LLM-generated (non-deterministic)    |
| Source           | `lib/domain/data-maturity.ts`    | `lib/ai/environment-intelligence.ts` |
| Stored           | Computed at display/export time  | Persisted as `ForgeTableInsight`     |
| Scope            | Entire estate                    | Asset discovery coverage             |
| Levels           | Foundational → Leading           | Nascent → Advanced                   |

The Analytics Maturity assessment is only generated when asset discovery is
enabled and produces dimensions like coverage, depth, freshness, and
completeness. It appears in the Excel export's "Analytics Coverage" sheet
but does **not** feed back into the headline Data Maturity Score.

---

## Design Decisions

1. **Equal pillar weights (25 % each):** Deliberate choice to avoid opinionated
   weighting. All four dimensions are equally important for a mature data
   platform. Customers who want to prioritise one area can compare pillar scores
   directly.

2. **Deterministic computation:** The headline score uses no LLM calls. It is
   reproducible given the same inputs and can be audited/explained indicator by
   indicator.

3. **Graceful degradation:** When data is unavailable (no lineage, no discovery,
   no streaming tables), the relevant indicators score conservatively rather than
   penalising to zero. This ensures the score reflects what *is* known rather
   than what *could not be measured*.

4. **Health score as an input, not a parallel metric:** Individual table health
   is an operational measure that feeds *into* the maturity model rather than
   competing with it. This prevents customers from seeing conflicting numbers.

5. **Analytics Readiness dual-mode:** Separating the with/without-discovery
   modes ensures the score meaningfully improves when a customer invests in
   running the discovery pipeline, creating a natural upsell moment.
