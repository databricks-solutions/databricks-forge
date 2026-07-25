/**
 * Token Budget Engine -- prevents prompt-too-long errors.
 *
 * Provides heuristic token estimation and adaptive batch-building that
 * respects model context limits. Used by all LLM-calling code to size
 * batches dynamically rather than relying on fixed item counts.
 */

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Safety margin below the 200k model limit. This leaves room for system
 * messages, response format overhead, and estimation inaccuracy.
 */
export const MAX_PROMPT_TOKENS = 180_000;

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * Fast heuristic token estimator. Claude/Llama tokenisers average ~3.2-3.5
 * characters per token on mixed English+code text. We use 3.2 (conservative)
 * so estimates skew slightly high -- better to over-estimate and stay safe.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.2);
}

/**
 * Estimate prompt tokens after template variable substitution.
 */
export function estimatePromptTokens(template: string, variables: Record<string, string>): number {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{${key}}`, value);
  }
  return estimateTokens(rendered);
}

// ---------------------------------------------------------------------------
// Adaptive Batch Builder
// ---------------------------------------------------------------------------

/**
 * Greedily pack items into batches such that each batch's total tokens
 * (base prompt overhead + rendered items) stays under the budget.
 *
 * @param items        - The items to partition into batches.
 * @param renderItem   - Serialises one item the same way the prompt will.
 * @param baseTokens   - Tokens consumed by the prompt template excluding items.
 * @param maxBudget    - Per-batch token budget (defaults to MAX_PROMPT_TOKENS).
 * @returns            - Array of batches (each batch is a sub-array of items).
 */
export function buildTokenAwareBatches<T>(
  items: T[],
  renderItem: (item: T) => string,
  baseTokens: number,
  maxBudget: number = MAX_PROMPT_TOKENS,
): T[][] {
  if (items.length === 0) return [];

  const available = maxBudget - baseTokens;
  if (available <= 0) {
    logger.warn("[token-budget] Base prompt already exceeds budget", {
      baseTokens,
      maxBudget,
    });
    return items.map((item) => [item]);
  }

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    const rendered = renderItem(item);
    const itemTokens = estimateTokens(rendered);

    if (currentBatch.length > 0 && currentTokens + itemTokens > available) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(item);
    currentTokens += itemTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  if (batches.length > 0) {
    logger.info("[token-budget] Adaptive batching", {
      totalItems: items.length,
      batches: batches.length,
      baseTokens,
      maxBudget,
      avgBatchSize: Math.round(items.length / batches.length),
    });
  }

  return batches;
}

// ---------------------------------------------------------------------------
// Pre-flight Guard
// ---------------------------------------------------------------------------

/**
 * Error thrown when a prompt would exceed the model context window.
 * Gives clear diagnostics instead of a cryptic 400 from the API.
 */
export class TokenBudgetExceededError extends Error {
  readonly estimatedTokens: number;
  readonly maxTokens: number;
  readonly promptKey: string;

  constructor(promptKey: string, estimatedTokens: number, maxTokens: number) {
    super(
      `Prompt "${promptKey}" estimated at ${estimatedTokens.toLocaleString()} tokens exceeds budget of ${maxTokens.toLocaleString()} tokens`,
    );
    this.name = "TokenBudgetExceededError";
    this.promptKey = promptKey;
    this.estimatedTokens = estimatedTokens;
    this.maxTokens = maxTokens;
  }
}

/**
 * Pre-flight check: estimate prompt tokens and throw if over budget.
 * Call this before sending to Model Serving.
 */
export function assertWithinBudget(
  promptKey: string,
  promptText: string,
  maxBudget: number = MAX_PROMPT_TOKENS,
): void {
  const estimated = estimateTokens(promptText);
  if (estimated > maxBudget) {
    logger.error("[token-budget] Prompt exceeds budget", {
      promptKey,
      estimatedTokens: estimated,
      maxBudget,
      promptChars: promptText.length,
    });
    throw new TokenBudgetExceededError(promptKey, estimated, maxBudget);
  }
}

// ---------------------------------------------------------------------------
// Column Truncation Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a table's column list to a maximum count, appending an ellipsis
 * indicator when columns are omitted.
 */
export function truncateColumns<C>(
  columns: C[],
  maxColumns: number,
): { truncated: C[]; omitted: number } {
  if (columns.length <= maxColumns) {
    return { truncated: columns, omitted: 0 };
  }
  return {
    truncated: columns.slice(0, maxColumns),
    omitted: columns.length - maxColumns,
  };
}

/**
 * Truncate a comment/description string to a maximum length.
 */
export function truncateComment(comment: string | null | undefined, maxLength: number): string {
  if (!comment) return "";
  if (comment.length <= maxLength) return comment;
  return comment.slice(0, maxLength - 3) + "...";
}
