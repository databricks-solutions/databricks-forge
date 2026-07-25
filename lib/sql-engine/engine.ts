/**
 * Unified SQL Engine.
 *
 * Provides a composable generate -> validate -> review -> fix pipeline
 * for all SQL generation surfaces. Accepts an LLMClient via the ports
 * layer so it can be used standalone or injected into any engine.
 *
 * This does NOT replace the domain-specific prompt templates in each
 * engine -- those are still the responsibility of each caller. The SQL
 * Engine provides the common infrastructure around SQL quality: rules
 * injection, validation, review, and fixing.
 *
 * @module sql-engine/engine
 */

import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type {
  SqlGenerateRequest,
  SqlGenerateResult,
  SqlValidateRequest,
  SqlValidateResult,
  SqlReviewRequest,
  SqlBatchReviewRequest,
  SqlEngineConfig,
} from "./types";
import type { ReviewResult, BatchReviewResult } from "@/lib/ai/sql-reviewer";
import {
  DATABRICKS_SQL_RULES,
  DATABRICKS_SQL_RULES_COMPACT,
  DATABRICKS_SQL_REVIEW_CHECKLIST,
} from "@/lib/toolkit/sql-rules";

// ---------------------------------------------------------------------------
// SQL Engine Interface
// ---------------------------------------------------------------------------

export interface SqlEngine {
  generate(request: SqlGenerateRequest): Promise<SqlGenerateResult>;
  validate(request: SqlValidateRequest): SqlValidateResult;
  review(request: SqlReviewRequest): Promise<ReviewResult>;
  reviewBatch(request: SqlBatchReviewRequest): Promise<BatchReviewResult[]>;
  getRules(): string;
  getRulesCompact(): string;
  getReviewChecklist(): string;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface SqlEngineDeps {
  llm: LLMClient;
  logger: Logger;
  config?: SqlEngineConfig;
  reviewFn?: (
    sql: string,
    opts?: { schemaContext?: string; surface?: string; requestFix?: boolean; maxTokens?: number },
  ) => Promise<ReviewResult>;
  reviewBatchFn?: (
    items: Array<{ id: string; sql: string; context?: string }>,
    surface?: string,
    schemaContext?: string,
  ) => Promise<BatchReviewResult[]>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const PASS_THROUGH: ReviewResult = {
  verdict: "pass",
  qualityScore: 100,
  issues: [],
  suggestions: [],
};

export function createSqlEngine(deps: SqlEngineDeps): SqlEngine {
  const { llm, logger: log, config = {} } = deps;

  return {
    async generate(request: SqlGenerateRequest): Promise<SqlGenerateResult> {
      const response = await llm.chat({
        endpoint: request.endpoint,
        messages: [{ role: "user", content: request.prompt }],
        temperature: request.temperature ?? 0.2,
        maxTokens: request.maxTokens,
        responseFormat: request.responseFormat,
        signal: request.signal,
      });

      const sql = response.content
        .replace(/^```(?:sql)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();

      return {
        sql,
        raw: response.content,
        usage: response.usage,
      };
    },

    validate(request: SqlValidateRequest): SqlValidateResult {
      const invalidRefs: string[] = [];
      const sqlLower = request.sql.toLowerCase();

      if (request.allowedTables) {
        for (const table of request.allowedTables) {
          if (!sqlLower.includes(table.toLowerCase())) continue;
        }
      }

      if (request.allowedColumns) {
        for (const [table, cols] of request.allowedColumns) {
          const tableLower = table.toLowerCase();
          if (!sqlLower.includes(tableLower)) continue;

          for (const col of cols) {
            if (!sqlLower.includes(col.toLowerCase())) {
              invalidRefs.push(`${table}.${col}`);
            }
          }
        }
      }

      return {
        valid: invalidRefs.length === 0,
        invalidReferences: invalidRefs,
      };
    },

    async review(request: SqlReviewRequest): Promise<ReviewResult> {
      if (config.reviewEnabled === false) return PASS_THROUGH;
      if (!request.sql || request.sql.trim().length < 10) return PASS_THROUGH;

      if (deps.reviewFn) {
        return deps.reviewFn(request.sql, {
          schemaContext: request.schemaContext,
          surface: request.surface,
          requestFix: request.requestFix,
          maxTokens: request.maxTokens,
        });
      }

      log.warn("SQL review requested but no reviewFn provided, passing through");
      return PASS_THROUGH;
    },

    async reviewBatch(request: SqlBatchReviewRequest): Promise<BatchReviewResult[]> {
      if (config.reviewEnabled === false || request.items.length === 0) {
        return request.items.map((item) => ({ id: item.id, result: PASS_THROUGH }));
      }

      if (deps.reviewBatchFn) {
        return deps.reviewBatchFn(request.items, request.surface, request.schemaContext);
      }

      log.warn("SQL batch review requested but no reviewBatchFn provided, passing through");
      return request.items.map((item) => ({ id: item.id, result: PASS_THROUGH }));
    },

    getRules(): string {
      return DATABRICKS_SQL_RULES;
    },

    getRulesCompact(): string {
      return DATABRICKS_SQL_RULES_COMPACT;
    },

    getReviewChecklist(): string {
      return DATABRICKS_SQL_REVIEW_CHECKLIST;
    },
  };
}
