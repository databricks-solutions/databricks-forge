/**
 * Types for the pgvector embedding layer.
 *
 * A single `forge_embeddings` table stores vectors for all entity kinds.
 * The `kind` discriminator allows scoped searches (e.g. only estate tables,
 * only use cases, or all kinds at once).
 */

// ---------------------------------------------------------------------------
// Embedding kinds
// ---------------------------------------------------------------------------

export const EMBEDDING_KINDS = [
  "table_detail",
  "column_profile",
  "use_case",
  "business_context",
  "genie_recommendation",
  "genie_question",
  "environment_insight",
  "table_health",
  "data_product",
  "outcome_map",
  "lineage_context",
  "document_chunk",
  "benchmark_context",
  "fabric_dataset",
  "fabric_measure",
  "fabric_report",
  "fabric_artifact",
  "skill_chunk",
  "industry_kpi",
  "industry_benchmark",
  "industry_data_asset",
  "value_estimate",
  "roadmap_phase",
  "stakeholder_profile",
  "executive_synthesis",
  "company_research",
  "portfolio_entity",
] as const;

export type EmbeddingKind = (typeof EMBEDDING_KINDS)[number];

/** Search scope maps to sets of embedding kinds. */
export const SEARCH_SCOPES: Record<string, readonly EmbeddingKind[]> = {
  estate: [
    "table_detail",
    "column_profile",
    "environment_insight",
    "table_health",
    "data_product",
    "lineage_context",
  ],
  usecases: ["use_case", "business_context"],
  genie: ["genie_recommendation", "genie_question"],
  insights: ["environment_insight", "table_health", "data_product"],
  documents: ["document_chunk"],
  benchmarks: ["benchmark_context", "outcome_map", "industry_benchmark"],
  fabric: ["fabric_dataset", "fabric_measure", "fabric_report", "fabric_artifact"],
  skills: ["skill_chunk", "industry_kpi", "industry_benchmark", "industry_data_asset"],
  strategy: ["value_estimate", "roadmap_phase", "stakeholder_profile", "executive_synthesis"],
  "company-research": ["company_research"],
  all: EMBEDDING_KINDS,
};

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface EmbeddingRecord {
  id: string;
  kind: EmbeddingKind;
  sourceId: string;
  runId: string | null;
  scanId: string | null;
  contentText: string;
  metadataJson: Record<string, unknown> | null;
  embedding: number[];
  createdAt: Date;
}

/** Input for upserting embeddings (id is auto-generated). */
export interface EmbeddingInput {
  kind: EmbeddingKind;
  sourceId: string;
  runId?: string | null;
  scanId?: string | null;
  contentText: string;
  metadataJson?: Record<string, unknown> | null;
  embedding: number[];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  query: string;
  scope?: keyof typeof SEARCH_SCOPES;
  kinds?: EmbeddingKind[];
  runId?: string;
  scanId?: string;
  /** JSONB metadata filter (e.g. { catalog: "main", domain: "Finance" }). */
  metadataFilter?: Record<string, unknown>;
  topK?: number;
  minScore?: number;
}

export interface SearchResult {
  id: string;
  kind: EmbeddingKind;
  sourceId: string;
  runId: string | null;
  scanId: string | null;
  contentText: string;
  metadataJson: Record<string, unknown> | null;
  score: number;
}

// ---------------------------------------------------------------------------
// RAG retrieval
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  content: string;
  kind: EmbeddingKind;
  sourceId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}
