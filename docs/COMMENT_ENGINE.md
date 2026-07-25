# Comment Engine

> AI-powered table and column description generator optimised for Genie Space discoverability.

## Overview

The Comment Engine generates high-quality table and column descriptions by
building holistic schema understanding before describing any individual table.
It enriches prompts with industry Reference Data Assets, use case linkages,
lineage, and write-frequency signals to produce descriptions that make Genie
Spaces more discoverable and useful.

## Architecture

The engine runs four sequential phases:

```
Phase 0+1: buildSchemaContext(scope)
    │  SchemaContext (tables, columns, lineage, domain/role/tier, dataAssetId)
    ▼
Phase 2: runTableCommentPass(tableInputs, context)
    │  Map<tableFqn, description>
    ▼
Phase 3: runColumnCommentPass(columnInputs, industryContext)
    │  Map<tableFqn, Map<columnName, description>>
    ▼
Phase 4: runConsistencyReview() → applyConsistencyFixes()
    │  In-place updates to tableComments + columnComments
    ▼
Result: CommentEngineResult { tableComments, columnComments, schemaContext, consistencyFixes, stats }
```

### Phase 0+1: Schema Context

Delegates to `buildSchemaContext()` from `lib/metadata/context-builder.ts`
(or uses a pre-built `deps.schemaContext` for DI). Produces a fully classified,
relationship-aware, lineage-enriched view of the schema. See
[AGENTS.md](../AGENTS.md#shared-metadata-context-layer) for the metadata layer
documentation.

### Phase 2: Table Comments

Generates table descriptions in token-aware batches using the fast model.

Each prompt includes:
- Industry context and business context
- Reference Data Asset mappings and use case linkages
- Full schema summary with domain, role, tier classifications
- Lineage context for upstream/downstream relationships
- Per-table metadata: columns (up to 20), existing comment, write frequency, owner, tags

**Constants:** `MAX_COLS_TABLE_PASS = 20` columns per table in prompt.

### Phase 3: Column Comments

Generates column descriptions in parallel (8 tables concurrently) using the
fast model. Each table prompt includes:
- Industry context
- Table description from Phase 2
- Domain, role, and data asset context
- Related tables and their descriptions
- Column list with types, nullable flags, and deterministic role hints

**Constants:** `COLUMN_CONCURRENCY = 8` parallel tables.

### Phase 4: Consistency Review (Optional)

Reviews all generated descriptions for:
- Terminology consistency across tables
- Cross-table reference accuracy
- Genie-readiness (business terms, synonyms, context)

Produces `ConsistencyFix[]` objects that are applied in-place to the table
and column comment maps. Enabled by default (`enableConsistencyReview: true`).

---

## Configuration

```typescript
interface CommentEngineConfig {
  industryId?: string;           // Industry for Reference Data Assets
  businessContext?: string;      // Business context string
  outputLanguage?: CommentOutputLanguage; // "en" | "pt-BR" | "es" (default: "en")
  enableConsistencyReview?: boolean;  // Phase 4 (default: true)
  enableLineage?: boolean;       // Walk lineage graph
  enableHistory?: boolean;       // Include Delta history
  signal?: AbortSignal;          // Cancellation
  onProgress?: CommentProgressCallback;
  onMetadataProgress?: (counters: MetadataCounters) => void;
  deps?: CommentEngineDeps;      // DI overrides
}
```

### Output Language

`outputLanguage` controls the natural language used in generated table/column
descriptions. Supported values: `en` (default), `pt-BR`, `es`. Technical
identifiers (table names, column names, FQNs) remain unchanged regardless of
language. The setting is persisted on the `ForgeCommentJob` row, so the AI
Comments page and the New Discovery pipeline both honour and surface it; the
prerequisite cache (`isJobFresh`) refuses to reuse a fresh job whose language
differs from the requested one.

### Dependency Injection

The engine accepts optional `CommentEngineDeps` for portability:

```typescript
interface CommentEngineDeps {
  llm: LLMClient;
  logger: Logger;
  schemaContext?: SchemaContext;
  industryContext?: string;
  dataAssetContext?: string;
  dataAssetList?: DataAsset[];
  useCaseLinkage?: string;
}
```

When deps are not provided, the engine wires Databricks Model Serving and
industry outcomes automatically.

---

## Progress Tracking

The engine reports progress through two callbacks:

- `onProgress(phase, pct, detail?)` -- high-level phase transitions
- `onMetadataProgress(counters)` -- granular metadata counters

Progress phases: `starting` → `fetching-metadata` → `walking-lineage` →
`enriching-tables` → `classifying` → `generating-tables` → `generating-columns` →
`consistency-review` → `saving` → `complete` (or `failed`).

In-memory progress is tracked via `lib/ai/comment-engine/progress.ts`:
`initCommentProgress()`, `updateCommentProgress()`, `getCommentProgress()`.

---

## Facade: `lib/ai/comment-generator.ts`

The `generateComments()` function is the primary entry point used by API routes:

1. Initialises in-memory progress for the job
2. Calls `runCommentEngine()` with progress callbacks wired to the job tracker
3. Persists generated proposals to Lakebase via `createProposals()`
4. Updates job status to `ready`

An `importFromScan()` function also exists to create proposals from
estate scan results (`ForgeTableDetail.generatedDescription`) without
running the full engine.

---

## DDL Execution: `lib/ai/comment-applier.ts`

Handles applying and undoing comments against Unity Catalog:

| Function | Purpose |
|----------|---------|
| `checkPermissions(tableFqns)` | SHOW GRANTS pre-check for MODIFY permission |
| `applyProposals(jobId, proposals)` | Execute COMMENT ON DDL for accepted proposals |
| `undoProposals(jobId, proposals)` | Restore original comments |
| `escapeComment(comment)` | SQL injection protection for string literals |
| `validateCommentText(comment)` | Blocklist check for dangerous SQL patterns |

**Constants:** `APPLY_CONCURRENCY = 5` parallel DDL statements.

Column comments are supported for MANAGED, EXTERNAL, and DELTA tables.
Views and materialized views support table-level comments only.

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/environment/comments` | GET | List comment jobs |
| `/api/environment/comments` | POST | Create job (catalogs, schemas, tables, industry, exclusions) |
| `/api/environment/comments/generate` | POST | Start generation (fire-and-forget) |
| `/api/environment/comments/check-permissions` | POST | SHOW GRANTS pre-check on table list |
| `/api/environment/comments/[jobId]` | GET | Job detail + proposals + table summary |
| `/api/environment/comments/[jobId]` | DELETE | Delete job and proposals |
| `/api/environment/comments/[jobId]/proposals` | PATCH | Bulk accept/reject/edit proposals |
| `/api/environment/comments/[jobId]/progress` | GET | In-memory progress (fallback from job status) |
| `/api/environment/comments/[jobId]/apply` | POST | Apply accepted proposals (DDL) |
| `/api/environment/comments/[jobId]/undo` | POST | Restore original comments |
| `/api/environment/comments/[jobId]/resync` | POST | Refresh original comment from UC for a table |

---

## UI

| Component | Purpose |
|-----------|---------|
| `app/environment/comments/page.tsx` | Main AI Comments page (setup, review, apply) |
| `components/environment/comment-table-nav.tsx` | Table navigator panel |
| `components/environment/comment-review-panel.tsx` | Old-vs-new review with inline editing |
| `components/environment/comment-action-bar.tsx` | Bulk apply/undo sticky action bar |

---

## Data Model

| Table | Purpose |
|-------|---------|
| `ForgeCommentJob` | Job record: scope, industry, status, timestamps |
| `ForgeCommentProposal` | Per-table/column proposal: original, generated, edited, status |

---

## File Reference

| File | Purpose |
|------|---------|
| `lib/ai/comment-engine/engine.ts` | Main orchestrator (4 phases) |
| `lib/ai/comment-engine/types.ts` | All TypeScript types |
| `lib/ai/comment-engine/prompts.ts` | Prompt templates (table, column, consistency) |
| `lib/ai/comment-engine/table-pass.ts` | Phase 2: table descriptions |
| `lib/ai/comment-engine/column-pass.ts` | Phase 3: column descriptions |
| `lib/ai/comment-engine/consistency-pass.ts` | Phase 4: consistency review and fix |
| `lib/ai/comment-engine/progress.ts` | In-memory progress tracker |
| `lib/ai/comment-generator.ts` | Facade: wires engine to jobs and proposals |
| `lib/ai/comment-applier.ts` | DDL execution, permissions, apply/undo |
| `lib/metadata/context-builder.ts` | Schema context builder (Phase 0+1) |
| `lib/metadata/classifier.ts` | LLM-based schema classification |
| `lib/metadata/deterministic.ts` | Pure-function schema analysis |
| `lib/domain/industry-outcomes-server.ts` | Industry context and data asset lookups |
| `lib/lakebase/comment-jobs.ts` | Job CRUD |
| `lib/lakebase/comment-proposals.ts` | Proposal CRUD |
