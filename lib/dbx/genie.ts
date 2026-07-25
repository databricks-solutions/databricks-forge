/**
 * Databricks Genie Spaces REST API client.
 *
 * Follows the same pattern as workspace.ts: uses getConfig() for host,
 * getHeaders() (OBO) for read operations, fetchWithTimeout with TIMEOUTS.WORKSPACE.
 *
 * API docs: https://docs.databricks.com/api/workspace/genie
 */

import { getConfig, getAppHeaders, getHeaders } from "./client";
import { fetchWithTimeout, TIMEOUTS } from "./fetch-with-timeout";
import { mkdirs } from "./workspace";
import { logger } from "@/lib/logger";
import type { GenieSpaceResponse, GenieListResponse } from "@/lib/genie/types";
import type { GenieAuthMode } from "@/lib/settings";
import { enforceConstraints, cleanConfig } from "./genie-cleanup";
import { sanitizeIds } from "./genie-id-sanitizer";

/**
 * Resolve auth headers based on the deploy auth mode (defaults to OBO).
 *
 * When an explicit `oboToken` is provided (e.g. captured at job creation for
 * background tasks that run outside a request context), it is used directly
 * instead of relying on the request-scoped `getHeaders()`.
 */
async function resolveHeaders(
  authMode?: GenieAuthMode,
  oboToken?: string,
): Promise<Record<string, string>> {
  if (authMode === "sp") return getAppHeaders();
  if (oboToken) {
    return { Authorization: `Bearer ${oboToken}`, "Content-Type": "application/json" };
  }
  return getHeaders();
}

export const DEFAULT_GENIE_PARENT_PATH = "/Shared/Forge Genie Spaces/";
const FALLBACK_GENIE_PARENT_PATH = "/Shared/";

/**
 * Build the parent_path fallback chain for createGenieSpace, in order of
 * preference. The first non-null entry that the API accepts wins.
 *
 * 1. Caller-supplied path (if any)
 * 2. Env override (`FORGE_GENIE_DEFAULT_PARENT_PATH`)
 * 3. Default Forge folder
 * 4. Last-resort `/Shared/`
 *
 * Duplicates are removed while preserving order so we never re-attempt the
 * same path twice.
 */
function buildParentPathChain(callerPath?: string): string[] {
  const candidates = [
    callerPath,
    process.env.FORGE_GENIE_DEFAULT_PARENT_PATH,
    DEFAULT_GENIE_PARENT_PATH,
    FALLBACK_GENIE_PARENT_PATH,
  ];
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    chain.push(trimmed);
  }
  return chain;
}

/**
 * Sanitize-and-cleanup a serialized space JSON string.
 *
 * Order matters:
 * 1. `sanitizeSerializedSpace` -- shape coercion (string→array, sort,
 *    join_spec rewrite, etc.)
 * 2. `sanitizeIds` -- id character normalization + collision-aware uniquification
 * 3. `enforceConstraints` -- structural caps + dedupe + drop empty SQL
 * 4. `cleanConfig` -- per-string truncation + total-bytes warning + relationship_type normalize
 *
 * Returns the post-cleanup JSON string. Idempotent: calling twice on the same
 * input is a no-op.
 */
function sanitizeAndCleanup(serializedSpace: string): string {
  const sanitized = sanitizeSerializedSpace(serializedSpace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    return sanitized;
  }
  sanitizeIds(parsed);
  enforceConstraints(parsed);
  cleanConfig(parsed);
  return JSON.stringify(parsed);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listGenieSpaces(
  pageSize = 100,
  pageToken?: string,
): Promise<GenieListResponse> {
  const config = getConfig();
  const params = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) params.set("page_token", pageToken);

  const url = `${config.host}/api/2.0/genie/spaces?${params}`;
  const headers = await getHeaders();

  const response = await fetchWithTimeout(url, { method: "GET", headers }, TIMEOUTS.WORKSPACE);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie list spaces failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieListResponse;
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

export async function getGenieSpace(spaceId: string): Promise<GenieSpaceResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}?include_serialized_space=true`;
  const headers = await getHeaders();

  const response = await fetchWithTimeout(url, { method: "GET", headers }, TIMEOUTS.WORKSPACE);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie get space failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieSpaceResponse;
}

// ---------------------------------------------------------------------------
// Sanitise serialized space before sending to the API.
// Fixes known enum casing issues (e.g. benchmark answer format must be
// uppercase "SQL", not lowercase "sql") so that older persisted payloads
// still deploy successfully.
// ---------------------------------------------------------------------------

const VALID_BENCHMARK_FORMATS = new Set(["SQL"]);

export function sanitizeSerializedSpace(raw: string): string {
  try {
    const parsed = JSON.parse(raw);

    // Fix benchmark answer format enum casing
    const questions = parsed?.benchmarks?.questions;
    if (Array.isArray(questions)) {
      for (const q of questions) {
        if (Array.isArray(q.answer)) {
          for (const a of q.answer) {
            if (typeof a.format === "string" && !VALID_BENCHMARK_FORMATS.has(a.format)) {
              a.format = a.format.toUpperCase();
            }
          }
        }
      }
    }

    // Collapse text_instructions to at most one entry (API limit)
    const instrs = parsed?.instructions?.text_instructions;
    if (Array.isArray(instrs) && instrs.length > 1) {
      const allContent = instrs.flatMap((i: { content?: string[] }) => i.content ?? []);
      parsed.instructions.text_instructions = [{ id: instrs[0].id, content: allContent }];
    }

    // Strip unsupported fields from data_sources.tables
    const tables = parsed?.data_sources?.tables;
    if (Array.isArray(tables)) {
      for (const t of tables) {
        delete t.columns;
      }
    }

    // Sort metric_views by identifier (Genie API requirement)
    const metricViews = parsed?.data_sources?.metric_views;
    if (Array.isArray(metricViews)) {
      metricViews.sort((a: { identifier?: string }, b: { identifier?: string }) =>
        (a.identifier ?? "").localeCompare(b.identifier ?? ""),
      );
    }

    // Strip unsupported `instructions` field from sql_snippets (measures, filters, expressions)
    const snippets = parsed?.instructions?.sql_snippets;
    if (snippets) {
      for (const key of ["measures", "filters", "expressions"] as const) {
        const items = snippets[key];
        if (Array.isArray(items)) {
          for (const item of items) {
            delete item.instructions;
          }
        }
      }
    }

    // Sanitize join_specs: rewrite FQN SQL to alias format, add aliases, encode relationship_type
    const joinSpecs = parsed?.instructions?.join_specs;
    if (Array.isArray(joinSpecs)) {
      for (const js of joinSpecs) {
        const leftId: string = js.left?.identifier ?? "";
        const rightId: string = js.right?.identifier ?? "";

        // Add aliases if missing
        if (leftId && !js.left.alias) {
          js.left.alias = leftId.split(".").pop() ?? leftId;
        }
        if (rightId && !js.right.alias) {
          let alias = rightId.split(".").pop() ?? rightId;
          if (alias === js.left.alias) alias = `${alias}_2`;
          js.right.alias = alias;
        }

        // Rewrite FQN.column references in sql[] to `alias`.`column` format
        if (Array.isArray(js.sql) && leftId && rightId) {
          const leftAlias = js.left.alias as string;
          const rightAlias = js.right.alias as string;

          js.sql = js.sql.map((s: string) => {
            if (s.startsWith("--")) return s;
            let result = s;
            // Sort by length descending to avoid partial matches
            const replacements = (
              [
                [leftId, leftAlias],
                [rightId, rightAlias],
              ] as [string, string][]
            ).sort((a, b) => b[0].length - a[0].length);
            for (const [fqn, alias] of replacements) {
              const escaped = fqn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              result = result.replace(
                new RegExp(`${escaped}\\.([a-zA-Z_]\\w*)`, "g"),
                `\`${alias}\`.\`$1\``,
              );
            }
            return result;
          });
        }

        // Encode relationship_type as SQL comment if present
        if (js.relationship_type) {
          const rtTag = `FROM_RELATIONSHIP_TYPE_${String(js.relationship_type).toUpperCase()}`;
          if (Array.isArray(js.sql) && !js.sql.some((s: string) => s.includes("--rt="))) {
            js.sql.push(`--rt=${rtTag}--`);
          }
          delete js.relationship_type;
        }
      }
    }

    // Strip any leftover sql_functions (no longer supported)
    if (parsed?.instructions?.sql_functions) {
      delete parsed.instructions.sql_functions;
    }

    // Remove sql_snippets with empty SQL (API rejects them)
    if (snippets) {
      for (const key of ["measures", "filters", "expressions"] as const) {
        const items = snippets[key];
        if (Array.isArray(items)) {
          snippets[key] = items.filter((item: Record<string, unknown>) => {
            const sql = item.sql;
            if (!sql) return false;
            if (Array.isArray(sql))
              return sql.some((s: unknown) => typeof s === "string" && s.trim().length > 0);
            if (typeof sql === "string") return sql.trim().length > 0;
            return true;
          });
        }
      }
    }

    // Coerce string fields to string arrays where the API expects arrays
    const STRING_ARRAY_FIELDS = new Set([
      "description",
      "content",
      "question",
      "sql",
      "instruction",
      "synonyms",
      "usage_guidance",
      "comment",
    ]);
    function coerceStringArrays(obj: unknown): unknown {
      if (obj == null) return obj;
      if (Array.isArray(obj)) return obj.filter((v) => v != null).map(coerceStringArrays);
      if (typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (STRING_ARRAY_FIELDS.has(k) && typeof v === "string") {
            result[k] = [v];
          } else {
            result[k] = coerceStringArrays(v);
          }
        }
        return result;
      }
      return obj;
    }
    const coerced = coerceStringArrays(parsed) as typeof parsed;
    Object.assign(parsed, coerced);

    // Sort column_configs by column_name within each table/metric_view
    for (const collection of [parsed?.data_sources?.tables, parsed?.data_sources?.metric_views]) {
      if (Array.isArray(collection)) {
        for (const item of collection) {
          if (Array.isArray(item.column_configs)) {
            item.column_configs.sort((a: { column_name?: string }, b: { column_name?: string }) =>
              (a.column_name ?? "").localeCompare(b.column_name ?? ""),
            );
          }
        }
      }
    }

    // Normalize + sort all id-keyed arrays (Genie API requires lowercase 32-hex UUIDs without hyphens, sorted)
    for (const arr of [
      parsed?.config?.sample_questions,
      parsed?.instructions?.join_specs,
      parsed?.instructions?.example_question_sqls,
      parsed?.instructions?.text_instructions,
      parsed?.instructions?.sql_snippets?.measures,
      parsed?.instructions?.sql_snippets?.filters,
      parsed?.instructions?.sql_snippets?.expressions,
      parsed?.benchmarks?.questions,
    ]) {
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item?.id === "string") {
            item.id = item.id.replace(/-/g, "").toLowerCase();
          }
        }
        arr.sort((a: { id?: string }, b: { id?: string }) =>
          (a.id ?? "").localeCompare(b.id ?? ""),
        );
      }
    }

    // Sort data_sources.tables by identifier (Genie API requirement)
    const dsTables = parsed?.data_sources?.tables;
    if (Array.isArray(dsTables)) {
      dsTables.sort((a: { identifier?: string }, b: { identifier?: string }) =>
        (a.identifier ?? "").localeCompare(b.identifier ?? ""),
      );
    }

    return JSON.stringify(parsed);
  } catch (err) {
    logger.error("sanitizeSerializedSpace: failed to parse JSON, returning raw", {
      error: err instanceof Error ? err.message : String(err),
      rawLength: raw.length,
    });
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createGenieSpace(opts: {
  title: string;
  description: string;
  serializedSpace: string;
  warehouseId: string;
  parentPath?: string;
  authMode?: GenieAuthMode;
  oboToken?: string;
}): Promise<GenieSpaceResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces`;
  const headers = await resolveHeaders(opts.authMode, opts.oboToken);
  const sanitized = sanitizeAndCleanup(opts.serializedSpace);

  // Debug: log join_specs from the final payload so we can diagnose API rejections
  try {
    const debugParsed = JSON.parse(sanitized);
    const debugJoins = debugParsed?.instructions?.join_specs;
    if (Array.isArray(debugJoins) && debugJoins.length > 0) {
      logger.info("createGenieSpace: join_specs sample", {
        count: debugJoins.length,
        first: JSON.stringify(debugJoins[0]),
        last: JSON.stringify(debugJoins[debugJoins.length - 1]),
      });
    }
  } catch (e) {
    logger.debug("[genie] Failed to log join_specs debug info", { error: String(e) });
  }

  const chain = buildParentPathChain(opts.parentPath);
  let lastError: { status: number; text: string } | null = null;

  for (let i = 0; i < chain.length; i++) {
    const parentPath = chain[i];

    try {
      await mkdirs(parentPath);
    } catch (e) {
      logger.debug("[genie] Pre-create parent folder failed (will still attempt)", {
        parentPath,
        error: String(e),
      });
    }

    const body = {
      title: opts.title,
      description: opts.description,
      serialized_space: sanitized,
      warehouse_id: opts.warehouseId,
      parent_path: parentPath,
    };

    const response = await fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      TIMEOUTS.WORKSPACE,
    );

    if (response.ok) {
      if (i > 0) {
        logger.warn("Genie create succeeded on parent_path fallback", {
          parentPath,
          attempt: i + 1,
        });
      }
      return (await response.json()) as GenieSpaceResponse;
    }

    const text = await response.text();
    lastError = { status: response.status, text };

    const isRetryable =
      text.includes("RESOURCE_DOES_NOT_EXIST") ||
      response.status === 403 ||
      response.status === 404;
    if (!isRetryable || i === chain.length - 1) break;

    logger.warn("Genie parent_path attempt failed; trying next candidate", {
      parentPath,
      status: response.status,
      attempt: i + 1,
      remaining: chain.length - i - 1,
    });
  }

  throw new Error(
    `Genie create space failed (${lastError?.status ?? "unknown"}): ${lastError?.text ?? "no candidates tried"}`,
  );
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateGenieSpace(
  spaceId: string,
  opts: {
    title?: string;
    description?: string;
    serializedSpace?: string;
    warehouseId?: string;
    authMode?: GenieAuthMode;
    oboToken?: string;
  },
): Promise<GenieSpaceResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}`;
  const headers = await resolveHeaders(opts.authMode, opts.oboToken);

  const body: Record<string, string> = {};
  if (opts.title !== undefined) body.title = opts.title;
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.serializedSpace !== undefined)
    body.serialized_space = sanitizeAndCleanup(opts.serializedSpace);
  if (opts.warehouseId !== undefined) body.warehouse_id = opts.warehouseId;

  const response = await fetchWithTimeout(
    url,
    { method: "PATCH", headers, body: JSON.stringify(body) },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie update space failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieSpaceResponse;
}

// ---------------------------------------------------------------------------
// 429 Rate-limit retry for Genie Conversation API
// ---------------------------------------------------------------------------

const GENIE_429_MAX_RETRIES = 3;
const GENIE_429_BASE_BACKOFF_MS = 30_000;

function extractRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = parseInt(header, 10);
  return !isNaN(seconds) ? seconds * 1000 : null;
}

/**
 * Wrapper around fetchWithTimeout that retries on 429 with exponential backoff.
 * Uses Retry-After header when available, otherwise backs off from 30s.
 */
async function fetchWithGenie429Retry(
  url: string,
  init: RequestInit,
  timeout: number,
  context: string,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchWithTimeout(url, init, timeout);

    if (response.status !== 429) return response;
    if (attempt >= GENIE_429_MAX_RETRIES) return response;

    const retryMs =
      extractRetryAfterMs(response) ?? GENIE_429_BASE_BACKOFF_MS * Math.pow(2, attempt);
    logger.warn(
      `${context}: 429 rate limited, retrying in ${Math.round(retryMs / 1000)}s (attempt ${attempt + 1}/${GENIE_429_MAX_RETRIES})`,
      { attempt, retryMs },
    );
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
}

// ---------------------------------------------------------------------------
// Conversation API -- ask questions to a deployed Genie Space
// ---------------------------------------------------------------------------

export interface GenieConversationMessage {
  question: string;
  conversationId: string;
  messageId: string;
  status:
    | "COMPLETED"
    | "EXECUTING_QUERY"
    | "FAILED"
    | "CANCELLED"
    | "SUBMITTED"
    | "FILTERING_RESULTS"
    | "ASKING_AI"
    | "CANCELLED_BY_USER";
  sql?: string;
  textResponse?: string;
  error?: string;
}

async function pollMessageCompletion(
  spaceId: string,
  conversationId: string,
  messageId: string,
  timeoutMs = 120_000,
  oboToken?: string,
): Promise<GenieConversationMessage> {
  const config = getConfig();
  const headers = await resolveHeaders(undefined, oboToken);
  const deadline = Date.now() + timeoutMs;
  const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "CANCELLED_BY_USER"]);

  while (Date.now() < deadline) {
    const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}`;
    const response = await fetchWithGenie429Retry(
      url,
      { method: "GET", headers },
      TIMEOUTS.WORKSPACE,
      "Genie poll message",
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Genie get message failed (${response.status}): ${text}`);
    }

    const msg = (await response.json()) as {
      id: string;
      status: string;
      query_result?: { query_text?: string };
      error?: { message?: string };
      content?: string;
    };

    if (terminalStatuses.has(msg.status)) {
      return {
        question: "",
        conversationId,
        messageId,
        status: msg.status as GenieConversationMessage["status"],
        sql: msg.query_result?.query_text,
        textResponse: msg.content,
        error: msg.error?.message,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return {
    question: "",
    conversationId,
    messageId,
    status: "FAILED",
    error: `Timed out after ${timeoutMs}ms`,
  };
}

/**
 * Start a new conversation with a Genie Space by asking a question.
 * Polls until the response is complete or times out.
 *
 * API: POST /api/2.0/genie/spaces/{space_id}/start-conversation
 */
export async function startConversation(
  spaceId: string,
  question: string,
  timeoutMs = 120_000,
  oboToken?: string,
): Promise<GenieConversationMessage> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/start-conversation`;
  const headers = await resolveHeaders(undefined, oboToken);

  const response = await fetchWithGenie429Retry(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ content: question }),
    },
    TIMEOUTS.WORKSPACE,
    "Genie start conversation",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie start conversation failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    conversation_id?: string;
    message_id?: string;
    conversation?: { id: string };
    message?: { message_id: string };
  };

  const conversationId = data.conversation_id ?? data.conversation?.id;
  const messageId = data.message_id ?? data.message?.message_id;

  if (!conversationId || !messageId) {
    throw new Error("Genie start-conversation response missing conversation_id or message_id");
  }

  const result = await pollMessageCompletion(
    spaceId,
    conversationId,
    messageId,
    timeoutMs,
    oboToken,
  );

  return { ...result, question };
}

/**
 * Send a follow-up question in an existing Genie conversation.
 * Polls until the response is complete or times out.
 */
export async function sendFollowUp(
  spaceId: string,
  conversationId: string,
  question: string,
  timeoutMs = 120_000,
  oboToken?: string,
): Promise<GenieConversationMessage> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages`;
  const headers = await resolveHeaders(undefined, oboToken);

  const response = await fetchWithGenie429Retry(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ content: question }),
    },
    TIMEOUTS.WORKSPACE,
    "Genie follow-up",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie follow-up failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    id?: string;
    message_id?: string;
  };

  const messageId = data.id ?? data.message_id;
  if (!messageId) {
    throw new Error("Genie follow-up response missing message id");
  }

  const result = await pollMessageCompletion(
    spaceId,
    conversationId,
    messageId,
    timeoutMs,
    oboToken,
  );

  return { ...result, question };
}

// ---------------------------------------------------------------------------
// Eval API -- benchmark evaluation runs (Beta)
// https://docs.databricks.com/api/workspace/genie
// ---------------------------------------------------------------------------

import type {
  GenieEvalRunResponse,
  GenieEvalResultDetails,
  GenieListEvalRunsResponse,
  GenieListEvalResultsResponse,
} from "@/lib/genie/eval-types";
import { TERMINAL_EVAL_STATUSES } from "@/lib/genie/eval-types";

export async function createEvalRun(
  spaceId: string,
  questionIds?: string[],
  oboToken?: string,
): Promise<GenieEvalRunResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/eval-runs`;
  const headers = await resolveHeaders(undefined, oboToken);

  const body: Record<string, unknown> = {};
  if (questionIds && questionIds.length > 0) {
    body.benchmark_question_ids = questionIds;
  }

  const response = await fetchWithGenie429Retry(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    TIMEOUTS.WORKSPACE,
    "Genie create eval run",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie create eval run failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieEvalRunResponse;
}

export async function getEvalRun(
  spaceId: string,
  evalRunId: string,
  oboToken?: string,
): Promise<GenieEvalRunResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/eval-runs/${evalRunId}`;
  const headers = await resolveHeaders(undefined, oboToken);

  const response = await fetchWithGenie429Retry(
    url,
    { method: "GET", headers },
    TIMEOUTS.WORKSPACE,
    "Genie get eval run",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie get eval run failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieEvalRunResponse;
}

export async function listEvalRuns(
  spaceId: string,
  pageSize?: number,
  pageToken?: string,
  oboToken?: string,
): Promise<GenieListEvalRunsResponse> {
  const config = getConfig();
  const params = new URLSearchParams();
  if (pageSize) params.set("page_size", String(pageSize));
  if (pageToken) params.set("page_token", pageToken);

  const qs = params.toString();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/eval-runs${qs ? `?${qs}` : ""}`;
  const headers = await resolveHeaders(undefined, oboToken);

  const response = await fetchWithGenie429Retry(
    url,
    { method: "GET", headers },
    TIMEOUTS.WORKSPACE,
    "Genie list eval runs",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie list eval runs failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieListEvalRunsResponse;
}

export async function listEvalResults(
  spaceId: string,
  evalRunId: string,
  pageSize?: number,
  pageToken?: string,
  oboToken?: string,
): Promise<GenieListEvalResultsResponse> {
  const config = getConfig();
  const params = new URLSearchParams();
  if (pageSize) params.set("page_size", String(pageSize));
  if (pageToken) params.set("page_token", pageToken);

  const qs = params.toString();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/eval-runs/${evalRunId}/results${qs ? `?${qs}` : ""}`;
  const headers = await resolveHeaders(undefined, oboToken);

  const response = await fetchWithGenie429Retry(
    url,
    { method: "GET", headers },
    TIMEOUTS.WORKSPACE,
    "Genie list eval results",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie list eval results failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieListEvalResultsResponse;
}

export async function getEvalResultDetails(
  spaceId: string,
  evalRunId: string,
  resultId: string,
  oboToken?: string,
): Promise<GenieEvalResultDetails> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}/eval-runs/${evalRunId}/results/${resultId}`;
  const headers = await resolveHeaders(undefined, oboToken);

  const response = await fetchWithGenie429Retry(
    url,
    { method: "GET", headers },
    TIMEOUTS.WORKSPACE,
    "Genie get eval result details",
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Genie get eval result details failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GenieEvalResultDetails;
}

const DEFAULT_EVAL_POLL_INTERVAL_MS = 3_000;
const DEFAULT_EVAL_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Poll an eval run until it reaches a terminal status (DONE, EVALUATION_FAILED,
 * EVALUATION_CANCELLED, EVALUATION_TIMEOUT) or our local timeout is exceeded.
 */
export async function pollEvalRunUntilDone(
  spaceId: string,
  evalRunId: string,
  oboToken?: string,
  opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    onProgress?: (run: GenieEvalRunResponse) => void;
  },
): Promise<GenieEvalRunResponse> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_EVAL_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const run = await getEvalRun(spaceId, evalRunId, oboToken);
    opts?.onProgress?.(run);

    if (run.eval_run_status && TERMINAL_EVAL_STATUSES.has(run.eval_run_status)) {
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Eval run ${evalRunId} timed out after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Trash (soft delete)
// ---------------------------------------------------------------------------

export async function trashGenieSpace(spaceId: string, authMode?: GenieAuthMode): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/genie/spaces/${spaceId}`;
  const headers = await resolveHeaders(authMode);

  const response = await fetchWithTimeout(url, { method: "DELETE", headers }, TIMEOUTS.WORKSPACE);

  if (!response.ok) {
    const text = await response.text();
    if (response.status !== 404) {
      throw new Error(`Genie trash space failed (${response.status}): ${text}`);
    }
  }
}
