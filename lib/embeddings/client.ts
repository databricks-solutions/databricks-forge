/**
 * Embedding generation client for Databricks Model Serving.
 *
 * Calls the configured embedding endpoint (default: databricks-qwen3-embedding-0-6b)
 * via the Foundation Model API to produce 1024-dimension vectors.
 *
 * Uses the same service-principal auth as chat completions (getAppHeaders).
 * Batches texts into groups of MAX_BATCH_SIZE to stay within API limits.
 * Retries on 429/5xx with exponential backoff.
 */

import { getConfig, getAppHeaders, getEmbeddingEndpoint } from "@/lib/dbx/client";
import { fetchWithTimeout } from "@/lib/dbx/fetch-with-timeout";
import { logger } from "@/lib/logger";
import { isEmbeddingEnabled } from "./config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMBEDDING_DIM = 1024;
const MAX_BATCH_SIZE = 32;
const MAX_CONCURRENT_BATCHES = 3;
const EMBEDDING_TIMEOUT_MS = 60_000;

const MAX_RETRIES = 3;
const MAX_429_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_429_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmbeddingResponseItem {
  embedding: number[];
  index: number;
}

interface EmbeddingResponse {
  data: EmbeddingResponseItem[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate embeddings for an array of texts.
 * Handles batching (max 16 per request) and retry automatically.
 * Returns vectors in the same order as input texts.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (!isEmbeddingEnabled()) {
    throw new EmbeddingError(
      "Embedding endpoint not configured (serving-endpoint-embedding resource not bound)",
      503,
    );
  }

  // Build batches and run with bounded concurrency
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    batches.push(texts.slice(i, i + MAX_BATCH_SIZE));
  }

  if (batches.length <= 1) {
    return callWithRetry(batches[0]);
  }

  // Run multiple batches concurrently to reduce total latency
  let active = 0;
  const queue: Array<() => void> = [];
  const batchResults = await Promise.all(
    batches.map(
      (batch) =>
        new Promise<number[][]>((resolve, reject) => {
          const run = async () => {
            try {
              resolve(await callWithRetry(batch));
            } catch (e) {
              reject(e);
            } finally {
              active--;
              if (queue.length > 0) queue.shift()!();
            }
          };
          if (active < MAX_CONCURRENT_BATCHES) {
            active++;
            run();
          } else {
            queue.push(() => {
              active++;
              run();
            });
          }
        }),
    ),
  );

  return batchResults.flat();
}

/**
 * Generate a single embedding for one text string.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}

// ---------------------------------------------------------------------------
// Core API call
// ---------------------------------------------------------------------------

async function callEmbeddingEndpoint(texts: string[]): Promise<number[][]> {
  const { host } = getConfig();
  const endpoint = getEmbeddingEndpoint();
  const headers = await getAppHeaders();
  const url = `${host}/serving-endpoints/${endpoint}/invocations`;

  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ input: texts }),
    },
    EMBEDDING_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new EmbeddingError(`Embedding request failed (${resp.status}): ${body}`, resp.status);
  }

  const data: EmbeddingResponse = await resp.json();

  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Retry logic (mirrors lib/genie/llm-cache.ts pattern)
// ---------------------------------------------------------------------------

async function callWithRetry(texts: string[]): Promise<number[][]> {
  let lastError: Error | null = null;
  let rateLimitHits = 0;
  const maxAttempts = MAX_429_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        if (isRateLimitError(lastError)) {
          const backoffMs = DEFAULT_429_BACKOFF_MS;
          logger.warn("[embeddings] Rate-limited (429), backing off", {
            attempt,
            backoffMs,
          });
          await sleep(backoffMs);
        } else {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          logger.info("[embeddings] Retry", { attempt, backoffMs });
          await sleep(backoffMs);
        }
      }

      return await callEmbeddingEndpoint(texts);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isRateLimitError(error)) {
        rateLimitHits++;
        if (rateLimitHits > MAX_429_RETRIES) throw lastError;
        continue;
      }

      if (!isRetryableError(error) || attempt >= MAX_RETRIES) {
        throw lastError;
      }

      logger.warn("[embeddings] Call failed (will retry)", {
        attempt: attempt + 1,
        error: lastError.message,
      });
    }
  }

  throw lastError ?? new Error("Embedding call failed after retries");
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function isRateLimitError(error: unknown): boolean {
  if (error instanceof EmbeddingError) return error.statusCode === 429;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("(429)") || msg.includes("REQUEST_LIMIT_EXCEEDED");
}

function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (error instanceof EmbeddingError) return error.statusCode >= 500;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET") || msg.includes("fetch failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class EmbeddingError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "EmbeddingError";
    this.statusCode = statusCode;
  }
}
