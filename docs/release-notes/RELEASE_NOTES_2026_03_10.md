# Release Notes -- 2026-03-10

**Databricks Forge v0.22.0**

---

## New Features

### Master Repository Integration
Integrated the Master Repository -- a comprehensive multi-industry reference library of 562 use cases and 398 data assets across 11 industries -- into the LLM Skills system. Use case generation, scoring, executive synthesis, and Ask Forge RAG are now enriched with industry-sourced benchmarks (McKinsey, BCG, Gartner), model type guidance, strategic alignment taxonomy, data asset requirements, and LOE patterns.

### LOE Matrix Cost Modeling
New `estimateLOEFromModelType(modelType, mcCount)` function in `lib/domain/cost-modeling.ts` uses the Master Repository 4x3 matrix (model type x data criticality) to derive effort estimates directly from use case characteristics. Supports alias resolution for flexible model type strings.

### Data Access Feasibility Scoring
New `estimateDataAccessFeasibility(industryId, assetIds)` function scores data access feasibility (0-1) based on Databricks connectivity ratings (Lakeflow Connect, UC Federation, Lakebridge Migrate) for referenced data assets.

### Strategy Alignment Engine
New `lib/domain/strategy-alignment.ts` provides deterministic strategic alignment by matching pipeline use cases against the Master Repository's strategic imperatives and pillars using fuzzy name matching. Results are automatically injected into the Executive Synthesis prompt for strategy-aware findings and recommendations.

### Conversion CLI
New `npm run sync-master-repo -- --input path/to/xlsx` command converts the Master Repository XLSX into structured TypeScript enrichment modules and benchmark JSON packs. Developer-centric workflow: convert, review diff, test, commit.

### Portfolio Export Infrastructure
Four new export formats available from a dropdown on the Business Value Portfolio page:
- **Portfolio Excel** -- 8-sheet workbook with Executive Summary, Key Findings, Recommendations, Risk Callouts, Domain Performance, Delivery Pipeline, Use Cases (with cost modeling and ROI columns), and Stakeholders.
- **Portfolio PPTX** -- 8-slide Databricks-branded deck with KPI boxes, findings, recommendations, risks, pipeline, domains, and stakeholders.
- **Executive PDF Brief** -- 2-page one-pager for senior stakeholders with value summary, key findings, recommendations, domain heatmap, and risk callouts.
- **D4B Workshop Pack PPTX** -- 5-section deck for Databricks-for-Business workshop facilitation: Case for Change (D4B statistics), Executive Findings, Delivery Roadmap with quick wins, Recommended Genie Spaces, and Workshop Agenda.

### Run PPTX Synthesis Slides
Per-run PPTX exports now include Key Findings, Strategic Recommendations, Risk Callouts, and Value Summary slides when Business Value data is available.

### Use Case Voting
Workshop-style voting/prioritisation on use cases via compact vote buttons in the Portfolio Drill-Down table.

### Value Capture Form
New Value Capture dialog component for recording actual delivered value against use cases.

### Portfolio Velocity Metrics
Conversion funnel on the Portfolio page showing discovery-to-delivery pipeline with conversion and realization rates.

### Implementation Cost Modeling
T-shirt sizing to dollar estimate conversion, net ROI calculations, and payback period estimates. Integrated into Portfolio Excel export.

### D4B Industry Benchmarks
Financial quantification prompts now include Databricks-for-Business industry benchmarks for grounded LLM estimates.

### Business Value Drill-Down Components
Portfolio, Roadmap, and Stakeholder Intelligence pages now feature interactive drill-down sections.

### Redesigned Executive Dashboard Surfaces
All Business Value pages redesigned with a consistent KPI card system.

---

## Improvements

### Industry Skills Enrichment
The `industry-enrichment.ts` skill now produces 9 chunk extractors (up from 4): KPIs, data entities, personas, business value, plus 5 new Master Repository extractors for benchmarks, model types, strategic alignment, data asset requirements, and LOE patterns.

### RAG Vector Embeddings
Two new pgvector entity kinds (`industry_benchmark`, `industry_data_asset`) enable semantic search over Master Repository benchmarks and data assets in Ask Forge and other RAG consumers.

### Prompt Enhancement
`buildReferenceUseCasesPrompt()` now appends benchmark impact, model type, and strategic imperative tags to each reference use case. `buildIndustryKPIsPrompt()` includes benchmark calibration data from the Master Repository.

### Benchmark Seeding
`seed-benchmarks.mjs` URL allowlist expanded to include BCG, Gartner, Accenture, Bain, and other Master Repository publishers. Master Repository benchmark packs (`*-master.json`) use the full seed schema.

### Tracking Page Enhancements
Inline owner editing, stalled indicators, status column, and stalled alert banner.

### Shared Export Branding
Centralised brand constants and shared styling utilities for all export formats.

### Pipeline Progress Granularity
Business Value Analysis reports granular progress for each sub-step.

---

## Bug Fixes
- **Executive Synthesis TypeError** -- Fixed crash caused by snake_case/camelCase mismatch.
- **Sidebar Multi-Highlight** -- Uses exact match for parent items.
- **Value Tracking timeStyle Crash** -- Changed `toLocaleDateString()` to `toLocaleString()`.
- **Tailwind JIT Dynamic Classes** -- Replaced dynamically constructed class names with literals.

---

## Other Changes
- 11 auto-generated industry enrichment modules (banking, insurance, HLS, RCG, manufacturing, energy-utilities, communications, media-advertising, digital-natives, games, sports-betting)
- 11 Master Repository benchmark JSON packs with sourced KPI/impact data
- 13 new unit tests for LOE matrix and data access feasibility (594 total tests)
- Updated `BUSINESS_VALUE.md` documentation with Master Repository integration details
- Updated benchmark test suite to validate both baseline and master-repo pack formats

---

## Commits (6)

| Hash | Summary |
|---|---|
| `579aaa1` | Merge pull request #96 from althrussell/feat/bv-exports-tracking-d4b |
| `c4e97a5` | Update release notes and BUSINESS_VALUE.md for v0.21.0 mega PR |
| `18a809d` | Add portfolio exports, D4B workshop pack, value tracking enhancements, and use case voting |
| `bee489c` | Merge pull request #95 from althrussell/fix/bv-progress-and-bugs |
| `ff12a25` | Bump version to 0.21.0 and update release notes |
| `49e1e99` | Fix BV pipeline progress, exec synthesis crash, and enhance Business Value UX |

**Uncommitted changes:** Master Repository integration (enrichment modules, types, skills, cost modeling, strategy alignment, conversion script, benchmark packs, tests, documentation).
