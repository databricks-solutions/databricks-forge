/**
 * Metadata Fetcher -- single entry point for enriched UC metadata.
 *
 * Orchestrates calls to existing query modules (metadata, metadata-detail,
 * lineage) and returns raw enriched data ready for deterministic analysis
 * and LLM classification.
 *
 * @module metadata/fetcher
 */

import {
  listTables,
  listColumns,
  listForeignKeys,
  fetchTableComments,
  mergeTableComments,
  fetchTableTypes,
  mergeTableTypes,
  filterAccessibleScopes,
} from "@/lib/queries/metadata";
import { enrichTablesInBatches, getTableTags } from "@/lib/queries/metadata-detail";
import { walkLineage } from "@/lib/queries/lineage";
import { logger } from "@/lib/logger";
import { globMatch } from "@/lib/domain/scope-selection";
import type {
  TableInfo,
  ColumnInfo,
  ForeignKey,
  TableDetail,
  TableHistorySummary,
} from "@/lib/domain/types";
import type { MetadataScope, MetadataFetchCounters } from "./types";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface FetchedMetadata {
  tables: TableInfo[];
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
  /** Table FQN -> existing comment from information_schema. */
  tableComments: Map<string, string>;
  /** Table FQN -> TableDetail from DESCRIBE DETAIL (may be partial). */
  tableDetails: Map<string, TableDetail>;
  /** Table FQN -> history summary from DESCRIBE HISTORY. */
  tableHistory: Map<string, TableHistorySummary>;
  /** Table FQN -> tag names. */
  tableTags: Map<string, string[]>;
  /** Lineage edges (may be empty if system tables unavailable). */
  lineageEdges: Array<{ sourceTableFqn: string; targetTableFqn: string }>;
}

export interface FetchOptions {
  includeLineage?: boolean;
  includeHistory?: boolean;
  lineageDepth?: number;
  /**
   * Lineage walk direction. Defaults to "upstream" so a schema's data sources
   * are discovered without fanning out across every downstream consumer.
   */
  lineageDirection?: "upstream" | "both" | "downstream";
  signal?: AbortSignal;
  onProgress?: (phase: string, pct: number, detail?: string) => void;
  onCounters?: (counters: MetadataFetchCounters) => void;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function fetchEnrichedMetadata(
  scope: MetadataScope,
  options: FetchOptions = {},
): Promise<FetchedMetadata> {
  const {
    includeLineage = true,
    includeHistory = true,
    lineageDepth = 3,
    lineageDirection = "upstream",
    signal,
    onProgress,
    onCounters,
  } = options;

  onProgress?.("metadata-fetch", 0, "Probing access permissions...");

  // Build scopes array from catalogs + optional schemas
  const rawScopes = scope.catalogs.flatMap((catalog) => {
    if (scope.schemas && scope.schemas.length > 0) {
      return scope.schemas.map((schema) => ({ catalog, schema }));
    }
    return [{ catalog }];
  });

  // Filter inaccessible scopes
  const { accessible: accessibleScopes, skipped } = await filterAccessibleScopes(rawScopes);
  if (skipped.length > 0) {
    logger.info("[metadata-fetcher] Skipped inaccessible scopes", {
      skipped: skipped.map((s) => s.label),
    });
  }

  if (accessibleScopes.length === 0) {
    logger.warn("[metadata-fetcher] No accessible scopes");
    return emptyResult();
  }

  if (signal?.aborted) throw new Error("Cancelled");

  // --- Phase 1: Basic metadata (tables, columns, comments, types, FKs, tags) ---
  onProgress?.("metadata-fetch", 10, `Scanning ${accessibleScopes.length} scope(s)...`);

  const allTables: TableInfo[] = [];
  const allColumns: ColumnInfo[] = [];
  const allForeignKeys: ForeignKey[] = [];
  const allTableComments = new Map<string, string>();
  const allTableTags = new Map<string, string[]>();

  for (const scopeEntry of accessibleScopes) {
    if (signal?.aborted) throw new Error("Cancelled");
    const scopeLabel = `${scopeEntry.catalog}${scopeEntry.schema ? "." + scopeEntry.schema : ""}`;

    try {
      const [tables, comments, typeData, columns, fks] = await Promise.all([
        listTables(scopeEntry.catalog, scopeEntry.schema),
        fetchTableComments(scopeEntry.catalog, scopeEntry.schema),
        fetchTableTypes(scopeEntry.catalog, scopeEntry.schema),
        listColumns(scopeEntry.catalog, scopeEntry.schema),
        listForeignKeys(scopeEntry.catalog, scopeEntry.schema),
      ]);

      mergeTableComments(tables, comments);
      mergeTableTypes(tables, typeData);
      allTables.push(...tables);
      allColumns.push(...columns);
      allForeignKeys.push(...fks);

      for (const [fqn, comment] of comments) {
        allTableComments.set(fqn, comment);
      }

      // Fetch tags (non-blocking)
      try {
        const tags = await getTableTags(scopeEntry.catalog, scopeEntry.schema);
        for (const tag of tags) {
          const existing = allTableTags.get(tag.tableFqn) ?? [];
          existing.push(`${tag.tagName}=${tag.tagValue}`);
          allTableTags.set(tag.tableFqn, existing);
        }
      } catch {
        logger.debug("[metadata-fetcher] Tags unavailable", { scope: scopeLabel });
      }

      onProgress?.(
        "metadata-fetch",
        30,
        `${scopeLabel}: ${tables.length} tables, ${columns.length} columns`,
      );
      onCounters?.({ tablesFound: allTables.length, columnsFound: allColumns.length });
    } catch (err) {
      logger.warn("[metadata-fetcher] Scope failed, skipping", {
        scope: scopeLabel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (allTables.length === 0) {
    logger.warn("[metadata-fetcher] No tables found across accessible scopes");
    return emptyResult();
  }

  // Filter to specific tables if requested
  let targetTables = allTables;
  if (scope.tables && scope.tables.length > 0) {
    const lowerSet = new Set(scope.tables.map((t) => t.toLowerCase()));
    targetTables = allTables.filter((t) => lowerSet.has(t.fqn.toLowerCase()));
  }

  // Apply explicit schema exclusions
  if (scope.excludedSchemas && scope.excludedSchemas.length > 0) {
    const excludeSet = new Set(scope.excludedSchemas.map((s) => s.toLowerCase()));
    const before = targetTables.length;
    targetTables = targetTables.filter((t) => {
      const parts = t.fqn.split(".");
      const schemaPath = `${parts[0]}.${parts[1]}`.toLowerCase();
      return !excludeSet.has(schemaPath);
    });
    if (targetTables.length < before) {
      logger.info("[metadata-fetcher] Applied schema exclusions", {
        excluded: scope.excludedSchemas,
        removedCount: before - targetTables.length,
      });
    }
  }

  // Apply explicit table exclusions
  if (scope.excludedTables && scope.excludedTables.length > 0) {
    const excludeSet = new Set(scope.excludedTables.map((t) => t.toLowerCase()));
    const before = targetTables.length;
    targetTables = targetTables.filter((t) => !excludeSet.has(t.fqn.toLowerCase()));
    if (targetTables.length < before) {
      logger.info("[metadata-fetcher] Applied table exclusions", {
        excluded: scope.excludedTables,
        removedCount: before - targetTables.length,
      });
    }
  }

  // Apply glob pattern exclusions (match against each segment name)
  if (scope.exclusionPatterns && scope.exclusionPatterns.length > 0) {
    const before = targetTables.length;
    targetTables = targetTables.filter((t) => {
      const [cat, sch, tbl] = t.fqn.split(".");
      return !scope.exclusionPatterns!.some(
        (p) => globMatch(p, cat) || globMatch(p, sch) || (tbl && globMatch(p, tbl)),
      );
    });
    if (targetTables.length < before) {
      logger.info("[metadata-fetcher] Applied pattern exclusions", {
        patterns: scope.exclusionPatterns,
        removedCount: before - targetTables.length,
      });
    }
  }

  if (signal?.aborted) throw new Error("Cancelled");

  // --- Phase 2: Lineage (graceful) ---
  let lineageEdges: Array<{ sourceTableFqn: string; targetTableFqn: string }> = [];

  if (includeLineage) {
    onProgress?.("metadata-fetch", 50, "Walking lineage...");
    try {
      const seedFqns = targetTables.map((t) => t.fqn);
      const graph = await walkLineage(seedFqns, {
        maxDepth: lineageDepth,
        direction: lineageDirection,
      });
      lineageEdges = graph.edges.map((e) => ({
        sourceTableFqn: e.sourceTableFqn,
        targetTableFqn: e.targetTableFqn,
      }));
      onProgress?.("metadata-fetch", 60, `Lineage: ${lineageEdges.length} edges`);
      onCounters?.({ lineageEdgesFound: lineageEdges.length });
    } catch (err) {
      logger.warn("[metadata-fetcher] Lineage unavailable, continuing without", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (signal?.aborted) throw new Error("Cancelled");

  // --- Phase 3: Table detail + history (graceful) ---
  const tableDetails = new Map<string, TableDetail>();
  const tableHistory = new Map<string, TableHistorySummary>();

  if (includeHistory) {
    onProgress?.("metadata-fetch", 70, "Fetching table details and history...");
    try {
      const enrichInput = targetTables.map((t) => ({
        fqn: t.fqn,
        discoveredVia: "selected" as const,
        tableType: t.tableType,
        dataSourceFormat: t.dataSourceFormat ?? undefined,
      }));

      const enriched = await enrichTablesInBatches(enrichInput, 5, (completed, total) => {
        const pct = 70 + Math.round((completed / total) * 25);
        onProgress?.("metadata-fetch", pct, `Enriching ${completed}/${total} tables`);
        onCounters?.({ enrichedCount: completed, enrichTotal: total });
      });

      for (const [fqn, result] of enriched) {
        if (result.detail) tableDetails.set(fqn, result.detail);
        if (result.history) tableHistory.set(fqn, result.history);
      }
    } catch (err) {
      logger.warn("[metadata-fetcher] History enrichment failed, continuing without", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onProgress?.("metadata-fetch", 100, `${targetTables.length} tables enriched`);

  return {
    tables: targetTables,
    columns: allColumns,
    foreignKeys: allForeignKeys,
    tableComments: allTableComments,
    tableDetails,
    tableHistory,
    tableTags: allTableTags,
    lineageEdges,
  };
}

function emptyResult(): FetchedMetadata {
  return {
    tables: [],
    columns: [],
    foreignKeys: [],
    tableComments: new Map(),
    tableDetails: new Map(),
    tableHistory: new Map(),
    tableTags: new Map(),
    lineageEdges: [],
  };
}
