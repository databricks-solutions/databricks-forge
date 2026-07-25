/**
 * Model Pool Registry.
 *
 * Manages a pool of Model Serving endpoints with per-endpoint capabilities,
 * concurrency caps, and priority ordering. Supports customer model restrictions
 * via DATABRICKS_ALLOWED_MODELS and graceful degradation to single-endpoint mode.
 *
 * Pool discovery order:
 *   1. Dedicated env vars (DATABRICKS_SERVING_ENDPOINT_REASONING_2, etc.)
 *   2. Legacy env vars (DATABRICKS_SERVING_ENDPOINT, _FAST, _REVIEW)
 *   3. Hardcoded default (databricks-claude-opus-4-7)
 *
 * When only legacy env vars are set, behavior is identical to the pre-pool era.
 */

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Task complexity tier used by all LLM call sites. The router maps each tier
 * to the best available endpoint based on capabilities and queue depth.
 */
export type TaskTier = "reasoning" | "generation" | "classification" | "sql" | "lightweight";

export interface ModelEndpoint {
  /** Serving endpoint name (e.g. "databricks-claude-opus-4-7"). */
  name: string;
  /** Task tiers this endpoint is suitable for (ordered by preference). */
  tiers: TaskTier[];
  /** Max concurrent requests for this endpoint's rate limiter. */
  maxConcurrent: number;
  /** Priority within a tier (lower = preferred). */
  priority: number;
  /** Whether the model supports response_format: json_object on Databricks FMAPI. */
  supportsJsonMode: boolean;
  /**
   * Whether the model accepts the `temperature` request parameter. Some
   * reasoning models (e.g. Claude Opus 4.7) reject it with HTTP 400. When
   * false, the wire layer omits `temperature` from the request body and
   * the model uses its server-side default (typically 1.0).
   */
  supportsTemperature: boolean;
  /** Maximum output tokens the model can generate per request. */
  maxOutputTokens: number;
  /**
   * Default value sent on the wire as `max_tokens` when the caller does not
   * specify one. Closes the Claude Sonnet 4 footgun where omitting
   * `max_tokens` silently truncates at 1,000 tokens, and ensures predictable
   * output budgets for every endpoint.
   */
  defaultMaxTokens: number;
  /**
   * Whether this endpoint is known to be reachable. Set to false at runtime
   * when a 404/RESOURCE_DOES_NOT_EXIST is received, or when startup
   * validation (FORGE_VALIDATED_ENDPOINTS) confirms it is missing.
   * Once marked unavailable the endpoint is excluded from tier routing
   * for the lifetime of the process.
   */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Built-in model capability map
// ---------------------------------------------------------------------------

interface ModelTemplate {
  tiers: TaskTier[];
  maxConcurrent: number;
  priority: number;
  supportsJsonMode: boolean;
  /** Defaults to true — only set false when the model explicitly rejects `temperature`. */
  supportsTemperature?: boolean;
  maxOutputTokens: number;
  /** Per-model default for `max_tokens` when the caller omits it. */
  defaultMaxTokens: number;
}

/**
 * Verified model capabilities from Databricks documentation.
 *
 * Sources:
 *   - https://docs.databricks.com/en/machine-learning/foundation-model-apis/supported-models.html
 *   - https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits
 *   - https://docs.databricks.com/aws/en/machine-learning/model-serving/query-reason-models
 *
 * Only models listed here are admitted to the pool. Unknown models are
 * rejected at startup with a warning log. To onboard a new model, add its
 * verified config here first.
 *
 * NOTE: Codex models (GPT-5.1 Codex Mini, GPT-5.2 Codex, GPT-5.3 Codex)
 * require the Responses API (/serving-endpoints/responses) which is only
 * available via AI Gateway (beta). They are intentionally excluded.
 */
const KNOWN_MODELS: Record<string, ModelTemplate> = {
  "databricks-claude-opus-4-7": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-4-6": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 2,
    supportsJsonMode: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-4-5": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 3,
    supportsJsonMode: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-sonnet-4-6": {
    tiers: ["generation", "classification"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-sonnet-4-5": {
    tiers: ["classification", "lightweight"],
    maxConcurrent: 8,
    priority: 2,
    supportsJsonMode: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-gpt-5-4": {
    tiers: ["sql", "generation", "reasoning"],
    maxConcurrent: 4,
    priority: 1,
    supportsJsonMode: true,
    maxOutputTokens: 128_000,
    defaultMaxTokens: 16_384,
  },
  "databricks-gemini-3-1-flash-lite": {
    tiers: ["generation", "classification", "lightweight"],
    maxConcurrent: 8,
    priority: 0,
    supportsJsonMode: false,
    maxOutputTokens: 32_768,
    defaultMaxTokens: 4_096,
  },
  "databricks-llama-4-maverick": {
    tiers: ["generation", "classification"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: false,
    maxOutputTokens: 8_192,
    defaultMaxTokens: 4_096,
  },
  "databricks-gemini-3-flash": {
    tiers: ["generation", "classification", "lightweight"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: false,
    maxOutputTokens: 32_768,
    defaultMaxTokens: 4_096,
  },
};

function templateFor(name: string): ModelTemplate | null {
  const lower = name.toLowerCase();
  for (const [key, tmpl] of Object.entries(KNOWN_MODELS)) {
    if (lower === key || lower.includes(key)) return tmpl;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Registry singleton
// ---------------------------------------------------------------------------

let _pool: ModelEndpoint[] | null = null;

/**
 * Build the endpoint pool from environment variables. Called once on first access.
 *
 * Env var mapping:
 *   DATABRICKS_SERVING_ENDPOINT            → primary premium/reasoning
 *   DATABRICKS_SERVING_ENDPOINT_FAST       → primary fast/classification
 *   DATABRICKS_REVIEW_ENDPOINT             → primary SQL review
 *   DATABRICKS_SERVING_ENDPOINT_REASONING_2 → secondary reasoning
 *   DATABRICKS_SERVING_ENDPOINT_GENERATION  → dedicated generation
 *   DATABRICKS_SERVING_ENDPOINT_SQL         → dedicated SQL/codex
 */
function buildPool(): ModelEndpoint[] {
  const seen = new Set<string>();
  const pool: ModelEndpoint[] = [];

  const add = (name: string | undefined) => {
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    const tmpl = templateFor(name);
    if (!tmpl) {
      logger.warn("Skipping unknown model — add to KNOWN_MODELS before use", {
        endpoint: name,
      });
      return;
    }
    seen.add(key);
    pool.push({
      name,
      tiers: tmpl.tiers,
      maxConcurrent: tmpl.maxConcurrent,
      priority: tmpl.priority,
      supportsJsonMode: tmpl.supportsJsonMode,
      supportsTemperature: tmpl.supportsTemperature ?? true,
      maxOutputTokens: tmpl.maxOutputTokens,
      defaultMaxTokens: tmpl.defaultMaxTokens,
      available: true,
    });
  };

  // Primary endpoints (legacy env vars)
  add(process.env.DATABRICKS_SERVING_ENDPOINT);
  add(process.env.DATABRICKS_SERVING_ENDPOINT_FAST);
  add(process.env.DATABRICKS_REVIEW_ENDPOINT);

  // Extended pool endpoints (new env vars)
  add(process.env.DATABRICKS_SERVING_ENDPOINT_REASONING_2);
  add(process.env.DATABRICKS_SERVING_ENDPOINT_GENERATION);
  add(process.env.DATABRICKS_SERVING_ENDPOINT_SQL);
  add(process.env.DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT);

  if (pool.length === 0) {
    const def = "databricks-claude-opus-4-7";
    add(def);
  }

  const filtered = applyAllowlist(pool);
  applyStartupValidation(filtered);
  return filtered;
}

/**
 * Filter pool to only customer-approved models when DATABRICKS_ALLOWED_MODELS
 * is set. If the allowlist would result in an empty pool, fall back to the
 * first configured endpoint with a warning.
 */
function applyAllowlist(pool: ModelEndpoint[]): ModelEndpoint[] {
  const raw = process.env.DATABRICKS_ALLOWED_MODELS;
  if (!raw) return pool;

  const allowed = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  if (allowed.size === 0) return pool;

  const filtered = pool.filter((ep) => allowed.has(ep.name.toLowerCase()));

  if (filtered.length === 0) {
    logger.warn(
      "DATABRICKS_ALLOWED_MODELS filtered out all endpoints — falling back to first configured",
      { allowlist: raw, poolSize: pool.length },
    );
    return pool.slice(0, 1);
  }

  return filtered;
}

/**
 * Apply startup-time endpoint validation results from FORGE_VALIDATED_ENDPOINTS.
 * Set by scripts/validate-endpoints.mjs via start.sh. When present, any pool
 * endpoint NOT in the validated list is marked unavailable.
 */
function applyStartupValidation(pool: ModelEndpoint[]): void {
  const raw = process.env.FORGE_VALIDATED_ENDPOINTS;
  if (!raw) return;

  const validated = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  if (validated.size === 0) return;

  let markedCount = 0;
  for (const ep of pool) {
    if (!validated.has(ep.name.toLowerCase())) {
      ep.available = false;
      markedCount++;
    }
  }

  if (markedCount > 0) {
    const stillAvailable = pool.filter((ep) => ep.available);
    if (stillAvailable.length === 0) {
      logger.warn(
        "Startup validation marked ALL endpoints unavailable — resetting to assume all available",
        { validated: raw, poolSize: pool.length },
      );
      for (const ep of pool) ep.available = true;
    } else {
      logger.info(
        `Startup validation: ${markedCount} endpoint(s) marked unavailable, ${stillAvailable.length} active`,
        {
          unavailable: pool.filter((ep) => !ep.available).map((ep) => ep.name),
          available: stillAvailable.map((ep) => ep.name),
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the active model pool (lazy-initialised, cached). */
export function getModelPool(): readonly ModelEndpoint[] {
  if (!_pool) {
    _pool = buildPool();
    logPoolSummary(_pool);
  }
  return _pool;
}

/** Returns all available endpoints in the pool that support a given tier, sorted by priority. */
export function getEndpointsForTier(tier: TaskTier): readonly ModelEndpoint[] {
  return getModelPool()
    .filter((ep) => ep.available && ep.tiers.includes(tier))
    .sort((a, b) => a.priority - b.priority);
}

/** Whether the pool has more than one distinct endpoint. */
export function isMultiEndpointPool(): boolean {
  return getModelPool().length > 1;
}

/** Sum of all per-endpoint maxConcurrent caps. */
export function getPoolMaxConcurrent(): number {
  return getModelPool().reduce((sum, ep) => sum + ep.maxConcurrent, 0);
}

/**
 * Mark a specific endpoint as permanently unavailable for the lifetime of
 * this process. Called by model-serving.ts when a 404 or
 * RESOURCE_DOES_NOT_EXIST response is received.
 */
export function markEndpointUnavailable(endpoint: string): void {
  const pool = getModelPool() as ModelEndpoint[];
  const ep = pool.find((e) => e.name.toLowerCase() === endpoint.toLowerCase());
  if (!ep || !ep.available) return;

  ep.available = false;

  const remaining = pool.filter((e) => e.available);
  logger.warn("Endpoint marked unavailable at runtime (404 / RESOURCE_DOES_NOT_EXIST)", {
    endpoint,
    remainingAvailable: remaining.length,
    remainingNames: remaining.map((e) => e.name),
  });

  if (remaining.length === 0) {
    logger.error(
      "All endpoints are now unavailable — LLM calls will fail until an endpoint becomes reachable",
    );
  }
}

/** Check whether a specific endpoint is currently marked as available. */
export function isEndpointAvailable(endpoint: string): boolean {
  const pool = getModelPool();
  const ep = pool.find((e) => e.name.toLowerCase() === endpoint.toLowerCase());
  return ep ? ep.available : true;
}

/** Returns a snapshot of pool availability for health checks and diagnostics. */
export function getPoolAvailability(): {
  available: string[];
  unavailable: string[];
  total: number;
} {
  const pool = getModelPool();
  return {
    available: pool.filter((ep) => ep.available).map((ep) => ep.name),
    unavailable: pool.filter((ep) => !ep.available).map((ep) => ep.name),
    total: pool.length,
  };
}

/** Reset the pool (for testing). */
export function resetModelPool(): void {
  _pool = null;
}

/** Safe defaults for models not in the pool (unknown endpoint fallback). */
const UNKNOWN_CAPS = {
  supportsJsonMode: false,
  supportsTemperature: true,
  maxOutputTokens: 8_192,
  defaultMaxTokens: 4_096,
} as const;

/**
 * Look up capability metadata for an endpoint.
 *
 * Checks the active pool first (already resolved), then falls back to
 * KNOWN_MODELS for endpoints not in the pool. Returns conservative
 * defaults for completely unknown endpoints.
 */
export function getModelCapabilities(endpoint: string): {
  supportsJsonMode: boolean;
  supportsTemperature: boolean;
  maxOutputTokens: number;
  defaultMaxTokens: number;
} {
  const pool = getModelPool();
  const ep = pool.find((e) => e.name.toLowerCase() === endpoint.toLowerCase());
  if (ep)
    return {
      supportsJsonMode: ep.supportsJsonMode,
      supportsTemperature: ep.supportsTemperature,
      maxOutputTokens: ep.maxOutputTokens,
      defaultMaxTokens: ep.defaultMaxTokens,
    };

  const tmpl = templateFor(endpoint);
  if (tmpl)
    return {
      supportsJsonMode: tmpl.supportsJsonMode,
      supportsTemperature: tmpl.supportsTemperature ?? true,
      maxOutputTokens: tmpl.maxOutputTokens,
      defaultMaxTokens: tmpl.defaultMaxTokens,
    };

  return UNKNOWN_CAPS;
}

// ---------------------------------------------------------------------------
// Startup log
// ---------------------------------------------------------------------------

function logPoolSummary(pool: ModelEndpoint[]): void {
  const restricted = !!process.env.DATABRICKS_ALLOWED_MODELS;
  const availablePool = pool.filter((ep) => ep.available);
  const totalConcurrent = availablePool.reduce((s, ep) => s + ep.maxConcurrent, 0);
  const unavailableCount = pool.length - availablePool.length;

  logger.info(
    `Model pool initialised: ${availablePool.length} endpoint${availablePool.length !== 1 ? "s" : ""} available` +
      (unavailableCount > 0 ? `, ${unavailableCount} unavailable` : "") +
      (restricted ? " (restricted by DATABRICKS_ALLOWED_MODELS)" : ""),
    {
      endpoints: pool.map((ep) => ({
        name: ep.name,
        tiers: ep.tiers.join(", "),
        maxConcurrent: ep.maxConcurrent,
        jsonMode: ep.supportsJsonMode,
        temperature: ep.supportsTemperature,
        maxOutput: ep.maxOutputTokens,
        defaultMax: ep.defaultMaxTokens,
        available: ep.available,
      })),
      effectiveMaxConcurrent: totalConcurrent,
    },
  );
}
