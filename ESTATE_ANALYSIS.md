# Estate Analysis -- How the Data Estate Intelligence Engine Works

> A comprehensive guide to the environment scanning pipeline, metadata enrichment, LLM intelligence layer, lineage walking, health scoring, ERD generation, aggregate estate view, and executive reporting behind Databricks Forge.

---

## Table of Contents

- [Overview](#overview)
- [Why This Matters](#why-this-matters)
- [Architecture Diagram](#architecture-diagram)
- [Data Model](#data-model)
- [Pipeline Flow](#pipeline-flow)
  - [Phase 1: Table Discovery & Metadata Listing](#phase-1-table-discovery--metadata-listing)
  - [Phase 2: Lineage Walking (BFS)](#phase-2-lineage-walking-bfs)
  - [Phase 3: Deep Metadata Enrichment](#phase-3-deep-metadata-enrichment)
  - [Phase 4: Tag Collection](#phase-4-tag-collection)
  - [Phase 5: Health Scoring](#phase-5-health-scoring)
  - [Phase 6: LLM Intelligence Layer](#phase-6-llm-intelligence-layer)
  - [Phase 7: Persistence](#phase-7-persistence)
- [LLM Intelligence Passes](#llm-intelligence-passes)
  - [Pass 1: Domain Categorisation](#pass-1-domain-categorisation)
  - [Pass 2: PII & Sensitivity Detection](#pass-2-pii--sensitivity-detection)
  - [Pass 3: Auto-Generated Descriptions](#pass-3-auto-generated-descriptions)
  - [Pass 4: Redundancy Detection](#pass-4-redundancy-detection)
  - [Pass 5: Implicit Relationship Discovery](#pass-5-implicit-relationship-discovery)
  - [Pass 6: Medallion Tier Classification](#pass-6-medallion-tier-classification)
  - [Pass 7: Data Product Identification](#pass-7-data-product-identification)
  - [Post-Pass: Governance Gap Analysis](#post-pass-governance-gap-analysis)
- [Lineage Walker Deep Dive](#lineage-walker-deep-dive)
- [Health Scoring Rules](#health-scoring-rules)
- [ERD Generation & Visualisation](#erd-generation--visualisation)
- [Aggregate Estate View](#aggregate-estate-view)
- [Executive Summary Intelligence](#executive-summary-intelligence)
- [Scan Progress & Live Feedback](#scan-progress--live-feedback)
- [Excel Export](#excel-export)
- [API Reference](#api-reference)
- [Privacy Model](#privacy-model)
- [Constants & Tuning Parameters](#constants--tuning-parameters)

---

## Overview

The **Data Estate Intelligence Engine** is a standalone scanning pipeline that analyses your entire Databricks Unity Catalog environment. Unlike the Discovery pipeline (which generates use cases), the Estate engine answers a fundamentally different question:

> **"What data do we actually have, how is it connected, how healthy is it, and what should we do about it?"**

The engine performs a deep, non-invasive scan of your Unity Catalog metadata -- table structures, lineage graphs, Delta history, tags, properties -- and then applies eight distinct LLM intelligence passes to produce a rich, categorised, scored view of your data landscape.

The output is a **holistic estate view** that combines:

- **Structural metadata**: sizes, formats, partitions, clustering, Delta protocol versions
- **Operational health**: maintenance gaps, streaming patterns, staleness detection
- **Data lineage**: upstream/downstream dependency graphs via system tables
- **Business intelligence**: domain categorisation, data product identification, tier classification
- **Risk & governance**: PII detection, sensitivity classification, governance scoring, gap analysis
- **Relationship mapping**: explicit FKs plus LLM-discovered implicit relationships
- **Redundancy detection**: duplicate and overlapping table identification

Multiple scans across different scopes (catalogs, schemas) are merged into a single **aggregate estate view** that represents the latest known state of your entire data landscape.

---

## Why This Matters

### For Data Leaders

| Challenge | How the Estate Engine Helps |
| --- | --- |
| "We don't know what data we have" | Automated discovery with LLM-generated descriptions for every table |
| "We can't find data across teams" | Domain categorisation and data product identification create a searchable catalogue |
| "We're not sure where PII lives" | Column-level PII detection with regulation mapping (GDPR, CCPA, HIPAA) |
| "Our data quality is inconsistent" | Health scoring flags maintenance gaps, stale tables, and missing governance |
| "We have duplicate datasets" | Redundancy detection identifies overlapping tables with actionable recommendations |
| "We don't understand data dependencies" | Lineage walking + implicit relationship discovery maps the full dependency graph |
| "We need to report on data governance" | Governance scorecard with per-table scoring and priority-ranked gap analysis |

### For Technical Teams

| Challenge | How the Estate Engine Helps |
| --- | --- |
| Undocumented tables | Auto-generated descriptions for tables without comments |
| Missing OPTIMIZE/VACUUM | Health scoring flags tables that haven't been maintained in 30+ days |
| Small file problem | Detects tables with average file sizes below 32 MB |
| Unknown lineage | BFS lineage walk discovers upstream/downstream dependencies automatically |
| Implicit relationships | LLM identifies FK-like column relationships even without formal constraints |
| Medallion architecture gaps | Tier classification reveals tables that don't fit the bronze/silver/gold pattern |
| Delta protocol drift | Flags tables running outdated Delta reader/writer versions |

---

## Architecture Diagram

```
                          ┌─────────────────────────┐
                          │   Unity Catalog Estate   │
                          │  ┌─────┐ ┌─────┐ ┌────┐ │
                          │  │Cat A│ │Cat B│ │ .. │ │
                          │  └──┬──┘ └──┬──┘ └──┬─┘ │
                          └─────┼───────┼───────┼───┘
                                │       │       │
                    ┌───────────▼───────▼───────▼──────────┐
                    │   Phase 1: Table & Column Discovery   │
                    │   SHOW TABLES / information_schema     │
                    │   + table types + comments + columns   │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │   Phase 2: Lineage Walking (BFS)      │
                    │   system.access.table_lineage          │
                    │   depth=3, both directions             │
                    │   → discovered tables added to scope   │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │   Phase 3: Deep Enrichment            │
                    │   DESCRIBE DETAIL  → size, files,     │
                    │                      format, location  │
                    │   DESCRIBE HISTORY → write patterns,   │
                    │                      ops, maintenance   │
                    │   SHOW TBLPROPERTIES → CDF, auto-opt   │
                    │   (with VIEW fallback for non-tables)  │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │   Phase 4: Tags                       │
                    │   information_schema.table_tags        │
                    │   information_schema.column_tags       │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │   Phase 5: Health Scoring              │
                    │   8 rules, score 0-100                 │
                    │   Issues + recommendations per table   │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │   Phase 6: LLM Intelligence Layer      │
                    │   8 passes via Model Serving            │
                    │                                         │
                    │   ┌─────────────┐  ┌──────────────┐   │
                    │   │  Domains    │  │  PII / Sens   │   │
                    │   └─────────────┘  └──────────────┘   │
                    │   ┌─────────────┐  ┌──────────────┐   │
                    │   │ Descriptions│  │  Redundancy   │   │
                    │   └─────────────┘  └──────────────┘   │
                    │   ┌─────────────┐  ┌──────────────┐   │
                    │   │ Implicit FKs│  │  Medallion    │   │
                    │   └─────────────┘  └──────────────┘   │
                    │   ┌─────────────┐  ┌──────────────┐   │
                    │   │Data Products│  │  Governance   │   │
                    │   └─────────────┘  └──────────────┘   │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │   Phase 7: Persist to Lakebase         │
                    │   5 tables: scans, details, histories, │
                    │   lineage, insights                     │
                    └──────────────────┬───────────────────┘
                                       │
              ┌────────────────────────┼───────────────────────┐
              │                        │                       │
    ┌─────────▼─────────┐  ┌─────────▼─────────┐  ┌─────────▼──────────┐
    │  Aggregate Estate  │  │   ERD / Lineage    │  │    Excel Export     │
    │  View (merge all   │  │   Graph Viewer     │  │    12 sheets        │
    │  scans, latest     │  │   (React Flow)     │  │                     │
    │  per table wins)   │  │                    │  │                     │
    └────────────────────┘  └────────────────────┘  └────────────────────┘
```

---

## Data Model

The estate feature persists scan results into five Lakebase (Prisma-managed) tables.

### ForgeEnvironmentScan

The root record for each scanning session.

| Field | Type | Description |
| --- | --- | --- |
| `scanId` | String (PK) | Unique scan identifier |
| `runId` | String? | Links to discovery pipeline run (if triggered from there) |
| `ucPath` | String | Unity Catalog scope scanned (e.g. `catalog.schema`) |
| `tableCount` | Int | Total tables discovered |
| `totalSizeBytes` | BigInt | Sum of all table sizes |
| `totalRows` | BigInt | Sum of all row counts (where statistics available) |
| `totalFiles` | Int | Sum of all file counts |
| `tablesWithStreaming` | Int | Tables with streaming writes |
| `tablesWithCDF` | Int | Tables with Change Data Feed enabled |
| `tablesNeedingOptimize` | Int | Tables flagged for OPTIMIZE |
| `tablesNeedingVacuum` | Int | Tables flagged for VACUUM |
| `lineageDiscoveredCount` | Int | Tables found via lineage walk (not in original scope) |
| `domainCount` | Int | Distinct business domains identified |
| `piiTablesCount` | Int | Tables containing PII columns |
| `redundancyPairsCount` | Int | Redundant table pairs detected |
| `dataProductCount` | Int | Logical data products identified |
| `avgGovernanceScore` | Float | Mean governance score (0--100) |
| `scanDurationMs` | Int? | Wall-clock scan duration |
| `scanSummaryJson` | String? | Summary statistics as JSON |
| `passResultsJson` | String? | Per-pass result metadata |
| `createdAt` | DateTime | Scan timestamp |

### ForgeTableDetail

One record per table, containing structural metadata and LLM-enriched fields.

| Field | Type | Description |
| --- | --- | --- |
| `tableFqn` | String | Fully qualified name (`catalog.schema.table`) |
| `tableType` | String? | `TABLE` or `VIEW` |
| `comment` | String? | Original table comment from UC |
| `generatedDescription` | String? | LLM-generated description (when comment is missing) |
| `format` / `provider` | String? | Delta, Parquet, etc. |
| `location` | String? | Storage path |
| `isManaged` | Boolean | Managed vs external table |
| `owner` | String? | Table owner |
| `sizeInBytes` | BigInt? | Table size |
| `numRows` | BigInt? | Row count (from `spark.sql.statistics.numRows` property or `operationMetrics`) |
| `numFiles` | Int? | Number of files |
| `partitionColumns` | String? | JSON array of partition columns |
| `clusteringColumns` | String? | JSON array of clustering columns |
| `deltaMinReaderVersion` / `deltaMinWriterVersion` | Int? | Delta protocol versions |
| `cdfEnabled` | Boolean | Change Data Feed enabled |
| `autoOptimize` | Boolean | Auto-optimize enabled |
| `dataDomain` / `dataSubdomain` | String? | LLM-assigned business domain |
| `dataTier` | String? | bronze / silver / gold / system |
| `sensitivityLevel` | String? | PII / confidential / internal / public |
| `governancePriority` | String? | critical / high / medium / low |
| `governanceScore` | Float? | Per-table governance score (0--100) |
| `discoveredVia` | String | `"selected"` or `"lineage"` |

### ForgeTableHistorySummary

Delta history insights per table.

| Field | Type | Description |
| --- | --- | --- |
| `tableFqn` | String | Table identifier |
| `lastWriteTimestamp` | String? | Most recent write |
| `lastWriteOperation` | String? | Operation type of last write |
| `lastWriteRows` | BigInt? | Rows affected in last write (from `operationMetrics.numOutputRows`) |
| `lastWriteBytes` | BigInt? | Bytes written in last write (from `operationMetrics.numOutputBytes`) |
| `totalWriteOps` | Int | Count of all write operations |
| `totalStreamingOps` | Int | Streaming write count |
| `totalOptimizeOps` | Int | OPTIMIZE operations |
| `totalVacuumOps` | Int | VACUUM operations |
| `totalMergeOps` | Int | MERGE operations |
| `hasStreamingWrites` | Boolean | Whether table receives streaming data |
| `historyDays` | Int | Span of available history |
| `healthScore` | Float? | Computed health score (0--100) |
| `issuesJson` | String? | JSON array of detected issues |
| `recommendationsJson` | String? | JSON array of recommendations |

### ForgeTableLineage

Directed edges in the data lineage graph.

| Field | Type | Description |
| --- | --- | --- |
| `sourceTableFqn` | String | Upstream table |
| `targetTableFqn` | String | Downstream table |
| `sourceType` / `targetType` | String? | TABLE or VIEW |
| `entityType` | String? | Entity type from system table |
| `lastEventTime` | String? | Most recent lineage event |
| `eventCount` | Int | Number of observed events |

### ForgeTableInsight

LLM-generated insights with typed payloads.

| Field | Type | Description |
| --- | --- | --- |
| `insightType` | String | `pii_detection`, `redundancy`, `implicit_relationship`, `data_product`, `governance_gap` |
| `tableFqn` | String? | Related table (null for cross-table insights) |
| `payloadJson` | String | Structured JSON payload (schema varies by type) |
| `severity` | String | `info`, `medium`, `high`, `critical` |

---

## Pipeline Flow

The estate scan pipeline (`lib/pipeline/standalone-scan.ts`) executes seven sequential phases. Each phase updates a real-time progress tracker that the UI polls for live feedback.

### Phase 1: Table Discovery & Metadata Listing

**Purpose**: Discover all tables and views within the selected Unity Catalog scope.

**Operations**:
1. Parse the UC scope string (e.g. `my_catalog.my_schema`) into catalog/schema pairs
2. `SHOW TABLES IN schema` for each schema to get table names
3. `information_schema.tables` query to get accurate `table_type` (TABLE vs VIEW)
4. Merge table types into discovered tables
5. Fetch table comments (`information_schema.tables.comment`)
6. `information_schema.columns` for column names, types, and ordinal positions
7. `information_schema.table_constraints` + `referential_constraints` for foreign keys

**Output**: `allTables[]`, `allColumns[]`, `allFKs[]`

**Progress updates**: Tables found count, columns found count

### Phase 2: Lineage Walking (BFS)

**Purpose**: Discover upstream and downstream dependencies that may live outside the selected scope.

**Operations**:
1. Check `system.access.table_lineage` accessibility
2. BFS traversal from seed tables (all discovered in Phase 1)
3. Query lineage edges in both directions up to depth 3
4. Deduplicate edges, add newly discovered tables to the enrichment scope

**Output**: `lineageGraph` (edges + discoveredTables)

**Progress updates**: Lineage edges found, lineage tables discovered

### Phase 3: Deep Metadata Enrichment

**Purpose**: Gather detailed structural and operational metadata for every table.

**Operations** (per table, concurrency 5):
1. `DESCRIBE DETAIL` -- size, files, format, location, partition/clustering columns, owner, Delta protocol
2. `DESCRIBE HISTORY` (limit 100) -- write patterns, operation counts, maintenance timestamps, plus `operationMetrics` parsing for `lastWriteRows` and `lastWriteBytes`
3. `SHOW TBLPROPERTIES` -- CDF, auto-optimize, custom properties, and `spark.sql.statistics.numRows` for row counts

**View handling**: Views don't support `DESCRIBE DETAIL` or `DESCRIBE HISTORY`. The engine catches these errors gracefully and creates fallback detail records with `tableType: "VIEW"`, ensuring views always appear in the estate.

**Output**: `enrichmentResults` Map (tableFqn -> { detail, history, properties })

**Progress updates**: Enriched X of Y tables

### Phase 4: Tag Collection

**Purpose**: Collect Unity Catalog tags applied to tables and columns.

**Operations**:
1. `information_schema.table_tags` -- table-level tags
2. `information_schema.column_tags` -- column-level tags

**Output**: `allTableTags[]`, `allColumnTags[]`

### Phase 5: Health Scoring

**Purpose**: Compute a maintenance health score (0--100) for each table based on operational patterns.

**Operations**: Apply eight rule-based checks against each table's detail and history records (see [Health Scoring Rules](#health-scoring-rules)).

**Output**: `healthScores` Map (tableFqn -> { score, issues, recommendations })

### Phase 6: LLM Intelligence Layer

**Purpose**: Apply eight LLM passes to extract business intelligence, classify data, detect risks, and identify governance gaps.

This is the most compute-intensive phase. Tables are batched (typically 40 per batch) and processed via the Databricks Model Serving chat completions API. See [LLM Intelligence Passes](#llm-intelligence-passes) for full details.

**Output**: Domains, sensitivities, descriptions, redundancies, implicit relationships, tiers, data products, governance scores

**Progress updates**: Current LLM pass name, domains found, PII tables detected

### Phase 7: Persistence

**Purpose**: Save all collected and computed data to Lakebase.

**Operations**: Single transactional write to five tables:
1. `forge_environment_scans` -- scan-level summary
2. `forge_table_details` -- per-table structural + LLM metadata
3. `forge_table_history_summaries` -- per-table history insights
4. `forge_table_lineage` -- lineage edges
5. `forge_table_insights` -- LLM insights (PII, redundancy, relationships, products, governance)

---

## LLM Intelligence Passes

All LLM calls use the Databricks Model Serving chat completions API with `temperature: 0.2` for deterministic output. Prompts request JSON output and include explicit output schemas.

### Pass 1: Domain Categorisation

**Goal**: Assign each table to a business domain and subdomain.

**Input per table**: `{ table_fqn, columns[], comment, tags[] }`

**Batch size**: 40 tables

**Prompt strategy**: Provide a predefined domain taxonomy (Finance, Customer, Product, Operations, HR, Marketing, etc.) and ask the LLM to categorise each table based on its name, column names, and any existing comments or tags. Lineage context is included so the LLM can see related tables.

**Output**: `[{ table_fqn, domain, subdomain }]` grouped into `DataDomain[]`

**Business value**: Creates an instant, automated data catalogue with business-meaningful groupings. Teams can find data by business function rather than technical schema names.

### Pass 2: PII & Sensitivity Detection

**Goal**: Identify columns that contain personally identifiable information or sensitive data.

**Input per table**: `{ table_fqn, columns[{ name, type }] }`

**Batch size**: 40 tables

**Prompt strategy**: Classify each column into sensitivity categories -- PII (names, emails, phone numbers, addresses), Financial (account numbers, salaries), Health (medical records), Authentication (passwords, tokens), Internal, or Public. Include confidence levels and applicable regulations.

**Output**: `[{ table_fqn, column_name, classification, confidence, reason, regulation }]`

**Business value**: Enables compliance teams to quickly identify where regulated data lives without manual column-by-column review. Maps directly to GDPR, CCPA, HIPAA, and SOX requirements.

### Pass 3: Auto-Generated Descriptions

**Goal**: Generate human-readable descriptions for tables that lack comments.

**Input**: Only tables where `comment` is null or empty

**Batch size**: 40 tables

**Prompt strategy**: Given the table name, column names/types, and domain context, generate a concise 1--2 sentence catalogue description.

**Output**: `[{ table_fqn, description }]` stored as `generatedDescription`

**Business value**: Dramatically improves data discoverability. Analysts can search and understand tables without contacting the engineering team that created them.

### Pass 4: Redundancy Detection

**Goal**: Find duplicate, overlapping, or backup tables.

**Input**: All tables in the scan

**Batch size**: 80 tables (larger batch to enable cross-table comparison)

**Prompt strategy**: Compare table names and column schemas across all tables. Flag pairs with >=80% column overlap, naming patterns that suggest backups (`_bak`, `_old`, `_v2`), or staging tables that duplicate production.

**Output**: `[{ tableA, tableB, similarityPercent, sharedColumns[], reason, recommendation }]`

**Deduplication**: Results are deduplicated by sorting `tableA|tableB` alphabetically to avoid counting the same pair twice.

**Business value**: Identifies cost savings from decommissioning redundant tables and reduces confusion from analysts querying the wrong copy of data.

### Pass 5: Implicit Relationship Discovery

**Goal**: Infer foreign-key-like relationships from column names and types, even when no formal constraints exist.

**Input**: All tables with their columns

**Batch size**: 60 tables

**Prompt strategy**: Look for naming patterns (`user_id` in one table matching `id` in a `users` table), shared column names across tables, and type-compatible join candidates. Assign confidence levels.

**Output**: `[{ sourceTableFqn, sourceColumn, targetTableFqn, targetColumn, confidence, reasoning }]`

**Business value**: Reveals the actual join paths analysts use in practice, even in schema-on-read environments where formal FKs are rarely defined. Powers the ERD visualisation.

### Pass 6: Medallion Tier Classification

**Goal**: Classify each table into the Medallion architecture tiers.

**Input**: Tables with lineage context (upstream/downstream relationships)

**Batch size**: 40 tables

**Prompt strategy**: Using the table's position in the lineage graph, its naming conventions, column structure, and domain, classify as:
- **Bronze**: Raw ingestion, minimal transformation
- **Silver**: Cleansed, conformed, joined
- **Gold**: Business-ready aggregates, features, reports
- **System**: Internal/technical tables

**Output**: `[{ table_fqn, tier, reasoning }]`

**Business value**: Validates whether the organisation's data architecture follows the intended Medallion pattern and highlights tables that may be misclassified or need restructuring.

### Pass 7: Data Product Identification

**Goal**: Identify logical data products -- cohesive groups of tables that serve a business function.

**Input**: Tables, domains, lineage graph (minimum 3 tables required)

**Batch size**: All tables (single pass)

**Prompt strategy**: Group related tables by domain, lineage connectivity, and business purpose into named data products. Assign maturity levels:
- **Raw**: Unmanaged collection of related tables
- **Curated**: Documented with some governance
- **Productised**: Well-governed, SLA-backed, consumer-ready

**Output**: `[{ productName, description, tables[], primaryDomain, maturityLevel, ownerHint }]`

**Business value**: Shifts the organisation from thinking about individual tables to thinking about data products. Identifies candidates for data mesh / data product initiatives and highlights maturity gaps.

### Post-Pass: Governance Gap Analysis

**Goal**: Score each table's governance posture and identify specific gaps with remediation recommendations.

**Input**: Pre-computed gap categories per table:
- `no_description` -- missing table comment
- `no_owner` -- no owner set
- `no_tags` -- no tags applied
- `pii_untagged` -- PII detected but no sensitivity tags
- `no_lineage` -- no lineage edges found
- `stale_optimize` -- OPTIMIZE overdue
- `stale_vacuum` -- VACUUM overdue
- `stale_data` -- no recent writes

**Batch size**: 40 tables

**Prompt strategy**: Score governance 0--100 and list gaps with severity (critical/high/medium/low), detailed description, and specific recommendations.

**Output**: `[{ tableFqn, overallScore, gaps[{ category, severity, detail, recommendation }] }]`

**Business value**: Provides an actionable governance scorecard that can be tracked over time. Enables data stewards to prioritise remediation by severity.

---

## Lineage Walker Deep Dive

The lineage walker (`lib/queries/lineage.ts`) uses breadth-first search to discover data dependencies.

### Algorithm

```
FUNCTION walkLineage(seedTables, maxDepth=3, direction="both"):
  1. Check accessibility: SELECT 1 FROM system.access.table_lineage LIMIT 1
     → If inaccessible, return empty graph (graceful degradation)

  2. Initialise:
     visited = Set(seedTables)
     frontier = seedTables
     allEdges = []

  3. For depth 1..maxDepth:
     a. Query lineage for current frontier:
        SELECT source_table_full_name, target_table_full_name,
               source_type, target_type, entity_type,
               MAX(event_time), COUNT(*)
        FROM system.access.table_lineage
        WHERE target_table_full_name IN (frontier)  -- upstream
           OR source_table_full_name IN (frontier)  -- downstream
        GROUP BY source, target, source_type, target_type, entity_type

     b. Collect new edges
     c. Identify newly discovered tables (not in visited set)
     d. Add to visited, form next frontier

  4. Deduplicate edges:
     Key = sourceTableFqn|targetTableFqn|entityType
     Keep edge with highest eventCount

  RETURN { edges[], discoveredTables[], depth }
```

### Configuration

| Parameter | Default | Max | Description |
| --- | --- | --- | --- |
| `maxDepth` | 3 | 5 | BFS traversal depth |
| `direction` | `"both"` | -- | `"both"`, `"upstream"`, or `"downstream"` |
| `maxDiscoveredTables` | 500 | -- | Safety limit to prevent runaway expansion |

### Graceful Degradation

If `system.access.table_lineage` is not accessible (insufficient permissions or system tables not enabled), the walker returns an empty graph and the scan continues without lineage data. This is logged as a warning but does not fail the scan.

---

## Health Scoring Rules

Each table starts with a score of 100. Rules deduct points for detected issues.

| Rule ID | Deduction | Condition | Issue Description |
| --- | --- | --- | --- |
| `no_optimize_30d` | -15 | No OPTIMIZE operation in 30 days | Table may have small file accumulation |
| `no_vacuum_30d` | -15 | No VACUUM operation in 30 days | Old files not cleaned up, wasting storage |
| `small_file_problem` | -20 | Average file size < 32 MB | Small files degrade query performance |
| `no_comment` | -10 | Table has no comment/description | Poor discoverability for other users |
| `high_partition_count` | -10 | > 100 partition columns | Over-partitioning causes metadata overhead |
| `stale_data_90d` | -15 | No write operations in 90 days | Table may be abandoned or unused |
| `no_cdf_with_streaming` | -10 | Has streaming writes but CDF disabled | Downstream consumers can't track changes |
| `outdated_delta_protocol` | -5 | Reader version < 2 | Missing performance features from newer protocol |
| `empty_table` | -10 | Table has zero rows (not a view) | May indicate failed ingestion or abandoned asset |
| `very_large_table` | -5 | Table has > 1 billion rows | Needs careful partitioning, clustering, and maintenance scheduling |

Each rule generates:
- An **issue** description explaining the problem
- A **recommendation** with specific remediation steps

---

## ERD Generation & Visualisation

### Graph Building (`lib/export/erd-generator.ts`)

The ERD graph is built from three data sources:

1. **Nodes**: One node per table from `ForgeTableDetail`, with:
   - `tableFqn`, `displayName` (short name)
   - `domain`, `tier` (from LLM passes)
   - `hasPII` flag (from sensitivity detection)
   - `size` (from DESCRIBE DETAIL)
   - `rowCount` (from table statistics or operation metrics)

2. **Edges -- Implicit Relationships**: Extracted from `ForgeTableInsight` where `insightType === "implicit_relationship"`. These are LLM-discovered join paths without formal FK constraints.

3. **Edges -- Lineage**: From `ForgeTableLineage` records. These represent actual data flow (ETL pipelines, views, streaming).

### Filtering Options

| Option | Default | Description |
| --- | --- | --- |
| `includeImplicit` | `true` | Show LLM-discovered implicit relationships |
| `includeLineage` | `true` | Show lineage data flow edges |
| `domain` | all | Filter to a specific business domain |

### Mermaid Export

Two Mermaid diagram formats are available:

- **`generateMermaidERD`**: ER diagram with entities and relationships (FK = solid line, implicit = dotted line)
- **`generateMermaidLineageFlow`**: Flowchart LR with directional lineage edges

### Interactive Viewer (`components/environment/erd-viewer.tsx`)

The UI uses **React Flow** (@xyflow/react) with **dagre** auto-layout:

- **Node rendering**: Tables as cards with domain badge, tier badge, PII indicator, row count, and storage size
- **Edge types**:
  - Solid blue: explicit foreign keys
  - Dashed orange: LLM-discovered implicit relationships
  - Dotted grey: lineage data flows
- **Features**: Drag-and-drop repositioning, zoom, pan, minimap, controls

---

## Aggregate Estate View

### Purpose

Individual scans cover specific UC scopes (one catalog, one schema). The **aggregate estate view** merges all historical scans into a single, holistic picture of the entire data landscape.

### Merge Strategy (`lib/lakebase/environment-scans.ts`)

```
FUNCTION getAggregateEstateView():
  1. Load all scans ordered by createdAt DESC (newest first)

  2. Details: Query all ForgeTableDetail records
     → Keep FIRST (newest) record per tableFqn
     → Newer scans always override older ones

  3. Histories: Query all ForgeTableHistorySummary records
     → Keep FIRST (newest) per tableFqn

  4. Lineage: Query all ForgeTableLineage records
     → Key: sourceTableFqn::targetTableFqn
     → Keep FIRST (newest) per edge

  5. Insights: Query all ForgeTableInsight records
     → Key: insightType::tableFqn
     → Keep FIRST (newest) per insight type per table

  6. Compute aggregate stats:
     - totalTables (unique tableFqns)
     - totalScans (count of all scans)
     - totalSizeBytes (sum)
     - totalRows (sum of numRows where available)
     - domainCount (distinct domains)
     - piiTablesCount (from sensitivity data)
     - avgGovernanceScore (mean of per-table governance scores)
     - oldestScanAt / newestScanAt
     - coverageByScope (scan-level breakdown)

  RETURN { details, histories, lineage, insights, stats }
```

### Key Design Decisions

- **Latest wins**: When the same table appears in multiple scans, the newest scan's data takes precedence. This ensures the aggregate view reflects the current state.
- **Additive scope**: Scans of different scopes are additive. Scan `catalog_a` then scan `catalog_b` and the aggregate contains both.
- **Coverage transparency**: The `coverageByScope` array lets users see which scans contribute to the aggregate and when each was last refreshed.

---

## Executive Summary Intelligence

The estate view includes an **Executive Summary** component that translates raw scan data into strategic findings. It operates in two layers:

### Business Perspective

Findings oriented toward data leaders, CDOs, and business stakeholders:

| Finding | Trigger | Message Focus |
| --- | --- | --- |
| Your Data Landscape | Always | Scale of the estate, storage, scope -- framing the data asset |
| Self-Service Readiness | Undocumented tables exist | Percentage of tables analysts can discover without help |
| Business Data Products | Data products identified | Maturity breakdown (productised / curated / raw) and what it means for self-service |
| Regulatory & Privacy Exposure | PII tables detected | Number of tables with PII, regulation implications, remediation urgency |
| Data Discoverability | Tables missing domain categorisation | Impact on analyst productivity and data-driven decision making |
| Wasted Spend & Inconsistency Risk | Redundant tables found | Storage cost implications and risk of conflicting data |

### Technical Detail

Concise technical findings for platform engineers and data engineers:

| Finding | Trigger | Message Focus |
| --- | --- | --- |
| Estate Composition | Always | Format breakdown, managed vs external, views, table types |
| Undocumented Relationships | Implicit relationships found | Count and significance for query optimisation |
| Governance Score | Governance scores available | Average score, distribution, lowest-scoring tables |
| Views in the Estate | Views present | View count and lineage coverage |

### Severity Levels

Each finding is assigned a severity that drives visual treatment:

- **Critical**: Red icon -- immediate action required
- **High**: Orange icon -- address soon
- **Medium**: Yellow icon -- monitor and plan
- **Info**: Blue icon -- awareness

---

## Scan Progress & Live Feedback

### Architecture

The scan progress system uses an **in-memory store** (`lib/pipeline/scan-progress.ts`) with a 30-minute TTL per entry.

```
Client (UI)                    Server
    │                              │
    │  POST /api/environment-scan  │
    │ ────────────────────────────►│  → Starts async scan
    │  { scanId }                  │  → initScanProgress(scanId)
    │ ◄────────────────────────────│
    │                              │
    │  GET .../progress (poll 2s)  │
    │ ────────────────────────────►│  → getScanProgress(scanId)
    │  { phase, counters, ... }    │
    │ ◄────────────────────────────│
    │                              │
    │  ... repeated polling ...    │
    │                              │
    │  { phase: "complete" }       │
    │ ◄────────────────────────────│  → Scan done, progress expires after 30m
```

### Progress Phases

| Phase | Description |
| --- | --- |
| `starting` | Scan initialising |
| `listing-tables` | Discovering tables and columns |
| `fetching-metadata` | Gathering initial metadata |
| `walking-lineage` | BFS lineage traversal |
| `enriching` | Running DESCRIBE DETAIL/HISTORY for each table |
| `fetching-tags` | Collecting table and column tags |
| `health-scoring` | Computing health scores |
| `llm-intelligence` | Running LLM passes (with current pass name) |
| `saving` | Persisting to Lakebase |
| `complete` | Scan finished successfully |
| `failed` | Scan failed (with error message) |

### Live Counters

| Counter | Description |
| --- | --- |
| `tablesFound` | Total tables discovered (including lineage-expanded) |
| `columnsFound` | Total columns discovered |
| `lineageTablesFound` | Tables discovered via lineage walk |
| `lineageEdgesFound` | Lineage edges found |
| `enrichedCount` / `enrichTotal` | Enrichment progress (X of Y) |
| `llmPass` | Current LLM pass name |
| `domainsFound` | Business domains identified |
| `piiDetected` | Tables with PII detected |
| `elapsedMs` | Wall-clock time since scan start |

---

## Excel Export

The environment Excel export (`lib/export/environment-excel.ts`) generates a comprehensive 12-sheet workbook:

| Sheet # | Sheet Name | Key Columns |
| --- | --- | --- |
| 1 | Executive Summary | Metric, Value |
| 2 | Table Inventory | FQN, Domain, Subdomain, Tier, Type, Format, Owner, Size, Files, Managed, Description, Created, Modified, Discovered Via |
| 3 | Data Domains | Domain, Subdomain, Table Count, Total Size, Tables |
| 4 | Data Products | Product Name, Description, Domain, Maturity, Owner, Tables |
| 5 | Sensitivity & PII | Table FQN, Column, Classification, Confidence, Reason, Regulation |
| 6 | Implicit Relationships | Source Table, Source Column, Target Table, Target Column, Confidence, Reasoning |
| 7 | Redundancy Report | Table A, Table B, Similarity %, Shared Columns, Reason, Recommendation |
| 8 | Governance Scorecard | Table FQN, Score, Gap Categories, Top Gaps, Recommendations |
| 9 | Table Health | FQN, Domain, Health Score, Issues, Recommendations, Last OPTIMIZE, Last VACUUM, Streaming, CDF |
| 10 | Lineage | Source FQN, Target FQN, Source Type, Target Type, Entity Type, Last Event, Event Count |
| 11 | History Insights | FQN, Total Writes, Streaming Ops, OPTIMIZE, VACUUM, MERGE, Last Write, History Span |
| 12 | Tags & Properties | Table FQN, Source (Tag/Property), Name, Value |

Each sheet includes auto-fitted column widths, header styling, and data type formatting.

---

## API Reference

| Route | Method | Description |
| --- | --- | --- |
| `/api/environment/aggregate` | GET | Returns the merged aggregate estate view (all scans combined) |
| `/api/environment/aggregate/erd` | GET | ERD graph for the aggregate estate. Params: `format` (json/mermaid), `includeImplicit`, `includeLineage`, `domain` |
| `/api/environment-scan` | GET | List all recent environment scans |
| `/api/environment-scan` | POST | Start a new scan. Body: `{ ucMetadata }` |
| `/api/environment-scan/[scanId]` | GET | Full details of a specific scan |
| `/api/environment-scan/[scanId]/progress` | GET | Live progress for an in-flight scan (404 when not tracked) |
| `/api/environment-scan/[scanId]/erd` | GET | ERD graph for a specific scan. Params: `format`, `includeFKs`, `includeImplicit`, `includeLineage`, `domain` |
| `/api/environment-scan/[scanId]/export` | GET | Download Excel export. Params: `format=excel` |

---

## Privacy Model

The estate engine follows the same privacy principles as the discovery pipeline:

- **Metadata only**: Only structural metadata is read -- table names, column names, types, comments, tags, and system table records. **No data rows are ever accessed.**
- **System tables**: Lineage data comes from `system.access.table_lineage`, which records data flow events without exposing row content.
- **LLM inputs**: Only table names, column names, column types, comments, and tags are sent to the LLM. No data values, no sample rows, no query results.
- **LLM provider**: All LLM calls go through Databricks Model Serving, keeping data within the Databricks security boundary.
- **Column-level PII detection**: Inferred from column names and types only (e.g. `email`, `phone_number`, `ssn`), not from scanning actual values.

---

## Row & Size Statistics

The estate engine extracts row counts and size data without running expensive `SELECT COUNT(*)` queries. Instead, it leverages existing metadata:

### Sources of Row Counts

1. **Table Properties** (`SHOW TBLPROPERTIES`): The `spark.sql.statistics.numRows` property is populated when `ANALYZE TABLE` has been run on a table. This is the most reliable source.

2. **Operation Metrics** (`DESCRIBE HISTORY`): Delta table history records include `operationMetrics` JSON for write operations. The engine parses:
   - `numOutputRows` (or `numTargetRowsInserted` for MERGE) → `lastWriteRows`
   - `numOutputBytes` (or `numAddedBytes`) → `lastWriteBytes`

3. **Priority**: Table property stats take precedence. If unavailable, the engine falls back to operation metrics from the most recent write.

### Where Row Counts Appear

| Location | Field | Display |
| --- | --- | --- |
| Aggregate summary card | `totalRows` | Formatted with K/M/B suffix |
| Single scan summary card | `totalRows` | Formatted with K/M/B suffix |
| Table list column | `numRows` | Formatted with K/M/B suffix |
| ERD node (collapsed) | `rowCount` | Compact format (e.g. "1.2M rows") |
| Excel: Executive Summary | Total Rows metric | Formatted |
| Excel: Table Inventory | Rows column | Formatted |
| Excel: History Insights | Last Write Rows, Last Write Bytes | Formatted |

### Governance Score on Table Details

The `governanceScore` field on `ForgeTableDetail` is populated from the health scoring phase during scan persistence. This enables:
- Per-table governance display in the table list (colour-coded: green ≥ 70, amber ≥ 40, red < 40)
- Accurate aggregate `avgGovernanceScore` computation across all tables
- Filtering and sorting by governance quality

---

## Constants & Tuning Parameters

| Parameter | Value | Location | Description |
| --- | --- | --- | --- |
| LLM batch size (default) | 40 | `environment-intelligence.ts` | Tables per LLM batch |
| LLM batch size (redundancy) | 80 | `environment-intelligence.ts` | Larger batch for cross-table comparison |
| LLM batch size (relationships) | 60 | `environment-intelligence.ts` | Larger batch for relationship inference |
| LLM temperature | 0.2 | `environment-intelligence.ts` | Low temperature for deterministic output |
| Enrichment concurrency | 5 | `metadata-detail.ts` | Parallel DESCRIBE DETAIL/HISTORY calls |
| Lineage max depth | 3 (max 5) | `lineage.ts` | BFS traversal depth |
| Lineage max discovered tables | 500 | `lineage.ts` | Safety limit for BFS expansion |
| Health score starting | 100 | `health-score.ts` | Perfect score before deductions |
| Health deduction range | 5--20 | `health-score.ts` | Per-rule deduction amounts |
| Scan progress TTL | 30 min | `scan-progress.ts` | In-memory progress entry lifetime |
| UI progress poll interval | 2 sec | `page.tsx` | Client-side polling frequency |
| Small file threshold | 32 MB | `health-score.ts` | Below this = small file problem |
| Stale data threshold | 90 days | `health-score.ts` | No writes = stale |
| Maintenance threshold | 30 days | `health-score.ts` | No OPTIMIZE/VACUUM = overdue |
| Empty table deduction | -10 | `health-score.ts` | Zero rows on non-view table |
| Very large table deduction | -5 | `health-score.ts` | > 1 billion rows |
