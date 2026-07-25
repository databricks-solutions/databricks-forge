# How the Use Case Engine Works

This guide explains, in simple terms, how Databricks Forge turns your metadata into high-quality business use cases.

## 1) Big picture

The engine does three things:

1. Learns your business context.
2. Reads your Unity Catalog metadata to discover what data you actually have.
3. Generates, scores, filters, and ranks use cases so the final list is practical and boardroom-ready.

Think of it as a funnel:

- Wide at the start (lots of ideas),
- Narrow at the end (only grounded, high-quality ideas survive).

## 2) What goes in

Each run starts from:

- Your business inputs (name, priorities, strategic goals, maturity, risk posture),
- Your selected Unity Catalog scope (catalogs/schemas/tables/columns),
- Optional knowledge-base documents (RAG),
- Optional benchmark records for your industry.

## 3) Step-by-step pipeline

The engine runs in ordered steps:

1. `business-context`
   - Builds a structured view of your business goals and value chain.
   - Uses your inputs first, then enriches with optional industry and benchmark context.

2. `metadata-extraction`
   - Pulls table/column/relationship metadata from Unity Catalog.
   - This is the factual data foundation for the run.

3. `table-filtering`
   - Keeps business-relevant tables and removes purely technical ones.

4. `usecase-generation`
   - Generates AI and statistical use cases in batches.
   - Every use case must reference real tables from your metadata.

5. `domain-clustering`
   - Groups use cases into business domains/subdomains for easier navigation.

6. `scoring`
   - Scores value and feasibility.
   - Deduplicates overlaps.
   - Calibrates scores globally.
   - Applies quality floor and adaptive cap.

7. `sql-generation`
   - Produces SQL for each surviving use case (with strict SQL rules and schema grounding).

8. `business-value-analysis`
   - Financial quantification (low/mid/high value estimates per use case).
   - Roadmap phasing with effort and dependency mapping.
   - Executive synthesis (board-ready findings, recommendations, risks).
   - Stakeholder analysis (role/department impact profiles).

After completion, the run is persisted, quality metrics are stored, and downstream recommendation engines (Genie Engine, Dashboard Engine) can continue in the background.

## 4) How benchmarks are applied (without polluting facts)

Benchmarks are used as **advisory guidance**, not as customer facts.

### Benchmark source and selection

- Benchmark records are stored in `forge_benchmark_records`.
- Only `published` and non-expired records are used.
- Packs are selected by `industry` and tuned by `customerMaturity`:
  - `nascent`: quick wins and lower complexity,
  - `developing`: balanced portfolio,
  - `advanced`: scalable, platform-level opportunities.
- If industry records are missing, the engine falls back to a safe default benchmark pack.

### Where benchmark context is injected

Benchmark context is inserted into prompts for:

- Business context generation,
- Use case generation,
- Scoring.

### Guardrail: source priority

Prompts enforce this ordering for claims:

`CustomerFact > PlatformBestPractice > IndustryBenchmark > AdvisoryGuidance`

In plain language: your metadata and your context always win. Benchmarks only guide framing and prioritization.

## 5) How quality is enforced

Quality is controlled with multiple gates, not a single score.

### A) Grounding and anti-hallucination checks

- Use cases with invalid/nonexistent table references are removed.
- If a use case ends up with zero valid table links, it is dropped.

### B) Deterministic anti-slop filter

Before scoring, the engine rejects use cases that are:

- Too generic,
- Too short,
- Missing key fields (beneficiary/sponsor/technique),
- Not grounded in actual tables.

### C) Scoring with fail-closed behavior

- Each domain is scored for priority, feasibility, impact, and overall value.
- If scoring fails too broadly (40%+ of domains), the run fails rather than shipping weak output.

### D) Deduplication and calibration

- In-domain duplicate cleanup,
- Cross-domain duplicate cleanup (with score-aware safeguards),
- Global recalibration so scores are comparable across domains.

### E) Final output shaping

- Quality floor removes low-scoring use cases.
- Adaptive cap limits volume so the final list stays actionable.

### F) Run-level quality gate

The engine computes run KPIs such as:

- Consultant readiness,
- Low-specificity rate,
- Schema coverage,
- SQL generation rate,
- Duplicate-name rate,
- Grounded use case rate.

If consultant readiness is below the configured threshold (`FORGE_MIN_CONSULTANT_READINESS`), the run fails and is not treated as publish-ready.

## 6) Why this produces better results

This design avoids common AI failure modes:

- Generic ideas with no data grounding,
- Hallucinated table usage,
- Duplicate or weak use cases,
- Benchmark overreach (treating industry priors as facts).

The end result is a smaller, higher-quality set of use cases that are:

- Grounded in your real estate,
- Prioritized by business value,
- More actionable for delivery teams and leadership.

## 7) Operational quality loop

To keep quality high over time:

- Each run writes quality metrics for trend tracking.
- Teams review failures and top findings on a regular cadence.
- Benchmark packs are refreshed and governed through lifecycle states (`draft -> reviewed -> published -> deprecated`).

This creates a continuous improvement loop instead of one-off prompt tuning.
