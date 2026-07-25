# Architecture

## Overview

Databricks Forge follows a **ports-and-adapters** architecture. The web app
is a Next.js 16 App Router application deployed as a Databricks App. All
Databricks interactions go through a thin adapter layer (`lib/dbx/`), keeping
business logic independent of transport details.

```
┌─────────────────────────────────────────────────────────┐
│  Next.js App (Databricks App)                           │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ app/     │  │ components/  │  │ lib/             │  │
│  │ (routes) │──│ (UI)         │──│ (business logic) │  │
│  └──────────┘  └──────────────┘  └────────┬─────────┘  │
│                                           │             │
│  ┌────────────────────────────────────────┘             │
│  │                                                      │
│  │  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐  │
│  │  │ lib/dbx │ │ lib/ai   │ │lib/    │ │lib/      │  │
│  │  │ (SQL)   │ │ (prompts)│ │pipeline│ │export    │  │
│  │  └────┬────┘ └────┬─────┘ └───┬────┘ └────┬─────┘  │
│  │       │           │           │            │         │
└──┼───────┼───────────┼───────────┼────────────┼─────────┘
   │       │           │           │            │
   ▼       ▼           ▼           ▼            ▼
┌──────┐ ┌──────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│SQL   │ │Model │ │Unity     │ │Lakebase│ │Workspace │
│W/H   │ │Serve │ │Catalog   │ │Tables  │ │API       │
└──────┘ └──────┘ └──────────┘ └────────┘ └──────────┘
```

## Layer Responsibilities

### `/lib/dbx/` -- Databricks Adapter

- `client.ts` -- initialises the Databricks SDK from env vars, auth token management
- `sql.ts` -- executes SQL via Statement Execution API, polls for results,
  maps rows to typed objects
- `model-serving.ts` -- Model Serving REST client (chat completions, streaming)
- `workspace.ts` -- creates/imports notebooks via Workspace REST API

### `/lib/queries/` -- SQL Text + Mappers

All SQL statements live here as tagged template literals. Each query module
exports:

1. The SQL string (parameterised)
2. A mapper function that converts raw rows to domain types

No raw SQL appears anywhere else in the codebase.

### `/lib/domain/` -- Types + Scoring

- `types.ts` -- all shared TypeScript interfaces (`PipelineRun`, `UseCase`, etc.)
- `scoring.ts` -- use case scoring and ranking logic

### `/lib/ai/` -- Prompt Building + Execution

- `templates.ts` -- all prompt templates (ported from the notebook)
- `functions.ts` -- AI_FUNCTIONS and STATISTICAL_FUNCTIONS registries
- `agent.ts` -- wrapper that invokes Model Serving via `lib/dbx/model-serving.ts`
  (chat completions API), parses LLM responses (JSON), handles retries and
  token usage tracking. Supports JSON mode and streaming.

### `/lib/pipeline/` -- Pipeline Engine

- `engine.ts` -- step orchestrator (runs steps in order, updates Lakebase progress)
- `steps/*.ts` -- individual pipeline step modules

### `/lib/lakebase/` -- Persistence

- `schema.ts` -- DDL for Lakebase tables + migration helper
- `runs.ts` -- CRUD for `forge_runs`
- `usecases.ts` -- CRUD for `forge_use_cases`
- `genie-recommendations.ts` -- CRUD for Genie Space recommendations
- `genie-engine-config.ts` -- Versioned Genie Engine config
- `genie-spaces.ts` -- Deployed Genie Space tracking
- `environment-scans.ts` -- Estate scan persistence + aggregate view
- `activity-log.ts`, `prompt-logs.ts`, `exports.ts`, `metadata-cache.ts`, `outcome-maps.ts`

### `/lib/export/` -- Output Generation

- `excel.ts` -- styled Excel workbook via exceljs
- `pdf.ts` -- PDF catalog via @react-pdf/renderer
- `pptx.ts` -- PowerPoint deck via pptxgenjs
- `notebooks.ts` -- SQL notebook generation + Workspace API deployment

## Lakebase Schema

15 tables in Lakebase managed by Prisma (see `prisma/schema.prisma` for full definitions):

| Table | Purpose |
| --- | --- |
| `forge_runs` | Pipeline execution records (config, status, progress, business context) |
| `forge_use_cases` | Generated use cases (scores, domain, SQL, tables involved) |
| `forge_metadata_cache` | Cached UC metadata snapshots |
| `forge_exports` | Export history (format, path, timestamp) |
| `forge_prompt_logs` | LLM prompt/response audit trail |
| `forge_activity_log` | User activity feed |
| `forge_outcome_maps` | Industry outcome map definitions |
| `forge_genie_recommendations` | Generated Genie Space recommendations per domain |
| `forge_genie_engine_configs` | Genie Engine config versions per run |
| `forge_genie_spaces` | Tracked deployed Genie Spaces |
| `forge_environment_scans` | Estate scan records (scope, counts, aggregate scores) |
| `forge_table_details` | Per-table metadata + LLM enrichments from estate scans |
| `forge_table_history_summaries` | Delta table history insights |
| `forge_table_lineage` | Data lineage edges |
| `forge_table_insights` | Health scores, issues, and recommendations per table |

## Data Flow

1. User submits configuration via `/configure` page
2. API route creates a `PipelineRun` record in Lakebase (status=pending)
3. Execute endpoint starts the pipeline engine asynchronously
4. Engine runs 8 steps, each updating progress in Lakebase
5. Frontend polls `/api/runs/[runId]` every 3 seconds for status
6. On completion, use cases are persisted in `forge_use_cases`
7. User views results and triggers exports from the run detail page

## Auth Model

| Environment    | Auth Method                                         |
| -------------- | --------------------------------------------------- |
| Databricks App | Auto-injected `DATABRICKS_CLIENT_ID/SECRET` (OAuth) |
| Local Dev      | `DATABRICKS_TOKEN` (PAT) in `.env.local`            |

The app never exposes credentials to the frontend. All Databricks calls happen
server-side in API routes.
