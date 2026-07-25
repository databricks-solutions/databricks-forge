/**
 * Decoupled-discovery (Workstream C) metadata resolution for source-scan runs.
 *
 * When a ForgeRun carries a `sourceScanId`, the pipeline does NOT re-extract
 * Unity Catalog metadata live — it reconstitutes the in-memory
 * `MetadataSnapshot` + `LineageGraph` from a completed estate scan. This module
 * centralises that path so BOTH the initial run and the resume path share one
 * implementation and stay consistent:
 *
 *   1. Reconstitute snapshot + lineage from the source scan
 *      (`reconstituteMetadataFromScan`). This preserves lineage identity
 *      (edges + discovered tables) so downstream consumers
 *      (source-system attribution, blast-radius) see the same lineage on both
 *      the initial and resume paths.
 *   2. On initial extraction only, persist the run's schema snapshot via
 *      `updateSchemaSnapshot` so Ask Forge gets the same column grounding as
 *      live extraction. Resume skips this write to preserve table-filtering
 *      flags already stored on the run.
 *
 * Dependencies are injectable so this is unit-testable without Prisma.
 */

import type {
  MetadataSnapshot,
  LineageGraph,
  TableInfo,
  ColumnInfo,
} from "@/lib/domain/types";
import type { SchemaSnapshot } from "@/lib/lakebase/runs";
import { logger } from "@/lib/logger";

export type ReconstituteFn = (
  scanId: string,
  ucPath: string,
) => Promise<{ snapshot: MetadataSnapshot; lineageGraph: LineageGraph } | null>;

export type UpdateSchemaSnapshotFn = (runId: string, snap: SchemaSnapshot) => Promise<void>;

export interface SourceRunMetadataDeps {
  reconstitute: ReconstituteFn;
  updateSchemaSnapshot: UpdateSchemaSnapshotFn;
  /**
   * Persist the run-level schema snapshot after reconstitution. Defaults true
   * for the initial metadata step. Resume sets false because the existing
   * snapshot may carry table-filtering decisions (`isBusinessTable`) that a
   * rebuilt snapshot cannot infer and must not erase.
   */
  persistSchemaSnapshot: boolean;
}

/**
 * Build the run's schema snapshot (fqn -> columns/type/comment) from a
 * reconstituted metadata snapshot. Mirrors the shape produced by the live
 * metadata-extraction step so Ask Forge column grounding is identical.
 */
export function buildRunSchemaSnapshotFromMetadata(
  tables: TableInfo[],
  columns: ColumnInfo[],
): SchemaSnapshot {
  const colsByTable = new Map<string, Array<{ name: string; type: string }>>();
  for (const c of columns) {
    const list = colsByTable.get(c.tableFqn) ?? [];
    list.push({ name: c.columnName, type: c.dataType });
    colsByTable.set(c.tableFqn, list);
  }
  const snap: SchemaSnapshot = {};
  for (const t of tables) {
    snap[t.fqn] = {
      columns: colsByTable.get(t.fqn) ?? [],
      tableType: t.tableType,
      comment: t.comment ?? null,
      isBusinessTable: null,
    };
  }
  return snap;
}

/**
 * Resolve metadata for a source-scan-seeded run. Reconstitutes snapshot +
 * lineage and, by default, persists the run's initial schema snapshot.
 * Resume callers pass `persistSchemaSnapshot: false` to preserve subsequent
 * table-filtering decisions already stored on the run. Returns `null` when
 * the source scan cannot be reconstituted (missing / incomplete / no tables)
 * so callers can fail loudly rather than silently fall back to live extraction.
 */
export async function resolveSourceScanMetadata(
  sourceScanId: string,
  ucPath: string,
  runId: string,
  deps?: Partial<SourceRunMetadataDeps>,
): Promise<{ snapshot: MetadataSnapshot; lineageGraph: LineageGraph } | null> {
  const reconstitute: ReconstituteFn =
    deps?.reconstitute ??
    (async (scanId, path) => {
      const { reconstituteMetadataFromScan } = await import("@/lib/pipeline/scan-reconstitution");
      return reconstituteMetadataFromScan(scanId, path);
    });
  const updateSchemaSnapshot: UpdateSchemaSnapshotFn =
    deps?.updateSchemaSnapshot ??
    (async (rid, snap) => {
      const { updateSchemaSnapshot: fn } = await import("@/lib/lakebase/runs");
      return fn(rid, snap);
    });

  const result = await reconstitute(sourceScanId, ucPath);
  if (!result) return null;

  if (deps?.persistSchemaSnapshot ?? true) {
    // Initial-path Ask Forge grounding. Non-fatal on failure so a transient DB
    // error does not sink the whole run.
    try {
      const snap = buildRunSchemaSnapshotFromMetadata(
        result.snapshot.tables,
        result.snapshot.columns,
      );
      await updateSchemaSnapshot(runId, snap);
    } catch (err) {
      logger.warn("[source-run-metadata] schema snapshot persistence failed (non-fatal)", {
        sourceScanId,
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
