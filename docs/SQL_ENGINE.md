# SQL Engine -- Grounded SQL Generation & Validation

> How Databricks Forge generates, validates, and repairs LLM-produced SQL
> across every surface in the application.

---

## 1. Overview and Design Principles

Databricks Forge generates SQL via LLM calls in **10 different surfaces**
(pipeline use case SQL, dashboards, Genie spaces, the Ask Forge assistant,
etc.). Every surface follows the same grounded generation philosophy:

**The LLM only sees real metadata, never invents.**

The defence-in-depth strategy is:

1. **Prompt grounding** -- inject actual table/column schemas into the prompt
   with explicit instructions that these are the ONLY valid identifiers
2. **Static column validation** -- extract column references from the generated
   SQL and check them against the known schema
3. **EXPLAIN dry-run** -- execute `EXPLAIN <sql>` against the warehouse to
   catch runtime errors (type mismatches, ambiguous columns, missing tables)
4. **Fix cycle** -- if validation fails, send the SQL + error back to the LLM
   with the correct schema for a single repair attempt
5. **LLM review** -- a dedicated review endpoint (`serving-endpoint-review`,
   default `databricks-gpt-5-4`) performs multi-dimensional quality assessment
   (correctness, performance, readability, security, Databricks idiom adherence)
   via `lib/ai/sql-reviewer.ts`. This separates generation (creative) from
   review (critical). When the review endpoint is configured, surfaces that
   opt in get a post-validation review pass that can auto-fix quality issues
   EXPLAIN cannot catch (suboptimal joins, non-idiomatic patterns, readability).
   Feature-gated per surface via `isReviewEnabled()`.
6. **Rejection** -- if the fix and review both fail, reject the SQL (return null,
   drop the dataset, or filter the expression)

Not every surface implements all six tiers. The minimum bar is prompt
grounding + static validation. See section 6 for the per-surface matrix.

---

## 2. Metadata Sourcing

### Where metadata originates

All metadata comes from Unity Catalog `information_schema` queries in
`lib/queries/metadata.ts`:

| Function | Returns | Source |
|----------|---------|--------|
| `listTables(catalog, schema?)` | `TableInfo[]` | `information_schema.tables` |
| `listColumns(catalog, schema?)` | `ColumnInfo[]` | `information_schema.columns` |
| `listForeignKeys(catalog, schema?)` | `ForeignKey[]` | `information_schema.table_constraints` + `key_column_usage` + `constraint_column_usage` |
| `listMetricViews(catalog, schema?)` | `MetricViewInfo[]` | `information_schema.tables` where `table_type = 'METRIC_VIEW'` |
| `fetchTableInfoBatch(fqns)` | `TableInfo[]` | Per-table `information_schema` lookup |
| `fetchColumnsBatch(fqns)` | `ColumnInfo[]` | Per-table `information_schema.columns` lookup |

### Core types

```
TableInfo     { catalog, schema, tableName, fqn, comment, tableType?, dataSourceFormat? }
ColumnInfo    { tableFqn, columnName, dataType, ordinalPosition, isNullable, comment? }
ForeignKey    { constraintName, tableFqn, columnName, referencedTableFqn, referencedColumnName }
MetricViewInfo { catalog, schema, name, fqn, comment? }
```

### MetadataSnapshot

The unified container used by most consumers:

```
MetadataSnapshot {
  tables: TableInfo[]
  columns: ColumnInfo[]
  foreignKeys: ForeignKey[]
  metricViews: MetricViewInfo[]
  schemaMarkdown: string     // pre-rendered for prompt injection
  tableCount, columnCount    // summary stats
  cachedAt: string           // ISO timestamp
}
```

### How metadata reaches each consumer

| Consumer | Source |
|----------|--------|
| Pipeline (SQL gen, use case gen) | `PipelineContext.metadata` -- built by the metadata-extraction step (step 2) |
| Genie engine | `MetadataSnapshot` passed to engine, built from table-selection pass |
| Dashboard engine | `MetadataSnapshot` passed to engine from pipeline context |
| Dashboard adhoc engine | `fetchTableInfoBatch` + `fetchColumnsBatch` called directly |
| Ask Forge assistant | `tableEnrichments` from RAG context builder (Lakebase + embedding retrieval) |

---

## 3. Schema Injection into Prompts

### Formatting functions

| Function | Location | Format | Used by |
|----------|----------|--------|---------|
| `buildSchemaMarkdown(tables, columns)` | `lib/queries/metadata.ts` | `### catalog.schema.table -- comment`<br>`  - columnName (TYPE) -- comment` | Pipeline SQL gen, use case gen, metadata extraction |
| `buildForeignKeyMarkdown(fks)` | `lib/queries/metadata.ts` | `- table.col -> ref_table.ref_col` | Pipeline SQL gen |
| `buildCompactColumnsBlock(metadata)` | `lib/genie/schema-allowlist.ts` | `catalog.schema.table: col1, col2, col3` | Genie passes |
| `buildSchemaContextBlock(metadata)` | `lib/genie/schema-allowlist.ts` | `**table** -- comment`<br>`  - \`col\` (TYPE) -- comment` | Genie passes |
| `buildColumnSchemas(columns, fqns)` | `lib/dashboard/adhoc-engine.ts` | `table: col1 (TYPE), col2 (TYPE)` | Adhoc dashboard |

### Per-use-case scoping (pipeline)

In the pipeline SQL generation step, schema is scoped to each use case's
`tablesInvolved` array. Only columns from those specific tables are injected:

```
for (const fqn of uc.tablesInvolved) {
  const cols = columnsByTable.get(fqn) ?? [];
  involvedColumns.push(...cols);
}
const schemaMarkdown = buildSchemaMarkdown(involvedTables, involvedColumns);
```

### Sample data injection

When `sampleRowsPerTable > 0` is configured, `fetchSampleData()` in
`lib/pipeline/sample-data.ts` queries up to N rows per table and formats them
as markdown tables. Cell values are truncated to 60 chars. Tables without
SELECT permission are skipped (metadata-only fallback).

### Prompt placement

The schema is injected via the `{directly_involved_schema}` template variable.
Every SQL generation prompt includes a critical instruction block:

> **CRITICAL: The tables and columns listed above are the ONLY ones available.
> Do NOT invent, guess, or hallucinate any table or column names. If a column
> does not appear above, it does not exist.**

---

## 4. SQL Quality Rules

### Shared rule sets (`lib/ai/sql-rules.ts`)

| Rule set | Length | Used by |
|----------|--------|---------|
| `DATABRICKS_SQL_RULES` | Full (~40 lines) | Pipeline SQL gen, pipeline SQL fix, Ask Forge assistant, dashboard design |
| `DATABRICKS_SQL_RULES_COMPACT` | Compact (~10 lines) | Genie semantic expressions, benchmark generation, trusted assets |

### Key rules

- **No MEDIAN()** -- use `PERCENTILE_APPROX(col, 0.5)`
- **No nested window functions** -- compute in CTE first, then aggregate
- **DECIMAL(18,2)** for financial/monetary calculations
- **Backtick-quote** column names with spaces: `` `Net Cash Flow` ``
- **Use names EXACTLY as in schema** -- never transform to snake_case
- **Three-part table names**: `catalog.schema.table`
- **No AI functions in metric views** -- non-deterministic and expensive
- **COLLATE UTF8_LCASE** for case-insensitive comparisons
- **Filter early, aggregate late**

---

## 5. The Shared Validation Module (`lib/validation/sql-columns.ts`)

This module is the single source of truth for column-reference extraction and
validation. It consolidates logic that was previously duplicated between the
pipeline validator and the Genie schema-allowlist.

### Exports

#### `extractColumnReferences(sql): ColumnReference[]`

Extracts all `alias.column` references from SQL, both plain identifiers and
backtick-quoted identifiers:

- Plain: `alias.column_name` via `/\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g`
- Quoted: `` alias.`column with spaces` `` via `/\b([a-zA-Z_]\w*)\.`([^`]+)`/g`

Returns `{ prefix, column, position, isQuoted }` for each reference.

#### `extractSqlAliases(sql): SqlAliases`

Detects all SQL aliases from the backtick-stripped SQL:

- **Table aliases**: `FROM/JOIN <fqn> [AS] <alias>`
- **Column aliases**: `AS <alias>`
- **CTE names**: `WITH cte AS (` and chained `, cte AS (`

Returns `{ tableAliases, columnAliases, cteNames, all }` (all as `Set<string>`).

#### `validateColumnReferences(sql, knownColumns, options?): SqlColumnValidationResult`

Core validation function. Extracts column references, filters out:

- SQL keywords (via `SQL_KEYWORDS`)
- FQN parts (catalog, schema, table name fragments from `options.tablesInvolved`)
- Known aliases and CTE names
- AI function return fields (when `options.allowAiFunctionFields` is true)

Then flags any column that does not appear in `knownColumns`.

Returns `{ valid: boolean, unknownColumns: string[], warnings: string[] }`.

#### `AI_FUNCTION_RETURN_FIELDS`

`Set<string>` containing `"result"`, `"errormessage"`, `"parsed_result"`, and
`"ai_result"` (lowercased). These are runtime struct fields and common aliases
used with `ai_query()` when `failOnError => false`. They are not table columns
and must be allowlisted to avoid false-positive hallucination flags.

The `parsed_result` and `ai_result` entries support the recommended
`from_json()` pattern for structured AI output (see section 9).

#### `SQL_KEYWORDS`

Re-exported from `lib/genie/schema-allowlist.ts`. Canonical set of ~200 SQL
keywords used to avoid false positives (e.g. `t.count` where `count` is a
SQL keyword, not a column name).

---

## 6. Validation Tiers

### Tier matrix

| # | Surface | Prompt grounding | Static column check | EXPLAIN | Fix cycle | LLM Review | Rejection |
|---|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | Pipeline SQL gen | Yes | Yes | Yes | Yes (LLM) | Yes (opt-in) | Return null |
| 2 | Ask Forge assistant | Yes | Yes | Yes | Yes (LLM) | Yes (opt-in) | Keep original |
| 3 | Dashboard engine | Yes | Yes | No | No | Yes (review+fix) | Drop dataset |
| 4 | Ad-hoc dashboard | Yes | Yes | No | No | Yes (review+fix) | Drop dataset |
| 5 | Genie: semantic expressions | Yes | Yes | No | No | Yes (batch) | Filter out |
| 6 | Genie: benchmarks | Yes | Yes | No | No | Yes (review+fix) | Filter out |
| 7 | Genie: trusted assets | Yes | Yes | No | No | Yes (review+fix) | Filter out |
| 8 | Genie: example queries | Yes | Yes | No | No | No | Filter out |
| 9 | Genie: join inference | Yes | Yes | No | No | No | Filter out |
| 10 | Genie: metric views | Yes | Yes (YAML) | Yes (DDL) | Yes (LLM) | No | Drop proposal |
| 11 | Fabric: DAX-to-SQL | No | No | No | No | Yes (batch) | Confidence downgrade |
| 12 | Genie: optimize | No | No | No | No | Yes (review) | Reject suggestion |

### Tier 1: Structural checks (pipeline only)

- SQL starts with a recognised keyword (`--`, `WITH`, `SELECT`, `CREATE`, `FROM`)
- At least one expected table from `tablesInvolved` appears in the SQL

### Tier 2: Static column validation

Uses the shared module (`validateColumnReferences` or `findInvalidIdentifiers`
via `validateSqlExpression`) to check that every `alias.column` reference
exists in the known schema. Catches:

- Completely hallucinated column names
- Column names with typos or incorrect casing
- Backtick-quoted column names with spaces that don't exist
- AI function return fields are allowlisted to avoid false positives

### Tier 3: EXPLAIN dry-run

`EXPLAIN <sql>` against the SQL Warehouse catches runtime errors that static
analysis cannot detect:

- Type mismatches (`CAST` errors)
- Ambiguous column references (columns in multiple joined tables)
- Missing tables (tables that exist but the user has no access to)
- Invalid function usage

**Limitation**: Pipe syntax (`|>`) is valid Databricks SQL but not supported
by EXPLAIN. Queries using pipe syntax skip this tier.

### Tier 4: Fix / repair cycle

When validation fails, the SQL and error message are sent back to the LLM
with the correct schema for a single repair attempt. See section 7.

### Tier 5: Rejection

If the fix attempt also fails, the SQL is rejected:

- Pipeline: `generateSqlForUseCase()` returns `null`
- Dashboard: dataset is dropped from the design before assembly
- Genie: expression/query is filtered out of the pass output
- Assistant: original SQL is kept in the response (best-effort)

---

## 7. Fix / Repair Cycles

### Pipeline fix cycle

**Prompt**: `USE_CASE_SQL_FIX_PROMPT` in `lib/ai/templates.ts`

**Flow**:
1. `validateSqlOutput()` detects unknown columns
2. `buildColumnViolationMessage()` constructs a detailed error listing the
   hallucinated columns and the valid columns per table
3. `attemptSqlFix()` sends the original SQL + error + schema to the LLM
4. The fix response is cleaned and re-validated
5. If unknown columns remain, the SQL is rejected
6. If the fix passes static validation, it's checked with EXPLAIN
7. If EXPLAIN fails, the SQL is rejected

**Key prompt rules**:
- Fix errors only -- do not change business logic UNLESS the error is a
  hallucinated column
- Removing references to non-existent columns is a valid fix -- do NOT
  substitute with guessed alternatives
- Use column names EXACTLY as in the schema
- `DATABRICKS_SQL_RULES` is appended for full SQL quality guidance

### Assistant fix cycle

**Prompt**: `buildSqlFixPrompt()` in `lib/assistant/sql-proposer.ts`

**Flow**:
1. Static pre-check via `validateColumnReferences()` catches hallucinations
   before EXPLAIN round-trip
2. If static check passes, `validateSql()` runs EXPLAIN
3. If either fails with a column error, `buildSqlFixPrompt()` constructs a
   fix prompt with the exact error and correct column schema
4. Single fix attempt via `chatCompletion()`
5. Fixed SQL is rechecked with EXPLAIN
6. If the fix passes, the original SQL block in the response is replaced

### Genie metric view fix cycle

**Prompt**: inline repair prompt in `lib/genie/passes/metric-view-proposals.ts`

**Flow**:
1. `validateMetricViewYaml()` checks column references in the YAML
2. If invalid, `repairProposal()` sends the YAML + validation issues + schema
   back to the LLM
3. DDL is generated and validated with `executeSQL()` (dry run)

---

## 8. Consumer Wiring Reference

### Per-surface summary

| Surface | Validation function | Known-columns source | Fix cycle |
|---------|-------------------|---------------------|-----------|
| Pipeline SQL gen | `validateColumnReferences` | `ColumnInfo[]` from metadata | Yes |
| Ask Forge | `validateColumnReferences` + `validateSql` | `tableEnrichments` | Yes |
| Dashboard engine | `validateSqlExpression` | `SchemaAllowlist` from `MetadataSnapshot` | No |
| Ad-hoc dashboard | `validateSqlExpression` | `SchemaAllowlist` from fetched metadata | No |
| Genie passes (5) | `validateSqlExpression` | `SchemaAllowlist` from `MetadataSnapshot` | No |
| Genie metric views | `validateMetricViewYaml` | Column references in YAML | Yes |

### How to wire a new SQL-generating consumer

#### Step 1: Source metadata

Choose the metadata source that fits your consumer:

```typescript
// Option A: Full MetadataSnapshot (from pipeline or Genie context)
const { metadata } = ctx;

// Option B: Fetch specific tables
const [tableInfos, columns] = await Promise.all([
  fetchTableInfoBatch(tables),
  fetchColumnsBatch(tables),
]);

// Option C: From assistant context
const knownColumns = new Set(
  context.tableEnrichments.flatMap((t) =>
    t.columns.map((c) => c.name.toLowerCase())
  )
);
```

#### Step 2: Build the known-columns set or allowlist

```typescript
// For validateColumnReferences (flat column set)
const knownColumns = new Set(
  columns.map((c) => c.columnName.toLowerCase())
);

// For validateSqlExpression (structured allowlist)
import { buildSchemaAllowlist, validateSqlExpression } from "@/lib/genie/schema-allowlist";
const allowlist = buildSchemaAllowlist(metadata);
```

#### Step 3: Validate

```typescript
// Option A: Direct column validation (pipeline / assistant pattern)
import { validateColumnReferences } from "@/lib/validation/sql-columns";
const result = validateColumnReferences(sql, knownColumns, {
  tablesInvolved: ["catalog.schema.table"],
  allowAiFunctionFields: true,
});
if (!result.valid) {
  // result.unknownColumns contains the hallucinated columns
}

// Option B: Schema allowlist validation (Genie / dashboard pattern)
const isValid = validateSqlExpression(allowlist, sql, "context:name", true);
if (!isValid) {
  // SQL was logged and should be filtered out
}
```

#### Step 4: Handle invalid results

```typescript
// Filter pattern (dashboards / Genie)
const validDatasets = datasets.filter((ds) =>
  validateSqlExpression(allowlist, ds.sql, `my-consumer:${ds.name}`, true)
);

// Fix pattern (pipeline / assistant)
if (result.unknownColumns.length > 0) {
  const fixedSql = await attemptFix(sql, result, schema);
  if (!fixedSql) return null; // reject
}
```

---

## 9. Known Limitations and Edge Cases

### AI function return fields and structured output

`ai_query()` with `failOnError => false` returns
`STRUCT<result: STRING, errorMessage: STRING>`. The `result` field is **always
STRING** regardless of the `responseFormat` parameter. Attempting to access
nested struct fields directly (e.g. `ai_result.result.field`) causes
`INVALID_EXTRACT_BASE_FIELD_TYPE` errors.

**Correct pattern for structured output:**

1. Include JSON format instructions in the prompt text via CONCAT
2. Call `ai_query(endpoint, prompt, modelParameters => ..., failOnError => false) AS ai_result`
3. Parse: `from_json(ai_result.result, 'STRUCT<field1: TYPE, ...>') AS parsed_result`
4. Access: `parsed_result.field1`, `parsed_result.field2`; errors: `ai_result.errorMessage`

**Do NOT** use `responseFormat` with `failOnError => false` -- it does not
change the result field from STRING to a nested struct.

The shared validation module allowlists `result`, `errormessage`,
`parsed_result`, and `ai_result` via `AI_FUNCTION_RETURN_FIELDS` to avoid
false-positive hallucination flags on these runtime aliases. If new AI
functions or parsing patterns introduce additional aliases, update this set.

### Backtick-quoted column names with spaces

Both the shared module and the Genie validator handle backtick-quoted columns
(e.g. `` alias.`Age Group` ``). The shared module extracts these via a
dedicated regex pass that runs on the original SQL before backtick stripping.

### CTE-computed aliases

When a CTE defines a computed column (e.g. `SUM(amount) AS total_revenue`),
`total_revenue` is a valid column reference in subsequent CTEs but does NOT
exist in the source schema. The validator treats it as a known alias (detected
by the `AS <alias>` regex) and does not flag it.

### EXPLAIN limitations

- **Pipe syntax** (`|>`) is valid Databricks SQL but `EXPLAIN` does not
  support it. Queries using pipe syntax skip EXPLAIN validation.
- **Complex CTEs**: EXPLAIN may not catch all column errors in deeply nested
  CTEs where column resolution depends on runtime evaluation.
- **Permissions**: EXPLAIN requires SELECT access to the referenced tables.
  Tables the user cannot access will fail EXPLAIN even if the SQL is correct.

### Tables with no column metadata

If `tablesInvolved` references a table that has no entries in
`metadata.columns` (e.g. due to permissions or information_schema gaps), the
validator logs a warning and skips column validation for that use case. The
schema markdown shows `(schema not available)`.

### Token budget

`buildSchemaMarkdown` emits all columns for all tables with no cap. For very
wide tables (hundreds of columns), this can consume significant prompt tokens.
The trade-off is intentional: hiding columns caused hallucinations. If token
limits become an issue, the solution is to reduce the number of tables per
use case, not to cap columns.

---

## 10. Diagrams

### Metadata flow

```
Unity Catalog information_schema
        │
        ▼
  listTables / listColumns / listForeignKeys / listMetricViews
        │
        ▼
  MetadataSnapshot { tables, columns, foreignKeys, metricViews }
        │
        ├──▶ Pipeline context (full snapshot)
        │       └──▶ per-use-case scoping (tablesInvolved)
        │               └──▶ buildSchemaMarkdown → prompt injection
        │
        ├──▶ Genie engine (full snapshot)
        │       └──▶ buildSchemaAllowlist → SchemaAllowlist
        │       └──▶ buildSchemaContextBlock → prompt injection
        │
        ├──▶ Dashboard engine (full snapshot or fetched)
        │       └──▶ buildSchemaAllowlist → SchemaAllowlist
        │
        └──▶ Assistant (tableEnrichments from RAG)
                └──▶ Set<string> of column names
```

### Validation pipeline

```
  LLM generates SQL
        │
        ▼
  [Tier 1] Structural checks
  (starts with SELECT/WITH, references expected tables)
        │
        ▼
  [Tier 2] Static column validation
  (extractColumnReferences → check against knownColumns)
        │
        ├── valid ──▶ [Tier 3] EXPLAIN dry-run
        │                 │
        │                 ├── passes ──▶ ✅ Accept SQL
        │                 │
        │                 └── fails ──▶ [Tier 4] Fix cycle
        │                                   │
        │                                   ├── fix passes ──▶ ✅ Accept fixed SQL
        │                                   │
        │                                   └── fix fails ──▶ ❌ Reject
        │
        └── invalid ──▶ [Tier 4] Fix cycle
                            │
                            ├── fix passes + re-validates ──▶ ✅ Accept
                            │
                            └── fix fails ──▶ ❌ Reject
```

### Consumer wiring

```
  lib/validation/sql-columns.ts (shared module)
  ┌─────────────────────────────────────────────┐
  │ extractColumnReferences (backtick-aware)     │
  │ extractSqlAliases (table/col/CTE aliases)    │
  │ validateColumnReferences (core validator)     │
  │ AI_FUNCTION_RETURN_FIELDS (allowlist)         │
  │ SQL_KEYWORDS (re-exported)                    │
  └──────────┬──────────────────────┬────────────┘
             │                      │
             ▼                      ▼
  Pipeline sql-generation.ts   Genie schema-allowlist.ts
  validateSqlOutput()          findInvalidIdentifiers()
  + fix cycle                  validateSqlExpression()
             │                      │
             │           ┌──────────┼──────────────────┐
             │           │          │                   │
             │           ▼          ▼                   ▼
             │    Dashboard    Genie passes (5)   Deploy validation
             │    engine       semantic-expressions  join-diagnostics
             │    adhoc-engine benchmark-generation
             │                 trusted-assets
             │                 example-query-generation
             │                 join-inference
             │
             ▼
  Assistant engine.ts
  validateColumnReferences()
  + validateSql (EXPLAIN)
  + fix cycle
```
