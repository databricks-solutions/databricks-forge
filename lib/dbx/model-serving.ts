/**
 * Databricks Foundation Model API (FMAPI) client.
 *
 * Provides a thin wrapper around the Model Serving chat completions endpoint.
 * Replaces the previous ai_query() SQL path with direct REST calls, giving:
 *   - Lower latency (no SQL warehouse overhead or polling)
 *   - Structured output via response_format (JSON mode)
 *   - Token usage metrics for cost tracking
 *   - System/user message separation for better prompt hygiene
 *   - Streaming support (SSE) for long-running generations
 *
 * Auth uses getAppHeaders() (service principal / PAT) since model-serving
 * scopes are not available in user authorization tokens.
 *
 * Endpoint: POST {host}/serving-endpoints/{endpoint}/invocations
 * OpenAI-compatible chat completions format.
 *
 * Docs: https://docs.databricks.com/en/machine-learning/model-serving/score-foundation-models.html
 */

import { getConfig, getAppHeaders } from "./client";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { getPoolRateLimiter, DEFAULT_429_BACKOFF_MS } from "./rate-limiter";
import { getModelCapabilities, markEndpointUnavailable } from "./model-registry";
import { logger } from "@/lib/logger";
import { isMlflowTracingEnabled, recordSpan } from "@/lib/observability/mlflow-tracing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message in the chat completions format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Options for a chat completion request. */
export interface ChatCompletionOptions {
  /** Model serving endpoint name (e.g. "databricks-claude-opus-4-7"). */
  endpoint: string;
  /** Messages to send (system + user). */
  messages: ChatMessage[];
  /** Sampling temperature (0.0 - 1.0). */
  temperature?: number;
  /** Maximum tokens for the response. When omitted, uses model default. */
  maxTokens?: number;
  /**
   * Response format hint. When set to "json_object", instructs the model to
   * return valid JSON. The prompt must also mention JSON output.
   */
  responseFormat?: "text" | "json_object";
  /** Optional abort signal for caller-initiated cancellation. */
  signal?: AbortSignal;
}

/** Token usage statistics returned by the model. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Response from a chat completion request. */
export interface ChatCompletionResponse {
  /** The generated text content. */
  content: string;
  /** Token usage statistics (if available). */
  usage: TokenUsage | null;
  /** The model identifier that served the request. */
  model: string;
  /** The finish reason (e.g. "stop", "length"). */
  finishReason: string | null;
}

/** Callback invoked for each chunk during streaming. */
export type StreamCallback = (chunk: string) => void;

// ---------------------------------------------------------------------------
// Model capability detection
// ---------------------------------------------------------------------------

/**
 * Whether the endpoint supports response_format: json_object.
 *
 * Only models with verified json_object support in KNOWN_MODELS are
 * allowed. Currently only GPT-5.x models work reliably; Claude returns
 * errors, Gemini and Llama return 400 on Databricks pay-per-token.
 */
function supportsJsonResponseFormat(endpoint: string): boolean {
  return getModelCapabilities(endpoint).supportsJsonMode;
}

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/**
 * LLM inference can take 1-3+ minutes for complex prompts.
 * This timeout covers the entire request lifecycle (non-streaming).
 */
const LLM_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Streaming requests get a longer timeout since data arrives incrementally.
 */
const LLM_STREAM_TIMEOUT_MS = 600_000; // 10 minutes

// ---------------------------------------------------------------------------
// Retry-After header parsing
// ---------------------------------------------------------------------------

function parseRetryAfterHeader(resp: Response): number {
  const header = resp.headers.get("Retry-After");
  if (!header) return DEFAULT_429_BACKOFF_MS;

  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : DEFAULT_429_BACKOFF_MS;
  }

  return DEFAULT_429_BACKOFF_MS;
}

/**
 * Detect whether an HTTP response indicates the endpoint does not exist.
 * Covers 404 and 400 with RESOURCE_DOES_NOT_EXIST in the body.
 */
function isEndpointNotFoundResponse(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status === 400 && body.includes("RESOURCE_DOES_NOT_EXIST")) return true;
  return false;
}

/**
 * Detect whether an HTTP 400 response was triggered by an unsupported
 * `temperature` parameter on a reasoning/hybrid model.
 */
function isUnsupportedTemperatureError(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /\btemperature\b/i.test(body);
}

/**
 * Detect whether an HTTP 403 response indicates the workspace has enabled
 * "Enforce Unity Gateway" (which disables legacy `/serving-endpoints/databricks-*`).
 */
function isUnityGatewayEnforcedError(status: number, body: string): boolean {
  if (status !== 403) return false;
  return /use Unity Gateway|disabled for this workspace/i.test(body);
}

/**
 * Resolve a configured endpoint name (e.g. `databricks-claude-opus-5-5`) to a
 * three-part Unity Gateway model service name (e.g. `system.ai.claude-opus-5-5`).
 */
export function resolveUnityGatewayModelName(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.split(".").length === 3) {
    return trimmed;
  }
  if (trimmed.toLowerCase() === "databricks-gemini-4-argon") {
    return "system.ai.databricks-gemini-4-argon";
  }
  if (trimmed.toLowerCase().startsWith("databricks-")) {
    return `system.ai.${trimmed.slice("databricks-".length)}`;
  }
  return `system.ai.${trimmed}`;
}

function shouldUseUnityGateway(endpoint: string): boolean {
  const mode = (process.env.FORGE_AI_GATEWAY_MODE ?? "auto").trim().toLowerCase();
  if (mode === "unity_gateway") return true;
  if (mode === "serving_endpoints") return false;
  return endpoint.trim().split(".").length === 3;
}

/**
 * Build the wire URL and request payload for:
 *   - Unity Gateway (`/ai-gateway/mlflow/v1/chat/completions` or `/responses`)
 *   - Model Serving Chat Completions (`/serving-endpoints/{endpoint}/invocations`)
 *   - Model Serving OpenAI Responses API (`/serving-endpoints/responses` for GPT-6.1 Sol / 6 Sol / 6 Luna)
 */
function buildWireRequest(
  host: string,
  options: ChatCompletionOptions,
  caps: ReturnType<typeof getModelCapabilities>,
  clampedMaxTokens: number,
  stream: boolean,
  forceUnityGateway = false,
): { url: string; body: Record<string, unknown> } {
  const apiStyle = caps.apiStyle ?? "chat_completions";
  const useGateway = forceUnityGateway || shouldUseUnityGateway(options.endpoint);
  const gatewayModel = resolveUnityGatewayModelName(options.endpoint);

  if (apiStyle === "responses") {
    const body: Record<string, unknown> = {
      model: useGateway ? gatewayModel : options.endpoint,
      input: options.messages.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: clampedMaxTokens,
    };
    if (stream) {
      body.stream = true;
    }
    if (caps.supportsTemperature && options.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options.responseFormat === "json_object" && supportsJsonResponseFormat(options.endpoint)) {
      body.text = { format: { type: "json_object" } };
    }
    return {
      url: useGateway
        ? `${host}/ai-gateway/mlflow/v1/responses`
        : `${host}/serving-endpoints/responses`,
      body,
    };
  }

  const body: Record<string, unknown> = {
    ...(useGateway ? { model: gatewayModel } : {}),
    messages: options.messages,
    max_tokens: clampedMaxTokens,
  };
  if (stream) {
    body.stream = true;
  }
  if (caps.supportsTemperature) {
    body.temperature = options.temperature ?? 0.3;
  }
  if (options.responseFormat === "json_object" && supportsJsonResponseFormat(options.endpoint)) {
    body.response_format = { type: "json_object" };
  }
  return {
    url: useGateway
      ? `${host}/ai-gateway/mlflow/v1/chat/completions`
      : `${host}/serving-endpoints/${options.endpoint}/invocations`,
    body,
  };
}

// ---------------------------------------------------------------------------
// Chat Completions (non-streaming)
// ---------------------------------------------------------------------------

/**
 * Send a chat completion request to a Databricks Model Serving endpoint.
 *
 * Uses `/serving-endpoints/{endpoint}/invocations` (Chat Completions) or
 * `/serving-endpoints/responses` (Responses API for GPT-6.1 Sol / 6 Sol / 6 Luna).
 *
 * All calls pass through the global rate limiter to prevent 429 storms.
 */
export async function chatCompletion(
  options: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  const { host } = getConfig();

  const headers = await getAppHeaders();
  const caps = getModelCapabilities(options.endpoint);

  const requestedMaxTokens = options.maxTokens ?? caps.defaultMaxTokens;
  const clamped = Math.min(requestedMaxTokens, caps.maxOutputTokens);
  if (options.maxTokens !== undefined && clamped < options.maxTokens) {
    logger.warn("Clamped maxTokens to model limit", {
      endpoint: options.endpoint,
      requested: options.maxTokens,
      clamped,
      cap: caps.maxOutputTokens,
    });
  }

  const { url, body } = buildWireRequest(host, options, caps, clamped, false);

  logger.info("LLM call", {
    fn: "chatCompletion",
    endpoint: options.endpoint,
    apiStyle: caps.apiStyle ?? "chat_completions",
    maxTokens: clamped,
    jsonMode: options.responseFormat === "json_object",
    supportsJson: caps.supportsJsonMode,
    supportsTemperature: caps.supportsTemperature,
    maxOutputTokens: caps.maxOutputTokens,
  });

  const limiter = getPoolRateLimiter();
  await limiter.acquire(options.endpoint);
  const tracingActive = isMlflowTracingEnabled();
  const traceStart = tracingActive ? Date.now() : 0;
  try {
    let resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      LLM_TIMEOUT_MS,
      options.signal,
    );

    if (!resp.ok) {
      const errText = await resp.text();
      if ("temperature" in body && isUnsupportedTemperatureError(resp.status, errText)) {
        logger.warn(
          "Endpoint rejected temperature parameter (400) — retrying without temperature",
          {
            endpoint: options.endpoint,
          },
        );
        delete body.temperature;
        resp = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          },
          LLM_TIMEOUT_MS,
          options.signal,
        );
      } else if (
        !shouldUseUnityGateway(options.endpoint) &&
        isUnityGatewayEnforcedError(resp.status, errText)
      ) {
        logger.warn("Workspace enforces Unity Gateway (403) — retrying via /ai-gateway/mlflow/v1", {
          endpoint: options.endpoint,
        });
        const gwReq = buildWireRequest(host, options, caps, clamped, false, true);
        resp = await fetchWithTimeout(
          gwReq.url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(gwReq.body),
          },
          LLM_TIMEOUT_MS,
          options.signal,
        );
      } else {
        resp = new Response(errText, { status: resp.status, headers: resp.headers });
      }
    }

    if (!resp.ok) {
      const text = await resp.text();
      const unavailable = isEndpointNotFoundResponse(resp.status, text);
      if (unavailable) {
        markEndpointUnavailable(options.endpoint);
      }
      const retryAfterMs = resp.status === 429 ? parseRetryAfterHeader(resp) : undefined;
      if (resp.status === 429) {
        const rawRetryAfter = resp.headers.get("Retry-After");
        logger.warn("LLM 429 rate limit hit", {
          endpoint: options.endpoint,
          rawRetryAfterHeader: rawRetryAfter ?? "(none)",
          computedBackoffMs: retryAfterMs,
        });
      }
      if (retryAfterMs) {
        limiter.backoff(options.endpoint, retryAfterMs);
      }
      if (tracingActive) {
        void recordSpan({
          name: `chatCompletion:${options.endpoint}`,
          spanType: "LLM",
          inputs: { messages: options.messages, maxTokens: clamped },
          attributes: {
            endpoint: options.endpoint,
            httpStatus: resp.status,
            jsonMode: options.responseFormat === "json_object",
          },
          startMs: traceStart,
          endMs: Date.now(),
          errorMessage: `HTTP ${resp.status}: ${text.slice(0, 200)}`,
        });
      }
      throw new ModelServingError(
        `Model Serving request failed (${resp.status}): ${text}`,
        resp.status,
        retryAfterMs,
        unavailable,
      );
    }

    const data = await resp.json();
    const result = parseCompletionResponse(data);

    if (!result.content && result.finishReason !== "stop") {
      logger.warn("Empty LLM response content from Model Serving", {
        fn: "chatCompletion",
        endpoint: options.endpoint,
        finishReason: result.finishReason,
        model: result.model,
        usage: result.usage,
      });
    }

    if (tracingActive) {
      void recordSpan({
        name: `chatCompletion:${options.endpoint}`,
        spanType: "LLM",
        inputs: { messages: options.messages, maxTokens: clamped },
        outputs: { content: result.content, finishReason: result.finishReason },
        attributes: {
          endpoint: options.endpoint,
          model: result.model,
          tokensPrompt: result.usage?.promptTokens,
          tokensCompletion: result.usage?.completionTokens,
          tokensTotal: result.usage?.totalTokens,
          jsonMode: options.responseFormat === "json_object",
        },
        startMs: traceStart,
        endMs: Date.now(),
      });
    }

    return result;
  } finally {
    limiter.release(options.endpoint);
  }
}

// ---------------------------------------------------------------------------
// Chat Completions (streaming)
// ---------------------------------------------------------------------------

/**
 * Send a streaming chat completion request.
 *
 * Invokes the same endpoint with `stream: true`. Calls `onChunk` for each
 * content delta as it arrives. Returns the final assembled response with
 * accumulated content and usage stats.
 *
 * All calls pass through the global rate limiter to prevent 429 storms.
 */
export async function chatCompletionStream(
  options: ChatCompletionOptions,
  onChunk?: StreamCallback,
): Promise<ChatCompletionResponse> {
  const { host } = getConfig();

  const headers = await getAppHeaders();
  const caps = getModelCapabilities(options.endpoint);

  const requestedMaxTokens = options.maxTokens ?? caps.defaultMaxTokens;
  const clamped = Math.min(requestedMaxTokens, caps.maxOutputTokens);
  if (options.maxTokens !== undefined && clamped < options.maxTokens) {
    logger.warn("Clamped maxTokens to model limit (stream)", {
      endpoint: options.endpoint,
      requested: options.maxTokens,
      clamped,
      cap: caps.maxOutputTokens,
    });
  }

  const { url, body } = buildWireRequest(host, options, caps, clamped, true);

  const limiter = getPoolRateLimiter();
  await limiter.acquire(options.endpoint);
  try {
    let resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      LLM_STREAM_TIMEOUT_MS,
      options.signal,
    );

    if (!resp.ok) {
      const errText = await resp.text();
      if ("temperature" in body && isUnsupportedTemperatureError(resp.status, errText)) {
        logger.warn(
          "Endpoint rejected temperature parameter (400, stream) — retrying without temperature",
          { endpoint: options.endpoint },
        );
        delete body.temperature;
        resp = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          },
          LLM_STREAM_TIMEOUT_MS,
          options.signal,
        );
      } else if (
        !shouldUseUnityGateway(options.endpoint) &&
        isUnityGatewayEnforcedError(resp.status, errText)
      ) {
        logger.warn(
          "Workspace enforces Unity Gateway (403, stream) — retrying via /ai-gateway/mlflow/v1",
          { endpoint: options.endpoint },
        );
        const gwReq = buildWireRequest(host, options, caps, clamped, true, true);
        resp = await fetchWithTimeout(
          gwReq.url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(gwReq.body),
          },
          LLM_STREAM_TIMEOUT_MS,
          options.signal,
        );
      } else {
        resp = new Response(errText, { status: resp.status, headers: resp.headers });
      }
    }

    if (!resp.ok) {
      const text = await resp.text();
      const unavailable = isEndpointNotFoundResponse(resp.status, text);
      if (unavailable) {
        markEndpointUnavailable(options.endpoint);
      }
      const retryAfterMs = resp.status === 429 ? parseRetryAfterHeader(resp) : undefined;
      if (resp.status === 429) {
        const rawRetryAfter = resp.headers.get("Retry-After");
        logger.warn("LLM 429 rate limit hit (stream)", {
          endpoint: options.endpoint,
          rawRetryAfterHeader: rawRetryAfter ?? "(none)",
          computedBackoffMs: retryAfterMs,
        });
      }
      if (retryAfterMs) {
        limiter.backoff(options.endpoint, retryAfterMs);
      }
      throw new ModelServingError(
        `Model Serving streaming request failed (${resp.status}): ${text}`,
        resp.status,
        retryAfterMs,
        unavailable,
      );
    }

    if (!resp.body) {
      throw new ModelServingError("Streaming response has no body", 0);
    }

    return parseSSEStream(resp.body, onChunk);
  } finally {
    limiter.release(options.endpoint);
  }
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onChunk?: StreamCallback,
): Promise<ChatCompletionResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let content = "";
  let model = "";
  let finishReason: string | null = null;
  let usage: TokenUsage | null = null;
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);

          if (parsed.model) {
            model = parsed.model;
          }

          // Responses API SSE events (e.g. GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna)
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
            content += parsed.delta;
            onChunk?.(parsed.delta);
          } else if (
            (parsed.type === "response.completed" || parsed.type === "response.incomplete") &&
            parsed.response &&
            typeof parsed.response === "object"
          ) {
            const respObj = parsed.response as Record<string, unknown>;
            if (typeof respObj.model === "string") model = respObj.model;
            if (respObj.status === "incomplete") finishReason = "length";
            else if (respObj.status === "completed") finishReason = "stop";
            if (!content) {
              const extracted = extractResponsesOutputText(respObj);
              if (extracted) {
                content += extracted;
                onChunk?.(extracted);
              }
            }
            if (respObj.usage && typeof respObj.usage === "object") {
              usage = parseUsageObject(respObj.usage as Record<string, unknown>);
            }
          }

          const choice = parsed.choices?.[0];
          if (choice) {
            const rawDelta = choice.delta?.content;
            const deltaText =
              typeof rawDelta === "string"
                ? rawDelta
                : Array.isArray(rawDelta)
                  ? rawDelta
                      .filter(
                        (b: unknown) =>
                          typeof b === "string" ||
                          (b &&
                            typeof b === "object" &&
                            ((b as Record<string, unknown>).type === "text" ||
                              (b as Record<string, unknown>).type === "output_text")),
                      )
                      .map((b: unknown) =>
                        typeof b === "string"
                          ? b
                          : String((b as Record<string, unknown>).text ?? ""),
                      )
                      .join("")
                  : "";
            if (deltaText) {
              content += deltaText;
              onChunk?.(deltaText);
            }
            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
          }

          // Usage stats are sent in the final chunk
          if (parsed.usage && typeof parsed.usage === "object") {
            usage = parseUsageObject(parsed.usage as Record<string, unknown>);
          }
        } catch {
          // Skip malformed SSE data lines
          logger.debug("Skipping malformed SSE chunk", { data });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content, usage, model, finishReason };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Extract text from a content value that may be a string (normal) or an
 * array of content blocks (reasoning models like Gemini 3 return
 * [{type:"reasoning",...},{type:"text",text:"answer"}]).
 *
 * The reasoning_effort parameter is NOT available on pay-per-token
 * endpoints, so we must always handle both shapes here.
 */
export function extractContentText(raw: unknown): string {
  if (typeof raw === "string") return raw;

  if (Array.isArray(raw)) {
    // Prefer explicit {type:"text"} or {type:"output_text"} blocks, skip reasoning blocks
    const textBlocks = raw.filter(
      (p: Record<string, unknown>) =>
        p?.type === "text" || p?.type === "output_text" || typeof p === "string",
    );
    const joined = textBlocks
      .map((p: unknown) =>
        typeof p === "string" ? p : (((p as Record<string, unknown>)?.text as string) ?? ""),
      )
      .join("");

    if (joined) return joined;

    // Fallback: extract .text from any block that has one
    return raw
      .map((p: unknown) =>
        typeof p === "string" ? p : (((p as Record<string, unknown>)?.text as string) ?? ""),
      )
      .join("");
  }

  return raw != null ? String(raw) : "";
}

function parseUsageObject(rawUsage: Record<string, unknown>): TokenUsage {
  const promptTokens = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? 0) || 0;
  const completionTokens = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? 0) || 0;
  const totalTokens = Number(rawUsage.total_tokens ?? promptTokens + completionTokens) || 0;
  return { promptTokens, completionTokens, totalTokens };
}

function extractResponsesOutputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string" && data.output_text) {
    return data.output_text;
  }
  if (Array.isArray(data.output)) {
    const parts: string[] = [];
    for (const item of data.output as Array<Record<string, unknown>>) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        const text = extractContentText(item.content);
        if (text) parts.push(text);
      } else if (item?.type === "output_text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
    if (parts.length > 0) return parts.join("");
  }
  return "";
}

function parseCompletionResponse(data: Record<string, unknown>): ChatCompletionResponse {
  const choices = data.choices as
    | Array<{
        message?: { content?: unknown };
        finish_reason?: string;
      }>
    | undefined;

  const isResponsesPayload = !choices && (Array.isArray(data.output) || "output_text" in data);
  const content = isResponsesPayload
    ? extractResponsesOutputText(data)
    : extractContentText(choices?.[0]?.message?.content);

  let finishReason: string | null = choices?.[0]?.finish_reason ?? null;
  if (isResponsesPayload && !finishReason) {
    if (data.status === "incomplete") finishReason = "length";
    else if (data.status === "completed") finishReason = "stop";
  }

  const model = (data.model as string) ?? "";

  const rawUsage = data.usage as Record<string, unknown> | undefined;
  const usage: TokenUsage | null = rawUsage ? parseUsageObject(rawUsage) : null;

  return { content, usage, model, finishReason };
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class ModelServingError extends Error {
  /** HTTP status code from the Model Serving endpoint. */
  readonly statusCode: number;

  /** Parsed Retry-After delay in ms (set on 429 responses). */
  readonly retryAfterMs?: number;

  /**
   * True when the error indicates the endpoint does not exist in this
   * workspace/region (404, or 400 with RESOURCE_DOES_NOT_EXIST). The
   * runtime rotation layer uses this to skip retries and immediately
   * rotate to an alternative endpoint.
   */
  readonly endpointUnavailable: boolean;

  constructor(
    message: string,
    statusCode: number,
    retryAfterMs?: number,
    endpointUnavailable = false,
  ) {
    super(message);
    this.name = "ModelServingError";
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
    this.endpointUnavailable = endpointUnavailable;
  }
}

/**
 * Thrown when Model Serving returns a structurally valid response but with
 * no extractable text content. This is observed on:
 *   - reasoning models that emit only `{type:"thinking"}` blocks (no text)
 *   - smaller models that abandon a very large structured-output prompt
 *   - safety/refusal paths that produce zero `{type:"text"}` blocks
 *
 * Treated by the retry loop as retryable AND fallback-eligible so the next
 * priority endpoint is tried instead of hammering the same model.
 */
export class EmptyContentError extends ModelServingError {
  /** The model identifier that returned empty content (for diagnostics). */
  readonly model: string;
  /** The finish_reason reported by the model (e.g. "stop", "length"). */
  readonly finishReason: string | null;

  constructor(promptKey: string, endpoint: string, finishReason: string | null) {
    super(
      `FMAPI returned empty content for ${promptKey} (endpoint=${endpoint}, finish_reason=${finishReason ?? "null"})`,
      0,
    );
    this.name = "EmptyContentError";
    this.model = endpoint;
    this.finishReason = finishReason;
  }
}

export function isEmptyContentError(err: unknown): err is EmptyContentError {
  return err instanceof EmptyContentError;
}
