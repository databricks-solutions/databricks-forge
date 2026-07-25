/**
 * Lineage Walker — discovers upstream and downstream tables via BFS
 * traversal of system.access.table_lineage.
 *
 * When a customer selects only a few tables for a scan, this walker
 * follows lineage edges to find all related tables (data sources and
 * consumers), building a complete picture of the data landscape.
 *
 * Graceful fallback: if system tables are not accessible, returns an
 * empty LineageGraph and the scan proceeds with seed tables only.
 */

import { executeSQL } from "@/lib/dbx/sql";
import { logger } from "@/lib/logger";
import type { LineageEdge, LineageGraph } from "@/lib/domain/types";
import { validateFqn } from "@/lib/validation";
import { partitionLineageSeeds } from "@/lib/queries/lineage-policy";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LineageWalkOptions {
  /** Max hops to walk (default 3, max 5). */
  maxDepth?: number;
  /** Walk direction: "both", "upstream", or "downstream" (default "both"). */
  direction?: "both" | "upstream" | "downstream";
  /** Max tables to discover before stopping (default 500). */
  maxDiscoveredTables?: number;
  /**
   * Drop seed tables in shared sample catalogs (e.g. `samples`) before walking,
   * so a public dataset never fans the walk out across the whole metastore.
   * Default true.
   */
  skipSharedCatalogSeeds?: boolean;
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/**
 * Walk lineage from seed tables via BFS.
 *
 * At each depth level, queries system.access.table_lineage with all
 * tables at the current frontier in a single SQL call. Newly discovered
 * tables are enqueued for the next level.
 */
export async function walkLineage(
  seedTables: string[],
  options: LineageWalkOptions = {},
): Promise<LineageGraph> {
  const maxDepth = Math.min(options.maxDepth ?? 3, 10);
  const direction = options.direction ?? "both";
  const maxDiscovered = options.maxDiscoveredTables ?? 500;
  const skipSharedCatalogSeeds = options.skipSharedCatalogSeeds ?? true;

  const emptyGraph: LineageGraph = {
    edges: [],
    seedTables,
    discoveredTables: [],
    upstreamDepth: 0,
    downstreamDepth: 0,
  };

  if (seedTables.length === 0) return emptyGraph;

  // Guard: drop seeds in shared sample catalogs so a public dataset (e.g.
  // samples.bakehouse) never fans the walk out across the whole metastore.
  let walkSeeds = seedTables;
  let skippedSeeds: string[] = [];
  if (skipSharedCatalogSeeds) {
    const partition = partitionLineageSeeds(seedTables);
    walkSeeds = partition.walkable;
    skippedSeeds = partition.skipped;
    if (skippedSeeds.length > 0) {
      logger.info("[lineage] Skipping shared sample-catalog seeds", {
        skipped: skippedSeeds.length,
        walkable: walkSeeds.length,
      });
    }
    if (walkSeeds.length === 0) {
      logger.warn(
        "[lineage] All seed tables are in shared sample catalogs; skipping lineage walk",
      );
      return { ...emptyGraph, skippedSeeds };
    }
  }

  // Check if we can access lineage system tables
  const accessible = await isLineageAccessible();
  if (!accessible) {
    logger.warn("[lineage] system.access.table_lineage is not accessible, skipping lineage walk");
    return { ...emptyGraph, skippedSeeds };
  }

  const visited = new Set<string>(walkSeeds.map((t) => t.toLowerCase()));
  const allEdges: LineageEdge[] = [];
  const discoveredTables: string[] = [];
  let currentDepth = 0;
  let frontier = [...walkSeeds];

  logger.info("[lineage] Starting BFS walk", {
    seedCount: walkSeeds.length,
    maxDepth,
    direction,
    maxDiscovered,
  });

  while (frontier.length > 0 && currentDepth < maxDepth) {
    currentDepth++;

    try {
      const edges = await queryLineageForTables(frontier, direction);
      const nextFrontier: string[] = [];

      for (const edge of edges) {
        allEdges.push(edge);

        // Check both ends of the edge for new tables
        for (const fqn of [edge.sourceTableFqn, edge.targetTableFqn]) {
          if (fqn && !visited.has(fqn.toLowerCase())) {
            visited.add(fqn.toLowerCase());
            discoveredTables.push(fqn);
            nextFrontier.push(fqn);

            if (discoveredTables.length >= maxDiscovered) {
              logger.warn("[lineage] Reached max discovered tables cap", {
                cap: maxDiscovered,
                depth: currentDepth,
              });
              break;
            }
          }
        }

        if (discoveredTables.length >= maxDiscovered) break;
      }

      logger.info("[lineage] BFS depth complete", {
        depth: currentDepth,
        edgesFound: edges.length,
        newTables: nextFrontier.length,
        totalDiscovered: discoveredTables.length,
      });

      if (discoveredTables.length >= maxDiscovered) break;
      frontier = nextFrontier;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("[lineage] BFS query failed at depth", {
        depth: currentDepth,
        error: msg,
      });
      break;
    }
  }

  // Deduplicate edges by source+target
  const uniqueEdges = deduplicateEdges(allEdges);

  logger.info("[lineage] BFS walk complete", {
    totalEdges: uniqueEdges.length,
    totalDiscovered: discoveredTables.length,
    maxDepthReached: currentDepth,
  });

  return {
    edges: uniqueEdges,
    seedTables,
    discoveredTables,
    upstreamDepth: direction === "downstream" ? 0 : currentDepth,
    downstreamDepth: direction === "upstream" ? 0 : currentDepth,
    skippedSeeds,
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Check if system.access.table_lineage is accessible.
 */
async function isLineageAccessible(): Promise<boolean> {
  try {
    await executeSQL("SELECT 1 FROM system.access.table_lineage LIMIT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Query lineage for a batch of tables at the current BFS frontier.
 *
 * Uses a single SQL call with WHERE ... IN (...) for efficiency.
 * Groups by source/target/entity_type to collapse duplicate events.
 */
async function queryLineageForTables(
  tableFqns: string[],
  direction: "both" | "upstream" | "downstream",
): Promise<LineageEdge[]> {
  if (tableFqns.length === 0) return [];

  const safeFqns: string[] = [];
  for (const fqn of tableFqns) {
    try {
      safeFqns.push(validateFqn(fqn, "lineage table FQN"));
    } catch {
      logger.warn("[lineage] Skipping invalid FQN during lineage query", { fqn });
    }
  }
  if (safeFqns.length === 0) return [];

  const quotedFqns = safeFqns.map((f) => `'${f.replace(/'/g, "''")}'`).join(", ");

  const conditions: string[] = [];
  if (direction === "both" || direction === "upstream") {
    conditions.push(`target_table_full_name IN (${quotedFqns})`);
  }
  if (direction === "both" || direction === "downstream") {
    conditions.push(`source_table_full_name IN (${quotedFqns})`);
  }

  const whereClause = conditions.join(" OR ");

  const sql = `
    SELECT
      source_table_full_name,
      target_table_full_name,
      source_type,
      target_type,
      entity_type,
      MAX(event_time) AS last_event_time,
      COUNT(*) AS event_count
    FROM system.access.table_lineage
    WHERE (${whereClause})
      AND source_table_full_name IS NOT NULL
      AND target_table_full_name IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5
  `;

  const result = await executeSQL(sql);

  return result.rows.map((row) => ({
    sourceTableFqn: row[0] ?? "",
    targetTableFqn: row[1] ?? "",
    sourceType: row[2] ?? "TABLE",
    targetType: row[3] ?? "TABLE",
    entityType: row[4] ?? null,
    lastEventTime: row[5] ?? null,
    eventCount: parseInt(row[6] ?? "1", 10),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicate edges by source+target FQN (keep the one with highest event count).
 */
function deduplicateEdges(edges: LineageEdge[]): LineageEdge[] {
  const map = new Map<string, LineageEdge>();
  for (const edge of edges) {
    const key = `${edge.sourceTableFqn}|${edge.targetTableFqn}|${edge.entityType ?? ""}`;
    const existing = map.get(key);
    if (!existing || edge.eventCount > existing.eventCount) {
      map.set(key, edge);
    }
  }
  return Array.from(map.values());
}
