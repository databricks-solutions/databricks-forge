# Release Notes -- 2026-03-16

**Databricks Forge v0.37.5 → v0.38.0**

---

## v0.37.5 -- Fix Genie build progress step indicators

### Bug Fixes
- **Genie build progress steps never marked complete in fast mode** -- The fast Genie engine (`runFastGenieEngine`) does not report explicit step identifiers via `onProgress`, so `currentStep` stayed `null` throughout the build. The `GenieBuildProgress` component relied entirely on `currentStep` to derive step completion, meaning all six steps remained in "pending" state while the progress bar advanced. Added a percentage-based fallback: when `currentStep` is null, step completion is derived from `progressPct` against each step's `pct` threshold, and the next pending step shows an active pulse animation.

### Other Changes
- **app.yaml deployment config** -- Updated app resource bindings (lightweight endpoint, demo mode, pooler experiment, seed benchmarks).

---

## v0.37.6 -- Replace placeholder repo URL in quickstart docs

### Improvements
#### Copy-pasteable clone command in all quickstart docs
The `git clone <repo-url>` placeholder in `README.md`, `QUICKSTART.md`, and `docs/quickstart.md` has been replaced with the actual repository URL (`https://github.com/althrussell/databricks-forge.git`), so users can copy and paste the deploy command block directly without editing.

---

## v0.38.0 -- Model availability failover across regions and clouds

### New Features
#### Three-layer model availability failover
Databricks Forge now gracefully handles model availability differences across regions and clouds. When a preferred model endpoint is not available, the app silently falls back to the best alternative at three levels:

1. **Deploy-time probing** -- `deploy.sh` probes each model endpoint via the Databricks CLI before binding resources. Per-role fallback chains select the best available model (e.g. if `databricks-claude-sonnet-4-6` is unavailable, it falls back to `databricks-gemini-3-flash`). Use `--skip-probe` to bypass.
2. **Startup-time validation** -- New `scripts/validate-endpoints.mjs` probes configured endpoints on app boot via the Serving Endpoints API, setting `FORGE_VALIDATED_ENDPOINTS` so the runtime pool starts with only reachable models.
3. **Runtime resilience** -- When a model returns 404 or `RESOURCE_DOES_NOT_EXIST`, it is permanently marked unavailable and the request immediately rotates to an alternative endpoint with zero retries on the dead endpoint.

### Improvements
#### Health endpoint exposes model pool status
`GET /api/health` (authenticated) now includes a `modelPool` section showing available and unavailable endpoints, useful for debugging cross-region deployment issues.

#### Streaming LLM client handles unavailable endpoints
The streaming fallback path (`databricks-llm-client.ts`) now rotates on endpoint unavailability in addition to 429 rate limits.

---

## All Commits

| Hash | Summary |
|---|---|
| `2ec7a65` | fix: Genie build progress steps not marking complete in fast mode |
| `aa5a5f8` | docs: replace placeholder repo URL with actual clone URL |
| `f5c943b` | feat: three-layer model availability failover for cross-region deployments |
