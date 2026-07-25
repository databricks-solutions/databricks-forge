/**
 * Per-user soft caps for fire-and-forget background jobs.
 *
 * Caps are configurable via env vars (with sensible defaults) and counted
 * against currently-active rows in Lakebase, scoped to the calling user via
 * `ownerEmail`. The caller decides what to do on exceedance: either return
 * a 429 to the API client, or persist the resource as `queued` so the
 * scheduler (Phase 5c) can promote it later.
 *
 * Counted as:
 *   SELECT count(*) FROM <root>
 *    WHERE owner_email = $user
 *      AND status IN ('queued', 'pending', 'running')
 */

import { withPrisma } from "@/lib/prisma";
import { listInflightScansForUser } from "@/lib/pipeline/scan-progress";
import { isUserIsolationEnabled } from "@/lib/config/isolation-flag";

export type QuotaKind = "pipeline" | "scan" | "genie_deploy" | "demo_engine";

const DEFAULTS: Record<QuotaKind, number> = {
  pipeline: 1,
  scan: 1,
  genie_deploy: 2,
  demo_engine: 1,
};

/**
 * Statuses considered "active" for quota purposes. Queued rows are NOT
 * counted -- otherwise a user could never queue more than their cap and
 * the queue + scheduler would be useless. The scheduler reads queued rows
 * separately and promotes them when a slot opens up.
 */
const ACTIVE_STATUSES = ["pending", "running"] as const;

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

export function getCap(kind: QuotaKind): number {
  switch (kind) {
    case "pipeline":
      return envInt("FORGE_MAX_ACTIVE_PIPELINE_RUNS_PER_USER") ?? DEFAULTS.pipeline;
    case "scan":
      return envInt("FORGE_MAX_ACTIVE_SCANS_PER_USER") ?? DEFAULTS.scan;
    case "genie_deploy":
      return envInt("FORGE_MAX_ACTIVE_GENIE_DEPLOYS_PER_USER") ?? DEFAULTS.genie_deploy;
    case "demo_engine":
      return envInt("FORGE_MAX_ACTIVE_DEMO_ENGINES_PER_USER") ?? DEFAULTS.demo_engine;
    default:
      return 1;
  }
}

/**
 * Count the user's active resources for a given quota kind.
 *
 * Returns 0 when the user is unknown (defensive).
 */
export async function countActive(kind: QuotaKind, userEmail: string): Promise<number> {
  if (!userEmail) return 0;
  const owner = userEmail.toLowerCase().trim();

  if (kind === "scan") {
    return listInflightScansForUser(owner);
  }

  return withPrisma(async (prisma) => {
    switch (kind) {
      case "pipeline":
        return prisma.forgeRun.count({
          where: { ownerEmail: owner, status: { in: [...ACTIVE_STATUSES] } },
        });
      case "genie_deploy":
        return prisma.forgeGenieSpace.count({
          where: { ownerEmail: owner, status: "deployed" },
        });
      case "demo_engine":
        return prisma.forgeDemoSession.count({
          where: { ownerEmail: owner, status: { in: ["researching", "generating"] } },
        });
      default:
        return 0;
    }
  });
}

export interface QuotaDecision {
  allowed: boolean;
  cap: number;
  active: number;
  /**
   * True when the cap is reached AND `behavior === "queue"`. Caller should
   * persist the new resource with `status='queued'` and return success.
   */
  shouldQueue: boolean;
}

/**
 * Check whether starting a new resource of `kind` is allowed for the user.
 *
 * `behavior` controls what happens when at the cap:
 *   - "reject" -- caller should respond 429 / 409 (default for synchronous flows)
 *   - "queue"  -- caller should persist as queued; the scheduler will promote
 */
export async function checkQuota(
  kind: QuotaKind,
  userEmail: string,
  behavior: "reject" | "queue" = "reject",
): Promise<QuotaDecision> {
  // When the isolation flag is off, caps are not enforced (single-tenant mode).
  if (!isUserIsolationEnabled()) {
    return { allowed: true, cap: 0, active: 0, shouldQueue: false };
  }
  const cap = getCap(kind);
  if (cap <= 0) {
    return { allowed: true, cap: 0, active: 0, shouldQueue: false };
  }
  const active = await countActive(kind, userEmail);
  const allowed = active < cap;
  return {
    allowed,
    cap,
    active,
    shouldQueue: !allowed && behavior === "queue",
  };
}
