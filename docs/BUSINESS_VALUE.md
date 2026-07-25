# Business Value Engine

> Post-pipeline intelligence that transforms discovered use cases into
> financially-grounded, boardroom-ready deliverables.

## Overview

The Business Value Engine runs as **Pipeline Step 9**, immediately after SQL
generation. It executes four LLM passes over the scored use cases to produce:

1. **Financial Quantification** -- dollar-range estimates per use case
2. **Roadmap Phasing** -- Quick Wins / Foundation / Transformation assignment
3. **Executive Synthesis** -- key findings, strategic recommendations, risk callouts
4. **Stakeholder Analysis** -- organizational impact mapping and champion identification

Results are persisted in Lakebase, surfaced through five dedicated UI pages,
exportable in four portfolio-level formats, and integrated into the dashboard,
run detail, Ask Forge, and per-run exports.

---

## Architecture

```
Pipeline Engine (engine.ts)
  └── runBusinessValueAnalysis(ctx)  [Step 9, ~90% progress]
        ├── Pass 1: Financial Quantification  [fast model, JSON mode]
        ├── Pass 2: Roadmap Phasing           [fast model, JSON mode]
        ├── Pass 3: Executive Synthesis       [fast model, JSON mode]
        └── Pass 4: Stakeholder Analysis      [fast model, JSON mode]
              │
              ▼
        Lakebase (7 tables)
              │
              ▼
        API Routes (/api/business-value/*, /api/export/portfolio)
              │
              ▼
        UI Pages (/business-value/*)
              │
              ▼
        Exports (Excel, PPTX, PDF, D4B Workshop Pack)
```

All four passes use `getFastServingEndpoint()` and `responseFormat: "json_object"`.
Use cases are batched (25 per request) for the financial and roadmap passes to
stay within token limits.

Financial quantification prompts include **D4B industry benchmarks** (ad-hoc
report costs, analyst time savings, BI consolidation, data quality automation,
governance audit reduction) to ground LLM estimates in real-world values.

---

## Data Model

### Lakebase Tables

| Model | Table | Purpose |
|-------|-------|---------|
| `ForgeValueEstimate` | `forge_value_estimates` | Per-use-case financial estimates (low/mid/high, type, confidence) |
| `ForgeRoadmapPhase` | `forge_roadmap_phases` | Phase assignment with effort, dependencies, enablers |
| `ForgeUseCaseTracking` | `forge_use_case_tracking` | Lifecycle stage tracking (discovered → measured) + voting data (in `notes` JSON) |
| `ForgeValueCapture` | `forge_value_captures` | Actual delivered value records |
| `ForgeStrategyDocument` | `forge_strategy_documents` | Uploaded strategy documents with parsed initiatives |
| `ForgeStrategyAlignment` | `forge_strategy_alignments` | Strategy-to-use-case alignment and gap analysis |
| `ForgeStakeholderProfile` | `forge_stakeholder_profiles` | Role/department profiles with champion flags |

The `ForgeRun` model holds `synthesisJson` (executive synthesis output) and has
relations to all seven tables. All relations cascade on delete.

### Domain Types

```
ValueType        = "cost_savings" | "revenue_uplift" | "risk_reduction" | "efficiency_gain"
ValueConfidence  = "low" | "medium" | "high"
RoadmapPhase     = "quick_wins" | "foundation" | "transformation"
EffortEstimate   = "xs" | "s" | "m" | "l" | "xl"
TrackingStage    = "discovered" | "planned" | "in_progress" | "delivered" | "measured"
StrategyGapType  = "supported" | "partial" | "blocked" | "unmatched"
```

Key interfaces: `ValueEstimate`, `RoadmapPhaseAssignment`, `UseCaseTrackingEntry`,
`ValueCaptureEntry`, `StrategyDocument`, `StrategyInitiative`,
`StrategyAlignmentEntry`, `StakeholderProfile`, `ExecutiveSynthesis`,
`BusinessValuePortfolio` (see `lib/domain/types.ts`).

### Cost Modeling

`lib/domain/cost-modeling.ts` provides:

- **T-shirt to dollar conversion** -- maps EffortEstimate (xs → xl) to FTE months
  and dollar cost ranges using `FTE_MONTHLY_COST` ($15,000/month)
- **ROI calculation** -- `calculateRoi(annualValueMid, effort)` returns net ROI
  percentage, payback period in months, and net value (mid value minus cost)
- **LOE matrix estimation** -- `estimateLOEFromModelType(modelType, mcCount)` uses
  the Master Repository 4x3 matrix (model type x data criticality) to derive
  effort directly from use case characteristics (maps to `s`/`m`/`l`)
- **Data access feasibility** -- `estimateDataAccessFeasibility(industryId, assetIds)`
  scores 0-1 based on Databricks connectivity ratings (Lakeflow, UC Federation,
  Lakebridge) for referenced data assets
- Helper labels and ordering for UI display

### Strategy Alignment

`lib/domain/strategy-alignment.ts` provides deterministic strategy alignment
using the Master Repository's strategic taxonomy:

- **`buildStrategyAlignmentMap(industryId, useCaseNames)`** -- fuzzy-matches
  pipeline use cases against Master Repository strategic imperatives and pillars
  (exact, substring, then token overlap with 40% threshold)
- **`buildStrategyAlignmentPrompt(industryId, useCaseNames)`** -- compact markdown
  summary injected into the Executive Synthesis prompt for strategy-aware findings

The Executive Synthesis pass (Pass 3) automatically includes strategy alignment
context when industry enrichment data is available.

### Master Repository Enrichment

The Master Repository (`scripts/convert-master-repo.mjs`) enriches the industry
outcome maps with structured benchmark, data asset, and strategic alignment data:

- **562 reference use cases** across 11 industries with benchmarks, model types,
  strategic imperatives, and data asset mappings (MC/VA criticality)
- **398 data assets** with Databricks connectivity scores
- Data flows through the **LLM Skills system** (`lib/skills/content/industry-enrichment.ts`)
  as 5 additional chunk extractors: benchmark context, model type guidance,
  strategic alignment, data asset requirements, and LOE patterns
- Embedded into **pgvector** as `industry_benchmark` and `industry_data_asset`
  entity kinds for RAG retrieval
- CLI update process: `npm run sync-master-repo -- --input path/to/xlsx`

---

## Pipeline Passes

### Pass 1: Financial Quantification

**Prompt:** `FINANCIAL_QUANTIFICATION_PROMPT`
**Persona:** Senior Management Consultant and Financial Analyst

Estimates annual financial impact per use case as a low/mid/high range in USD.
Uses calibration anchors:

- **Cost Savings** -- process automation (1-5% of operating cost), data quality (0.5-2% of revenue)
- **Revenue Uplift** -- targeting/personalization (2-8% of addressable revenue), churn reduction
- **Risk Reduction** -- fraud detection (0.5-2% of transaction value), compliance
- **Efficiency Gain** -- analyst time savings ($100-250K per FTE), faster decision cycles

D4B industry benchmarks injected into the prompt:

- Average cost per ad-hoc analyst report: $1,200--$3,500
- Analyst time saved by self-service analytics: 3--7 days per month
- BI tool consolidation savings: 15--30% of licensing costs
- Data quality automation: 40--60% error reduction
- Governance audit reduction: 50--70% with lineage/cataloguing

Estimates are scaled by data estate size, industry, feasibility score, and table
complexity. Conservative by design: low estimate is achievable with poor execution,
high represents ideal execution.

### Pass 2: Roadmap Phasing

**Prompt:** `ROADMAP_PHASING_PROMPT`
**Persona:** Chief Delivery Officer

Assigns each use case to a delivery phase:

| Phase | Timeframe | Criteria |
|-------|-----------|----------|
| Quick Wins | 0-3 months | Feasibility >= 0.7, proven patterns, data readily available |
| Foundation | 3-9 months | Requires data engineering, gold tables, quality improvements |
| Transformation | 9-18 months | ML models, real-time systems, cross-domain analytics |

Includes effort estimates (xs through xl), dependency chains between use cases,
and enabler descriptions.

### Pass 3: Executive Synthesis

**Prompt:** `EXECUTIVE_SYNTHESIS_PROMPT`
**Persona:** Senior Partner at a top-tier management consulting firm

Produces a board-ready briefing:

- **3-5 Key Findings** -- specific to the business, mixing opportunities and risks
- **3-5 Strategic Recommendations** -- concrete actions with expected outcomes
- **2-3 Risk Callouts** -- specific risks with evidence and impact

Stored as `synthesisJson` on the `ForgeRun` record.

### Pass 4: Stakeholder Analysis

**Prompt:** `STAKEHOLDER_ANALYSIS_PROMPT`
**Persona:** Organizational Change Management Consultant

Maps beneficiary and sponsor fields from use cases into structured profiles:
role, department, use case count, domains, type distribution, change complexity,
champion/sponsor flags.

---

## UI Pages

All pages use `PageHeader`, `mx-auto max-w-[1400px] space-y-8` container,
and the established shadcn/ui component patterns.

### `/business-value` -- Portfolio Overview

Server component with `<Suspense>` boundary. Aggregates data across all runs via
`getPortfolioData()`.

- Key Findings banner (from latest synthesis)
- Value Hero Cards: Total Estimated Value, Quick Wins, Delivered Value, Use Case count
- **Portfolio Velocity Metrics**: conversion funnel (Discovered → Measured),
  conversion rate, realization rate (delivered/estimated), in-pipeline count
- Strategic Themes: top domains by value
- Phase Distribution: Quick Wins / Foundation / Transformation counts
- Domain Heatmap: table with score, feasibility, use case count, value per domain
- **Interactive Drill-Down**: expandable domain cards with per-use-case tables
  including scores, feasibility, effort, estimated value, and **vote buttons**
- **Export Button** (dropdown): Portfolio Excel, Portfolio PPTX, Executive PDF,
  D4B Workshop Pack

### `/business-value/roadmap` -- Implementation Roadmap

Server component. Shows phase-level summary with a Recharts `BarChart`
(`DeliveryTimelineChart`) for visual delivery timeline. Interactive drill-down
by phase with effort and dependency details.

### `/business-value/strategy` -- Strategy Alignment

Client component. Upload strategy documents (plain text), which are parsed into
initiatives via LLM (`PARSE_OUTCOME_MAP`). View alignment against discovered
use cases with gap status badges (Supported / Partial / Blocked / Not Assessed).
Supports delete with confirmation dialog.

### `/business-value/stakeholders` -- Stakeholder Intelligence

Server component. Displays recommended champions, department summary cards,
full stakeholder table (role, department, use cases, domains, types, change
complexity, champion/sponsor flags), and skills assessment (aggregate type
distribution). Interactive drill-down by stakeholder with linked use cases.

### `/business-value/tracking` -- Value Tracking

Client component. Lifecycle tracking from discovery to measured value:

- Scorecard: Discovered / Planned + In Progress / Delivered / Measured counts
- Stage Pipeline: visual bar showing distribution across stages
- Tracking Table with:
  - Stage dropdown (PATCH to update)
  - **Inline owner editing** (pencil icon → input → save/cancel)
  - **Stalled indicators**: amber highlight and "Stalled (Xd)" badge for use cases
    with no stage change in 14+ days
  - **Status column**: days since last update, "Today" label for recent changes
- **Stalled alert banner**: count of stalled use cases with unblock guidance
- **Value Capture dialog**: record actual delivered value against a use case

---

## Exports

### Per-Run Exports

Per-run PPTX export (`lib/export/pptx.ts`) conditionally includes synthesis
slides when Business Value data is available:

- Key Findings slide (numbered list)
- Strategic Recommendations slide (numbered list)
- Risk Callouts slide (titled + body)
- Value Summary KPI slide (total value, quick wins value, quick wins count, phases)

Backward-compatible: the `synthesis` parameter is optional.

Per-run Excel export includes a "Business Value" sheet and "Stakeholders" sheet.

### Portfolio Exports

Served from `GET /api/export/portfolio?format=excel|pptx|pdf|workshop`.

| Format | Generator | Description |
|--------|-----------|-------------|
| `excel` | `lib/export/portfolio-excel.ts` | 8-sheet workbook (Executive Summary, Key Findings, Recommendations, Risk Callouts, Domain Performance, Delivery Pipeline, Use Cases with cost modeling/ROI, Stakeholders) |
| `pptx` | `lib/export/portfolio-pptx.ts` | 8-slide Databricks-branded deck (Title, Value Summary KPIs, Findings, Recommendations, Risks, Pipeline, Domains, Stakeholders) |
| `pdf` | `lib/export/executive-pdf.ts` | 2-page executive brief (Page 1: KPIs + findings + recommendations; Page 2: pipeline + domain heatmap + risks) |
| `workshop` | `lib/export/workshop-pptx.ts` | D4B Workshop Pack (5 sections: Case for Change with D4B stats, Executive Findings, Delivery Roadmap, Recommended Genie Spaces, Workshop Agenda) |

### Shared Export Infrastructure

- `lib/export/brand.ts` -- centralised Databricks brand constants (`BRAND`, `PPTX`, `EXCEL`, `PDF` palettes) and utilities (`today()`, `formatCompactCurrency()`, `scoreColor()`)
- `lib/export/excel-helpers.ts` -- reusable ExcelJS utilities (`thinBorder`, `styleHeaderRow`, `styleDataRows`, `styleScoreCell`)
- `lib/export/pptx-helpers.ts` -- reusable pptxgenjs utilities (`getLogoBase64`, `addFooter`, `addAccentBar`, `addRedSeparator`, `addBrandShapes`, `addTitleSlide`, `addSectionSlide`, `headerCell`, `bodyCell`)

---

## Use Case Voting

Workshop-style prioritisation feature allowing users to vote on use cases:

- `POST /api/business-value/vote` -- cast or toggle a vote (stores in `notes` JSON of `ForgeUseCaseTracking`, no schema changes)
- `GET /api/business-value/vote?runId=` -- retrieve vote counts per use case
- `VoteButton` component (compact and full variants) rendered in Portfolio Drill-Down table
- Voter identity based on current user email; each user can vote once per use case

---

## API Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/business-value/portfolio` | Aggregated portfolio data |
| `GET` | `/api/business-value/tracking` | All tracking entries + stage counts |
| `PATCH` | `/api/business-value/tracking` | Update use case stage, owner, or notes |
| `GET` | `/api/business-value/value-capture` | List value captures with use case names |
| `POST` | `/api/business-value/value-capture` | Record actual delivered value |
| `DELETE` | `/api/business-value/value-capture` | Delete a value capture record |
| `GET` | `/api/business-value/strategy` | List strategy documents |
| `POST` | `/api/business-value/strategy` | Create + LLM-parse strategy document |
| `DELETE` | `/api/business-value/strategy?id=` | Delete strategy document |
| `GET` | `/api/business-value/strategy/[id]` | Strategy doc with alignments |
| `GET` | `/api/business-value/vote?runId=` | Vote counts per use case |
| `POST` | `/api/business-value/vote` | Cast or toggle a vote |
| `GET` | `/api/export/portfolio?format=` | Portfolio export (excel, pptx, pdf, workshop) |
| `GET` | `/api/runs/[runId]/business-value` | Full business value data for a run |

---

## Integration Points

### Dashboard

`BusinessValueSummary` component (client, fetches from portfolio API on mount)
shows Total Estimated Value and Implementation Progress cards, linking into the
business value pages.

### Run Detail

`BusinessValueTab` in `run-completed-tabs.tsx` renders per-run value summary,
executive synthesis (findings/recommendations/risks), value by category, and
roadmap phase distribution.

### Ask Forge

- `strategic` intent added to intent classification (heuristic + LLM)
- `strategic` persona overlay for CDO/CFO/Board-level audience
- Action cards: View Portfolio, Generate Business Case, View Stakeholders,
  View Roadmap, Draft Executive Memo

### Run PPTX Export

The per-run PPTX export (`lib/export/pptx.ts`) conditionally includes synthesis
slides (Key Findings, Strategic Recommendations, Risk Callouts, Value Summary)
when `synthesisJson` is present on the run record.

---

## File Map

```
lib/
  ai/
    templates-business-value.ts      4 prompt templates (includes D4B benchmarks)
    templates.ts                     Registers prompts in central registry
    agent.ts                         Default temperatures for BV prompts
  pipeline/
    steps/
      business-value-analysis.ts     Step 9 orchestrator (4 LLM passes)
    engine.ts                        Integrates step 8 into pipeline
  lakebase/
    value-estimates.ts               CRUD for ForgeValueEstimate
    roadmap-phases.ts                CRUD for ForgeRoadmapPhase
    use-case-tracking.ts             CRUD for ForgeUseCaseTracking
    value-captures.ts                CRUD for ForgeValueCapture
    strategy-documents.ts            CRUD for ForgeStrategyDocument + Alignment
    stakeholder-profiles.ts          CRUD for ForgeStakeholderProfile
    portfolio.ts                     Cross-run portfolio aggregation (+ latestRunId)
  domain/
    types.ts                         ValueEstimate, RoadmapPhase, etc.
    cost-modeling.ts                 T-shirt sizing, ROI, LOE matrix, data access feasibility
    strategy-alignment.ts            Deterministic strategy alignment from Master Repository
    industry-outcomes/
      master-repo-types.ts           MasterRepoUseCase, ReferenceDataAsset types
      master-repo-registry.ts        Enrichment data lookup by industry ID
      *.enrichment.ts                Auto-generated enrichment modules (11 industries)
  export/
    brand.ts                         Centralised brand constants (BRAND, PPTX, EXCEL, PDF)
    excel-helpers.ts                 Shared ExcelJS styling utilities
    pptx-helpers.ts                  Shared pptxgenjs slide helpers
    portfolio-excel.ts               8-sheet portfolio Excel generator
    portfolio-pptx.ts                8-slide portfolio PPTX generator
    executive-pdf.ts                 2-page executive PDF brief
    workshop-pptx.ts                 D4B Workshop Pack PPTX generator
    pptx.ts                          Per-run PPTX (now with optional synthesis slides)
    excel.ts                         Per-run Excel (Business Value + Stakeholders sheets)
  assistant/
    intent.ts                        "strategic" intent
    prompts.ts                       "strategic" persona overlay
    engine.ts                        Strategic action cards

app/
  business-value/
    page.tsx                         Portfolio overview (+ velocity metrics, export button)
    roadmap/page.tsx                 Roadmap page (+ drill-down)
    strategy/page.tsx                Strategy alignment
    stakeholders/page.tsx            Stakeholder intelligence (+ drill-down)
    tracking/page.tsx                Value tracking (+ inline edit, stalled, voting)
  api/
    business-value/
      portfolio/route.ts             GET portfolio
      tracking/route.ts              GET/PATCH tracking (stage, owner, notes)
      value-capture/route.ts         GET/POST/DELETE value capture
      vote/route.ts                  GET/POST use case voting
      strategy/route.ts              GET/POST/DELETE strategy docs
      strategy/[id]/route.ts         GET strategy with alignments
    export/
      portfolio/route.ts             GET portfolio exports (4 formats)
    runs/[runId]/
      business-value/route.ts        GET per-run business value

components/
  business-value/
    delivery-timeline-chart.tsx      Recharts BarChart for roadmap
    portfolio-drill-down.tsx         Expandable domain cards with vote buttons
    portfolio-export-button.tsx      4-format dropdown export button
    value-capture-dialog.tsx         Record actual delivered value
    vote-button.tsx                  Use case voting (compact + full variants)
  pipeline/
    run-detail/
      business-value-tab.tsx         Run detail BV tab
    sidebar-nav.tsx                  Business Value nav section
  dashboard/
    dashboard-content.tsx            BusinessValueSummary widget

__tests__/
  domain/
    cost-modeling.test.ts            Unit tests for cost modeling + LOE matrix + feasibility
    benchmarks.test.ts               Benchmark pack validation (baseline + master-repo)
  export/
    brand.test.ts                    Unit tests for brand constants

scripts/
  convert-master-repo.mjs            XLSX → TypeScript/JSON conversion for Master Repository
  seed-benchmarks.mjs                Seed benchmark records to Lakebase (includes master-repo packs)

data/
  benchmark/
    *-baseline.json                  Curated baseline benchmark packs
    *-master.json                    Master Repository benchmark packs (auto-generated)

prisma/
  schema.prisma                      7 new models (see Data Model above)
```

---

## Configuration

No additional configuration is required. The Business Value Engine uses the same
model serving endpoints as the rest of the pipeline:

- `serving-endpoint-fast` for all 4 LLM passes (falls back to premium if unset)
- All passes use `temperature: 0.2` except Executive Synthesis (`0.4`)
- Batch size: 25 use cases per LLM request (financial quantification and roadmap)

The engine runs automatically when a pipeline completes scoring. It can be
skipped if no use cases are generated (early exit with log message).
