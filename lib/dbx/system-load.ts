/**
 * Snapshot of cross-system load for the SystemLoadBanner.
 *
 * Returns per-endpoint queue depths from the in-memory rate limiter plus
 * aggregate counts of active pipeline runs, scans, Genie deploys, and demo
 * engines from Lakebase. Per-user inflight/queued is also returned so a
 * banner copy can say "your work" specifically.
 *
 * Anonymous: never returns other users' identities -- the LLM block exposes
 * only counts and endpoint metadata.
 */

import { getPoolRateLimiter } from "@/lib/dbx/rate-limiter";
import { withPrisma } from "@/lib/prisma";
import { listInflightScansForUser } from "@/lib/pipeline/scan-progress";

export interface SystemLoadSnapshot {
  active: {
    pipelineRuns: number;
    scans: number;
    genieDeploys: number;
    demoEngines: number;
    queued: number;
  };
  llm: {
    totalInflight: number;
    totalQueued: number;
    perEndpoint: Array<{
      name: string;
      inflight: number;
      pending: number;
      blocked: boolean;
      retryInMs: number | null;
    }>;
    yourInflight: number;
    yourQueued: number;
  };
}

const ACTIVE_RUN_STATUSES = ["pending", "running", "queued"];
const ACTIVE_DEMO_STATUSES = ["researching", "generating"];

let cached: { at: number; data: Omit<SystemLoadSnapshot, "llm"> } | null = null;
const CACHE_MS = 3000;

async function fetchActiveCounts(): Promise<Omit<SystemLoadSnapshot, "llm">> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.data;
  const data = await withPrisma(async (prisma) => {
    const [pipelineRuns, genieDeploys, demoEngines, queued] = await Promise.all([
      prisma.forgeRun.count({ where: { status: { in: ACTIVE_RUN_STATUSES } } }),
      prisma.forgeGenieSpace.count({ where: { status: "deployed" } }),
      prisma.forgeDemoSession.count({ where: { status: { in: ACTIVE_DEMO_STATUSES } } }),
      prisma.forgeRun.count({ where: { status: "queued" } }),
    ]);
    // Active scans are tracked in-memory only (no status column); count for "system"
    // would require summing all per-user counts. Approximate as 0 here; per-user
    // is supplied via the rate limiter snapshot.
    const scans = 0;
    return {
      active: { pipelineRuns, scans, genieDeploys, demoEngines, queued },
    };
  });
  cached = { at: now, data };
  return data;
}

export async function getSystemLoad(userEmail: string | null): Promise<SystemLoadSnapshot> {
  const limiter = getPoolRateLimiter();
  const snap = limiter.snapshot();
  const totalInflight = limiter.totalInflight();
  const totalQueued = limiter.totalPending();
  const perEndpoint = snap.map((s) => ({
    name: s.name,
    inflight: s.inflight,
    pending: s.pending,
    blocked: s.blocked,
    retryInMs: s.blocked ? Math.max(0, s.blockedUntil - Date.now()) : null,
  }));

  const counts = await fetchActiveCounts();
  const userScope = userEmail
    ? limiter.perUserSnapshot(userEmail.toLowerCase().trim())
    : { inflight: 0, pending: 0 };
  const userScans = userEmail ? listInflightScansForUser(userEmail) : 0;

  return {
    active: { ...counts.active, scans: userScans },
    llm: {
      totalInflight,
      totalQueued,
      perEndpoint,
      yourInflight: userScope.inflight,
      yourQueued: userScope.pending,
    },
  };
}
