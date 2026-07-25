/**
 * Prompt Registry with in-code fallback.
 *
 * Strategy:
 *   - Every caller registers a deterministic in-code prompt template via
 *     `registerDefaultPrompt(key, version, template)`.
 *   - At runtime, `getPrompt(key)` first looks for an `active=true` row in
 *     Lakebase (`ForgePromptVersion`) and uses it if present. Otherwise it
 *     falls back to the in-code default. Nothing in Lakebase = nothing
 *     changes from today's behavior.
 *   - `setActiveVersion(key, version)` flips the active row (admin
 *     operation; logs to activity log).
 *   - A short LRU-ish in-memory cache (60s TTL) avoids round-tripping
 *     Lakebase on every call.
 *
 * The in-code defaults remain the source of truth: if the Lakebase template
 * is missing required `{{variables}}` after substitution, we log and fall
 * back to the default. This avoids the "edit in DB, break prod" footgun.
 *
 * Mirrors upstream `databricks-genie-workbench` Prompt Registry semantics
 * without pulling in the MLflow Prompts Python SDK.
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// In-code fallback registry
// ---------------------------------------------------------------------------

interface InCodeEntry {
  template: string;
  version: number;
  description?: string;
}

const _defaults = new Map<string, InCodeEntry>();

/**
 * Register an in-code prompt template. Call once at module load. Idempotent
 * for the same `(key, version)`; throws on a `(key, version)` collision
 * with a different template body.
 */
export function registerDefaultPrompt(
  key: string,
  version: number,
  template: string,
  description?: string,
): void {
  const existing = _defaults.get(key);
  if (existing) {
    if (existing.version === version && existing.template !== template) {
      throw new Error(
        `[prompt-registry] conflicting registration for "${key}" v${version}`,
      );
    }
    if (existing.version > version) return;
  }
  _defaults.set(key, { template, version, description });
}

/** Test helper -- clears all in-code defaults. */
export function clearAllDefaults(): void {
  _defaults.clear();
}

// ---------------------------------------------------------------------------
// Lakebase override layer (cached)
// ---------------------------------------------------------------------------

interface CachedActive {
  template: string;
  version: number;
  fetchedAtMs: number;
}

const CACHE_TTL_MS = 60_000;
const _activeCache = new Map<string, CachedActive>();

/** Test helper -- forces a re-fetch on the next `getPrompt` call. */
export function clearActiveCache(): void {
  _activeCache.clear();
}

async function fetchActive(key: string): Promise<CachedActive | null> {
  const cached = _activeCache.get(key);
  if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
    return cached;
  }
  try {
    const row = await withPrisma(async (prisma) =>
      prisma.forgePromptVersion.findFirst({
        where: { promptKey: key, active: true },
        orderBy: { version: "desc" },
        select: { template: true, version: true },
      }),
    );
    if (!row) {
      _activeCache.delete(key);
      return null;
    }
    const entry: CachedActive = {
      template: row.template,
      version: row.version,
      fetchedAtMs: Date.now(),
    };
    _activeCache.set(key, entry);
    return entry;
  } catch (err) {
    logger.warn("[prompt-registry] active fetch failed, using in-code default", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return cached ?? null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvedPrompt {
  template: string;
  version: number;
  source: "lakebase" | "in-code";
  key: string;
}

/**
 * Resolve the effective prompt for a key. Lakebase override wins when an
 * `active=true` row exists; otherwise the in-code default is returned.
 *
 * Throws if the key is not registered with an in-code default AND no
 * Lakebase row is configured.
 */
export async function getPrompt(key: string): Promise<ResolvedPrompt> {
  const active = await fetchActive(key);
  if (active) {
    return { template: active.template, version: active.version, source: "lakebase", key };
  }
  const def = _defaults.get(key);
  if (!def) {
    throw new Error(
      `[prompt-registry] no in-code default registered for "${key}"; refusing to return empty template`,
    );
  }
  return { template: def.template, version: def.version, source: "in-code", key };
}

/**
 * Synchronous variant for hot paths that already cached the active value
 * during request setup. Returns the in-code default when no cached active
 * row is present.
 */
export function getPromptSync(key: string): ResolvedPrompt {
  const cached = _activeCache.get(key);
  if (cached) {
    return { template: cached.template, version: cached.version, source: "lakebase", key };
  }
  const def = _defaults.get(key);
  if (!def) {
    throw new Error(`[prompt-registry] no in-code default registered for "${key}"`);
  }
  return { template: def.template, version: def.version, source: "in-code", key };
}

/**
 * Substitute `{{variable}}` placeholders. When the Lakebase template is
 * missing one or more required variables (i.e. interpolation produced an
 * empty / unknown value), the function falls back to the in-code default.
 */
export function interpolatePrompt(
  resolved: ResolvedPrompt,
  variables: Record<string, string | number | boolean>,
): string {
  const fill = (template: string): string =>
    template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k: string) => {
      const v = variables[k];
      return v === undefined || v === null ? `{{${k}}}` : String(v);
    });

  let body = fill(resolved.template);
  if (resolved.source === "lakebase" && body.includes("{{")) {
    const def = _defaults.get(resolved.key);
    if (def) {
      logger.warn("[prompt-registry] active template missing variables, falling back to in-code", {
        key: resolved.key,
      });
      body = fill(def.template);
    }
  }
  return body;
}

/**
 * Admin operation: flip the active row for a key. Best-effort -- callers
 * should guard with their own permission checks.
 */
export async function setActiveVersion(key: string, version: number): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgePromptVersion.updateMany({
      where: { promptKey: key, NOT: { version } },
      data: { active: false },
    });
    await prisma.forgePromptVersion.updateMany({
      where: { promptKey: key, version },
      data: { active: true },
    });
  });
  _activeCache.delete(key);
  logger.info("[prompt-registry] active version updated", { key, version });
}

/**
 * Test helper: returns the registered in-code defaults. Useful for the
 * one-time bootstrap migration that seeds Lakebase with v1 templates.
 */
export function listDefaults(): Array<{ key: string; version: number; template: string }> {
  return Array.from(_defaults.entries()).map(([key, v]) => ({
    key,
    version: v.version,
    template: v.template,
  }));
}
