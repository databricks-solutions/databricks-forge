/**
 * In-memory Entra ID token cache for Fabric / Power BI connections.
 *
 * Uses the client_credentials OAuth2 flow (no refresh tokens).
 * Tokens are cached per connectionId and automatically re-acquired
 * when they expire or are explicitly invalidated (e.g. after a 401).
 */

import { logger } from "@/lib/logger";
import { getConnectionSecret } from "@/lib/lakebase/connections";

const ENTRA_TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const PBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

/**
 * Returns a valid bearer token for the given connection, using the cache
 * when possible. Automatically re-acquires if the cached token has <5 min
 * remaining or has been invalidated.
 */
export async function getToken(connectionId: string): Promise<string> {
  const cached = cache.get(connectionId);
  if (cached && cached.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return cached.accessToken;
  }

  const secret = await getConnectionSecret(connectionId);
  if (!secret) throw new Error("Could not decrypt connection credentials");

  const { accessToken, expiresIn } = await acquireTokenRaw(
    secret.tenantId,
    secret.clientId,
    secret.clientSecret,
  );

  const entry: CachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  cache.set(connectionId, entry);

  logger.info("[token-manager] Token acquired", {
    connectionId,
    expiresInSec: expiresIn,
  });

  return accessToken;
}

/**
 * Invalidates the cached token for a connection, forcing re-acquisition
 * on the next `getToken()` call. Call this after receiving a 401.
 */
export function invalidateToken(connectionId: string): void {
  cache.delete(connectionId);
}

/**
 * Low-level Entra ID token request. Parses both `access_token` and
 * `expires_in` from the response (the old `acquireToken` only kept
 * the access_token).
 */
async function acquireTokenRaw(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: PBI_SCOPE,
  });

  const res = await fetch(ENTRA_TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error("[token-manager] Token acquisition failed", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(`Entra ID token acquisition failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  };
}
