/**
 * Lakebase OAuth credential broker (Databricks Apps `postgres` resource).
 *
 * Forge consumes Lakebase as a first-class app resource. When the `postgres`
 * resource is bound in `app.yaml`, the Apps platform injects:
 *
 *     PGHOST            -- hostname (pooler by default)
 *     PGPORT            -- 5432
 *     PGDATABASE        -- database name
 *     PGUSER            -- service-principal role on the DB
 *     PGSSLMODE         -- "require"
 *     LAKEBASE_ENDPOINT -- endpoint resource path
 *                          (projects/<id>/branches/<id>/endpoints/<id>)
 *
 * This module's sole job is to mint short-lived OAuth Postgres credentials
 * against `LAKEBASE_ENDPOINT` (the password rotates every ~hour) and assemble
 * the connection URL using the platform-injected host/user/database.
 *
 * Everything else that used to live here -- project creation, endpoint listing,
 * SCIM /Me username resolution, pooler-host derivation, scale-to-zero
 * enforcement -- is now platform-managed and has been removed.
 *
 * Local dev path: when `DATABASE_URL` is set (e.g. via `.deploy_local.sh`),
 * `lib/prisma.ts` uses the static URL directly and skips this module.
 */

import { createScopedLogger } from "@/lib/logger";
import { fetchWithTimeout, TIMEOUTS } from "@/lib/dbx/fetch-with-timeout";

const log = createScopedLogger({ origin: "Lakebase", module: "lakebase/provision" });

// ---------------------------------------------------------------------------
// Shared mutable state on globalThis
// ---------------------------------------------------------------------------
// Next.js App Router bundles RSC and API routes separately. Module-scoped
// `let` variables exist independently in each bundle, but they share a
// single `globalThis`. Cached tokens and credential generation counters live
// here so they're consistent across bundles.

interface CachedToken {
  value: string;
  expiresAt: number;
}

const globalForProvision = globalThis as unknown as {
  __provisionInflightMap: Map<string, Promise<unknown>> | undefined;
  __wsToken: CachedToken | null | undefined;
  __dbCredential: CachedToken | null | undefined;
  __credentialGeneration: number | undefined;
};

if (!globalForProvision.__provisionInflightMap) {
  globalForProvision.__provisionInflightMap = new Map();
}
globalForProvision.__wsToken ??= null;
globalForProvision.__dbCredential ??= null;
globalForProvision.__credentialGeneration ??= 0;

function dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = globalForProvision.__provisionInflightMap!;
  const existing = map.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn().finally(() => {
    map.delete(key);
  });

  map.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAKEBASE_API_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Resource-binding accessors
// ---------------------------------------------------------------------------

interface LakebaseResourceBinding {
  host: string;
  port: string;
  database: string;
  username: string;
  sslMode: string;
  endpointName: string;
}

function readResourceBinding(): LakebaseResourceBinding | null {
  const host = process.env.PGHOST;
  const username = process.env.PGUSER;
  const endpointName = process.env.LAKEBASE_ENDPOINT;
  if (!host || !username || !endpointName) return null;
  return {
    host,
    port: process.env.PGPORT || "5432",
    database: process.env.PGDATABASE || "databricks_postgres",
    username,
    sslMode: process.env.PGSSLMODE || "require",
    endpointName,
  };
}

function requireResourceBinding(): LakebaseResourceBinding {
  const binding = readResourceBinding();
  if (!binding) {
    throw new Error(
      "Lakebase resource binding not found. The `postgres` resource must be " +
        "bound in app.yaml so the Databricks Apps platform injects PGHOST, " +
        "PGUSER, PGDATABASE, and LAKEBASE_ENDPOINT. Run deploy.sh to (re)bind.",
    );
  }
  return binding;
}

// ---------------------------------------------------------------------------
// Host helper
// ---------------------------------------------------------------------------

function getHost(): string {
  let host = process.env.DATABRICKS_HOST ?? "";
  if (host && !host.startsWith("https://")) host = `https://${host}`;
  host = host.replace(/\/+$/, "");
  if (!host) throw new Error("DATABRICKS_HOST is not set");
  return host;
}

// ---------------------------------------------------------------------------
// Workspace OAuth token (for REST API calls only, NOT for Postgres)
// ---------------------------------------------------------------------------

async function getWorkspaceToken(): Promise<string> {
  const cached = globalForProvision.__wsToken;
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value;
  }

  return dedup("wsToken", async () => {
    const clientId = process.env.DATABRICKS_CLIENT_ID;
    const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET not available");
    }

    const host = getHost();
    const resp = await fetchWithTimeout(
      `${host}/oidc/v1/token`,
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
      throw new Error(`Workspace OAuth failed (${resp.status}): ${text}`);
    }

    const data: { access_token: string; expires_in: number } = await resp.json();
    globalForProvision.__wsToken = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1_000,
    };

    log.info("Workspace token acquired", {
      expiresInSec: data.expires_in,
    });

    return globalForProvision.__wsToken!.value;
  });
}

// ---------------------------------------------------------------------------
// DB credential minting (Postgres password token, ~1-hour TTL)
// ---------------------------------------------------------------------------

async function generateDbCredential(): Promise<string> {
  const cached = globalForProvision.__dbCredential;
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value;
  }

  return dedup("dbCredential", async () => {
    const rechecked = globalForProvision.__dbCredential;
    if (rechecked && Date.now() < rechecked.expiresAt - 60_000) {
      return rechecked.value;
    }

    const { endpointName } = requireResourceBinding();
    const host = getHost();
    const token = await getWorkspaceToken();

    const resp = await fetchWithTimeout(
      `${host}/api/2.0/postgres/credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint: endpointName }),
      },
      LAKEBASE_API_TIMEOUT,
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Generate DB credential failed (${resp.status}): ${text}`);
    }

    const data: { token?: string; expire_time?: string } = await resp.json();
    if (!data.token) {
      throw new Error("Generate DB credential returned no token");
    }

    const expiresAt = data.expire_time
      ? new Date(data.expire_time).getTime()
      : Date.now() + 3_600_000;

    globalForProvision.__dbCredential = {
      value: data.token,
      expiresAt,
    };
    globalForProvision.__credentialGeneration =
      (globalForProvision.__credentialGeneration ?? 0) + 1;

    log.info("DB credential generated", {
      generation: globalForProvision.__credentialGeneration,
      tokenLength: data.token.length,
      tokenExpiresInSec: Math.max(Math.round((expiresAt - Date.now()) / 1_000), 0),
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return globalForProvision.__dbCredential!.value;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * True when the `postgres` app resource is bound (Databricks Apps runtime).
 */
export function isAutoProvisionEnabled(): boolean {
  return !!(
    readResourceBinding() &&
    process.env.DATABRICKS_CLIENT_ID &&
    process.env.DATABRICKS_CLIENT_SECRET &&
    process.env.DATABRICKS_HOST &&
    !process.env.DATABASE_URL
  );
}

/**
 * True when SP credentials are available AND the `postgres` resource is bound.
 * Used by `withPrisma` to decide whether auth-error retry can fall back to
 * minting a fresh OAuth credential.
 */
export function canAutoProvision(): boolean {
  return !!(
    readResourceBinding() &&
    process.env.DATABRICKS_CLIENT_ID &&
    process.env.DATABRICKS_CLIENT_SECRET &&
    process.env.DATABRICKS_HOST
  );
}

/**
 * No-op in resource-binding mode -- the platform owns project + endpoint
 * lifecycle (including scale-to-zero). Kept as an export for backward
 * compatibility with the startup script.
 */
export async function ensureLakebaseProject(): Promise<void> {
  if (!readResourceBinding()) {
    log.warn(
      "ensureLakebaseProject called without `postgres` resource binding -- " +
        "platform now manages Lakebase lifecycle; nothing to do",
    );
    return;
  }
  log.info("Lakebase project lifecycle is platform-managed via app resource binding");
}

/**
 * Build a complete Postgres connection URL with a fresh OAuth credential.
 * Safe to call repeatedly -- returns the same URL until the token nears
 * expiry, then transparently mints a new one.
 */
export async function getLakebaseConnectionUrl(): Promise<string> {
  const binding = requireResourceBinding();
  const token = await generateDbCredential();

  log.info("Building runtime connection URL", {
    host: binding.host,
  });

  return (
    `postgresql://${encodeURIComponent(binding.username)}:${encodeURIComponent(token)}` +
    `@${binding.host}:${binding.port}/${binding.database}` +
    `?sslmode=${encodeURIComponent(binding.sslMode)}&uselibpqcompat=true`
  );
}

/**
 * Single canonical connection URL plus token metadata. In resource-binding
 * mode there is exactly one host (the platform decides whether it's pooler
 * or direct); the legacy dual-URL contract was retired with the self-
 * provisioning code path.
 */
export async function getLakebaseConnectionUrls(): Promise<{
  url: string;
  tokenGeneration: number;
  tokenExpiresAt: number | null;
}> {
  const url = await getLakebaseConnectionUrl();
  return {
    url,
    tokenGeneration: getCredentialGeneration(),
    tokenExpiresAt: getCredentialExpiresAt(),
  };
}

/**
 * Hostname + endpoint metadata for diagnostic logging. Reads directly from
 * the platform-injected env vars.
 */
export async function getRuntimeEndpointInfo(): Promise<{
  endpointName: string;
  host: string;
}> {
  const binding = requireResourceBinding();
  return {
    endpointName: binding.endpointName,
    host: binding.host,
  };
}

/**
 * Get a fresh DB credential token (for pool rotation). Returns the cached
 * token if still valid.
 */
export async function refreshDbCredential(): Promise<string> {
  return generateDbCredential();
}

/**
 * Force-invalidate the cached DB credential so the next `refreshDbCredential()`
 * call mints a new one. Use this when an authentication error is caught to
 * guarantee the stale credential is discarded.
 */
export function invalidateDbCredential(): void {
  globalForProvision.__dbCredential = null;
}

/**
 * Monotonically increasing counter that bumps every time a new DB credential
 * is minted. Used by `lib/prisma.ts` to detect token rotation and recreate
 * the connection pool.
 */
export function getCredentialGeneration(): number {
  return globalForProvision.__credentialGeneration ?? 0;
}

/**
 * Epoch-ms expiry of the current DB credential, or null if no credential has
 * been minted yet. Used by `lib/prisma.ts` to schedule proactive rotation.
 */
export function getCredentialExpiresAt(): number | null {
  return globalForProvision.__dbCredential?.expiresAt ?? null;
}
