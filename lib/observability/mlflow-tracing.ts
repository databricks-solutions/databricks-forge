/**
 * Opt-in MLflow Tracing for Forge LLM/tool calls.
 *
 * Feature gate: every export is a no-op until BOTH of these env vars are set:
 *   - `FORGE_MLFLOW_EXPERIMENT_ID` -- the experiment to write traces to
 *   - `DATABRICKS_HOST`            -- already required for Databricks Apps
 *
 * Auth uses the same `getAppHeaders()` (service principal) the rest of the
 * Databricks REST clients use. Trace IDs are generated locally; failures are
 * always swallowed so a flaky tracing call NEVER breaks the foreground path.
 *
 * Mirrors upstream `databricks-genie-workbench` LLM tracing wiring -- enough
 * to give a full audit trail in the customer's MLflow workspace without
 * pulling in the Python tracing SDK.
 */

import { randomUUID } from "crypto";
import { getAppHeaders, getConfig } from "@/lib/dbx/client";
import { fetchWithTimeout } from "@/lib/dbx/fetch-with-timeout";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TracingSpanType = "LLM" | "TOOL" | "RETRIEVER" | "AGENT" | "CHAIN";

export interface TraceSpanInput {
  /** Caller-supplied span name (e.g. `chatCompletion:databricks-claude-opus-4-7`). */
  name: string;
  spanType: TracingSpanType;
  /** Sanitized prompt or function arguments. */
  inputs?: unknown;
  /** Sanitized response or return value. */
  outputs?: unknown;
  /** Free-form attributes (endpoint, tier, latency, tokens, cache_hit). */
  attributes?: Record<string, unknown>;
  /** When the span started (ms epoch). Defaults to `Date.now()`. */
  startMs?: number;
  /** When the span ended (ms epoch). Defaults to `Date.now()`. */
  endMs?: number;
  /** Optional error message; sets the span status to ERROR. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Feature gate
// ---------------------------------------------------------------------------

const TRACING_TIMEOUT_MS = 5_000;

export function isMlflowTracingEnabled(): boolean {
  if (process.env.FORGE_MLFLOW_TRACING_ENABLED === "false") return false;
  const expId = process.env.FORGE_MLFLOW_EXPERIMENT_ID;
  return typeof expId === "string" && expId.trim().length > 0;
}

function experimentId(): string | null {
  const v = process.env.FORGE_MLFLOW_EXPERIMENT_ID;
  return v && v.trim().length > 0 ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const REDACT_KEYS = [
  /authorization/i,
  /api[_-]?key/i,
  /bearer/i,
  /password/i,
  /token/i,
  /secret/i,
  /access[_-]?key/i,
];

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return "[truncated:depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.some((rx) => rx.test(k))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > 8000 ? `${value.slice(0, 8000)}…[truncated]` : value;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a single span in MLflow Tracing. Best-effort:
 *   - returns immediately when tracing is disabled or unavailable,
 *   - never throws,
 *   - bounded to TRACING_TIMEOUT_MS.
 */
export async function recordSpan(input: TraceSpanInput): Promise<void> {
  if (!isMlflowTracingEnabled()) return;
  const expId = experimentId();
  if (!expId) return;

  const start = input.startMs ?? Date.now();
  const end = input.endMs ?? Date.now();
  const traceId = randomUUID().replace(/-/g, "").slice(0, 16);
  const spanId = randomUUID().replace(/-/g, "").slice(0, 16);

  const payload = {
    experiment_id: expId,
    trace_id: traceId,
    spans: [
      {
        span_id: spanId,
        name: input.name,
        span_type: input.spanType,
        start_time_ns: start * 1_000_000,
        end_time_ns: end * 1_000_000,
        status: input.errorMessage ? { status_code: "ERROR", description: input.errorMessage } : { status_code: "OK" },
        inputs: sanitize(input.inputs),
        outputs: sanitize(input.outputs),
        attributes: sanitize(input.attributes ?? {}),
      },
    ],
  };

  try {
    const { host } = getConfig();
    const headers = await getAppHeaders();
    const url = `${host}/api/2.0/mlflow/traces/log`;
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      TRACING_TIMEOUT_MS,
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      logger.warn("[mlflow] trace log failed (ignored)", {
        status: resp.status,
        body: txt.slice(0, 200),
      });
    }
  } catch (err) {
    logger.warn("[mlflow] trace log threw (ignored)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Wrap an arbitrary async function with a `recordSpan` call. The wrapper
 * always returns the function's resolved value (or rethrows its error)
 * regardless of whether the trace was logged.
 */
export async function withSpan<T>(
  spec: Omit<TraceSpanInput, "outputs" | "endMs" | "errorMessage">,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isMlflowTracingEnabled()) return fn();
  const start = Date.now();
  try {
    const result = await fn();
    void recordSpan({
      ...spec,
      outputs: result as unknown,
      startMs: start,
      endMs: Date.now(),
    });
    return result;
  } catch (err) {
    void recordSpan({
      ...spec,
      startMs: start,
      endMs: Date.now(),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
