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
import { findKnownModelKey, runtimeEndpointAdmission } from "@/lib/dbx/model-admission.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Task complexity tier used by all LLM call sites. The router maps each tier
 * to the best available endpoint based on capabilities and queue depth.
 */
export type TaskTier = "reasoning" | "generation" | "classification" | "sql" | "lightweight";

/** Wire API protocol required by the model on Databricks FMAPI. */
export type ModelApiStyle = "chat_completions" | "responses";

export interface ModelEndpoint {
  /** Serving endpoint name (e.g. "databricks-claude-opus-5-5"). */
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
   * Whether the model accepts the `temperature` request parameter. Modern
   * reasoning and hybrid models (Claude 5.x, Opus 4.7+, GPT-6.x, GPT-5.x,
   * Gemini 4 / 3.5+) reject or disallow `temperature` (returning HTTP 400).
   * Defaults to false so `temperature` is omitted unless explicitly supported.
   */
  supportsTemperature: boolean;
  /** Wire API format ("chat_completions" or "responses"). */
  apiStyle: ModelApiStyle;
  /** Maximum output tokens the model can generate per request. */
  maxOutputTokens: number;
  /**
   * Default value sent on the wire as `max_tokens` (or `max_output_tokens`)
   * when the caller does not specify one.
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
  /**
   * Defaults to false — modern reasoning/hybrid models reject `temperature`
   * with HTTP 400 and all FMAPI models have a server-side default when omitted.
   */
  supportsTemperature?: boolean;
  /** Defaults to "chat_completions". Models like GPT-6.1 Sol / 6 Sol / 6 Luna use "responses". */
  apiStyle?: ModelApiStyle;
  maxOutputTokens: number;
  /** Per-model default for `max_tokens` / `max_output_tokens` when omitted. */
  defaultMaxTokens: number;
}

/**
 * Verified model capabilities from Databricks documentation (Oct 2026).
 *
 * Sources:
 *   - https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models
 *   - https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits
 *   - https://docs.databricks.com/aws/en/machine-learning/model-serving/query-reason-models
 *   - https://docs.databricks.com/aws/en/machine-learning/model-serving/query-openai-responses
 *
 * Only models listed here are admitted to the pool. Unknown models are
 * rejected at startup with a warning log.
 *
 * NOTE: Claude Fable 5 / 5.1 retain prompts and responses for 30 days with
 * Anthropic as a subprocessor and are intentionally excluded from default admission.
 */
const KNOWN_MODELS: Record<string, ModelTemplate> = {
  // ---- Anthropic Claude 5.x & 4.x -----------------------------------------
  "databricks-claude-opus-5-5": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-5": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 2,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-4-8": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 3,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-4-7": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 4,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-4-6": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 5,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-opus-4-5": {
    tiers: ["reasoning"],
    maxConcurrent: 6,
    priority: 6,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-sonnet-5-5": {
    tiers: ["generation", "classification"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-sonnet-5": {
    tiers: ["generation", "classification"],
    maxConcurrent: 8,
    priority: 2,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-sonnet-4-6": {
    tiers: ["generation", "classification"],
    maxConcurrent: 8,
    priority: 3,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-sonnet-4-5": {
    tiers: ["classification", "lightweight"],
    maxConcurrent: 8,
    priority: 4,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-claude-haiku-5-5": {
    tiers: ["classification", "lightweight"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 4_096,
  },
  "databricks-claude-haiku-4-5": {
    tiers: ["classification", "lightweight"],
    maxConcurrent: 8,
    priority: 2,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_000,
    defaultMaxTokens: 4_096,
  },

  // ---- OpenAI GPT-6.1, GPT-6 & GPT-5.x ------------------------------------
  "databricks-gpt-6-1-sol": {
    tiers: ["sql", "reasoning", "generation"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "responses",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 16_384,
  },
  "databricks-gpt-6-1-terra": {
    tiers: ["sql", "reasoning", "generation"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "chat_completions",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 16_384,
  },
  "databricks-gpt-6-astra": {
    tiers: ["reasoning", "sql", "generation"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "chat_completions",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 16_384,
  },
  "databricks-gpt-6-sol": {
    tiers: ["sql", "reasoning", "generation"],
    maxConcurrent: 6,
    priority: 2,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "responses",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 16_384,
  },
  "databricks-gpt-6-luna": {
    tiers: ["generation", "classification", "lightweight", "sql"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "responses",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-gpt-5-4": {
    tiers: ["sql", "generation", "reasoning"],
    maxConcurrent: 4,
    priority: 3,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "chat_completions",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 16_384,
  },
  "databricks-gpt-5-4-mini": {
    tiers: ["sql", "generation", "classification"],
    maxConcurrent: 8,
    priority: 3,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "chat_completions",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 8_192,
  },
  "databricks-gpt-5-4-nano": {
    tiers: ["classification", "lightweight"],
    maxConcurrent: 8,
    priority: 2,
    supportsJsonMode: true,
    supportsTemperature: false,
    apiStyle: "chat_completions",
    maxOutputTokens: 128_000,
    defaultMaxTokens: 4_096,
  },

  // ---- Google Gemini 4 & 3.x ----------------------------------------------
  "databricks-gemini-4-argon": {
    tiers: ["reasoning", "generation"],
    maxConcurrent: 6,
    priority: 2,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 8_192,
  },
  "databricks-gemini-3-8-flash": {
    tiers: ["generation", "classification", "lightweight", "reasoning"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 8_192,
  },
  "databricks-gemini-3-7-flash": {
    tiers: ["generation", "classification", "lightweight", "reasoning"],
    maxConcurrent: 8,
    priority: 2,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 8_192,
  },
  "databricks-gemini-3-6-flash": {
    tiers: ["generation", "classification", "lightweight"],
    maxConcurrent: 8,
    priority: 2,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 8_192,
  },
  "databricks-gemini-3-5-flash": {
    tiers: ["generation", "classification", "lightweight"],
    maxConcurrent: 8,
    priority: 3,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 8_192,
  },
  "databricks-gemini-3-5-flash-lite": {
    tiers: ["generation", "classification", "lightweight"],
    maxConcurrent: 8,
    priority: 0,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 4_096,
  },
  "databricks-gemini-3-1-pro": {
    tiers: ["reasoning", "generation"],
    maxConcurrent: 6,
    priority: 3,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 65_536,
    defaultMaxTokens: 8_192,
  },
  "databricks-gemini-3-1-flash-lite": {
    tiers: ["generation", "classification", "lightweight"],
    maxConcurrent: 8,
    priority: 0,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_768,
    defaultMaxTokens: 4_096,
  },
  "databricks-gemini-3-flash": {
    tiers: ["generation", "classification", "lightweight", "reasoning"],
    maxConcurrent: 8,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 32_768,
    defaultMaxTokens: 4_096,
  },

  // ---- Meta Llama 4 -------------------------------------------------------
  "databricks-llama-4-maverick": {
    tiers: ["generation", "classification"],
    maxConcurrent: 6,
    priority: 1,
    supportsJsonMode: false,
    supportsTemperature: false,
    maxOutputTokens: 8_192,
    defaultMaxTokens: 4_096,
  },
};

function templateFor(name: string): ModelTemplate | null {
  const key = findKnownModelKey(name);
  return key ? (KNOWN_MODELS[key] ?? null) : null;
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
  const pool: ModelEndpoint[] = [];
  const admission = runtimeEndpointAdmission(process.env);

  for (const name of admission.rejected) {
    logger.warn("Skipping unknown model — add to KNOWN_MODELS before use", {
      endpoint: name,
    });
  }
  if (admission.allowlistFallback) {
    logger.warn(
      "DATABRICKS_ALLOWED_MODELS filtered out all endpoints — falling back to first configured",
      {
        allowlist: process.env.DATABRICKS_ALLOWED_MODELS,
        poolSize: admission.admitted.length,
      },
    );
  }

  for (const admitted of admission.admitted) {
    const tmpl = templateFor(admitted.name);
    if (!tmpl) continue;
    pool.push({
      name: admitted.name,
      tiers: tmpl.tiers,
      maxConcurrent: tmpl.maxConcurrent,
      priority: tmpl.priority,
      supportsJsonMode: tmpl.supportsJsonMode,
      supportsTemperature: tmpl.supportsTemperature ?? false,
      apiStyle: tmpl.apiStyle ?? "chat_completions",
      maxOutputTokens: tmpl.maxOutputTokens,
      defaultMaxTokens: tmpl.defaultMaxTokens,
      available: true,
    });
  }

  applyStartupValidation(pool);
  return pool;
}

/**
 * Apply startup-time endpoint validation results from FORGE_VALIDATED_ENDPOINTS.
 * Set by scripts/validate-endpoints.mjs via start.sh. When present, any pool
 * endpoint NOT in the validated list is marked unavailable.
 */
function applyStartupValidation(pool: ModelEndpoint[]): void {
  if (process.env.FORGE_ENDPOINT_VALIDATION_STATE !== "completed") return;

  const raw = process.env.FORGE_VALIDATED_ENDPOINTS;

  const validated = new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

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
      logger.error("Startup validation marked all configured endpoints unavailable", {
        validated: raw,
        poolSize: pool.length,
      });
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
  supportsTemperature: false,
  apiStyle: "chat_completions" as ModelApiStyle,
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
  apiStyle: ModelApiStyle;
  maxOutputTokens: number;
  defaultMaxTokens: number;
} {
  const pool = getModelPool();
  const ep = pool.find((e) => e.name.toLowerCase() === endpoint.toLowerCase());
  if (ep)
    return {
      supportsJsonMode: ep.supportsJsonMode,
      supportsTemperature: ep.supportsTemperature,
      apiStyle: ep.apiStyle,
      maxOutputTokens: ep.maxOutputTokens,
      defaultMaxTokens: ep.defaultMaxTokens,
    };

  const tmpl = templateFor(endpoint);
  if (tmpl)
    return {
      supportsJsonMode: tmpl.supportsJsonMode,
      supportsTemperature: tmpl.supportsTemperature ?? false,
      apiStyle: tmpl.apiStyle ?? "chat_completions",
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
