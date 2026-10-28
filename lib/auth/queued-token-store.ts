/**
 * Ephemeral store for OBO tokens belonging to runs that were queued by
 * `checkQuota("pipeline", ..., "queue")`.
 *
 * Tokens are held in an in-process Map AND (when Lakebase is available)
 * AES-256-GCM encrypted into `ForgeMetadataCache` (`queued_obo:<runId>`) so a
 * multi-instance deployment that promotes the queued run on a different worker
 * still recovers the user's OBO token. Entries expire after MAX_TTL_MS (50
 * minutes, matching Databricks OBO token lifetime) and are deleted immediately
 * when claimed by `lib/pipeline/scheduler.ts`.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

interface QueuedTokenEntry {
  oboToken: string;
  expiresAt: number;
}

interface EncryptedTokenEnvelope {
  iv: string;
  tag: string;
  ciphertext: string;
  expiresAt: number;
}

const MAX_TTL_MS = 50 * 60 * 1000;
const CACHE_KEY_PREFIX = "queued_obo:";
const store = new Map<string, QueuedTokenEntry>();

function deriveEncryptionKey(): Buffer {
  const secret =
    process.env.FORGE_TOKEN_ENCRYPTION_KEY ||
    process.env.DATABRICKS_CLIENT_SECRET ||
    process.env.DATABASE_URL ||
    "forge-queued-obo-ephemeral-key";
  return createHash("sha256").update(secret).digest();
}

export function encryptQueuedOboEnvelope(oboToken: string, expiresAt: number): string {
  const key = deriveEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(oboToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedTokenEnvelope = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    expiresAt,
  };
  return JSON.stringify(envelope);
}

export function decryptQueuedOboEnvelope(raw: string): QueuedTokenEntry | null {
  try {
    const parsed = JSON.parse(raw) as EncryptedTokenEnvelope;
    if (!parsed.iv || !parsed.tag || !parsed.ciphertext || typeof parsed.expiresAt !== "number") {
      return null;
    }
    const key = deriveEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return { oboToken: plaintext, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function stashQueuedOboToken(runId: string, oboToken: string | null | undefined): void {
  if (!runId || !oboToken) return;
  const expiresAt = Date.now() + MAX_TTL_MS;
  store.set(runId, {
    oboToken,
    expiresAt,
  });
}

export async function persistQueuedOboToken(
  runId: string,
  oboToken: string | null | undefined,
): Promise<void> {
  if (!runId || !oboToken) return;
  const expiresAt = Date.now() + MAX_TTL_MS;
  store.set(runId, { oboToken, expiresAt });
  try {
    const { withPrisma } = await import("@/lib/prisma");
    const cacheKey = `${CACHE_KEY_PREFIX}${runId}`;
    const metadataJson = encryptQueuedOboEnvelope(oboToken, expiresAt);
    await withPrisma((prisma) =>
      prisma.forgeMetadataCache.upsert({
        where: { cacheKey },
        create: { cacheKey, metadataJson },
        update: { metadataJson, cachedAt: new Date() },
      }),
    );
  } catch {
    // Non-fatal fallback to in-memory Map in unit tests or offline dev
  }
}

export function consumeQueuedOboToken(runId: string): string | null {
  const entry = store.get(runId);
  if (!entry) return null;
  store.delete(runId);
  if (Date.now() >= entry.expiresAt) {
    return null;
  }
  return entry.oboToken;
}

export async function consumeQueuedOboTokenAsync(runId: string): Promise<string | null> {
  const localToken = consumeQueuedOboToken(runId);
  const cacheKey = `${CACHE_KEY_PREFIX}${runId}`;

  try {
    const { withPrisma } = await import("@/lib/prisma");
    const row = await withPrisma(async (prisma) => {
      const existing = await prisma.forgeMetadataCache.findUnique({
        where: { cacheKey },
        select: { metadataJson: true },
      });
      if (existing) {
        await prisma.forgeMetadataCache.deleteMany({ where: { cacheKey } });
      }
      return existing;
    });
    if (localToken) return localToken;
    if (row?.metadataJson) {
      const decrypted = decryptQueuedOboEnvelope(row.metadataJson);
      if (decrypted && Date.now() < decrypted.expiresAt) {
        return decrypted.oboToken;
      }
    }
  } catch {
    // Fall back to in-memory result when Prisma is unavailable
  }

  return localToken;
}

export function clearQueuedOboTokens(): void {
  store.clear();
}
