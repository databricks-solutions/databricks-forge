/**
 * Generic retry utility with exponential backoff.
 *
 * Designed for calls that may fail transiently during cold starts or
 * temporary network issues.
 *
 * @module toolkit/retry
 */

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Determines whether an error is non-retryable (client-side mistakes,
 * permission errors, SQL syntax errors). These should fail immediately
 * rather than wasting retries.
 */
export function isNonRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);

  // HTTP 4xx status codes embedded in error messages
  const httpStatusMatch = msg.match(/\((\d{3})\)/);
  if (httpStatusMatch) {
    const status = parseInt(httpStatusMatch[1], 10);
    if (status >= 400 && status < 500) return true;
  }

  // Databricks-specific non-retryable patterns
  if (
    msg.includes("INSUFFICIENT_PERMISSIONS") ||
    msg.includes("SQLSTATE: 42") ||
    msg.includes("USE CATALOG") ||
    msg.includes("does not exist") ||
    msg.includes("IdentifierValidation")
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retries (default: 2, so up to 3 total attempts). */
  maxRetries?: number;
  /** Initial backoff in ms (default: 3000). Doubles each retry up to maxBackoffMs. */
  initialBackoffMs?: number;
  /** Maximum backoff in ms (default: 15000). */
  maxBackoffMs?: number;
  /** Label for logging (e.g. "listCatalogs"). */
  label?: string;
}

/**
 * Execute `fn` with automatic retry + exponential backoff.
 *
 * Non-retryable errors (permissions, syntax) fail immediately.
 * Retryable errors (timeouts, warehouse starting) are retried up to
 * `maxRetries` times with exponential backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 2,
    initialBackoffMs = 3_000,
    maxBackoffMs = 15_000,
    label = "withRetry",
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.min(initialBackoffMs * Math.pow(2, attempt - 1), maxBackoffMs);
        logger.info(`[${label}] Retry ${attempt}/${maxRetries} after ${backoffMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isNonRetryableError(error)) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        logger.warn(`[${label}] Attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after ${maxRetries + 1} attempts`);
}
