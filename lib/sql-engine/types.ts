/**
 * SQL Engine types.
 *
 * Pure types, no runtime dependencies. Re-exports existing review types
 * for a single import source.
 *
 * @module sql-engine/types
 */

export type {
  ReviewIssue,
  ReviewResult,
  ReviewOptions,
  BatchReviewItem,
  BatchReviewResult,
} from "@/lib/ai/sql-reviewer";

export type SqlRulesLevel = "full" | "compact";

export interface SqlGenerateRequest {
  prompt: string;
  endpoint: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  signal?: AbortSignal;
}

export interface SqlGenerateResult {
  sql: string;
  raw: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface SqlValidateRequest {
  sql: string;
  allowedTables?: Set<string>;
  allowedColumns?: Map<string, Set<string>>;
}

export interface SqlValidateResult {
  valid: boolean;
  invalidReferences: string[];
}

export interface SqlReviewRequest {
  sql: string;
  schemaContext?: string;
  surface?: string;
  requestFix?: boolean;
  maxTokens?: number;
}

export interface SqlBatchReviewRequest {
  items: Array<{ id: string; sql: string; context?: string }>;
  surface?: string;
  schemaContext?: string;
}

export interface SqlEngineConfig {
  reviewEnabled?: boolean;
  rulesLevel?: SqlRulesLevel;
}
