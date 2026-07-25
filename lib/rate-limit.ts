/**
 * In-memory sliding-window rate limiter for API routes.
 *
 * Tracks request counts per key (IP or user) within a configurable
 * time window. Designed for single-instance Databricks App deployments.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Maximum requests allowed within the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(name: string): Map<string, RateLimitEntry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function createRateLimiter(name: string, config: RateLimitConfig) {
  const store = getStore(name);

  return {
    /**
     * Check if a request from `key` is within the rate limit.
     * Returns `{ allowed, remaining, resetAt }`.
     */
    check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || now >= entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + config.windowMs });
        return { allowed: true, remaining: config.limit - 1, resetAt: now + config.windowMs };
      }

      entry.count++;
      const allowed = entry.count <= config.limit;
      return {
        allowed,
        remaining: Math.max(0, config.limit - entry.count),
        resetAt: entry.resetAt,
      };
    },

    /** Prune expired entries (call periodically to prevent memory leaks). */
    prune() {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (now >= entry.resetAt) store.delete(key);
      }
    },
  };
}

const EXPENSIVE_ROUTES = [
  "/api/runs",
  "/api/assistant",
  "/api/metadata-genie",
  "/api/environment-scan",
];

const llmLimiter = createRateLimiter("llm", { limit: 3000, windowMs: 60_000 });
const generalLimiter = createRateLimiter("general", { limit: 12000, windowMs: 60_000 });

setInterval(() => {
  llmLimiter.prune();
  generalLimiter.prune();
}, 60_000);

/**
 * Check rate limit for an API request. Returns null if allowed,
 * or `{ status, retryAfter, error }` if rate-limited.
 */
export function checkRateLimit(
  pathname: string,
  clientKey: string,
): { error: string; retryAfterMs: number } | null {
  const isExpensive = EXPENSIVE_ROUTES.some((r) => pathname.startsWith(r));
  const limiter = isExpensive ? llmLimiter : generalLimiter;
  const result = limiter.check(clientKey);

  if (!result.allowed) {
    return {
      error: "Too many requests. Please try again later.",
      retryAfterMs: result.resetAt - Date.now(),
    };
  }

  return null;
}
