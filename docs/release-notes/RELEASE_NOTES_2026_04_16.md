# Release Notes -- 2026-04-16

**Databricks Forge v0.39.5 → v0.40.0**

---

## v0.40.0 -- Adaptive Column Budget Engine

### New Features
#### Always-on adaptive column budgeting
Replaces the manual Large Schema Mode toggle with a two-layer adaptive engine that is always active:

1. **Fill-then-trim token allocation** -- Dynamically computes per-table column limits within the available token budget. Narrow tables keep all columns; wide tables share surplus proportionally. Every table retains at least 10 columns.
2. **LLM-based column ranking** -- When trimming is needed, a single lightweight classification call ranks columns by business relevance (goals, priorities, measurable outcomes, join keys) instead of relying solely on heuristic scoring. Falls back silently to the heuristic scorer on any LLM failure.

Zero cost when all columns fit (most batches). Typically 0-3 lightweight LLM calls per run.

#### Auto-detected wide schema fetch limits
Tables with 100+ columns are automatically detected at metadata extraction time. When present, fetch-level memory limits (200K column rows, 18 sample columns) are applied without any manual toggle.

### Improvements
- **Uncapped batch estimation** -- Token-aware batching now uses full column counts for realistic sizing, preventing batch overstuffing that forced aggressive trimming.
- **Structured trim logging** -- Detailed logs when the adaptive engine trims columns, including per-table before/after counts, LLM ranking status, and available token budget. User-facing run message reports trimming activity.
- **Removed `largeSchemaMode` toggle** -- The settings UI toggle, pipeline config field, and all related plumbing have been removed across ~15 files. Old serialised runs with `largeSchemaMode: true` are harmlessly ignored.

---

## v0.39.5 -- Large Schema Mode global scope fix

### Bug Fixes
- **Large Schema Mode now applies to standalone estate scans** -- Previously the setting only affected pipeline run steps (metadata extraction, use case generation, SQL generation) but was completely ignored by standalone estate scans. The column row cap is now enforced in both code paths.
- **Serialization gap in `generationOptions`** -- `largeSchemaMode` and `businessValueEnabled` were not persisted in the run's `generationOptions` JSON, causing the flags to default to `false` when a run was re-loaded from the database. Both flags are now serialized correctly.

### Improvements
- **"Schema Handling" settings card** -- The Large Schema Mode toggle has been extracted from the "Estate Scan" settings card into its own "Schema Handling" card, making it clear the setting applies globally to both pipeline runs and estate scans.
- **Corrected UI description** -- The toggle description previously stated "max 15 per table" but the actual budget constant is 25 columns per table. The UI and code comments are now aligned.

---

## All Commits

| Hash | Summary |
|---|---|
| `3ff99f3` | feat: replace Large Schema Mode toggle with always-on adaptive column budget engine |
| `0279e96` | fix: make Large Schema Mode apply to both pipeline runs and estate scans |
