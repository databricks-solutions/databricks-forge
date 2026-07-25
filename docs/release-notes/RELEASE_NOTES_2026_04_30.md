# Release Notes -- 2026-04-30

**Databricks Forge v0.40.0 → v0.41.0**

---

## v0.40.1 -- Opus 4.7 compatibility + max_tokens defaults

### Bug Fixes
- **Opus 4.7 temperature 400** -- `databricks-claude-opus-4-7` now rejects requests that include the `temperature` parameter with HTTP 400. Added a per-model `supportsTemperature` capability (only Opus 4.7 is `false`) and gated the wire body in `lib/dbx/model-serving.ts` so all callers can keep passing temperature without changes; the field is simply omitted for models that disallow it.
- **Claude Sonnet 4 silent 1K truncation** -- Databricks defaults `max_tokens` to 1,000 for Claude Sonnet 4 when the field is omitted, causing silent `finish_reason: length` truncation. The wire layer now always emits `max_tokens`, falling back to a per-model `defaultMaxTokens` when the caller doesn't specify one.

### Improvements
- **Gemini Flash output ceiling raised** -- `databricks-gemini-3-flash` and `databricks-gemini-3-1-flash-lite` `maxOutputTokens` raised from 8,192 to 32,768 to match Databricks' published per-request envelope.
- **Visible clamp warnings** -- The maxTokens clamp log was promoted from `info` to `warn` so unintended truncation (e.g. the 128K asks in `lib/pipeline/steps/scoring.ts` against a 32K Claude cap) surfaces in normal log views.
- **Per-model `defaultMaxTokens`** -- Added a sensible default per model: GPT-5.4 = 16,384; Claude Opus/Sonnet 4.x = 8,192; Gemini Flash + Llama Maverick = 4,096. Surfaced via `getModelCapabilities()` and logged in the pool startup summary.

### Other Changes
- Extended `ModelTemplate`, `ModelEndpoint`, `getModelCapabilities()`, and `UNKNOWN_CAPS` with the two new fields.
- Updated `__tests__/model-pool/model-registry.test.ts` (now 27 tests in the model-pool suite, 922 across the full repo) and the `__tests__/model-serving/content-parsing.test.ts` mock to match the new `getModelCapabilities` shape.

---

## v0.41.0 -- WAF Assessment

### New Features
#### Self-service Databricks Well-Architected Framework assessment
A new `/assessment` page lets customers score their workspace against the Databricks Well-Architected Framework (WAF) without leaving Forge. Forge runs deterministic SQL over `system.*` (lineage, audit, billing, compute, information_schema) on behalf of the logged-in user (OBO) and produces:

1. **Per-pillar scores** -- Governance, Reliability, Cost Optimisation, Performance Efficiency, plus an overall score derived from the available pillars.
2. **Drill-down per pillar** -- Each pillar has its own tab with a score header (Mature / Progressing / At Risk / Critical) and a control table sorted failing-first.
3. **Failing controls tab** -- A cross-pillar shortcut to the controls that did not meet their threshold, ordered by score ascending.
4. **History** -- Every run is persisted in Lakebase (`forge_waf_assessments`) with timestamps, scores, and triggering metadata.

The catalog of 30 controls (sourced from Databricks-WAF-Light-Tooling) is bundled as a CSV, upserted into `forge_waf_controls` on first boot, and re-synced on every run.

#### "Fix with Forge" deep-links on every control
Each failing control surfaces a one-click action mapped to the right destination:

- **Forge engines** (Wrench icon) for controls genuinely automatable inside Forge -- Comment Engine for missing column comments, Estate Scan for lineage / tag / format / managed-table inventory.
- **Open docs** (Book icon, opens in new tab) for admin- or workload-level controls (Photon, autoscaling, cluster policies, model serving, audit-log enablement, etc.) where the canonical Databricks doc is the right next step.
- **Ask Forge** fallback when no mapping is curated.

All 30 controls now have at least one curated next step.

#### CSV export
"Export CSV" button on the assessment toolbar generates a client-side CSV (`waf-assessment-YYYY-MM-DD.csv`) with `waf_id, pillar, principle, best_practice, score, threshold, met, recommendation` -- ready to drop into a customer report.

#### Drift comparison between runs
A new `/assessment/compare?from=X&to=Y` view diffs two assessments and groups controls by drift category:

- **Regressed** -- was met, now not met (highlighted in red, top of page).
- **Improved** -- was not met, now met.
- **Score moved** -- same status, score delta beyond a 5-point noise floor.
- **Catalog changes** -- controls that entered or left the catalog between runs.
- **Unchanged** -- collapsed by default.

A "vs. latest" button on each row of the History tab launches the comparison.

### API
- `POST /api/assessment/run` -- triggers a full assessment run, persists results, returns the summary.
- `GET  /api/assessment` -- returns latest assessment (with control results) plus history list.
- `GET  /api/assessment/[assessmentId]` -- returns a single assessment with its per-control results.
- `GET  /api/assessment/controls` -- returns the bundled controls catalog (no run required).

### Schema
Three new Lakebase tables (auto-migrated via `prisma db push` on boot):

- `forge_waf_controls` -- catalog of WAF controls with thresholds, metric definitions, and curated remediation text + fix-action mapping.
- `forge_waf_assessments` -- one row per assessment run with status, per-pillar scores, overall score, met/total counts, error message, timestamps.
- `forge_waf_control_results` -- per-control result rows joined to a parent assessment via FK.

---

## All Commits

| Hash | Summary |
|---|---|
| `3447c1b` | fix(model-serving): make Opus 4.7 work + close Sonnet 4 max_tokens footgun |
| _fill at merge_ | feat: WAF Assessment module with drill-down, CSV export, and drift compare |
