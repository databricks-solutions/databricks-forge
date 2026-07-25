# Benchmark Context Strategy

## Purpose

Introduce benchmark guidance into use case generation and scoring without
confusing benchmark priors with customer facts.

## Design

- Benchmark context is produced by `lib/domain/benchmark-context.ts` from
  published records in `forge_benchmark_records`.
- It includes:
  - reference KPI lenses,
  - platform best-practice priorities,
  - advisory benchmark principles,
  - consulting guidance themes.
- It is injected as `benchmark_context` into business-context, use case
  generation, and scoring prompts.

## Baseline Packs

- Seed packs live under `data/benchmark/*.json`.
- Initial verticals: banking, healthcare/life sciences, retail/consumer.
- Idempotent ingestion script: `node scripts/seed-benchmarks.mjs`.
- Optional full-coverage seed: `FORGE_SEED_BENCHMARKS_ALL_INDUSTRIES=true node scripts/seed-benchmarks.mjs`.
- Deploy-time flags in `deploy.sh`:
  - `--seed-benchmarks` seeds baseline catalog at startup.
  - `--seed-benchmarks-all-industries` additionally generates records for every
    industry under `lib/domain/industry-outcomes/` that does not yet have a
    curated JSON pack.
  - `--seed-benchmark-industries "banking,hls"` seeds only selected industries.
- Records are upserted by `(kind, title, source_url)`.

## Data separation policy

- **Customer facts** must come from Unity Catalog metadata and retrieved
  customer artifacts.
- **Benchmark guidance** is advisory prior only.
- Prompts must keep benchmark guidance as optional framing, never as factual
  evidence.

## Adaptivity

- Benchmark packs are selected by `industryId`.
- Guidance is tuned by `customerMaturity`:
  - `nascent`: quick wins, lower complexity.
  - `developing`: balanced portfolio.
  - `advanced`: reusable, platform-level opportunities.

## Governance notes

- External thought leadership (e.g., consulting papers) should be distilled into
  neutral principles, not copied as proprietary text.
- Provenance and lifecycle are mandatory (`draft -> reviewed -> published -> deprecated`).
- Source review and approved classes are tracked in `docs/BENCHMARK_SOURCE_REGISTRY.md`.
