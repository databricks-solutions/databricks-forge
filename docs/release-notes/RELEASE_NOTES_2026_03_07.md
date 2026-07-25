# Release Notes -- 2026-03-07

**Databricks Forge v0.14.2**

---

## Bug Fixes

- **Metric view validation false positives** -- The join-alias scanner in `validateMetricViewYaml` and `autoRenameShadowedDimensions` scanned from `joins:` to end-of-YAML, incorrectly collecting dimension and measure names as join aliases. Every dimension then "shadowed itself", producing a flood of false-positive `INVALID_EXTRACT_BASE_FIELD_TYPE` warnings. Fixed by limiting the scan to the joins section only.

- **Missing auto-fix in repair loop** -- The LLM repair loop called `autoRenameCollidingJoinAliases` and `autoRenameShadowedMeasures` but omitted `autoRenameShadowedDimensions`, so repaired proposals could still have dimension/alias collisions. Now included.

- **Materialization block referencing join aliases** -- Fixed materialization refs that used join alias names instead of declared dimension/measure names.

---

## Improvements

### Metric views scoped to Genie Spaces only
- Removed the standalone **Metric Views** tab from the pipeline run detail page. Metric views are now only visible within Genie Space details, simplifying the UI.
- Updated help text in the Genie detail accordion and deploy modal to reflect the new structure.

### Dashboards use standalone SQL exclusively
- Dashboard engine no longer fetches or passes metric view proposals to the LLM prompt. Dashboards now generate standalone SQL with no dependency on new metric views.
- Removed the metric view dependency check and `MetricViewDependencyModal` from the dashboard deploy flow, simplifying it from a 4-step to a 3-step process (configure, deploying, done).
- Removed metric view FQN rewriting from the dashboard deploy API route.

### Metric view dependency resolution with FQN rewriting
- Added QUALIFY+aggregate SQL rule and metric view dependency resolution with FQN rewriting for Genie Space deployments.

---

## Commits (3)

| Hash | Summary |
|---|---|
| `dfa4cce` | Fix metric view validation false positives and decouple dashboards from metric views |
| `2ec3662` | Add QUALIFY+aggregate SQL rule and metric view dependency resolution with FQN rewriting |
| `119b967` | Fix materialization block referencing join aliases instead of declared dim/measure names |

**Uncommitted changes:** version bump + release notes (this file).
