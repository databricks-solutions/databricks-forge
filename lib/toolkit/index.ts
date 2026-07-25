/**
 * Shared toolkit -- cross-cutting utilities used by multiple engines.
 *
 * Every module here is engine-agnostic and has no Forge-specific domain
 * imports. Databricks infrastructure deps (model-serving, rate-limiter)
 * will be replaced by port interfaces in Phase 3.
 *
 * @module toolkit
 */

export { createConcurrencyLimiter, mapWithConcurrency } from "./concurrency";
export { parseLLMJson } from "./parse-llm-json";
export { cachedChatCompletion, clearLLMCache, llmCacheSize } from "./llm-cache";
export {
  DATABRICKS_SQL_RULES,
  DATABRICKS_SQL_RULES_COMPACT,
  DATABRICKS_SQL_REVIEW_CHECKLIST,
  DATABRICKS_DATA_MODELING_RULES,
} from "./sql-rules";
export {
  MAX_PROMPT_TOKENS,
  estimateTokens,
  estimatePromptTokens,
  buildTokenAwareBatches,
  TokenBudgetExceededError,
  assertWithinBudget,
  truncateColumns,
  truncateComment,
} from "./token-budget";
export { isNonRetryableError, withRetry } from "./retry";
export type { RetryOptions } from "./retry";
