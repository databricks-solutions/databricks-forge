/**
 * AI Agent -- wrapper for executing LLM calls via Databricks Model Serving.
 *
 * All LLM interactions go through the Foundation Model API (FMAPI) using
 * the OpenAI-compatible chat completions endpoint. This replaces the
 * previous ai_query() SQL path, giving:
 *   - Lower latency (no SQL warehouse overhead or polling)
 *   - Structured output via JSON mode (response_format)
 *   - Token usage metrics for cost tracking
 *   - System/user message separation
 *   - Optional streaming for long-running generations
 *
 * Features:
 * - Temperature control per prompt type (low for structured output,
 *   moderate for creative generation)
 * - Automatic retry with exponential backoff (configurable)
 * - Optional JSON mode for structured responses
 */

import { randomUUID } from "crypto";
import {
  chatCompletion,
  chatCompletionStream,
  EmptyContentError,
  isEmptyContentError,
  ModelServingError,
  type ChatMessage,
  type StreamCallback,
  type TokenUsage,
} from "@/lib/dbx/model-serving";
import { assertWithinBudget, MAX_PROMPT_TOKENS } from "@/lib/toolkit/token-budget";
import { addJitter, DEFAULT_429_BACKOFF_MS } from "@/lib/dbx/rate-limiter";
import { getFallbackEndpoint } from "@/lib/dbx/client";
import { logger } from "@/lib/logger";
import { insertPromptLog } from "@/lib/lakebase/prompt-logs";
import { formatPrompt, PROMPT_VERSIONS, PROMPT_SYSTEM_MESSAGES, type PromptKey } from "./templates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIQueryOptions {
  /** The prompt template key */
  promptKey: PromptKey;
  /** Variables to inject into the template */
  variables: Record<string, string>;
  /** The AI model endpoint to use */
  modelEndpoint: string;
  /**
   * Temperature for the LLM (0.0 - 1.0).
   * Low (0.1-0.3): scoring, classification, SQL generation, dedup.
   * Moderate (0.5-0.7): use case generation, business context.
   * Defaults based on prompt type if not provided.
   */
  temperature?: number;
  /**
   * Maximum tokens for the response.
   * When omitted, no max_tokens constraint is sent — the model uses its
   * own default, which avoids mid-response truncation.
   */
  maxTokens?: number;
  /**
   * Number of retry attempts on failure (default: 2).
   * Set to 0 for no retries.
   */
  retries?: number;
  /**
   * Pipeline run ID. When set, the call is logged to ForgePromptLog
   * for auditing and debugging.
   */
  runId?: string;
  /**
   * Pipeline step context (e.g. "business-context", "sql-generation").
   * Logged alongside runId for per-step filtering.
   */
  step?: string;
  /**
   * When set to "json_object", instructs the model to return valid JSON.
   * The prompt must also mention JSON in its output format instructions.
   * Eliminates the need for markdown fence stripping and bracket-finding.
   */
  responseFormat?: "text" | "json_object";
  /**
   * Optional system message to prepend. When provided, the prompt template
   * content is sent as the "user" message and this becomes the "system"
   * message. Enables better persona/instruction separation.
   */
  systemMessage?: string;
}

export interface AIQueryResult {
  /** Raw response text from the LLM */
  rawResponse: string;
  /** Extracted honesty score (if present, 0.0-1.0) */
  honestyScore: number | null;
  /** The prompt template version hash used for this call */
  promptVersion: string;
  /** Duration of the LLM call in milliseconds */
  durationMs: number;
  /** Token usage statistics (prompt, completion, total). Null if unavailable. */
  tokenUsage: TokenUsage | null;
  /** Model finish reason ("stop", "length", etc.). "length" indicates truncation. */
  finishReason: string | null;
  /**
   * The resolved endpoint that actually produced this response. May differ
   * from the caller's `modelEndpoint` when the agent rotated to a fallback
   * after 429 / empty-content. Surfaced so callers can record provenance.
   */
  endpoint: string;
}

// Re-export TokenUsage for consumers
export type { TokenUsage } from "@/lib/dbx/model-serving";

// ---------------------------------------------------------------------------
// Pipeline cancellation registry
// ---------------------------------------------------------------------------

/**
 * Thrown when a pipeline run has been cancelled by the user or by delete-all.
 * Caught by the pipeline engine to set status to "cancelled" (not "failed").
 */
export class PipelineCancelledError extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`Pipeline run ${runId} was cancelled`);
    this.name = "PipelineCancelledError";
    this.runId = runId;
  }
}

const cancelledRunIds = new Set<string>();

export function markRunCancelled(runId: string): void {
  cancelledRunIds.add(runId);
}

export function clearRunCancelled(runId: string): void {
  cancelledRunIds.delete(runId);
}

// ---------------------------------------------------------------------------
// Global concurrency semaphore
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_LLM_CALLS = Math.max(
  1,
  parseInt(process.env.LLM_MAX_CONCURRENT ?? "10", 10) || 10,
);

/**
 * Simple async semaphore to cap total in-flight LLM calls across all
 * pipeline steps. Works as a secondary cap alongside the global rate
 * limiter in model-serving.ts.
 * Override with LLM_MAX_CONCURRENT env var (default: 10).
 */
class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const llmSemaphore = new Semaphore(MAX_CONCURRENT_LLM_CALLS);

// ---------------------------------------------------------------------------
// Per-prompt temperature configuration
// ---------------------------------------------------------------------------
// Ported from the reference notebook's TECHNICAL_CONTEXT.
// Low temps (0.1-0.2) for structured/deterministic output (scoring, SQL, classification).
// Medium temps (0.3-0.5) for semi-structured reasoning (business context, domains, dedup).
// Higher temps (0.7-0.8) for creative generation (use case ideation).

const PROMPT_TEMPERATURES: Partial<Record<PromptKey, number>> = {
  // Phase 1: Initialization
  BUSINESS_CONTEXT_WORKER_PROMPT: 0.3,
  // Phase 2: Table Filtering
  FILTER_BUSINESS_TABLES_PROMPT: 0.2,
  // Phase 3: Use Case Generation (creative -- needs diversity)
  AI_USE_CASE_GEN_PROMPT: 0.8,
  STATS_USE_CASE_GEN_PROMPT: 0.7,
  // Phase 4: Domain Clustering
  DOMAIN_FINDER_PROMPT: 0.5,
  SUBDOMAIN_DETECTOR_PROMPT: 0.4,
  DOMAINS_MERGER_PROMPT: 0.4,
  // Phase 5: Scoring & Deduplication (deterministic)
  SCORE_USE_CASES_PROMPT: 0.2,
  REVIEW_USE_CASES_PROMPT: 0.3,
  GLOBAL_SCORE_CALIBRATION_PROMPT: 0.2,
  CROSS_DOMAIN_DEDUP_PROMPT: 0.3,
  // Phase 6: SQL Generation (precise)
  USE_CASE_SQL_GEN_PROMPT: 0.1,
  USE_CASE_SQL_FIX_PROMPT: 0.1,
  // Phase 7: Outcome Map Parsing
  PARSE_OUTCOME_MAP: 0.2,
  // Environment Intelligence
  ENV_DOMAIN_CATEGORISATION_PROMPT: 0.3,
  ENV_PII_DETECTION_PROMPT: 0.1,
  ENV_AUTO_DESCRIPTIONS_PROMPT: 0.3,
  ENV_REDUNDANCY_DETECTION_PROMPT: 0.2,
  ENV_IMPLICIT_RELATIONSHIPS_PROMPT: 0.2,
  ENV_MEDALLION_TIER_PROMPT: 0.2,
  ENV_DATA_PRODUCTS_PROMPT: 0.4,
  ENV_GOVERNANCE_GAPS_PROMPT: 0.2,
  // Business Value
  FINANCIAL_QUANTIFICATION_PROMPT: 0.2,
  ROADMAP_PHASING_PROMPT: 0.2,
  EXECUTIVE_SYNTHESIS_PROMPT: 0.4,
  STAKEHOLDER_ANALYSIS_PROMPT: 0.2,
};

function getDefaultTemperature(promptKey: PromptKey): number {
  return PROMPT_TEMPERATURES[promptKey] ?? 0.3;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute an LLM call via Databricks Model Serving (FMAPI) and return
 * the raw response.
 *
 * Uses the chat completions endpoint with system/user message separation.
 * Retries on transient failures with exponential backoff.
 *
 * Endpoint: POST /serving-endpoints/{endpoint}/invocations
 * Docs: https://docs.databricks.com/en/machine-learning/model-serving/score-foundation-models.html
 */
export async function executeAIQuery(options: AIQueryOptions): Promise<AIQueryResult> {
  const maxRetries = options.retries ?? 2;
  const temperature = options.temperature ?? getDefaultTemperature(options.promptKey);
  const maxTokens = options.maxTokens;
  const promptVersion = PROMPT_VERSIONS[options.promptKey] ?? "unknown";

  // Pre-render the prompt once for logging (executeAIQueryOnce also renders it,
  // but we need it here to log on both success and failure paths)
  const renderedPrompt = options.runId ? formatPrompt(options.promptKey, options.variables) : "";

  // Pre-flight token budget check
  const preflightPrompt = renderedPrompt || formatPrompt(options.promptKey, options.variables);
  assertWithinBudget(options.promptKey, preflightPrompt, MAX_PROMPT_TOKENS);

  // Check cancellation before acquiring the semaphore (avoids queueing doomed calls)
  if (options.runId && cancelledRunIds.has(options.runId)) {
    throw new PipelineCancelledError(options.runId);
  }

  let lastError: Error | null = null;
  let exhausted429 = false;
  let exhaustedEmptyContent = false;

  await llmSemaphore.acquire();
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check cancellation before each attempt
      if (options.runId && cancelledRunIds.has(options.runId)) {
        throw new PipelineCancelledError(options.runId);
      }

      try {
        if (attempt > 0) {
          const backoffMs = addJitter(Math.min(2000 * Math.pow(2, attempt - 1), 10000));
          logger.info("FMAPI retrying", {
            promptKey: options.promptKey,
            attempt,
            maxRetries,
            backoffMs: Math.round(backoffMs),
          });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        const result = await executeAIQueryOnce(options, temperature, maxTokens);

        // Fire-and-forget: log successful call
        if (options.runId) {
          insertPromptLog({
            logId: randomUUID(),
            runId: options.runId,
            step: options.step ?? options.promptKey,
            promptKey: options.promptKey,
            promptVersion,
            model: options.modelEndpoint,
            temperature,
            renderedPrompt,
            rawResponse: result.rawResponse,
            honestyScore: result.honestyScore,
            durationMs: result.durationMs,
            tokenUsage: result.tokenUsage,
            success: true,
            errorMessage: null,
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("FMAPI attempt failed", {
          promptKey: options.promptKey,
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message,
        });

        // 429 rate-limit: retryable with jittered backoff
        if (isRateLimitError(lastError)) {
          const baseRetryMs =
            lastError instanceof ModelServingError && lastError.retryAfterMs
              ? lastError.retryAfterMs
              : DEFAULT_429_BACKOFF_MS;
          const retryAfterMs = addJitter(baseRetryMs);
          logger.warn("FMAPI rate-limited (429), backing off with jitter", {
            promptKey: options.promptKey,
            retryAfterMs: Math.round(retryAfterMs),
          });
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          continue;
        }

        // Empty-content: model returned no text (reasoning-only, refusal, or
        // abandoned a large prompt). Retry quickly; on exhaustion, the
        // fallback path below rotates to the next-priority endpoint.
        if (isEmptyContentError(lastError)) {
          const retryAfterMs = addJitter(2_000);
          logger.warn("FMAPI returned empty content, backing off briefly", {
            promptKey: options.promptKey,
            endpoint: options.modelEndpoint,
            finishReason: lastError.finishReason,
            retryAfterMs: Math.round(retryAfterMs),
          });
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          continue;
        }

        // Don't retry on other client errors (4xx) -- these are non-retryable
        if (isNonRetryableError(lastError)) {
          break;
        }
      }
    }

    // If we exited the loop due to 429s or empty content, mark for fallback.
    if (lastError && isRateLimitError(lastError)) {
      exhausted429 = true;
    } else if (lastError && isEmptyContentError(lastError)) {
      exhaustedEmptyContent = true;
    }
  } finally {
    llmSemaphore.release();
  }

  // Attempt fallback endpoint when primary is 429-exhausted or empty-content-exhausted
  if (exhausted429 || exhaustedEmptyContent) {
    const fallback = getFallbackEndpoint(options.modelEndpoint);
    if (fallback) {
      logger.warn("FMAPI falling back to alternate endpoint", {
        promptKey: options.promptKey,
        from: options.modelEndpoint,
        to: fallback,
      });
      const fallbackOpts = { ...options, modelEndpoint: fallback };
      for (let fa = 0; fa < 2; fa++) {
        try {
          if (fa > 0) {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
          await llmSemaphore.acquire();
          try {
            const result = await executeAIQueryOnce(fallbackOpts, temperature, maxTokens);

            if (options.runId) {
              insertPromptLog({
                logId: randomUUID(),
                runId: options.runId,
                step: options.step ?? options.promptKey,
                promptKey: options.promptKey,
                promptVersion,
                model: fallback,
                temperature,
                renderedPrompt,
                rawResponse: result.rawResponse,
                honestyScore: result.honestyScore,
                durationMs: result.durationMs,
                tokenUsage: result.tokenUsage,
                success: true,
                errorMessage: null,
              });
            }

            return result;
          } finally {
            llmSemaphore.release();
          }
        } catch (fbError) {
          lastError = fbError instanceof Error ? fbError : new Error(String(fbError));
          logger.warn("FMAPI fallback attempt failed", {
            promptKey: options.promptKey,
            attempt: fa + 1,
            endpoint: fallback,
            error: lastError.message,
          });
        }
      }
    }
  }

  // Fire-and-forget: log failed call (after all retries exhausted)
  if (options.runId && lastError) {
    insertPromptLog({
      logId: randomUUID(),
      runId: options.runId,
      step: options.step ?? options.promptKey,
      promptKey: options.promptKey,
      promptVersion,
      model: options.modelEndpoint,
      temperature,
      renderedPrompt,
      rawResponse: null,
      honestyScore: null,
      durationMs: null,
      tokenUsage: null,
      success: false,
      errorMessage: lastError.message,
    });
  }

  throw lastError ?? new Error(`FMAPI call failed for ${options.promptKey}`);
}

/**
 * Check if an error is a 429 rate-limit error (retryable with backoff).
 */
function isRateLimitError(error: Error): boolean {
  if (error instanceof ModelServingError) {
    return error.statusCode === 429;
  }
  return error.message.includes("(429)") || error.message.includes("REQUEST_LIMIT_EXCEEDED");
}

/**
 * Check if an error is non-retryable (4xx client errors, excluding 429).
 * Only retry on 5xx, 429, timeouts, and network errors.
 */
function isNonRetryableError(error: Error): boolean {
  // 429 is retryable -- handled separately
  if (isRateLimitError(error)) return false;

  // Direct status code check for ModelServingError
  if (error instanceof ModelServingError) {
    return error.statusCode >= 400 && error.statusCode < 500;
  }

  const msg = error.message;
  // Match HTTP 4xx status codes in error messages
  const httpStatusMatch = msg.match(/\((\d{3})\)/);
  if (httpStatusMatch) {
    const status = parseInt(httpStatusMatch[1], 10);
    if (status === 429) return false; // retryable
    if (status >= 400 && status < 500) return true;
  }
  // Check for specific non-retryable error patterns
  if (msg.includes("INSUFFICIENT_PERMISSIONS")) {
    return true;
  }
  return false;
}

/**
 * Execute a single LLM call via the Databricks Model Serving chat
 * completions endpoint.
 *
 * Builds messages in the system/user format, sends via FMAPI, and
 * extracts the response content along with token usage metrics.
 */
async function executeAIQueryOnce(
  options: AIQueryOptions,
  temperature: number,
  maxTokens: number | undefined,
): Promise<AIQueryResult> {
  const prompt = formatPrompt(options.promptKey, options.variables);
  const promptVersion = PROMPT_VERSIONS[options.promptKey] ?? "unknown";

  // Build chat messages with system/user separation.
  // Use explicit systemMessage if provided, otherwise fall back to the
  // per-prompt system message for better persona/instruction adherence.
  const messages: ChatMessage[] = [];
  const systemMsg = options.systemMessage ?? PROMPT_SYSTEM_MESSAGES[options.promptKey];

  if (systemMsg) {
    messages.push({ role: "system", content: systemMsg });
  }

  messages.push({ role: "user", content: prompt });

  const startTime = Date.now();

  logger.info("FMAPI executing", {
    promptKey: options.promptKey,
    promptVersion,
    model: options.modelEndpoint,
    promptChars: prompt.length,
    temperature,
    responseFormat: options.responseFormat ?? "text",
    ...(maxTokens !== undefined && { maxTokens }),
  });

  const response = await chatCompletion({
    endpoint: options.modelEndpoint,
    messages,
    temperature,
    maxTokens,
    responseFormat: options.responseFormat,
  });

  const rawResponse = response.content;
  const durationMs = Date.now() - startTime;

  if (!rawResponse) {
    // Treat as a typed, retryable, fallback-eligible error so the retry loop
    // can rotate to the next-priority endpoint instead of hammering the same
    // model. See lib/dbx/model-serving.ts -> EmptyContentError.
    throw new EmptyContentError(
      options.promptKey,
      options.modelEndpoint,
      response.finishReason,
    );
  }

  const honestyScore = extractHonestyScore(rawResponse);

  logger.info("FMAPI response received", {
    promptKey: options.promptKey,
    promptVersion,
    model: response.model || options.modelEndpoint,
    responseChars: rawResponse.length,
    durationMs,
    honestyScore,
    finishReason: response.finishReason,
    ...(response.usage && {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
    }),
  });

  // Warn if the response was truncated (finish_reason: "length")
  if (response.finishReason === "length") {
    logger.warn("FMAPI response truncated (hit token limit)", {
      promptKey: options.promptKey,
      completionTokens: response.usage?.completionTokens,
    });
  }

  return {
    rawResponse,
    honestyScore,
    promptVersion,
    durationMs,
    tokenUsage: response.usage,
    finishReason: response.finishReason,
    endpoint: response.model || options.modelEndpoint,
  };
}

// ---------------------------------------------------------------------------
// Streaming Execution
// ---------------------------------------------------------------------------

/**
 * Execute an LLM call with SSE streaming via Databricks Model Serving.
 *
 * Similar to executeAIQuery but streams the response, calling `onChunk`
 * for each content delta. Useful for long-running generations (e.g. SQL)
 * where incremental progress is valuable.
 *
 * Retries on 429 rate-limit errors with a 60s backoff (up to 2 retries).
 * Other errors are not retried since streaming calls are expensive to restart.
 */
export async function executeAIQueryStream(
  options: AIQueryOptions,
  onChunk?: StreamCallback,
): Promise<AIQueryResult> {
  const temperature = options.temperature ?? getDefaultTemperature(options.promptKey);
  const maxTokens = options.maxTokens;
  const promptVersion = PROMPT_VERSIONS[options.promptKey] ?? "unknown";
  const prompt = formatPrompt(options.promptKey, options.variables);

  // Pre-flight token budget check
  assertWithinBudget(options.promptKey, prompt, MAX_PROMPT_TOKENS);

  const messages: ChatMessage[] = [];
  const systemMsg = options.systemMessage ?? PROMPT_SYSTEM_MESSAGES[options.promptKey];
  if (systemMsg) {
    messages.push({ role: "system", content: systemMsg });
  }
  messages.push({ role: "user", content: prompt });

  const streamOpts = {
    endpoint: options.modelEndpoint,
    messages,
    temperature,
    maxTokens,
    responseFormat: options.responseFormat,
  };

  const maxStreamRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxStreamRetries; attempt++) {
    const startTime = Date.now();

    if (attempt > 0 && lastError) {
      // Retry on 429 OR empty content; everything else aborts the stream loop.
      if (!isRateLimitError(lastError) && !isEmptyContentError(lastError)) break;
      const baseRetryMs = isRateLimitError(lastError)
        ? lastError instanceof ModelServingError && lastError.retryAfterMs
          ? lastError.retryAfterMs
          : DEFAULT_429_BACKOFF_MS
        : 2_000;
      const retryAfterMs = addJitter(baseRetryMs);
      logger.warn("FMAPI streaming retrying after retryable error", {
        promptKey: options.promptKey,
        attempt,
        reason: isRateLimitError(lastError) ? "rate_limit" : "empty_content",
        retryAfterMs: Math.round(retryAfterMs),
      });
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }

    logger.info("FMAPI streaming executing", {
      promptKey: options.promptKey,
      promptVersion,
      model: options.modelEndpoint,
      promptChars: prompt.length,
      temperature,
      ...(attempt > 0 && { attempt }),
    });

    try {
      await llmSemaphore.acquire();
      const response = await chatCompletionStream(streamOpts, onChunk).finally(() =>
        llmSemaphore.release(),
      );

      const rawResponse = response.content;
      const durationMs = Date.now() - startTime;

      if (!rawResponse) {
        throw new EmptyContentError(
          options.promptKey,
          options.modelEndpoint,
          response.finishReason,
        );
      }

      const honestyScore = extractHonestyScore(rawResponse);

      logger.info("FMAPI streaming response complete", {
        promptKey: options.promptKey,
        promptVersion,
        model: response.model || options.modelEndpoint,
        responseChars: rawResponse.length,
        durationMs,
        finishReason: response.finishReason,
        ...(response.usage && {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
        }),
      });

      if (options.runId) {
        insertPromptLog({
          logId: randomUUID(),
          runId: options.runId,
          step: options.step ?? options.promptKey,
          promptKey: options.promptKey,
          promptVersion,
          model: options.modelEndpoint,
          temperature,
          renderedPrompt: prompt,
          rawResponse,
          honestyScore,
          durationMs,
          tokenUsage: response.usage,
          success: true,
          errorMessage: null,
        });
      }

      return {
        rawResponse,
        honestyScore,
        promptVersion,
        durationMs,
        tokenUsage: response.usage,
        finishReason: response.finishReason,
        endpoint: response.model || options.modelEndpoint,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn("FMAPI streaming attempt failed", {
        promptKey: options.promptKey,
        attempt: attempt + 1,
        error: lastError.message,
      });

      // Only 429 and empty-content are retryable for streaming.
      if (!isRateLimitError(lastError) && !isEmptyContentError(lastError)) {
        break;
      }
    }
  }

  // Attempt fallback endpoint when primary is 429-exhausted or empty-content-exhausted
  if (lastError && (isRateLimitError(lastError) || isEmptyContentError(lastError))) {
    const fallback = getFallbackEndpoint(options.modelEndpoint);
    if (fallback) {
      logger.warn("FMAPI streaming falling back to alternate endpoint", {
        promptKey: options.promptKey,
        from: options.modelEndpoint,
        to: fallback,
      });
      const fallbackStreamOpts = { ...streamOpts, endpoint: fallback };
      for (let fa = 0; fa < 2; fa++) {
        const startTime = Date.now();
        try {
          if (fa > 0) {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
          await llmSemaphore.acquire();
          const response = await chatCompletionStream(fallbackStreamOpts, onChunk).finally(() =>
            llmSemaphore.release(),
          );

          const rawResponse = response.content;
          const durationMs = Date.now() - startTime;

          if (!rawResponse) {
            throw new EmptyContentError(options.promptKey, fallback, response.finishReason);
          }

          const honestyScore = extractHonestyScore(rawResponse);

          logger.info("FMAPI streaming fallback response complete", {
            promptKey: options.promptKey,
            promptVersion,
            model: response.model || fallback,
            responseChars: rawResponse.length,
            durationMs,
            finishReason: response.finishReason,
          });

          if (options.runId) {
            insertPromptLog({
              logId: randomUUID(),
              runId: options.runId,
              step: options.step ?? options.promptKey,
              promptKey: options.promptKey,
              promptVersion,
              model: fallback,
              temperature,
              renderedPrompt: prompt,
              rawResponse,
              honestyScore,
              durationMs,
              tokenUsage: response.usage,
              success: true,
              errorMessage: null,
            });
          }

          return {
            rawResponse,
            honestyScore,
            promptVersion,
            durationMs,
            tokenUsage: response.usage,
            finishReason: response.finishReason,
            endpoint: response.model || fallback,
          };
        } catch (fbError) {
          lastError = fbError instanceof Error ? fbError : new Error(String(fbError));
          logger.warn("FMAPI streaming fallback attempt failed", {
            promptKey: options.promptKey,
            attempt: fa + 1,
            endpoint: fallback,
            error: lastError.message,
          });
        }
      }
    }
  }

  if (options.runId && lastError) {
    insertPromptLog({
      logId: randomUUID(),
      runId: options.runId,
      step: options.step ?? options.promptKey,
      promptKey: options.promptKey,
      promptVersion,
      model: options.modelEndpoint,
      temperature,
      renderedPrompt: prompt,
      rawResponse: null,
      honestyScore: null,
      durationMs: null,
      tokenUsage: null,
      success: false,
      errorMessage: lastError.message,
    });
  }

  throw lastError ?? new Error(`FMAPI streaming call failed for ${options.promptKey}`);
}

// ---------------------------------------------------------------------------
// Response Parsers
// ---------------------------------------------------------------------------

/**
 * Parse a CSV response from the LLM into rows of string arrays.
 * Handles quoted fields and malformed rows gracefully.
 */
export function parseCSVResponse(rawResponse: string, expectedColumns: number): string[][] {
  const cleaned = cleanCSVResponse(rawResponse);
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);

  const rows: string[][] = [];
  for (const line of lines) {
    const fields = parseCSVLine(line);
    // Accept rows with roughly the right number of columns
    if (fields.length >= expectedColumns - 2 && fields.length <= expectedColumns + 2) {
      // Pad or trim to expected columns
      while (fields.length < expectedColumns) fields.push("");
      rows.push(fields.slice(0, expectedColumns));
    }
  }

  return rows;
}

/**
 * Parse a JSON response from the LLM.
 */
export function parseJSONResponse<T = Record<string, unknown>>(rawResponse: string): T {
  const cleaned = cleanJSONResponse(rawResponse);
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function cleanCSVResponse(response: string): string {
  let cleaned = response.trim();
  // Remove markdown code fences
  cleaned = cleaned.replace(/^```(?:csv)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");
  // Remove any leading header row that matches common patterns
  const firstLine = cleaned.split("\n")[0];
  if (
    firstLine &&
    (firstLine.toLowerCase().includes("no,") || firstLine.toLowerCase().includes("no, name"))
  ) {
    cleaned = cleaned.substring(cleaned.indexOf("\n") + 1);
  }
  return cleaned.trim();
}

function cleanJSONResponse(response: string): string {
  let cleaned = response.trim();
  // Remove markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");
  // Find the first { or [
  const jsonStart = Math.min(
    cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
    cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("["),
  );
  if (jsonStart !== Infinity) {
    cleaned = cleaned.substring(jsonStart);
  }
  // Find the last } or ]
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  const jsonEnd = Math.max(lastBrace, lastBracket);
  if (jsonEnd > 0) {
    cleaned = cleaned.substring(0, jsonEnd + 1);
  }
  return cleaned;
}

function extractHonestyScore(response: string): number | null {
  // Try JSON format
  const jsonMatch = response.match(/"honesty_score"\s*:\s*([\d.]+)/);
  if (jsonMatch) return parseFloat(jsonMatch[1]);

  // Try CSV format (last/second-to-last column)
  const csvMatch = response.match(/,(0\.\d+),/);
  if (csvMatch) return parseFloat(csvMatch[1]);

  return null;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}
