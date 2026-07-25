# Skills System and Knowledge Base

> Composable domain knowledge and document-powered RAG for LLM prompt enrichment.

## Overview

Forge uses two complementary systems to inject domain expertise into LLM prompts:

- **Skills** -- static, curated knowledge blocks (SQL patterns, Genie design
  principles, industry KPIs) registered at module load and resolved by intent,
  Genie pass, or pipeline step.
- **Knowledge Base** -- user-uploaded documents (PDF, MD, TXT) chunked and
  embedded into pgvector for RAG retrieval.

Both systems feed into the same embedding store (`forge_embeddings`) and are
consumed by Ask Forge, the Genie Engine, the SQL Engine, and the pipeline.

---

## Skills System

### What is a Skill?

A skill is a self-contained bundle of domain knowledge split into typed chunks.
Each chunk has a category (rules, patterns, anti-patterns, examples, vocabulary,
kpis) and optional character budget. Skills declare which intents, Genie passes,
and pipeline steps they are relevant to.

```typescript
interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  relevance: SkillRelevance;
  chunks: SkillChunk[];
}

interface SkillChunk {
  id: string;
  title: string;
  content: string;
  category: "rules" | "patterns" | "anti-patterns" | "examples" | "vocabulary" | "kpis";
  maxCharBudget?: number;
}

interface SkillRelevance {
  intents?: AskForgeIntent[];
  geniePasses?: GeniePass[];
  pipelineSteps?: PipelineStep[];
}
```

### Registry

Skills self-register at import time via `registerSkill()`. The registry provides
lookup by ID, intent, Genie pass, or pipeline step:

| Function | Returns |
|----------|---------|
| `getSkill(id)` | Single skill definition |
| `getAllSkills()` | All registered skills |
| `getSkillsForIntent(intent)` | Skills matching an Ask Forge intent |
| `getSkillsForGeniePass(pass)` | Skills matching a Genie Engine pass |
| `getSkillsForPipelineStep(step)` | Skills matching a pipeline step |
| `getChunksForIntent(intent)` | Flattened chunks for an intent |

### Resolver

The resolver composes skills into prompt-ready blocks with character budgets:

- `resolveForIntent(intent)` → `ResolvedSkills`
- `resolveForGeniePass(pass)` → `ResolvedSkills`
- `resolveForPipelineStep(step)` → `ResolvedSkills`

Output splits chunks into:
- **System overlay** (rules, anti-patterns) -- budget ~600-1200 chars
- **Context sections** (patterns, examples, vocabulary, kpis) -- budget ~2000-4000 chars

### Static Skill Modules

Nine skill modules live in `lib/skills/content/`:

| Module | Domain | Key Content |
|--------|--------|-------------|
| `databricks-sql-patterns.ts` | SQL | Window functions, CTEs, date handling, lambdas, anti-patterns |
| `databricks-data-modeling.ts` | SQL | Data modeling patterns and best practices |
| `databricks-ai-functions.ts` | AI | ai_query, ai_classify, ai_extract, ai_gen usage |
| `databricks-sql-scripting.ts` | SQL | SQL scripting and stored procedures |
| `databricks-dashboard-sql.ts` | Dashboard | Dashboard-optimised SQL patterns |
| `genie-design.ts` | Genie | Genie Space design principles and best practices |
| `metric-view-patterns.ts` | Metrics | Metric view YAML patterns |
| `system-tables.ts` | Platform | Unity Catalog system table queries |
| `industry-enrichment.ts` | Industry | Dynamic skills from industry outcome maps |

### Relevance Targets

Skills declare relevance across three dimensions:

**Ask Forge intents:**
`business`, `technical`, `dashboard`, `navigation`, `exploration`

**Genie passes:**
`instructions`, `semanticExpressions`, `benchmarks`, `trustedAssets`,
`metricViews`, `columnIntelligence`, `exampleQueries`, `joinInference`

**Pipeline steps:**
`sql-generation`, `scoring`, `use-case-generation`, `table-filtering`,
`dashboard-design`

---

## Knowledge Base

### What is the Knowledge Base?

The Knowledge Base lets users upload organisation-specific documents (strategy
packs, data dictionaries, governance policies, architecture documents) that
enrich the AI assistant and pipeline with context that static skills cannot
provide.

### Upload Flow

```
POST /api/knowledge-base/upload (multipart: file + category)
    │
    ├── Extract text: PDF via pdf-parse, MD/TXT via Buffer.toString()
    ├── Chunk: 512 tokens, 64 token overlap (lib/embeddings/chunker.ts)
    ├── Compose: composeDocumentChunk(text, filename, category, index)
    ├── Embed: generateEmbeddings() → databricks-qwen3-embedding-0-6b (1024-dim)
    └── Store: insertEmbeddings() → forge_embeddings as "document_chunk"
```

### Document Categories

| Category | Purpose |
|----------|---------|
| `strategy` | Business strategy and initiative documents |
| `data_dictionary` | Data definitions, glossaries, field descriptions |
| `governance_policy` | Data governance rules and compliance policies |
| `architecture` | System architecture and technical design docs |
| `other` | Any other supporting documents |

### Feature Gating

The Knowledge Base requires the embedding endpoint to be configured
(`DATABRICKS_EMBEDDING_ENDPOINT` via `serving-endpoint-embedding`). When
disabled, the upload API returns 503 and the UI shows "Knowledge Base
Unavailable".

---

## Embedding and RAG Integration

### Embedding Kinds

Both systems share the `forge_embeddings` table (pgvector with HNSW index,
1024 dimensions):

| Kind | Source |
|------|--------|
| `skill_chunk` | Static skill chunks |
| `industry_kpi` | Industry KPI benchmarks |
| `industry_benchmark` | Master Rep benchmark records |
| `industry_data_asset` | Reference Data Assets |
| `document_chunk` | User-uploaded Knowledge Base documents |

### Search Scopes

RAG retrieval uses scopes to target relevant embedding kinds:

| Scope | Kinds |
|-------|-------|
| `skills` | skill_chunk, industry_kpi, industry_benchmark, industry_data_asset |
| `documents` | document_chunk |
| `estate` | table_detail, column_profile, environment_insight, table_health, data_product, lineage_context |
| `usecases` | use_case, business_context, genie_recommendation, genie_question |
| `benchmarks` | benchmark_context, outcome_map |
| `fabric` | fabric_dataset, fabric_measure, fabric_report, fabric_artifact |

### RAG Retrieval

`retrieveContext(query, opts)` in `lib/embeddings/retriever.ts`:
1. Embeds the query via the embedding endpoint
2. Runs vector search across specified scopes
3. Labels results with provenance (`[PLATFORM SKILL]`, `[UPLOADED DOCUMENT: filename]`, etc.)
4. Reranks by provenance priority: CustomerFact > PlatformBestPractice > IndustryBenchmark > AdvisoryGuidance

### Ask Forge Context Assembly

Ask Forge's context builder (`lib/assistant/context-builder.ts`) combines three
strategies:

1. **Direct Lakebase** -- business context, estate summary, deployed assets, industry context
2. **Vector search** -- `retrieveContext()` with intent-based scope selection
3. **Rule-based skills** -- `resolveForIntent()` + `buildIndustrySkillSections()`

Intent → scope mapping determines which embedding kinds are searched:

| Intent | Scopes |
|--------|--------|
| business | usecases, estate, benchmarks, fabric, skills |
| technical | estate, insights, skills |
| dashboard | insights, usecases, fabric, skills |
| navigation | estate, usecases, documents, fabric |
| exploration | estate, usecases, documents, fabric, skills |
| strategic | usecases, estate, benchmarks, documents, skills |

---

## Skill Embedding

`lib/skills/embed-skills.ts` provides functions to embed skills into pgvector:

| Function | What it embeds |
|----------|----------------|
| `embedStaticSkills()` | All static skill chunks as `skill_chunk` |
| `embedIndustryKPIs()` | Industry KPIs as `industry_kpi` |
| `embedIndustryBenchmarks()` | Master Rep benchmarks as `industry_benchmark` |
| `embedIndustryDataAssets()` | Reference Data Assets as `industry_data_asset` |
| `embedAllSkills()` | Runs all four in parallel |

All embedding functions are idempotent (delete-and-replace on each run).

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/knowledge-base` | GET | List uploaded documents |
| `/api/knowledge-base` | DELETE | Delete document by ID (also removes embeddings) |
| `/api/knowledge-base/upload` | POST | Upload file (multipart), chunk, embed |

---

## UI

The Knowledge Base page (`app/knowledge-base/page.tsx`) provides:
- Drag-and-drop or file picker upload
- Category selector (strategy, data_dictionary, governance_policy, architecture, other)
- Document list with status indicators (processing, ready, failed, empty)
- Delete confirmation

Requires `semanticSearchEnabled` in Settings. Gated behind `isEmbeddingEnabled()`.

---

## Data Model

| Table | Purpose |
|-------|---------|
| `ForgeDocument` (`forge_documents`) | Document metadata: filename, MIME type, category, chunk count, status, uploader |
| `forge_embeddings` | Shared embedding store (pgvector): kind, source_id, content_text, metadata_json, embedding vector(1024) |

---

## File Reference

| File | Purpose |
|------|---------|
| `lib/skills/types.ts` | Core types: SkillDefinition, SkillChunk, SkillRelevance |
| `lib/skills/registry.ts` | Central registry: registerSkill, lookup by intent/pass/step |
| `lib/skills/resolver.ts` | Composes skills into prompt-ready blocks |
| `lib/skills/embed-skills.ts` | Embeds skills and industry data into pgvector |
| `lib/skills/index.ts` | Public API (imports content modules to register) |
| `lib/skills/content/*.ts` | 9 static skill modules |
| `lib/embeddings/chunker.ts` | Text chunking (512 tokens, 64 overlap) |
| `lib/embeddings/client.ts` | Embedding API client |
| `lib/embeddings/store.ts` | pgvector store: insert, search, delete |
| `lib/embeddings/retriever.ts` | RAG retrieval with provenance and reranking |
| `lib/embeddings/types.ts` | Embedding kinds, search scopes |
| `lib/lakebase/documents.ts` | Document CRUD |
| `lib/assistant/context-builder.ts` | Ask Forge context assembly (skills + RAG + Lakebase) |
