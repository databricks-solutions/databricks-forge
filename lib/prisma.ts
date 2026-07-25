/**
 * Prisma client singleton for Lakebase.
 *
 * Uses an **external pg.Pool** passed to @prisma/adapter-pg (v7). We manage
 * the pool ourselves so we can pre-warm multiple connections before handing
 * control to PrismaClient. This prevents the "dashboard fails on first load"
 * problem where PrismaPg's internal pool creates connections lazily and bursts
 * of concurrent queries hit Lakebase's connection rate limiter.
 *
 * Two modes (chosen automatically):
 *   1. **Resource-binding** (Databricks Apps) -- the `postgres` resource is
 *      bound in app.yaml; PGHOST/PGUSER/PGDATABASE/LAKEBASE_ENDPOINT are
 *      injected by the platform. We mint short-lived OAuth Postgres tokens
 *      via lib/lakebase/provision.ts and rotate them automatically.
 *   2. **Static URL** (local dev) -- DATABASE_URL is set and SP credentials
 *      are not available. Uses the URL directly without rotation.
 *
 * The standard Next.js pattern caches the client on `globalThis` to survive
 * HMR reloads in development.
 */

import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import {
  canAutoProvision,
  getRuntimeEndpointInfo,
  getCredentialGeneration,
  getCredentialExpiresAt,
  getLakebaseConnectionUrl,
  refreshDbCredential,
  invalidateDbCredential,
} from "@/lib/lakebase/provision";
import {
  isAuthError,
  isCredentialPropagationError,
  isRateLimitError,
} from "@/lib/lakebase/auth-errors";
import { createScopedLogger } from "@/lib/logger";

const log = createScopedLogger({ origin: "Lakebase", module: "prisma" });

// ---------------------------------------------------------------------------
// Connection string logging helper
// ---------------------------------------------------------------------------

function logConnectionInfo(connectionString: string): void {
  const parsed = new URL(connectionString);
  log.info("Connecting", {
    host: parsed.hostname,
    database: parsed.pathname.slice(1),
    user: decodeURIComponent(parsed.username),
    passwordLength: decodeURIComponent(parsed.password).length,
  });
}

type AuthErrorClass = "sasl_auth" | "password_auth" | "rate_limit" | "network" | "unknown";

function classifyDbError(err: unknown): AuthErrorClass {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("sasl")) return "sasl_auth";
  if (msg.includes("password authentication failed")) return "password_auth";
  if (isRateLimitError(err)) return "rate_limit";
  if (
    msg.includes("timeout") ||
    msg.includes("connect") ||
    msg.includes("econn") ||
    msg.includes("enotfound")
  ) {
    return "network";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Singleton cache
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  __prisma: PrismaClient | undefined;
  __pool: pg.Pool | undefined;
  __prismaTokenId: string | undefined;
  __refreshTimer: ReturnType<typeof setTimeout> | undefined;
  __rotationInFlight: Promise<PrismaClient> | null | undefined;
  __initInFlight: Promise<PrismaClient> | null | undefined;
  __staticInitInFlight: Promise<PrismaClient> | null | undefined;
  __dbReady: boolean | undefined;
  __rotationResolvedAt: number | undefined;
  __lastRotationAttemptAt: number | undefined;
};

globalForPrisma.__rotationInFlight ??= null;
globalForPrisma.__initInFlight ??= null;
globalForPrisma.__staticInitInFlight ??= null;
globalForPrisma.__dbReady ??= false;
globalForPrisma.__rotationResolvedAt ??= 0;
globalForPrisma.__lastRotationAttemptAt ??= 0;

// ---------------------------------------------------------------------------
// Pool configuration
// ---------------------------------------------------------------------------

const POOL_OPTIONS: pg.PoolConfig = {
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  max: 10,
};

const POOL_WARM_TARGET = 2;

// ---------------------------------------------------------------------------
// Pool creation + pre-warming
// ---------------------------------------------------------------------------

/**
 * Create a pg.Pool, verify the first connection (with optional retries for
 * credential propagation), then pre-warm additional connections so the pool
 * is ready for concurrent query bursts.
 */
async function createAndWarmPool(
  connectionString: string,
  verifyRetries = 0,
  retryDelayMs = 3_000,
  initialDelayMs = 0,
): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString, ...POOL_OPTIONS });

  pool.on("error", (err) => {
    log.warn("Idle pool connection error", {
      error: err.message,
      errorCategory: "pool_error",
    });
  });

  if (initialDelayMs > 0) {
    log.info("Waiting before first pool verification", {
      initialDelayMs,
    });
    await new Promise((r) => setTimeout(r, initialDelayMs));
  }

  let lastError: unknown;
  for (let i = 0; i <= verifyRetries; i++) {
    if (i > 0) {
      log.warn("Pool connection not ready, retrying", {
        attempt: i,
        maxAttempts: verifyRetries + 1,
        nextDelayMs: retryDelayMs,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        errorCategory: "connection_retry",
      });
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
    try {
      const conn = await pool.connect();
      conn.release();
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    await pool.end().catch(() => {});
    throw lastError;
  }

  // Pre-warm additional connections concurrently (best-effort).
  if (POOL_WARM_TARGET > 1) {
    const results = await Promise.allSettled(
      Array.from({ length: POOL_WARM_TARGET - 1 }, () =>
        pool.connect().then((c) => {
          c.release();
        }),
      ),
    );
    const warmed = results.filter((r) => r.status === "fulfilled").length + 1;
    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      const firstReason = rejected[0];
      const message =
        firstReason.status === "rejected"
          ? firstReason.reason instanceof Error
            ? firstReason.reason.message
            : String(firstReason.reason)
          : "";
      log.warn("Pool warm-up partially failed", {
        warmed,
        target: POOL_WARM_TARGET,
        rejected: rejected.length,
        rateLimited: isRateLimitError(message),
        error: message,
        errorCategory: "pool_warmup",
      });
    }
    log.info("Pool connections warmed", {
      warmed,
      target: POOL_WARM_TARGET,
    });
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getPrisma(): Promise<PrismaClient> {
  if (canAutoProvision()) {
    return getAutoProvisionedPrisma();
  }
  return getStaticPrisma();
}

export function isDatabaseReady(): boolean {
  return globalForPrisma.__dbReady ?? false;
}

export function getDatabaseAuthRuntimeState(): {
  ready: boolean;
  authMode: "oauth";
} {
  return {
    ready: isDatabaseReady(),
    authMode: "oauth",
  };
}

export async function invalidatePrismaClient(): Promise<void> {
  const oldClient = globalForPrisma.__prisma;
  const oldPool = globalForPrisma.__pool;

  invalidateDbCredential();
  globalForPrisma.__prisma = undefined;
  globalForPrisma.__prismaTokenId = undefined;
  globalForPrisma.__pool = undefined;

  if (oldClient) {
    try {
      await oldClient.$disconnect();
    } catch {
      // best-effort disconnect
    }
  }
  if (oldPool) {
    try {
      await oldPool.end();
    } catch {
      // best-effort pool cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Resource-binding mode (Databricks Apps, OAuth-only)
// ---------------------------------------------------------------------------

async function getAutoProvisionedPrisma(): Promise<PrismaClient> {
  await refreshDbCredential();
  const generation = getCredentialGeneration();
  const tokenId = `oauth_${generation}`;

  if (globalForPrisma.__prisma && globalForPrisma.__prismaTokenId === tokenId) {
    return globalForPrisma.__prisma;
  }

  if (globalForPrisma.__initInFlight) return globalForPrisma.__initInFlight;

  globalForPrisma.__initInFlight = buildAutoProvisionedClient(tokenId, generation).finally(() => {
    globalForPrisma.__initInFlight = null;
  });

  return globalForPrisma.__initInFlight;
}

async function buildAutoProvisionedClient(
  tokenId: string,
  generation: number,
): Promise<PrismaClient> {
  if (globalForPrisma.__prisma) {
    try {
      await globalForPrisma.__prisma.$disconnect();
    } catch (err) {
      log.warn("Failed to disconnect old client during rotation", {
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "rotation_error",
      });
    }
  }
  if (globalForPrisma.__pool) {
    await globalForPrisma.__pool.end().catch(() => {});
    globalForPrisma.__pool = undefined;
  }

  const endpointInfo = await getRuntimeEndpointInfo();
  log.info("Runtime endpoint resolved", {
    endpointName: endpointInfo.endpointName,
    host: endpointInfo.host,
  });

  // Pooler credential propagation can lag on cold starts. Retry with
  // regenerated credentials rather than reusing a single potentially stale
  // token.
  const MAX_CREDENTIAL_GENERATIONS = 3;
  let pool: pg.Pool | null = null;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_CREDENTIAL_GENERATIONS; attempt++) {
    if (attempt > 1) {
      invalidateDbCredential();
      await refreshDbCredential();
    }

    const connectionString = await getLakebaseConnectionUrl();
    const tokenGeneration = getCredentialGeneration();
    const tokenExpiresAt = getCredentialExpiresAt();
    logConnectionInfo(connectionString);

    try {
      // ~65s max per attempt (5s initial + 20 * 3s retries)
      pool = await createAndWarmPool(connectionString, 20, 3_000, 5_000);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Auto-provision pool bootstrap failed", {
        attempt,
        maxAttempts: MAX_CREDENTIAL_GENERATIONS,
        host: endpointInfo.host,
        tokenGeneration,
        tokenExpiresInSec: tokenExpiresAt
          ? Math.max(Math.round((tokenExpiresAt - Date.now()) / 1000), 0)
          : null,
        errorClass: classifyDbError(err),
        authError: isAuthError(err),
        rateLimited: isRateLimitError(err),
        propagationLikely: isCredentialPropagationError(err),
        error: msg,
        errorCategory: "bootstrap_failed",
      });
    }

    if (attempt < MAX_CREDENTIAL_GENERATIONS) {
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }

  if (!pool || lastError) {
    throw lastError ?? new Error("Failed to initialize pool");
  }

  globalForPrisma.__pool = pool;

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  globalForPrisma.__prisma = prisma;
  globalForPrisma.__prismaTokenId = tokenId;
  globalForPrisma.__dbReady = true;

  log.info("Client created (resource-binding OAuth mode)", {
    generation,
    tokenId,
    host: endpointInfo.host,
  });

  scheduleProactiveRefresh();
  return prisma;
}

// ---------------------------------------------------------------------------
// Proactive background credential refresh
// ---------------------------------------------------------------------------

const PROACTIVE_REFRESH_LEAD_MS = 5 * 60_000;

function scheduleProactiveRefresh(): void {
  if (globalForPrisma.__refreshTimer) {
    clearTimeout(globalForPrisma.__refreshTimer);
    globalForPrisma.__refreshTimer = undefined;
  }

  const expiresAt = getCredentialExpiresAt();
  if (!expiresAt) return;

  const delay = Math.max(expiresAt - PROACTIVE_REFRESH_LEAD_MS - Date.now(), 0);

  globalForPrisma.__refreshTimer = setTimeout(async () => {
    globalForPrisma.__refreshTimer = undefined;

    if (globalForPrisma.__rotationInFlight) {
      log.info("Proactive refresh skipped — rotation already in flight");
      return;
    }

    try {
      log.info("Proactive credential rotation starting", {
        msBeforeExpiry: expiresAt - Date.now(),
      });
      await invalidatePrismaClient();
      await getPrisma();
      log.info("Proactive credential rotation complete");
    } catch (err) {
      log.warn("Proactive credential rotation failed — will retry on next request", {
        error: err instanceof Error ? err.message : String(err),
        errorCategory: "rotation_error",
      });
    }
  }, delay);

  log.info("Proactive refresh scheduled", {
    delaySec: Math.round(delay / 1_000),
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Static URL mode (local dev)
// ---------------------------------------------------------------------------

async function getStaticPrisma(): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set and Lakebase resource binding is not available. " +
        "Set DATABASE_URL in .env for local dev, or deploy as a Databricks App " +
        "with the `postgres` resource bound.",
    );
  }

  if (globalForPrisma.__prisma && globalForPrisma.__prismaTokenId === "__static__") {
    return globalForPrisma.__prisma;
  }

  if (globalForPrisma.__staticInitInFlight) {
    return globalForPrisma.__staticInitInFlight;
  }

  globalForPrisma.__staticInitInFlight = (async () => {
    if (globalForPrisma.__prisma) {
      await globalForPrisma.__prisma.$disconnect();
    }
    if (globalForPrisma.__pool) {
      await globalForPrisma.__pool.end().catch(() => {});
    }

    logConnectionInfo(url);

    const pool = await createAndWarmPool(url);
    globalForPrisma.__pool = pool;

    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    globalForPrisma.__prisma = prisma;
    globalForPrisma.__prismaTokenId = "__static__";
    globalForPrisma.__dbReady = true;

    log.info("Client created (static mode)");

    return prisma;
  })().finally(() => {
    globalForPrisma.__staticInitInFlight = null;
  });

  return globalForPrisma.__staticInitInFlight;
}

// ---------------------------------------------------------------------------
// Resilient wrapper with auth-error retry
// ---------------------------------------------------------------------------

const MAX_AUTH_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

/**
 * Execute a callback with a PrismaClient. If the call fails with a database
 * authentication error (stale credential), the client and credential are
 * invalidated and the call is retried.
 *
 * Strategy on auth error:
 *   1. **Quick retry** — Wait briefly and retry. Lakebase credential
 *      propagation is eventually consistent across backends; a short delay
 *      often resolves transient auth failures without the cost of a full
 *      credential rotation.
 *   2. **Rotate** — If the quick retry also fails, invalidate the client and
 *      mint a new credential.
 *   3. **Final retry** — One last attempt after rotation.
 *
 * Concurrent callers that all hit an auth error at the same time share a
 * single rotation promise — `rotatePrismaClient` verifies the connection
 * before returning and enforces a cooldown to prevent callers from
 * disconnecting each other's working pools.
 */
export async function withPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_AUTH_RETRIES; attempt++) {
    const prisma = await getPrisma();
    try {
      return await fn(prisma);
    } catch (err) {
      lastErr = err;
      if (isRateLimitError(err) && attempt < MAX_AUTH_RETRIES) {
        const backoffMs = RETRY_DELAY_MS * (attempt + 1);
        log.warn("Connection rate-limited, retrying", {
          attempt: attempt + 1,
          maxRetries: MAX_AUTH_RETRIES,
          backoffMs,
          errorClass: classifyDbError(err),
          error: err instanceof Error ? err.message : String(err),
          errorCategory: "rate_limit",
        });
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      if (!isAuthError(err)) throw err;
      if (!canAutoProvision()) throw err;

      if (attempt < MAX_AUTH_RETRIES) {
        const propagationLikely = isCredentialPropagationError(err);
        const strategy = propagationLikely && attempt === 0 ? "delay" : "rotate";
        log.warn("Auth error, retrying", {
          attempt: attempt + 1,
          maxRetries: MAX_AUTH_RETRIES,
          strategy,
          propagationLikely,
          errorClass: classifyDbError(err),
          error: err instanceof Error ? err.message : String(err),
          errorCategory: "auth_error",
        });

        if (strategy === "delay") {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          await rotatePrismaClient("auth_error");
        }
      }
    }
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// Race-safe credential rotation with verification + cooldown
// ---------------------------------------------------------------------------

const ROTATION_COOLDOWN_MS = 30_000;

async function rotatePrismaClient(reason: string): Promise<PrismaClient> {
  const now = Date.now();
  if (
    globalForPrisma.__prisma &&
    now - (globalForPrisma.__rotationResolvedAt ?? 0) < ROTATION_COOLDOWN_MS
  ) {
    return globalForPrisma.__prisma;
  }
  if (now - (globalForPrisma.__lastRotationAttemptAt ?? 0) < ROTATION_COOLDOWN_MS) {
    if (globalForPrisma.__prisma) return globalForPrisma.__prisma;
    log.warn("Rotation skipped — cooldown active after recent failed attempt", {
      msSinceLastAttempt: now - (globalForPrisma.__lastRotationAttemptAt ?? 0),
      errorCategory: "cooldown",
    });
    throw new Error("Credential rotation on cooldown after recent failure");
  }

  if (globalForPrisma.__rotationInFlight) return globalForPrisma.__rotationInFlight;

  globalForPrisma.__rotationInFlight = (async () => {
    globalForPrisma.__lastRotationAttemptAt = Date.now();

    try {
      await invalidatePrismaClient();
      log.info("Credential rotation starting", { reason });

      const client = await getPrisma();
      await client.forgeRun.count();

      globalForPrisma.__rotationResolvedAt = Date.now();
      log.info("Credential rotation complete — connection verified");
      return client;
    } catch (err) {
      globalForPrisma.__prisma = undefined;
      globalForPrisma.__prismaTokenId = undefined;
      throw err;
    } finally {
      globalForPrisma.__rotationInFlight = null;
    }
  })();

  return globalForPrisma.__rotationInFlight;
}
