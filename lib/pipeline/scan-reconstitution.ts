/**
 * Reconstitute a pipeline MetadataSnapshot from a persisted estate scan.
 *
 * Workstream C (decoupled discovery): when a ForgeRun is seeded with a
 * `sourceScanId`, use-case generation runs on top of an already-completed
 * estate scan instead of re-extracting Unity Catalog metadata live. This
 * module rebuilds the in-memory `MetadataSnapshot` + `LineageGraph` that the
 * pipeline's metadata-extraction step would otherwise produce, sourcing every
 * field from the persisted `ForgeEnvironmentScan` and its children.
 *
 * Field mapping (persisted -> snapshot):
 *   ForgeTableDetail            -> TableInfo
 *   ForgeTableDetail.columnsJson -> ColumnInfo[] (ordinalPosition synthesised
 *                                    from array index, which preserves the
 *                                    listColumns/ordinal order written at scan
 *                                    time)
 *   ForgeTableInsight(foreign_key) -> ForeignKey[]
 *   ForgeTableLineage           -> LineageEdge[]
 *
 * Known gaps (acceptable for this path):
 *   - foreign_key insights are only written by standalone estate scans; if the
 *     scan has none, FKs come back empty and schema markdown renders without
 *     an FK section (generation already handles this).
 *   - metricViews are not persisted on a scan; returned empty (not consumed by
 *     use-case generation).
 */

import { getEnvironmentScan } from "@/lib/lakebase/environment-scans";
import { splitFqn } from "@/lib/queries/metadata-detail";
import { logger } from "@/lib/logger";
import { fromStoredLineageEntityType } from "@/lib/domain/lineage-entity-type";
import type {
  MetadataSnapshot,
  TableInfo,
  ColumnInfo,
  ForeignKey,
  LineageGraph,
  LineageEdge,
} from "@/lib/domain/types";

interface PersistedColumn {
  name: string;
  type: string;
  nullable: boolean;
  comment: string | null;
}

/**
 * Rebuild the metadata snapshot + lineage graph for a run from a persisted
 * estate scan. Returns null when the scan does not exist or has no tables.
 */
export async function reconstituteMetadataFromScan(
  scanId: string,
  ucPath: string,
): Promise<{ snapshot: MetadataSnapshot; lineageGraph: LineageGraph } | null> {
  const scan = await getEnvironmentScan(scanId);
  if (!scan) {
    logger.warn("[scan-reconstitution] scan not found", { scanId });
    return null;
  }
  // Only a fully-saved scan is a valid source: a `running` checkpoint has no
  // table details yet, and a `failed` one is incomplete/untrustworthy.
  if (scan.scanStatus && scan.scanStatus !== "complete") {
    logger.warn("[scan-reconstitution] scan is not complete", {
      scanId,
      scanStatus: scan.scanStatus,
    });
    return null;
  }
  if (!scan.details || scan.details.length === 0) {
    logger.warn("[scan-reconstitution] scan has no table details", { scanId });
    return null;
  }

  const tables: TableInfo[] = [];
  const columns: ColumnInfo[] = [];

  for (const d of scan.details) {
    // Persisted details carry catalog/schema/tableName; fall back to splitting
    // the FQN only if any are missing (shared helper from metadata-detail).
    let catalog = d.catalog;
    let schema = d.schema;
    let tableName = d.tableName;
    if (!catalog || !schema || !tableName) {
      try {
        const [c, s, t] = splitFqn(d.tableFqn);
        catalog = catalog || c;
        schema = schema || s;
        tableName = tableName || t;
      } catch {
        // malformed FQN with missing columns — keep whatever we have
      }
    }
    tables.push({
      catalog,
      schema,
      tableName,
      fqn: d.tableFqn,
      tableType: d.tableType ?? "TABLE",
      dataSourceFormat: d.format ?? null,
      comment: d.comment ?? d.generatedDescription ?? null,
      discoveredVia: d.discoveredVia === "lineage" ? "lineage" : "selected",
    });

    // columnsJson is the array written by saveEnvironmentScan, in ordinal order.
    if (d.columnsJson) {
      try {
        const parsed = JSON.parse(d.columnsJson) as PersistedColumn[];
        parsed.forEach((c, idx) => {
          columns.push({
            tableFqn: d.tableFqn,
            columnName: c.name,
            dataType: c.type,
            ordinalPosition: idx + 1,
            isNullable: c.nullable !== false,
            comment: c.comment ?? null,
          });
        });
      } catch (e) {
        logger.debug("[scan-reconstitution] failed to parse columnsJson", {
          scanId,
          tableFqn: d.tableFqn,
          error: String(e),
        });
      }
    }
  }

  // Foreign keys: stored as `foreign_key` insights (standalone scans only).
  const foreignKeys: ForeignKey[] = [];
  for (const ins of scan.insights ?? []) {
    if (ins.insightType !== "foreign_key") continue;
    try {
      const fk = JSON.parse(ins.payloadJson) as ForeignKey;
      if (fk && fk.tableFqn && fk.referencedTableFqn) foreignKeys.push(fk);
    } catch {
      // skip malformed payloads
    }
  }

  // Lineage edges.
  const edges: LineageEdge[] = (scan.lineage ?? []).map((l) => ({
    sourceTableFqn: l.sourceTableFqn,
    targetTableFqn: l.targetTableFqn,
    sourceType: l.sourceType ?? "TABLE",
    targetType: l.targetType ?? "TABLE",
    lastEventTime: l.lastEventTime ?? null,
    entityType: fromStoredLineageEntityType(l.entityType),
    eventCount: l.eventCount ?? 1,
  }));

  const seedTables = scan.details
    .filter((d) => d.discoveredVia !== "lineage")
    .map((d) => d.tableFqn);
  const discoveredFqns = scan.details
    .filter((d) => d.discoveredVia === "lineage")
    .map((d) => d.tableFqn);

  const lineageGraph: LineageGraph = {
    edges,
    seedTables,
    discoveredTables: discoveredFqns,
    upstreamDepth: 0,
    downstreamDepth: 0,
  };

  const snapshot: MetadataSnapshot = {
    cacheKey: `scan:${scanId}`,
    ucPath,
    tables,
    columns,
    foreignKeys,
    metricViews: [],
    tableCount: tables.length,
    columnCount: columns.length,
    cachedAt: scan.createdAt.toISOString(),
    lineageDiscoveredFqns: discoveredFqns,
  };

  logger.info("[scan-reconstitution] reconstituted metadata from scan", {
    scanId,
    tables: tables.length,
    columns: columns.length,
    foreignKeys: foreignKeys.length,
    lineageEdges: edges.length,
  });

  return { snapshot, lineageGraph };
}
