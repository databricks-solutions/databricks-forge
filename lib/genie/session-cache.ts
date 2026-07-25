/**
 * Two-tier session cache for conversational/long-running Genie flows.
 *
 *   L1: in-memory `Map<sessionKey, { value, expiresAt }>`
 *   L2: Lakebase (`ForgeAgentSession`)
 *
 * Use this when an agent flow needs to resume work across a request
 * boundary -- e.g. SSE streams that produce `needs_continuation` envelopes
 * and pick up where they left off on the next call.
 *
 * Default TTL: 30 minutes. Pass `ttlMs` to override per call.
 *
 * Mirrors upstream Fix Agent / Create Agent session caches. Today only
 * stub'd consumers exist (this module is wired but not yet driving the
 * Genie conversational flows); the API is shaped so future call sites can
 * adopt it without a refactor.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// L1
// ---------------------------------------------------------------------------

interface CacheEntry<T = unknown> {
  value: T;
  expiresAtMs: number;
  ownerEmail?: string | null;
}

const _l1 = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function isExpired(entry: CacheEntry): boolean {
  return Date.now() >= entry.expiresAtMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SessionGetOptions {
  /** When true, do NOT consult L2 even on L1 miss. Defaults to false. */
  l1Only?: boolean;
}

export interface SessionPutOptions {
  ttlMs?: number;
  ownerEmail?: string | null;
  /** When false, only writes L1 (skips Lakebase persistence). */
  persist?: boolean;
}

export async function getSession<T = unknown>(
  sessionKey: string,
  options?: SessionGetOptions,
): Promise<T | null> {
  const hit = _l1.get(sessionKey);
  if (hit) {
    if (!isExpired(hit)) return hit.value as T;
    _l1.delete(sessionKey);
  }
  if (options?.l1Only) return null;

  try {
    const row = await withPrisma(async (prisma) =>
      prisma.forgeAgentSession.findUnique({
        where: { sessionKey },
        select: { payload: true, expiresAt: true, ownerEmail: true },
      }),
    );
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.payload);
    } catch (err) {
      logger.warn("[session-cache] L2 payload was not valid JSON", {
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    _l1.set(sessionKey, {
      value: parsed,
      expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : Date.now() + DEFAULT_TTL_MS,
      ownerEmail: row.ownerEmail,
    });
    return parsed as T;
  } catch (err) {
    logger.warn("[session-cache] L2 read failed", {
      sessionKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function putSession<T = unknown>(
  sessionKey: string,
  value: T,
  options?: SessionPutOptions,
): Promise<void> {
  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAtMs = Date.now() + ttl;
  _l1.set(sessionKey, { value, expiresAtMs, ownerEmail: options?.ownerEmail });

  if (options?.persist === false) return;

  try {
    const payload = JSON.stringify(value);
    await withPrisma(async (prisma) => {
      await prisma.forgeAgentSession.upsert({
        where: { sessionKey },
        update: {
          payload,
          expiresAt: new Date(expiresAtMs),
          ownerEmail: options?.ownerEmail ?? null,
        },
        create: {
          sessionKey,
          payload,
          expiresAt: new Date(expiresAtMs),
          ownerEmail: options?.ownerEmail ?? null,
        },
      });
    });
  } catch (err) {
    logger.warn("[session-cache] L2 write failed (continuing with L1 only)", {
      sessionKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteSession(sessionKey: string): Promise<void> {
  _l1.delete(sessionKey);
  try {
    await withPrisma(async (prisma) => {
      await prisma.forgeAgentSession.deleteMany({ where: { sessionKey } });
    });
  } catch (err) {
    logger.warn("[session-cache] L2 delete failed (L1 was cleared)", {
      sessionKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Test helper -- clears the L1 layer entirely. */
export function clearL1(): void {
  _l1.clear();
}
