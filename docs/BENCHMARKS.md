# Benchmarks -- Current State

> Feature status: **behind feature flag** (`FORGE_BENCHMARKS_ENABLED` env var +
> `benchmarksEnabled` client setting). Both must be enabled for full functionality.

## Purpose

The benchmark catalog stores public-source industry KPIs, advisory themes,
benchmark principles, and platform best practices. When enabled, benchmark
records are embedded into the vector store and injected into pipeline prompts
(business-context, use-case generation, scoring) to ground LLM output in
real-world industry data.

## Architecture

```
seed-benchmarks.mjs          JSON packs (data/benchmark/*.json)
        │                            │
        └──► forge_benchmark_records ◄┘
                     │
        ┌────────────┼────────────────────┐
        ▼            ▼                    ▼
  Embed pipeline   DB fallback        RAG retrieval
  (embed-pipeline) (benchmark-context) (context-builder)
        │                                  │
        ▼                                  ▼
  forge_embeddings            Ask Forge assistant
  (benchmark_context)         (business intent)
        │
        ▼
  Pipeline prompts
  (business-context, usecase-gen, scoring)
```

## Data Model

- **Prisma model**: `ForgeBenchmarkRecord` in `prisma/schema.prisma`
- **Lakebase table**: `forge_benchmark_records`
- **Embedding kind**: `benchmark_context`
- **Search scope**: `benchmarks` (includes `benchmark_context` + `outcome_map`)

### Record kinds

| Kind | Description |
|------|-------------|
| `kpi` | Measurable industry KPI (e.g. gross margin, stockout rate) |
| `benchmark_principle` | Advisory principle from industry research |
| `advisory_theme` | Consulting guidance theme |
| `platform_best_practice` | Data platform implementation guidance |

### Lifecycle states

`draft` -> `reviewed` -> `published` -> `deprecated`

Only `published` records are embedded and used in pipeline prompts.

## Known Issues

1. **Source fetcher blocked by bot protection** -- McKinsey, HBR, BCG, Gartner,
   Forrester, and other publisher sites block server-side HTTP fetches
   (Cloudflare, JS-only rendering). A blocked-domain allowlist skips these
   instantly, but most high-value sources require manual paste.

2. **Summary-only embedding** -- When source fetch fails, only the hand-written
   summary is embedded (typically 1 chunk). This provides minimal RAG context
   compared to full article content.

3. **No JS rendering** -- The source fetcher uses plain `fetch()` with regex
   HTML cleanup + Turndown. Pages that require JavaScript execution return
   empty or minimal content.

4. **TTL not enforced at query time** -- `ttlDays` is stored but not checked
   during RAG retrieval or prompt injection. Outdated benchmarks are still
   returned.

5. **No provenance tracking in prompts** -- Benchmark context is injected as
   plain text without citation markers. The LLM cannot attribute specific
   claims to specific sources.

## Feature Flag

- **Server-side**: `FORGE_BENCHMARKS_ENABLED=true` env var, checked by
  `isBenchmarksEnabled()` in `lib/benchmarks/config.ts`
- **Client-side**: `benchmarksEnabled` in `AppSettings` (localStorage),
  defaults to `false`

When disabled:
- Sidebar nav item is hidden
- `/benchmarks` page shows a disabled state
- API routes return 404
- Pipeline prompts use the hardcoded `DEFAULT_PACK` (generic advisory context)
- RAG retrieval skips the `benchmarks` scope
- Embedding backfill skips benchmark records

## File Inventory

| File | Role |
|------|------|
| `data/benchmark/*.json` | Seed data packs per industry |
| `scripts/seed-benchmarks.mjs` | Seed script (reads JSON, upserts to Lakebase) |
| `lib/benchmarks/config.ts` | Feature flag (`isBenchmarksEnabled()`) |
| `lib/benchmarks/admin-guard.ts` | Admin email gating (`FORGE_BENCHMARK_ADMINS`) |
| `lib/benchmarks/source-fetcher.ts` | URL fetch + HTML-to-markdown conversion |
| `lib/lakebase/benchmarks.ts` | CRUD for `ForgeBenchmarkRecord` |
| `lib/domain/benchmarks.ts` | Domain types and constants |
| `lib/domain/benchmark-context.ts` | Prompt context builder (RAG + DB + default) |
| `lib/embeddings/embed-pipeline.ts` | `embedBenchmarkRecords()` |
| `lib/embeddings/compose.ts` | `composeBenchmarkContext()`, `composeBenchmarkSourceChunk()` |
| `lib/embeddings/types.ts` | `benchmark_context` kind, `benchmarks` scope |
| `lib/assistant/context-builder.ts` | RAG retrieval for `business` intent |
| `app/benchmarks/page.tsx` | Admin UI page |
| `app/api/benchmarks/route.ts` | GET (list) + POST (create) |
| `app/api/benchmarks/[benchmarkId]/route.ts` | PATCH (lifecycle/source) + DELETE |
| `app/api/benchmarks/[benchmarkId]/fetch-source/route.ts` | POST (fetch URL) |
| `app/api/embeddings/backfill/route.ts` | `backfillBenchmarks()` |
| `components/pipeline/sidebar-nav.tsx` | Nav item |
| `components/header-title.tsx` | Page title mapping |
| `lib/validation.ts` | `CreateBenchmarkSchema`, `UpdateBenchmarkSchema` |
| `prisma/schema.prisma` | `ForgeBenchmarkRecord` model |
