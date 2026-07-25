# Release Notes -- 2026-03-15

**Databricks Forge v0.37.4**

---

## v0.37.4 -- Stability fixes from production log review

### Bug Fixes
- **Metric view YAML "aterialization" truncation** -- Fixed `sanitizeMetricViewYaml()` where an incorrect `.slice(1).search(/^\S/m)` pattern truncated the first character of `"materialization:"` instead of removing the invalid block. The same off-by-one bug in the measures section is also fixed.
- **Dashboard MISSING_GROUP_BY at runtime** -- Added a static GROUP BY lint to dashboard validation that catches SQL mixing aggregate functions with non-aggregated columns before the EXPLAIN round-trip. Both pipeline and ad-hoc dashboard engines now reject these queries early. Strengthened the dashboard prompt and shared SQL rules with an explicit CROSS JOIN + aggregate GROUP BY requirement.
- **LLM fallback rotating to expensive models** -- `buildEndpointPool()` now accepts an optional tier hint and uses `getFallbacksForTier()` to prefer same-tier endpoints before falling back to the full model pool. This prevents cheap classification tasks (e.g. `flash-lite`) from rotating to expensive reasoning models (e.g. `claude-opus`) on 429 exhaustion.

### Improvements
- **Gradual circuit breaker cooldown** -- The rate limiter now decrements `consecutive429s` by 1 on success instead of resetting to 0, preventing rapid oscillation between blocked and unblocked states under sustained load.
- **Metric view repair prompt for materialization** -- The LLM repair prompt now includes explicit guidance for materialization block errors: either include a complete `materialized_views:` list with `name` and `type` fields, or remove the block entirely.

---

## All Commits

| Hash | Summary |
|---|---|
| `59f16fd` | fix: metric view YAML sanitization, dashboard GROUP BY lint, tier-aware LLM fallback |
