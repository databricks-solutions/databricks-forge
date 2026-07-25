/**
 * CRUD operations for the Genie Space workspace cache -- backed by Lakebase (Prisma).
 *
 * Stores a cached copy of ALL workspace Genie spaces so the Genie Studio page
 * can load instantly from Lakebase instead of paginating the Databricks API on
 * every visit. The cache is populated by an explicit user-triggered sync and
 * updated individually when a space detail page is visited.
 */

import { withPrisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedGenieSpace {
  spaceId: string;
  title: string;
  description: string | null;
  tableCount: number | null;
  measureCount: number | null;
  sampleQuestionCount: number | null;
  filterCount: number | null;
  healthScore: number | null;
  healthReportJson: string | null;
  permissionDenied: boolean;
  lastDiscoveredAt: string | null;
  syncedAt: string;
}

export interface SpaceCacheUpsertInput {
  spaceId: string;
  title: string;
  description?: string | null;
}

export interface SpaceCacheDiscoveryInput {
  tableCount?: number | null;
  measureCount?: number | null;
  sampleQuestionCount?: number | null;
  filterCount?: number | null;
  healthScore?: number | null;
  healthReportJson?: string | null;
  permissionDenied?: boolean;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function rowToCached(row: {
  spaceId: string;
  title: string;
  description: string | null;
  tableCount: number | null;
  measureCount: number | null;
  sampleQuestionCount: number | null;
  filterCount: number | null;
  healthScore: number | null;
  healthReportJson: string | null;
  permissionDenied: boolean;
  lastDiscoveredAt: Date | null;
  syncedAt: Date;
}): CachedGenieSpace {
  return {
    spaceId: row.spaceId,
    title: row.title,
    description: row.description,
    tableCount: row.tableCount,
    measureCount: row.measureCount,
    sampleQuestionCount: row.sampleQuestionCount,
    filterCount: row.filterCount,
    healthScore: row.healthScore,
    healthReportJson: row.healthReportJson,
    permissionDenied: row.permissionDenied,
    lastDiscoveredAt: row.lastDiscoveredAt?.toISOString() ?? null,
    syncedAt: row.syncedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** List all cached spaces (single DB query). */
export async function listCachedSpaces(): Promise<CachedGenieSpace[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeGenieSpaceCache.findMany({
      orderBy: { title: "asc" },
    });
    return rows.map(rowToCached);
  });
}

/** Return the most recent syncedAt timestamp, or null if cache is empty. */
export async function getCacheSyncTimestamp(): Promise<string | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeGenieSpaceCache.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    });
    return row?.syncedAt.toISOString() ?? null;
  });
}

/**
 * Bulk upsert spaces from a Databricks API sync.
 * Uses batched upserts (100 per transaction) to stay within Lakebase limits.
 */
export async function upsertCachedSpaces(spaces: SpaceCacheUpsertInput[]): Promise<number> {
  if (spaces.length === 0) return 0;

  const BATCH_SIZE = 100;
  let upserted = 0;

  for (let i = 0; i < spaces.length; i += BATCH_SIZE) {
    const batch = spaces.slice(i, i + BATCH_SIZE);
    await withPrisma(async (prisma) => {
      await prisma.$transaction(
        batch.map((s) =>
          prisma.forgeGenieSpaceCache.upsert({
            where: { spaceId: s.spaceId },
            create: {
              spaceId: s.spaceId,
              title: s.title,
              description: s.description ?? null,
              syncedAt: new Date(),
            },
            update: {
              title: s.title,
              description: s.description ?? null,
              syncedAt: new Date(),
            },
          }),
        ),
      );
    });
    upserted += batch.length;
  }

  return upserted;
}

/**
 * Update a single space's discovery data (metadata + health) after
 * the user visits the detail page.
 */
export async function updateCachedSpaceDiscovery(
  spaceId: string,
  discovery: SpaceCacheDiscoveryInput,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeGenieSpaceCache.update({
      where: { spaceId },
      data: {
        tableCount: discovery.tableCount ?? undefined,
        measureCount: discovery.measureCount ?? undefined,
        sampleQuestionCount: discovery.sampleQuestionCount ?? undefined,
        filterCount: discovery.filterCount ?? undefined,
        healthScore: discovery.healthScore ?? undefined,
        healthReportJson: discovery.healthReportJson ?? undefined,
        permissionDenied: discovery.permissionDenied ?? undefined,
        lastDiscoveredAt: new Date(),
      },
    });
  }).catch(() => {
    // Space may not be in cache yet (e.g. just created, no sync yet) -- safe to ignore
  });
}

/** Delete a single cached space (e.g. after trash). */
export async function deleteCachedSpace(spaceId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeGenieSpaceCache.deleteMany({
      where: { spaceId },
    });
  });
}

/**
 * Remove cache entries for spaces no longer in the workspace.
 * Called after a sync to prune deleted spaces.
 */
export async function pruneStaleCacheEntries(liveSpaceIds: Set<string>): Promise<number> {
  if (liveSpaceIds.size === 0) return 0;

  return withPrisma(async (prisma) => {
    const allCached = await prisma.forgeGenieSpaceCache.findMany({
      select: { spaceId: true },
    });
    const staleIds = allCached.map((r) => r.spaceId).filter((id) => !liveSpaceIds.has(id));

    if (staleIds.length === 0) return 0;

    const result = await prisma.forgeGenieSpaceCache.deleteMany({
      where: { spaceId: { in: staleIds } },
    });
    return result.count;
  });
}
