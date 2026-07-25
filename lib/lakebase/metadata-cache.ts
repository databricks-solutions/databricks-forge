/**
 * Metadata cache persistence -- backed by Lakebase (Prisma).
 *
 * Stores and retrieves MetadataSnapshot objects so they can be reused
 * by features like Genie Space recommendations without re-running the
 * metadata extraction queries.
 */

import { withPrisma } from "@/lib/prisma";
import type { MetadataSnapshot } from "@/lib/domain/types";

/**
 * Save a metadata snapshot to the cache table.
 */
export async function saveMetadataSnapshot(snapshot: MetadataSnapshot): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeMetadataCache.upsert({
      where: { cacheKey: snapshot.cacheKey },
      create: {
        cacheKey: snapshot.cacheKey,
        ucPath: snapshot.ucPath,
        metadataJson: JSON.stringify(snapshot),
        tableCount: snapshot.tableCount,
        columnCount: snapshot.columnCount,
      },
      update: {
        metadataJson: JSON.stringify(snapshot),
        tableCount: snapshot.tableCount,
        columnCount: snapshot.columnCount,
      },
    });
  });
}

/**
 * Load a metadata snapshot from the cache by key.
 * Returns null if not found or if the stored JSON is invalid.
 */
export async function loadMetadataSnapshot(cacheKey: string): Promise<MetadataSnapshot | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeMetadataCache.findUnique({
      where: { cacheKey },
    });

    if (!row?.metadataJson) return null;

    try {
      const snapshot = JSON.parse(row.metadataJson) as MetadataSnapshot;
      if (!snapshot.metricViews) {
        snapshot.metricViews = [];
      }
      if (!snapshot.lineageDiscoveredFqns) {
        snapshot.lineageDiscoveredFqns = [];
      }
      return snapshot;
    } catch {
      return null;
    }
  });
}

/**
 * Load metadata for a run by looking up its metadataCacheKey.
 */
export async function loadMetadataForRun(runId: string): Promise<MetadataSnapshot | null> {
  const cacheKey = await withPrisma(async (prisma) => {
    const run = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { metadataCacheKey: true },
    });
    return run?.metadataCacheKey ?? null;
  });

  if (!cacheKey) return null;
  return loadMetadataSnapshot(cacheKey);
}

/**
 * Load only `lineageDiscoveredFqns` for a run, avoiding the full metadata
 * snapshot transfer and parse.  Returns [] when no cache entry exists.
 */
export async function loadLineageFqnsForRun(runId: string): Promise<string[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.$queryRaw<
      Array<{ fqns: string | null }>
    >`SELECT mc."metadataJson"::jsonb -> 'lineageDiscoveredFqns' AS fqns
      FROM "ForgeRun" r
      JOIN "ForgeMetadataCache" mc ON mc."cacheKey" = r."metadataCacheKey"
      WHERE r."runId" = ${runId}
      LIMIT 1`;

    if (!rows.length || !rows[0].fqns) return [];
    try {
      const parsed = typeof rows[0].fqns === "string" ? JSON.parse(rows[0].fqns) : rows[0].fqns;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
}
