# Release Notes -- 2026-03-31

**Databricks Forge v0.39.4**

---

## v0.39.4 -- Large Schema OOM Mitigation

### Bug Fixes
- **Out-of-memory on large schemas (12k+ tables)** -- Multiple compounding memory issues caused OOM failures on schemas with thousands of tables. This release addresses the root causes across the metadata extraction, context building, and use case generation layers.

### Improvements
#### Node.js Heap Limit
Configured `--max-old-space-size=4096` in production startup and dev scripts to accommodate large schemas. Operators can override via `NODE_OPTIONS`.

#### Memory Monitoring
Added `process.memoryUsage()` logging at every pipeline step boundary and exposed heap stats (`heapUsedMB`, `rssMB`, etc.) in the `/api/health` endpoint for operational visibility.

#### Metadata Pruning After Table Filtering
After the table filtering step, columns and foreign keys for excluded tables are now released from memory. On large schemas where filtering removes 50-80% of tables, this frees proportional memory before the expensive LLM steps.

#### Schema Markdown Made Lazy
Removed the eagerly-computed `schemaMarkdown` string from `MetadataSnapshot`. This ~12 MB string was built at extraction time but never read by any downstream consumer (all steps build their own from subsets). Eliminates dead memory allocation and ~12 MB of Lakebase storage per cached snapshot.

#### Bounded Prompt Injection Strings
- `buildSchemaMarkdown()`: Now enforces the documented `maxColumnsPerTable` cap (default: 40), preventing unbounded string growth on wide tables.
- `buildForeignKeyMarkdown()`: Now caps output at 500 FK entries by default.
- Use case generation: FK markdown is filtered to only business-relevant tables before cap.
- `buildPreviousUseCasesFeedback()`: Limited to the last 100 use case names instead of all prior.

#### Quadratic Schema Summary Fix
`buildSchemaSummaryText()` was performing `O(T × R)` work (filtering all relationships for every table). Replaced with an indexed `Map<fqn, Relationship[]>` lookup for `O(1)` per table. Also capped output at 2000 tables.

#### Large Schema Auto-Detection
Metadata extraction now warns operators when the schema exceeds 5000 tables or 200k columns, suggesting schema-level scoping for faster runs.

#### Adaptive Concurrency
Use case generation automatically reduces concurrent LLM batch processing from 8 to 3 when the filtered table count exceeds 3000, reducing peak memory from parallel request/response payloads.

#### Column Query Safety Net
Added `LIMIT 500,000` to `listColumns()` SQL queries to prevent runaway results on pathological schemas.

#### Duplicate Column Data Release
The schema context builder now explicitly releases raw `ColumnInfo[]` data after building `EnrichedTable[]`, preventing the same column data from existing in two forms simultaneously.

---

## All Commits

| Hash | Summary |
|---|---|
| `c381927` | fix: mitigate OOM on large schemas (12k+ tables) |
