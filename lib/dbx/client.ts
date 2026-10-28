/**
 * Databricks client configuration.
 *
 * Supports four authentication modes (checked in priority order):
 *   1. **User authorization (on-behalf-of-user)**: When deployed as a
 *      Databricks App with user-auth scopes, the platform injects the
 *      user's access token in the `x-forwarded-access-token` header.
 *      This lets UC permissions follow the logged-in user.
 *   2. **PAT (local dev override)**: Uses DATABRICKS_TOKEN in .env.local.
 *   3. **CLI OAuth U2M (local dev)**: Shells out to `databricks auth token`
 *      to get a short-lived token from the CLI's OAuth session. No
 *      credentials stored on disk -- developer runs `databricks auth login`
 *      once and the app transparently picks up refreshed tokens.
 *   4. **App authorization (service principal)**: Falls back to OAuth M2M via
 *      DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET injected at runtime.
 *
 * The SQL Warehouse ID is read from DATABRICKS_WAREHOUSE_ID, which is mapped
 * from the app's sql-warehouse resource binding via app.yaml.
 */

import { execSync } from "child_process";
import { headers as nextHeaders } from "next/headers";
import { getDatabricksAuthContext } from "./auth-context";
import { fetchWithTimeout, TIMEOUTS } from "./fetch-with-timeout";

// Re-export the task router so callers can do `import { resolveEndpoint } from "@/lib/dbx/client"`
export {
  resolveEndpoint,
  getFallbacksForTier,
  resolvePremiumReasoningEndpoint,
} from "./task-router";
export type { TaskTier } from "./task-router";

export interface DatabricksConfig {
  host: string; // always includes https://
  warehouseId: string;
}

// ---------------------------------------------------------------------------
// OAuth token cache
// ---------------------------------------------------------------------------

interface OAuthToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _oauthToken: OAuthToken | null = null;

// ---------------------------------------------------------------------------
// Databricks CLI token cache (OAuth U2M for local dev)
// ---------------------------------------------------------------------------

interface CliTokenEntry {
  accessToken: string;
  expiresAt: number;
}

let _cliToken: CliTokenEntry | null = null;
const CLI_TOKEN_CACHE_MS = 5 * 60_000; // cache for 5 minutes

/**
 * Try to obtain a token from the Databricks CLI's OAuth session.
 *
 * Requires the developer to have run `databricks auth login` at least once.
 * The CLI manages short-lived tokens (~1hr) with automatic refresh.
 *
 * When `DATABRICKS_CLI_PROFILE` is set, uses `--profile` instead of `--host`
 * to support multi-workspace configurations. Otherwise resolves by host.
 *
 * Returns null if the CLI is not installed or not authenticated.
 */
function getCliToken(host: string): string | null {
  if (_cliToken && Date.now() < _cliToken.expiresAt) {
    return _cliToken.accessToken;
  }
  try {
    const profile = process.env.DATABRICKS_CLI_PROFILE;
    const selector = profile ? `--profile ${profile}` : `--host ${host}`;
    const cmd = `databricks auth token ${selector}`;

    const raw = execSync(cmd, {
      timeout: 5_000,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: [
          process.env.PATH,
          "/opt/homebrew/bin",
          "/usr/local/bin",
          `${process.env.HOME}/.local/bin`,
          `${process.env.HOME}/.databricks/bin`,
        ]
          .filter(Boolean)
          .join(":"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const data = JSON.parse(raw.trim());
    if (data.access_token) {
      _cliToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + CLI_TOKEN_CACHE_MS,
      };
      return data.access_token;
    }
    console.warn("[forge:auth] CLI returned no access_token:", raw.trim().slice(0, 200));
  } catch (err) {
    if (!_cliTokenWarned) {
      _cliTokenWarned = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[forge:auth] Databricks CLI token failed. Ensure \`databricks auth login\` ` +
          `has been run and the CLI is on PATH.\n  Error: ${msg.split("\n")[0]}`,
      );
    }
  }
  return null;
}

let _cliTokenWarned = false;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

let _config: DatabricksConfig | null = null;

function normaliseHost(raw: string): string {
  let h = raw.replace(/\/+$/, "");
  if (!h.startsWith("https://") && !h.startsWith("http://")) {
    h = `https://${h}`;
  }
  return h;
}

/**
 * Returns the Databricks configuration, reading from env vars on first call.
 * Throws if required variables are missing.
 */
export function getConfig(): DatabricksConfig {
  if (_config) return _config;

  const host = process.env.DATABRICKS_HOST;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;

  if (!host) {
    throw new Error(
      "DATABRICKS_HOST is not set. Set it in .env.local or deploy as a Databricks App.",
    );
  }
  if (!warehouseId) {
    throw new Error(
      "DATABRICKS_WAREHOUSE_ID is not set. " +
        "Ensure app.yaml maps the sql-warehouse resource to this env var, " +
        "or set it in .env.local for local development.",
    );
  }

  _config = {
    host: normaliseHost(host),
    warehouseId,
  };

  return _config;
}

const DEFAULT_SERVING_ENDPOINT = "databricks-claude-opus-5-5";
/**
 * Returns the Model Serving endpoint name.
 *
 * Resolution order:
 *   1. `DATABRICKS_SERVING_ENDPOINT` env var (set via deploy.sh or app.yaml
 *      resource binding when deployed, or .env.local for local dev).
 *   2. Falls back to `DEFAULT_SERVING_ENDPOINT` so the app works out of the
 *      box without requiring the env var. Pipeline runs store the model name
 *      per-run in the `aiModel` config field.
 */
export function getServingEndpoint(): string {
  return process.env.DATABRICKS_SERVING_ENDPOINT || DEFAULT_SERVING_ENDPOINT;
}

/**
 * Returns the fast Model Serving endpoint name for low-complexity passes.
 *
 * Used across all pipelines for passes that need structured output but not
 * maximum reasoning (classification, metadata enrichment, domain assignment,
 * deduplication, column intelligence, join inference, instructions).
 *
 * Resolution order:
 *   1. `DATABRICKS_SERVING_ENDPOINT_FAST` env var (set via app resource
 *      binding `serving-endpoint-fast`, or .env.local for local dev).
 *   2. Falls back to `getServingEndpoint()` (premium model) -- so if the
 *      fast resource is not configured, everything uses the primary model.
 */
export function getFastServingEndpoint(): string {
  return process.env.DATABRICKS_SERVING_ENDPOINT_FAST || getServingEndpoint();
}

/**
 * Returns the review Model Serving endpoint name.
 *
 * Used by the SQL reviewer (lib/ai/sql-reviewer.ts) for LLM-as-reviewer
 * quality checks across all SQL-generating surfaces.
 *
 * Resolution order:
 *   1. `DATABRICKS_REVIEW_ENDPOINT` env var (set via app resource
 *      binding `serving-endpoint-review`, or .env.local for local dev).
 *   2. Falls back to `getServingEndpoint()` (premium model) -- so if the
 *      review resource is not configured, review uses the primary model.
 */
export function getReviewEndpoint(): string {
  return process.env.DATABRICKS_REVIEW_ENDPOINT || getServingEndpoint();
}

/**
 * Returns an alternate endpoint to try when `currentEndpoint` is rate-limited.
 *
 * Prefers the review endpoint (`databricks-gpt-5-4`) as fallback for the
 * premium/fast models.  If `currentEndpoint` *is* the review endpoint,
 * falls back to the primary.  Returns `null` when no distinct alternative
 * is available (avoids self-fallback loops).
 */
export function getFallbackEndpoint(currentEndpoint: string): string | null {
  const review = getReviewEndpoint();
  if (review !== currentEndpoint) return review;
  const primary = getServingEndpoint();
  if (primary !== currentEndpoint) return primary;
  return null;
}

/**
 * Whether a dedicated review endpoint is configured.
 * Callers can use this to gate optional review passes.
 */
export function isReviewEndpointEnabled(): boolean {
  return !!process.env.DATABRICKS_REVIEW_ENDPOINT;
}

/**
 * Whether review is enabled for a given surface.
 * Surfaces can be disabled via DATABRICKS_REVIEW_DISABLED_SURFACES (comma-separated).
 */
export function isReviewEnabled(surface?: string): boolean {
  if (!isReviewEndpointEnabled()) return false;
  const disabled = process.env.DATABRICKS_REVIEW_DISABLED_SURFACES ?? "";
  if (surface && disabled.split(",").includes(surface)) return false;
  return true;
}

/**
 * Returns the embedding Model Serving endpoint name.
 *
 * Used by the embedding client (lib/embeddings/client.ts) to generate
 * vector embeddings for semantic search across estate and pipeline data.
 *
 * Reads `DATABRICKS_EMBEDDING_ENDPOINT` (set via the
 * `serving-endpoint-embedding` app resource binding, or `.env.local`
 * for local dev).  Throws if called when the resource is not bound —
 * callers must check `isEmbeddingEnabled()` first.
 */
export function getEmbeddingEndpoint(): string {
  const ep = process.env.DATABRICKS_EMBEDDING_ENDPOINT;
  if (!ep)
    throw new Error(
      "Embedding endpoint not configured (serving-endpoint-embedding resource not bound)",
    );
  return ep;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Try to read the user's access token from the Databricks Apps proxy header.
 *
 * When user authorization is enabled, the proxy injects the logged-in user's
 * OAuth token in `x-forwarded-access-token`.  This only works inside a
 * Next.js request context (API routes / server components); outside of that
 * (e.g. pipeline background work) it returns null.
 */
async function getUserToken(): Promise<string | null> {
  try {
    const hdrs = await nextHeaders();
    const token = hdrs.get("x-forwarded-access-token");
    return token || null;
  } catch {
    // headers() throws when called outside a request context
    return null;
  }
}

/**
 * Obtain a Bearer token.
 *
 * Priority order:
 *   1. Deferred OBO authorization – token retained in async auth context.
 *   2. User authorization – `x-forwarded-access-token` header from the
 *      Databricks Apps proxy (runs queries as the logged-in user).
 *   3. PAT – `DATABRICKS_TOKEN` env var (explicit override for local dev).
 *   4. CLI OAuth U2M – `databricks auth token` from the CLI's OAuth
 *      session. No credentials on disk; developer runs
 *      `databricks auth login` once and tokens auto-refresh.
 *   5. OAuth M2M – `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`
 *      (service principal, for background tasks or when user auth is off).
 */
export async function getBearerToken(): Promise<string> {
  // 1. Deferred user authorization. Presence of this context means the work
  // must not silently elevate to app credentials when its OBO token is absent.
  const authContext = getDatabricksAuthContext();
  if (authContext) {
    if (authContext.oboToken) return authContext.oboToken;
    throw new Error("Databricks OBO token is required for deferred user-scoped work");
  }

  // 2. User authorization (on-behalf-of-user, Databricks Apps)
  const userToken = await getUserToken();
  if (userToken) return userToken;

  // 3. PAT token (explicit override)
  const pat = process.env.DATABRICKS_TOKEN ?? process.env.DATABRICKS_API_TOKEN;
  if (pat) return pat;

  // 4. Databricks CLI OAuth U2M (local dev — no credentials on disk)
  const cliHost = process.env.DATABRICKS_HOST;
  if (cliHost) {
    const cliToken = getCliToken(normaliseHost(cliHost));
    if (cliToken) return cliToken;
  }

  // 5. OAuth M2M (Databricks Apps — service principal fallback)
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const profile = process.env.DATABRICKS_CLI_PROFILE;
    const loginCmd = profile
      ? `databricks auth login --profile ${profile}`
      : `databricks auth login --host ${process.env.DATABRICKS_HOST ?? "<workspace-url>"}`;
    throw new Error(
      "No authentication credentials found. " +
        `For local dev, run: ${loginCmd}\n` +
        "If the CLI is installed but not on PATH, add it or set DATABRICKS_TOKEN in .env.local.",
    );
  }

  // Return cached token if still valid (with 60 s buffer)
  if (_oauthToken && Date.now() < _oauthToken.expiresAt - 60_000) {
    return _oauthToken.accessToken;
  }

  const { host } = getConfig();
  const tokenUrl = `${host}/oidc/v1/token`;

  const resp = await fetchWithTimeout(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "all-apis",
      }),
    },
    TIMEOUTS.AUTH,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth token exchange failed (${resp.status}): ${text}`);
  }

  const data: { access_token: string; expires_in: number } = await resp.json();

  _oauthToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1_000,
  };

  return _oauthToken.accessToken;
}

/**
 * Get the current user's email.
 *
 * Resolution order:
 *   1. Databricks Apps proxy headers (`x-forwarded-email` /
 *      `x-forwarded-preferred-username`) -- set when deployed.
 *   2. `FORGE_LOCAL_USER_EMAIL` env var -- set by `.deploy_local.sh`
 *      for local development where proxy headers are absent.
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const hdrs = await nextHeaders();
    const email = hdrs.get("x-forwarded-email") ?? hdrs.get("x-forwarded-preferred-username");
    if (email) return email;
  } catch {
    // Outside request context or headers unavailable
  }
  return process.env.FORGE_LOCAL_USER_EMAIL ?? null;
}

/**
 * Returns headers using user authorization when available.
 *
 * Use for APIs where user-scoped OAuth scopes exist (e.g. `sql`,
 * `catalog.*`). Falls back to SP / PAT when outside a request context.
 */
export async function getHeaders(): Promise<Record<string, string>> {
  const token = await getBearerToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Returns headers using app authorization (service principal) only.
 *
 * Use for APIs where the action is performed by the app, not the user
 * (e.g. Model Serving LLM calls, Genie Space management).
 */
export async function getAppHeaders(): Promise<Record<string, string>> {
  const token = await getAppBearerToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Obtain a Bearer token using only app-level credentials (PAT, CLI, or SP).
 * Deliberately skips the user's forwarded token.
 */
async function getAppBearerToken(): Promise<string> {
  // 1. PAT token (explicit override)
  const pat = process.env.DATABRICKS_TOKEN ?? process.env.DATABRICKS_API_TOKEN;
  if (pat) return pat;

  // 2. Databricks CLI OAuth U2M (local dev — no credentials on disk)
  const cliHost = process.env.DATABRICKS_HOST;
  if (cliHost) {
    const cliToken = getCliToken(normaliseHost(cliHost));
    if (cliToken) return cliToken;
  }

  // 3. OAuth M2M (Databricks Apps — service principal)
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const profile = process.env.DATABRICKS_CLI_PROFILE;
    const loginCmd = profile
      ? `databricks auth login --profile ${profile}`
      : `databricks auth login --host ${process.env.DATABRICKS_HOST ?? "<workspace-url>"}`;
    throw new Error(
      "No app-level credentials found. " +
        `For local dev, run: ${loginCmd}\n` +
        "If the CLI is installed but not on PATH, add it or set DATABRICKS_TOKEN in .env.local.",
    );
  }

  // Reuse cached SP token if still valid
  if (_oauthToken && Date.now() < _oauthToken.expiresAt - 60_000) {
    return _oauthToken.accessToken;
  }

  const { host } = getConfig();
  const tokenUrl = `${host}/oidc/v1/token`;

  const resp = await fetchWithTimeout(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "all-apis",
      }),
    },
    TIMEOUTS.AUTH,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth token exchange failed (${resp.status}): ${text}`);
  }

  const data: { access_token: string; expires_in: number } = await resp.json();

  _oauthToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1_000,
  };

  return _oauthToken.accessToken;
}
