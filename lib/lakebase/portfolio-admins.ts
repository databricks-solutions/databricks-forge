/**
 * Lakebase-backed org-admin allowlist for the cross-estate Portfolio tier.
 *
 * Supersedes the legacy `FORGE_ORG_ADMIN_EMAILS` env var as the source of
 * truth, while still unioning it (and the deployer bootstrap admin) for
 * back-compat. The deploying user is auto-seeded as a `isBootstrap` admin on
 * first access so the portfolio works with zero config; admins then grant /
 * revoke access to others from the UI without a redeploy.
 *
 * Admin status is the union of:
 *   - the `ForgePortfolioAdmin` table (UI-managed, the source of truth), and
 *   - env-derived admins (`FORGE_ORG_ADMIN_EMAILS` ∪ bootstrap) for back-compat.
 *
 * The membership set is cached in-process for a short TTL to keep the
 * per-request guard cheap; mutations invalidate the cache immediately.
 */

import { withPrisma } from "@/lib/prisma";
import { envOrgAdmins, isEnvOrgAdmin, portfolioBootstrapAdmin } from "@/lib/config/portfolio-flag";

export interface PortfolioAdmin {
  email: string;
  grantedByEmail: string | null;
  isBootstrap: boolean;
  createdAt: string;
}

const CACHE_TTL_MS = 30_000;
let _cache: { emails: Set<string>; ts: number } | null = null;
let _bootstrapped = false;

function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

function invalidate(): void {
  _cache = null;
}

/**
 * Seed the deployer (bootstrap admin) once per process. Idempotent: only
 * inserts when the email is not already present, and never demotes an existing
 * row. Safe to call before every read.
 */
async function ensureBootstrapAdmin(): Promise<void> {
  if (_bootstrapped) return;
  _bootstrapped = true;
  const boot = portfolioBootstrapAdmin();
  if (!boot) return;
  try {
    await withPrisma((prisma) =>
      prisma.forgePortfolioAdmin.upsert({
        where: { email: boot },
        create: { email: boot, grantedByEmail: null, isBootstrap: true },
        update: {}, // never clobber an existing (possibly UI-managed) row
      }),
    );
    invalidate();
  } catch {
    // Bootstrap is best-effort; env-derived admin check still covers the
    // deployer via `isEnvOrgAdmin`, so a transient DB hiccup is non-fatal.
    _bootstrapped = false;
  }
}

/** Lower-cased set of DB-managed admin emails (cached). */
async function dbAdminEmails(): Promise<Set<string>> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.emails;
  const rows = await withPrisma((prisma) =>
    prisma.forgePortfolioAdmin.findMany({ select: { email: true } }),
  );
  const emails = new Set(rows.map((r) => r.email.toLowerCase()));
  _cache = { emails, ts: Date.now() };
  return emails;
}

/**
 * Authoritative admin check: DB list ∪ env-derived admins. Ensures the
 * deployer bootstrap row exists first so a fresh deploy grants the deployer.
 */
export async function isPortfolioAdmin(email: string | null | undefined): Promise<boolean> {
  const e = normaliseEmail(email);
  if (!e) return false;
  if (isEnvOrgAdmin(e)) return true;
  await ensureBootstrapAdmin();
  return (await dbAdminEmails()).has(e);
}

/** Full admin list (DB rows ∪ env-derived), sorted, for the management UI. */
export async function listPortfolioAdmins(): Promise<PortfolioAdmin[]> {
  await ensureBootstrapAdmin();
  const rows = await withPrisma((prisma) =>
    prisma.forgePortfolioAdmin.findMany({ orderBy: { createdAt: "asc" } }),
  );
  const byEmail = new Map<string, PortfolioAdmin>();
  for (const r of rows) {
    byEmail.set(r.email.toLowerCase(), {
      email: r.email.toLowerCase(),
      grantedByEmail: r.grantedByEmail,
      isBootstrap: r.isBootstrap,
      createdAt: r.createdAt.toISOString(),
    });
  }
  // Surface env-configured admins that aren't in the table as read-only
  // (cannot be revoked from the UI — they come from deployment config).
  for (const e of envOrgAdmins()) {
    if (!byEmail.has(e)) {
      byEmail.set(e, {
        email: e,
        grantedByEmail: null,
        isBootstrap: true,
        createdAt: new Date(0).toISOString(),
      });
    }
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Grant portfolio admin to `email`. Returns the normalised email. */
export async function addPortfolioAdmin(
  email: string,
  grantedByEmail: string,
): Promise<string> {
  const e = normaliseEmail(email);
  if (!e) throw new Error("A valid email address is required.");
  await withPrisma((prisma) =>
    prisma.forgePortfolioAdmin.upsert({
      where: { email: e },
      create: { email: e, grantedByEmail, isBootstrap: false },
      update: {}, // already an admin; no-op
    }),
  );
  invalidate();
  return e;
}

/**
 * Revoke portfolio admin from `email`. Refuses to remove the last remaining
 * DB-managed admin (so the tier can never be locked out from the UI) and
 * cannot revoke env-configured admins (they're deployment config).
 */
export async function removePortfolioAdmin(email: string): Promise<void> {
  const e = normaliseEmail(email);
  if (!e) throw new Error("A valid email address is required.");
  if (isEnvOrgAdmin(e)) {
    throw new Error(
      "This admin is configured at deploy time and cannot be removed from the UI.",
    );
  }
  await withPrisma(async (prisma) => {
    const count = await prisma.forgePortfolioAdmin.count();
    if (count <= 1) {
      throw new Error("Cannot remove the last portfolio admin.");
    }
    await prisma.forgePortfolioAdmin.deleteMany({ where: { email: e } });
  });
  invalidate();
}
