/**
 * Startup guard: ensures every root table row has an `owner_email` so the
 * per-user isolation model never produces invisible orphans.
 *
 * Per the User Isolation refactor, every root model has an `ownerEmail`
 * column. New code always writes a value, but legacy rows created before
 * the refactor (or before specific code paths started threading the owner
 * through) can still carry `NULL`. Those rows would be invisible to every
 * user under the OR-scoped query model.
 *
 * Behaviour:
 *   1. Count NULL-owner rows across every root table.
 *   2. If any are found, auto-backfill them with a sentinel owner so the
 *      rows are *visible to nobody real* but the app can still boot. The
 *      sentinel email is configurable via `FORGE_ORPHAN_OWNER_EMAIL`
 *      (default: `"orphan@forge.local"`). Admins can subsequently
 *      `UPDATE ... SET owner_email = <real user>` from Lakebase to hand
 *      these rows back to a human, or delete them outright.
 *   3. Only re-verify after the backfill -- if any NULLs *still* remain
 *      (e.g. a backfill UPDATE silently failed because the column lacks
 *      a default), throw fatally so the platform retries the deploy with
 *      a clear error message.
 *   4. `FORGE_USER_ISOLATION=false` is a final escape hatch: under that
 *      flag the guard logs a warning and never throws.
 *
 * Tables checked: every root model declared with `ownerEmail` in
 * `prisma/schema.prisma`. Children inherit visibility via their parent
 * FK and don't need a direct check.
 */

import { withPrisma } from "@/lib/prisma";
import { isUserIsolationEnabled } from "@/lib/config/isolation-flag";
import { logger } from "@/lib/logger";

interface RootTableCheck {
  label: string;
  count: () => Promise<number>;
  backfill: (owner: string) => Promise<number>;
}

/**
 * Default sentinel owner for orphan rows. Chosen to be a syntactically
 * valid email that no real workspace user will ever match, so attribution
 * stays clear and the row remains effectively invisible to the
 * OR-scoped list queries.
 */
const DEFAULT_ORPHAN_OWNER = "orphan@forge.local";

function resolveOrphanOwner(): string {
  const raw = (process.env.FORGE_ORPHAN_OWNER_EMAIL ?? "").trim().toLowerCase();
  return raw || DEFAULT_ORPHAN_OWNER;
}

export async function assertOwnerEmailIntegrity(): Promise<void> {
  const orphanOwner = resolveOrphanOwner();

  const { initialCounts, backfilledCounts, residualCounts } = await withPrisma(
    async (prisma) => {
      // Each row is a root model that the isolation refactor added an
      // owner to. Children (use cases, exports, prompt logs, ...) cascade
      // through their parents via FK and aren't checked directly.
      const checks: RootTableCheck[] = [
        {
          label: "ForgeRun",
          count: () => prisma.forgeRun.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeRun.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeEnvironmentScan",
          count: () => prisma.forgeEnvironmentScan.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeEnvironmentScan.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeGenieSpace",
          count: () => prisma.forgeGenieSpace.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeGenieSpace.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeMetadataGenieSpace",
          count: () =>
            prisma.forgeMetadataGenieSpace.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeMetadataGenieSpace.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeSpaceBenchmarkRun",
          count: () => prisma.forgeSpaceBenchmarkRun.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeSpaceBenchmarkRun.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeSpaceHealthScore",
          count: () => prisma.forgeSpaceHealthScore.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeSpaceHealthScore.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeDemoSession",
          count: () => prisma.forgeDemoSession.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeDemoSession.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeCommentJob",
          count: () => prisma.forgeCommentJob.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeCommentJob.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeConnection",
          count: () => prisma.forgeConnection.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeConnection.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeFabricScan",
          count: () => prisma.forgeFabricScan.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeFabricScan.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeFabricMigration",
          count: () => prisma.forgeFabricMigration.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeFabricMigration.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeStrategyDocument",
          count: () => prisma.forgeStrategyDocument.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeStrategyDocument.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
        {
          label: "ForgeDocument",
          count: () => prisma.forgeDocument.count({ where: { ownerEmail: null } }),
          backfill: async (owner) =>
            (await prisma.forgeDocument.updateMany({
              where: { ownerEmail: null },
              data: { ownerEmail: owner },
            })).count,
        },
      ];

      const initialCounts: Array<{ label: string; count: number }> = [];
      const backfilledCounts: Array<{ label: string; count: number }> = [];
      const residualCounts: Array<{ label: string; count: number }> = [];

      for (const check of checks) {
        let initial = 0;
        try {
          initial = await check.count();
        } catch (err) {
          // Table may not exist yet on a fresh deploy -- skip silently.
          logger.debug("[isolation-guard] Skipping table (does not exist yet)", {
            label: check.label,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        if (initial === 0) continue;

        initialCounts.push({ label: check.label, count: initial });

        // Auto-remediate: backfill with the sentinel owner so the row is
        // visible only to the (non-existent) sentinel user. The app can
        // now boot; an admin can re-attribute or delete the rows later.
        try {
          const backfilled = await check.backfill(orphanOwner);
          backfilledCounts.push({ label: check.label, count: backfilled });
        } catch (err) {
          logger.error("[isolation-guard] Auto-backfill failed for table", {
            label: check.label,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Re-verify -- a successful backfill returns count 0 here.
        try {
          const after = await check.count();
          if (after > 0) {
            residualCounts.push({ label: check.label, count: after });
          }
        } catch {
          // Table-missing case already handled above; ignore here.
        }
      }

      return { initialCounts, backfilledCounts, residualCounts };
    },
  );

  if (initialCounts.length === 0) {
    logger.info("[isolation-guard] All root tables have ownerEmail populated.");
    return;
  }

  const initialSummary = initialCounts
    .map((c) => `  - ${c.label}: ${c.count} rows`)
    .join("\n");
  const backfillSummary = backfilledCounts
    .map((c) => `  - ${c.label}: ${c.count} rows`)
    .join("\n");

  // Always log loudly so the orphan event is auditable -- this is exactly
  // the signal we want bubbling into the activity stream / on-call review.
  logger.warn(
    `[isolation-guard] Auto-backfilled NULL owner_email orphans with sentinel "${orphanOwner}".\n` +
      `Found:\n${initialSummary}\n` +
      `Backfilled:\n${backfillSummary || "  (none)"}\n` +
      `Admins can re-attribute or delete these rows from Lakebase using:\n` +
      `  UPDATE <table> SET owner_email = '<real-user>' WHERE owner_email = '${orphanOwner}';`,
  );

  if (residualCounts.length === 0) {
    // Healthy outcome: everything was backfilled and the app can boot.
    return;
  }

  // Residual NULLs after a backfill attempt indicate something is wrong
  // at the schema level (constraint violation, table-missing race, etc).
  const residualSummary = residualCounts
    .map((c) => `  - ${c.label}: ${c.count} rows`)
    .join("\n");
  const message =
    `Startup integrity check failed: rows with NULL owner_email remain AFTER auto-backfill.\n${residualSummary}\n\n` +
    `Auto-remediation could not complete. Run a factory reset (deleteAllData()) and\n` +
    `re-deploy, or back-fill the owner_email column manually:\n` +
    `  UPDATE <table> SET owner_email = '${orphanOwner}' WHERE owner_email IS NULL;`;

  if (!isUserIsolationEnabled()) {
    logger.warn(`[isolation-guard] ${message}\nFORGE_USER_ISOLATION=false; allowing boot.`);
    return;
  }

  // Loud, fatal failure: backfill did not close the gap.
  logger.error(`[isolation-guard] ${message}`);
  throw new Error(message);
}
