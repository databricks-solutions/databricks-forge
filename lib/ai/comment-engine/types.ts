/**
 * Comment Engine types.
 *
 * @module ai/comment-engine/types
 */

import type { SchemaContext } from "@/lib/metadata/types";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";

// ---------------------------------------------------------------------------
// Dependency Injection
// ---------------------------------------------------------------------------

/**
 * Optional injectable dependencies for the Comment Engine.
 *
 * When provided, the engine uses these instead of hard-coded imports.
 * This enables portability: callers can supply a pre-built schema context,
 * a custom LLM client, or a different logger.
 */
export interface CommentEngineDeps {
  /** LLM client for all generation passes. Falls back to cachedChatCompletion. */
  llm?: LLMClient;
  /** Logger. Falls back to @/lib/logger. */
  logger?: Logger;
  /**
   * Pre-built schema context. When provided, the engine skips Phase 0+1
   * (metadata fetch + classification) entirely, making it portable to
   * environments without a Databricks SQL warehouse.
   */
  schemaContext?: SchemaContext;
  /** Pre-built industry context prompt. When provided, skips the domain module lookup. */
  industryContext?: string;
  /** Pre-built data asset context text. */
  dataAssetContext?: string;
  /** Pre-built data asset list for use case linkage. */
  dataAssetList?: Array<{ id: string; name: string; description: string; assetFamily: string }>;
  /** Pre-built use case linkage context. */
  useCaseLinkage?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Structured counters for the in-memory progress tracker. */
export interface MetadataCounters {
  tablesFound?: number;
  columnsFound?: number;
  lineageEdgesFound?: number;
  enrichedCount?: number;
  enrichTotal?: number;
  tablesGenerated?: number;
  columnsGenerated?: number;
  columnTablesProcessed?: number;
  currentTable?: string | null;
  tableBatches?: number;
  tableBatchesDone?: number;
  consistencyFixes?: number;
}

/**
 * Output language for generated metadata descriptions.
 * Independent from the UI locale -- a user can run the UI in English
 * and request descriptions in Portuguese.
 */
export type CommentOutputLanguage = "en" | "pt-BR" | "es";

export const COMMENT_OUTPUT_LANGUAGES: readonly CommentOutputLanguage[] = [
  "en",
  "pt-BR",
  "es",
] as const;

export const DEFAULT_COMMENT_OUTPUT_LANGUAGE: CommentOutputLanguage = "en";

export function isCommentOutputLanguage(value: unknown): value is CommentOutputLanguage {
  return (
    typeof value === "string" &&
    (COMMENT_OUTPUT_LANGUAGES as readonly string[]).includes(value)
  );
}

export interface CommentEngineConfig {
  industryId?: string;
  businessContext?: string;
  /**
   * Output language for generated table/column descriptions.
   * Independent from the UI locale. Default: "en".
   */
  outputLanguage?: CommentOutputLanguage;
  /** Enable the consistency review pass (Phase 4). Default: true. */
  enableConsistencyReview?: boolean;
  /** Fetch lineage from system.access.table_lineage. Default: true. */
  enableLineage?: boolean;
  /** Fetch Delta history + DESCRIBE DETAIL. Default: true. */
  enableHistory?: boolean;
  signal?: AbortSignal;
  /** Phase-level progress (phase name + human-readable detail). */
  onProgress?: CommentProgressCallback;
  /** Structured counter updates for the in-memory progress tracker. */
  onMetadataProgress?: (counters: MetadataCounters) => void;
  /** Injectable dependencies for portability. Falls back to defaults. */
  deps?: CommentEngineDeps;
}

export type CommentProgressCallback = (phase: string, pct: number, detail?: string) => void;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface CommentEngineResult {
  /** Table FQN -> generated description. */
  tableComments: Map<string, string>;
  /** Table FQN -> (column name -> generated description). */
  columnComments: Map<string, Map<string, string>>;
  /** The SchemaContext built during Phase 0+1 (exposed for downstream reuse). */
  schemaContext: SchemaContext;
  /** Issues found during consistency review (empty if review disabled or skipped). */
  consistencyFixes: ConsistencyFix[];
  stats: CommentEngineStats;
}

export interface CommentEngineStats {
  tables: number;
  columns: number;
  skipped: number;
  consistencyFixesApplied: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

export interface ConsistencyFix {
  tableFqn: string;
  columnName: string | null;
  issue: string;
  original: string;
  fixed: string;
}

// ---------------------------------------------------------------------------
// Internal pass types
// ---------------------------------------------------------------------------

export interface TableCommentInput {
  fqn: string;
  columns: Array<{ name: string; dataType: string }>;
  existingComment: string | null;
  domain: string | null;
  role: string | null;
  tier: string | null;
  dataAssetId: string | null;
  dataAssetName: string | null;
  writeFrequency: string | null;
  owner: string | null;
  tags: string[];
  relatedTableFqns: string[];
}

export interface ColumnCommentInput {
  tableFqn: string;
  tableDescription: string;
  tableDomain: string | null;
  tableRole: string | null;
  dataAssetId: string | null;
  dataAssetDescription: string | null;
  columns: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
    existingComment: string | null;
    inferredRole: string | null;
    inferredFkTarget: string | null;
  }>;
  /** Descriptions of tables in the same domain or with FK relationships. */
  relatedTables: Array<{ fqn: string; description: string }>;
}
