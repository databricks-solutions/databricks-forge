/**
 * Feature flag + bootstrap config: the cross-estate Portfolio (CDO) tier.
 *
 * The Portfolio tier is a DELIBERATE, AUDITED exception to Forge's mandatory
 * per-owner isolation: it aggregates estate/scan *metadata* across owners so a
 * Chief Data Officer can see the whole org. Access is therefore gated to an
 * org-admin allowlist. As of the in-tool admin model, that allowlist lives in
 * Lakebase (`ForgePortfolioAdmin`) and is managed from the UI without a
 * redeploy — see `lib/lakebase/portfolio-admins.ts`. This module only holds the
 * deployment-level switches and env-derived seeds:
 *
 *   1. `FORGE_PORTFOLIO_ENABLED` — deployment kill switch. Defaults ON
 *      (opt-out): set it to a falsey value (`false`/`0`/`no`/`off`) to hard
 *      disable the tier regardless of who is on the allowlist. Access is still
 *      admin-gated, so "enabled" never means "open to everyone".
 *   2. `FORGE_PORTFOLIO_BOOTSTRAP_ADMIN` — the deploying user's email, injected
 *      by deploy.sh (falls back to `LAKEBASE_BOOTSTRAP_USER`, then the local-dev
 *      `FORGE_LOCAL_USER_EMAIL`). Seeded into `ForgePortfolioAdmin` on first
 *      access so the deployer is automatically an admin with zero config.
 *   3. `FORGE_ORG_ADMIN_EMAILS` — legacy static allowlist. Still honoured
 *      (unioned with the DB list) for back-compat, but the UI is now the
 *      source of truth.
 *
 * This is never an ambient `FORGE_USER_ISOLATION=false` bypass — single-estate
 * routes keep their per-owner scoping regardless of this flag. The aggregator
 * only ever reads METADATA (scores, counts, names), never row-level data, and
 * every access is activity-logged.
 *
 * See docs/ESTATE_INTELLIGENCE_DESIGN.md (org-admin security model).
 */

function isFalseyFlag(raw: string | undefined): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "false" || v === "0" || v === "no" || v === "off";
}

function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/**
 * Deployment-level kill switch. Defaults ON; only an explicit falsey value
 * disables the tier. Access remains gated to org admins.
 */
export function isPortfolioEnabled(): boolean {
  return !isFalseyFlag(process.env.FORGE_PORTFOLIO_ENABLED);
}

/** Parsed, normalised legacy env allowlist (lower-cased, de-duped). */
export function orgAdminAllowlist(): string[] {
  const raw = process.env.FORGE_ORG_ADMIN_EMAILS ?? "";
  const set = new Set(
    raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
  return [...set];
}

/**
 * The email to auto-seed as the bootstrap org-admin (the deployer). Falls back
 * through the deploy-time bootstrap user and, in dev, the local user.
 */
export function portfolioBootstrapAdmin(): string | null {
  return (
    normaliseEmail(process.env.FORGE_PORTFOLIO_BOOTSTRAP_ADMIN) ??
    normaliseEmail(process.env.LAKEBASE_BOOTSTRAP_USER) ??
    (process.env.NODE_ENV !== "production"
      ? normaliseEmail(process.env.FORGE_LOCAL_USER_EMAIL)
      : null)
  );
}

/**
 * Env-derived admins (legacy allowlist ∪ bootstrap). The authoritative check
 * also unions the Lakebase-managed list — see
 * `lib/lakebase/portfolio-admins.ts` `isPortfolioAdmin`.
 */
export function envOrgAdmins(): string[] {
  const set = new Set(orgAdminAllowlist());
  const boot = portfolioBootstrapAdmin();
  if (boot) set.add(boot);
  return [...set];
}

/** True when `email` is an admin per env config alone (no DB lookup). */
export function isEnvOrgAdmin(email: string | null | undefined): boolean {
  const e = normaliseEmail(email);
  if (!e) return false;
  return envOrgAdmins().includes(e);
}
