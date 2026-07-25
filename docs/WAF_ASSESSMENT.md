# WAF Assessment Engine

> Self-service Databricks Well-Architected Framework assessment with deterministic SQL over `system.*` and per-pillar scoring.

## Overview

The WAF Assessment Engine evaluates a Databricks workspace against the
[Databricks Well-Architected Framework](https://docs.databricks.com/aws/en/lakehouse-architecture/)
(7 pillars). It runs deterministic SQL queries over `system.*` (lineage, audit,
billing, compute, information_schema) on behalf of the logged-in user (OBO),
joins the rows to a curated controls catalog, and produces:

1. **Per-pillar scores** -- one score per pillar (`controls met / controls in pillar * 100`)
2. **Overall score** -- average of available pillar scores (skips pillars with
   no controls or query failures)
3. **Per-control drill-down** -- principle, best practice, threshold, score,
   recommendation, and a "Fix with Forge" deep-link
4. **History + drift comparison** -- every run persisted in Lakebase,
   `from vs. to` diff highlighting regressions and improvements

The engine is **always enabled** -- the page lives at `/assessment` and the
catalog is seeded on first boot from a bundled CSV.

---

## Pillars

The catalog covers all 7 Databricks WAF pillars. Each pillar has a
deterministic SQL query that scores a curated subset of its controls; the
remaining controls in each pillar are either catalog-only (no automatic
signal yet) or qualitative (scored from `forge_waf_qualitative_responses`).

| Pillar key | Display name | Evaluation today |
|------------|--------------|------------------|
| `governance` | Data and AI Governance | Automatic (SQL) |
| `interoperability_usability` | Interoperability and Usability | Automatic (SQL, subset) |
| `operational_excellence` | Operational Excellence | Automatic (SQL, subset) + qualitative |
| `security_compliance_privacy` | Security, Compliance and Privacy | Automatic (SQL, subset) + qualitative |
| `reliability` | Reliability | Automatic (SQL) + qualitative |
| `performance_efficiency` | Performance Efficiency | Automatic (SQL) |
| `cost_optimisation` | Cost Optimisation | Automatic (SQL) |

The pillars with SQL queries are exported as `WAF_PILLARS_WITH_QUERIES` in
`lib/engines/waf-assessment/types.ts` and drive the engine loop. The IU / OE /
SCP queries cover a curated set of high-signal controls (4-5 each); other
controls in those pillars stay catalog-only.

---

## Architecture

```
runAssessment()
    │
    │ 1. ensureCatalogSeeded() -- upsert bundled CSV into forge_waf_controls
    │
    │ 2. Insert ForgeWafAssessment row (status=running)
    │
    ▼
runAllPillars() -- Promise.allSettled over WAF_PILLARS_WITH_QUERIES
    │
    │   ┌──────────────┬─────────┬─────────┬─────────┬───────┬────────┬────────────┐
    │   │ governance   │ IU      │ OE      │ SCP     │ rel.  │ cost   │ perf       │
    │   └──────────────┴─────────┴─────────┴─────────┴───────┴────────┴────────────┘
    │              ▼  executeSQL() against the user's SQL Warehouse (OBO)
    │
    │   WafControlResult[]  (waf_id, pillar, score, threshold, threshold_met)
    │
    ▼
Score aggregation
    │   pillarScore = round((met / total) * 100, 1)
    │   overallScore = avg of available pillar scores
    │
    ▼
Persist
    │   ForgeWafControlResult.createMany() -- per-control rows
    │   ForgeWafAssessment.update() -- status=completed + scores + counts
    │
    ▼
WafAssessmentSummary returned to the API
```

A failure in any single pillar query is captured as `{ pillar, message }` in
the `errors[]` array and surfaced in `errorMessage`; the other pillars still
produce results and the assessment is marked `completed` with whatever pillars
returned. Only when **all** pillars fail is the assessment marked `failed`.

---

## Engine Flow

### Phase 1: Catalog seed

`ensureCatalogSeeded()` in `lib/engines/waf-assessment/catalog.ts`:

1. Reads `lib/engines/waf-assessment/data/waf-controls-catalog.csv`
2. Maps each row to a `WafControl` (pillar key derived from `pillar_name`)
3. Attaches the `FIX_ACTIONS` map for the "Fix with Forge" UI shortcut
4. Upserts into `ForgeWafControl` (idempotent — runs every assessment)

### Phase 2: Pillar queries

`runPillar(pillar)` in `lib/engines/waf-assessment/engine.ts` loads the
corresponding SQL file from `lib/engines/waf-assessment/queries/`, executes it
via `executeSQL()`, and maps each row to a `WafControlResult`. Each query must
return columns:

```
waf_id, score_percentage, threshold_percentage, threshold_met
```

`threshold_met` is a string — `met` becomes `true`, anything else becomes
`false`.

`runAllPillars()` runs all 7 SQL pillars in parallel via
`Promise.allSettled`, so one failing query does not block the others.

### Phase 3: Aggregate + persist

`runAssessment()` in `lib/engines/waf-assessment/service.ts`:

1. Filters results to `wafId`s present in the catalog (avoids FK violations
   if a query returns an unknown id)
2. `createMany()` per-control results in `ForgeWafControlResult`
3. Computes per-pillar scores via `pillarScore(totals, pillar)` --
   `Math.round((met / total) * 1000) / 10`
4. `overallScore` is the rounded average of available pillar scores
5. Updates the assessment header with status + scores + counts + timestamps

---

## Catalog

The bundled catalog (`waf-controls-catalog.csv`, 166 rows) is the source of
truth for control metadata. It currently includes:

- **151 BPs** from the official Databricks WAF spreadsheet (CombinedList) —
  Databricks-style codes (e.g. `DG-01-03`, `R-02-04`, `CO-01-09`) that map
  cleanly to the AWS / Azure WAF references.
- **15 EX extensions** (`<PILLAR>-EX<NN>-<NN>` format, e.g. `SCP-EX01-01`)
  covering modern controls not yet in the official spreadsheet: Automatic
  Identity Management, encryption-in-transit, data classification, idle
  decommissioning, criticality tiering, SDLC, FinOps, ops standardization,
  FMA, and DR drills.

### CSV schema (11 columns)

| Column | Notes |
|--------|-------|
| `waf_id` | Stable identifier (`DG-01-01`, `SCP-EX01-01`, ...) — primary key |
| `pillar_name` | Verbatim from the catalog (e.g. `01 - Data And AI Governance`) — mapped to a pillar key by `pillarKeyFromName()` |
| `principle` | Higher-level grouping inside the pillar |
| `best_practice` | Short title shown in the UI |
| `capabilities` | Free-text capabilities note |
| `details` | Long description shown in the drill-down |
| `query_table_name` | Hint for which `system.*` table the SQL touches |
| `threshold_percentage` | Pass threshold — `null` for qualitative controls |
| `metric_definition` | Free-text formula / metric definition |
| `recommendation_if_not_met` | Recommendation surfaced when the control fails |
| `evaluation_type` | `automatic` or `qualitative` (160 + 6 today) |

### Evaluation type

- `automatic` — score comes from a SQL query; the result is compared against
  `threshold_percentage` to derive `threshold_met`.
- `qualitative` — score comes from a `yes` (100) / `partial` (50) / `no` (0) /
  `not_applicable` (excluded) questionnaire response stored in
  `forge_waf_qualitative_responses`. The threshold is hardcoded at 100 (must
  answer "yes" to count as met). Saved responses are workspace-level and reused
  across every assessment run — no need to re-answer between runs.

### Fix-action map

`FIX_ACTIONS` in `catalog.ts` attaches a `fixActionEngine` + `params` per
`waf_id`. Two flavours:

- **Internal engines** (`comment-engine`, `estate-scan`, `ask-forge`) deep-link
  to a Forge surface that addresses the gap directly. Rendered with a
  "Fix with Forge" button (Wrench icon).
- **`docs`** is a fallback that links to the canonical Databricks doc when
  remediation is admin- or workload-level (Photon, autoscaling, runtimes).
  Rendered with an "Open docs" button (Book icon, new tab).

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/assessment` | GET | Latest assessment (with control results) + history list + qualitative controls + saved responses |
| `/api/assessment/run` | POST | Trigger a full assessment run, persist results, return the summary |
| `/api/assessment/[assessmentId]` | GET | Single assessment with per-control results |
| `/api/assessment/controls` | GET | Catalog of WAF controls (no run required) |
| `/api/assessment/qualitative` | GET / POST / DELETE | List, upsert, or remove a workspace qualitative response |
| `/api/assessment/ignored` | GET / POST / DELETE | List, add, or remove a workspace control exclusion |

---

## UI

| Component | Purpose |
|-----------|---------|
| `app/assessment/page.tsx` | Main `/assessment` page: pillar score cards, failing-controls tab, per-pillar drill-down, qualitative tab, ignored tab, AWS/Azure WAF cross-reference badges, history table, CSV export |
| `app/assessment/compare/page.tsx` | `/assessment/compare?from=X&to=Y` drift view — Regressed / Improved / Moved / Added / Removed / Unchanged |

Each control row (both automatic and qualitative) renders two clickable badges
("AWS WAF · …" / "Azure WAF · …") sourced from
`lib/engines/waf-assessment/cross-references.ts`. The module returns a
pillar-level fallback for every control plus per-control overrides for the
controls where the official Databricks WAF spreadsheet documents a specific
AWS / Azure reference (currently `DG-02-02`, `CO-01-09`, `PE-02-04`,
`R-01-03`, `SCP-01-13`).

The toolbar exports a client-side CSV (`waf-assessment-YYYY-MM-DD.csv`) with
columns `waf_id, pillar, principle, best_practice, score, threshold, met,
recommendation`.

---

## Data Model

| Table | Purpose |
|-------|---------|
| `ForgeWafControl` | Curated catalog of WAF controls (one row per `waf_id`) — seeded from the bundled CSV. Includes `evaluation_type` and nullable `threshold_percentage` for qualitative items |
| `ForgeWafAssessment` | One row per assessment run: status, per-pillar scores (`governance_score`, `iu_score`, `oe_score`, `scp_score`, `reliability_score`, `cost_score`, `performance_score`), `overall_score`, met/total counts, error message, timestamps |
| `ForgeWafControlResult` | Per-control result rows joined to a parent assessment via FK (`assessment_id` × `waf_id`) — score, threshold, met flag, evaluated_at |
| `ForgeWafQualitativeResponse` | Workspace-level answers for the 6 qualitative controls — one row per `waf_id`, reused across assessment runs (configuration, not run-scoped) |
| `ForgeWafIgnoredResource` | Workspace exclusions: opt out of a control (or in a future iteration, a specific resource) with a reason. Excluded controls are skipped when computing pillar/overall scores |

Schema is auto-migrated via `prisma db push --accept-data-loss` on app boot
(`scripts/start.sh`, Step E).

---

## Configuration

The engine takes no runtime configuration today. The bundled CSV is the
source of truth for pillar coverage, thresholds, and evaluation type. To add
or modify a control, edit the CSV and re-deploy — `ensureCatalogSeeded()`
will upsert the change on the next assessment.

---

## File Reference

| File | Purpose |
|------|---------|
| `lib/engines/waf-assessment/types.ts` | All TypeScript types: `WafPillar`, `WafControl`, `WafControlResult`, `WafAssessmentSummary/Detail`, `WAF_PILLARS`, `WAF_PILLARS_WITH_QUERIES`, `PILLAR_LABEL` |
| `lib/engines/waf-assessment/catalog.ts` | CSV loader, pillar-key mapping, `FIX_ACTIONS` map, `ensureCatalogSeeded()` |
| `lib/engines/waf-assessment/csv.ts` | Minimal RFC 4180 CSV parser (handles multiline quoted fields) |
| `lib/engines/waf-assessment/engine.ts` | `runPillar()` + `runAllPillars()` — load SQL, execute, map rows |
| `lib/engines/waf-assessment/service.ts` | `runAssessment()`, `listAssessments()`, `getLatestAssessment()`, `getAssessmentDetail()`, `listControls()` |
| `lib/engines/waf-assessment/queries/governance.sql` | Governance pillar SQL |
| `lib/engines/waf-assessment/queries/interoperability-usability.sql` | Interoperability & Usability pillar SQL |
| `lib/engines/waf-assessment/queries/operational-excellence.sql` | Operational Excellence pillar SQL |
| `lib/engines/waf-assessment/queries/security-compliance-privacy.sql` | Security, Compliance and Privacy pillar SQL |
| `lib/engines/waf-assessment/queries/reliability.sql` | Reliability pillar SQL |
| `lib/engines/waf-assessment/queries/cost-optimisation.sql` | Cost Optimisation pillar SQL |
| `lib/engines/waf-assessment/queries/performance-efficiency.sql` | Performance Efficiency pillar SQL |
| `lib/engines/waf-assessment/data/waf-controls-catalog.csv` | Bundled catalog (166 rows, 11 columns) |
| `lib/engines/waf-assessment/cross-references.ts` | Static AWS WAF / Azure WAF cross-reference resolver (pillar fallback + per-control overrides) used by the UI badges |
| `app/api/assessment/route.ts` | `GET` latest + history |
| `app/api/assessment/run/route.ts` | `POST` trigger run |
| `app/api/assessment/[assessmentId]/route.ts` | `GET` single assessment |
| `app/api/assessment/controls/route.ts` | `GET` catalog |
| `app/assessment/page.tsx` | Main UI |
| `app/assessment/compare/page.tsx` | Drift comparison UI |
| `prisma/schema.prisma` | `ForgeWafControl`, `ForgeWafAssessment`, `ForgeWafControlResult` models |

---

## Roadmap

- **Broaden IU / OE / SCP coverage** — the current SQL queries cover a
  curated subset of each pillar (4-5 controls). Extend with admin-API checks
  for SCIM/AIM, network/IdP federation, customer-managed keys, and additional
  workflow/cluster policy signals.
- **Resource-level exclusions** — extend `ForgeWafIgnoredResource` (which
  already accepts an optional `resourceType`/`resourceId` pair) so that SQL
  queries honor exclusions at the resource grain (e.g. exclude one warehouse
  from `SCP-02-01` instead of the whole control).
- **Enrich AWS / Azure cross-references** — `cross-references.ts` ships with
  pillar-level fallback for every control plus per-control overrides for a
  handful of controls. Sweep the official Databricks WAF spreadsheet's
  "AWS reference" / "Azure reference" columns and add a `CONTROL_REFS` entry
  for every documented mapping so the badges always deep-link to the most
  specific AWS / Azure WAF guidance.
