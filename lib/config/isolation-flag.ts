/**
 * Feature flag: user isolation and sharing.
 *
 * Defaults to ON in production. When OFF the application still runs but:
 *   - Per-user pipeline / scan / Genie / demo caps are NOT enforced.
 *   - The Sharing UI is hidden (the API still works).
 *   - The SystemLoadBanner stays mounted (it never reveals other users'
 *     identities, so this isn't a privacy gate).
 *
 * The flag does NOT change data-layer behaviour — `ownerEmail` filters
 * are always applied because the schema migration is forward-only and
 * data leakage is far worse than a friction regression.
 *
 * Set `FORGE_USER_ISOLATION=false` to opt out (e.g. single-tenant demo
 * deployment). Any other value (or unset) means the flag is ON.
 */

export function isUserIsolationEnabled(): boolean {
  const raw = process.env.FORGE_USER_ISOLATION;
  if (raw == null) return true;
  const v = raw.trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}
