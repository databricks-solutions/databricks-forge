/**
 * CRUD operations for environment scans — backed by Lakebase (Prisma).
 *
 * Stores enriched metadata, lineage edges, and LLM-derived insights
 * from environment scan runs.
 */

import { withPrisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { computeDataMaturity } from "@/lib/domain/data-maturity";
import { computeMetadataQualityCoverage } from "@/lib/domain/estate-readiness";
import { mergeInsights } from "@/lib/environment/insight-merge";
import { mergeProgramRelationshipInputs } from "@/lib/environment/relationships";
import {
  portfolioAssetIdentitiesFromInsight,
  type PortfolioAssetKind,
} from "@/lib/lakebase/portfolio-estate";
import { fromStoredLineageEdge, toStoredLineageEntityType } from "@/lib/domain/lineage-entity-type";
import type { MetadataQualityCoverage } from "@/lib/domain/estate-readiness";
import type {
  EnvironmentScan,
  TableDetail,
  TableHistorySummary,
  LineageEdge,
  TableHealthInsight,
  ColumnInfo,
  TableTag,
  ColumnTag,
} from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Types for insight storage
// ---------------------------------------------------------------------------

export interface InsightRecord {
  insightType: string;
  tableFqn: string | null;
  payloadJson: string;
  severity: string;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save a complete environment scan with all related data in a single transaction.
 */
export async function saveEnvironmentScan(
  scan: EnvironmentScan,
  details: TableDetail[],
  histories: Array<TableHistorySummary & TableHealthInsight>,
  lineageEdges: LineageEdge[],
  insights: InsightRecord[],
  columns: ColumnInfo[] = [],
  tableTags: TableTag[] = [],
  columnTags: ColumnTag[] = [],
  ownerEmail: string | null = null,
): Promise<void> {
  // Build a per-table column lookup (lowercase FQN keys for case-insensitive matching)
  const columnsByTable = new Map<
    string,
    Array<{ name: string; type: string; nullable: boolean; comment: string | null }>
  >();
  for (const col of columns) {
    const key = col.tableFqn.toLowerCase();
    if (!columnsByTable.has(key)) columnsByTable.set(key, []);
    columnsByTable.get(key)!.push({
      name: col.columnName,
      type: col.dataType,
      nullable: col.isNullable,
      comment: col.comment,
    });
  }

  const tagsByTable = new Map<string, Array<{ tagName: string; tagValue: string }>>();
  for (const tag of tableTags) {
    const key = tag.tableFqn.toLowerCase();
    const arr = tagsByTable.get(key) ?? [];
    arr.push({ tagName: tag.tagName, tagValue: tag.tagValue });
    tagsByTable.set(key, arr);
  }

  const columnTagsByTable = new Map<
    string,
    Array<{ columnName: string; tagName: string; tagValue: string }>
  >();
  for (const tag of columnTags) {
    const key = tag.tableFqn.toLowerCase();
    const arr = columnTagsByTable.get(key) ?? [];
    arr.push({ columnName: tag.columnName, tagName: tag.tagName, tagValue: tag.tagValue });
    columnTagsByTable.set(key, arr);
  }

  const BATCH_SIZE = 500;

  try {
    await withPrisma(async (prisma) => {
      await prisma.$transaction(
        async (tx) => {
          // 1. Upsert the scan record
          const normalisedOwner = ownerEmail ? ownerEmail.toLowerCase().trim() : null;
          const nowTs = new Date();
          const scanStatus = scan.scanStatus ?? "complete";
          const isTerminal = scanStatus === "complete" || scanStatus === "failed";
          await tx.forgeEnvironmentScan.upsert({
            where: { scanId: scan.scanId },
            create: {
              scanId: scan.scanId,
              runId: scan.runId,
              ucPath: scan.ucPath,
              scanStatus,
              startedAt: nowTs,
              finishedAt: isTerminal ? nowTs : null,
              tableCount: scan.tableCount,
              totalSizeBytes: BigInt(scan.totalSizeBytes),
              totalFiles: scan.totalFiles,
              totalRows: BigInt(scan.totalRows),
              tablesWithStreaming: scan.tablesWithStreaming,
              tablesWithCDF: scan.tablesWithCDF,
              tablesNeedingOptimize: scan.tablesNeedingOptimize,
              tablesNeedingVacuum: scan.tablesNeedingVacuum,
              lineageDiscoveredCount: scan.lineageDiscoveredCount,
              domainCount: scan.domainCount,
              piiTablesCount: scan.piiTablesCount,
              redundancyPairsCount: scan.redundancyPairsCount,
              dataProductCount: scan.dataProductCount,
              avgGovernanceScore: scan.avgGovernanceScore,
              scanDurationMs: scan.scanDurationMs,
              scanSummaryJson: scan.scanSummary ? JSON.stringify(scan.scanSummary) : null,
              passResultsJson: JSON.stringify(scan.passResults),
              genieSpaceCount: scan.genieSpaceCount,
              dashboardCount: scan.dashboardCount,
              metricViewCount: scan.metricViewCount,
              analyticsCoveragePercent: scan.analyticsCoveragePercent,
              excludedScope: scan.excludedScope ?? null,
              exclusionPatterns: scan.exclusionPatterns ?? null,
              inclusionPatterns: scan.inclusionPatterns ?? null,
              workspaceId: scan.workspaceId ?? null,
              teamLabel: scan.teamLabel ?? null,
              ownerEmail: normalisedOwner,
            },
            update: {
              runId: scan.runId,
              ucPath: scan.ucPath,
              scanStatus,
              ...(isTerminal ? { finishedAt: nowTs } : {}),
              excludedScope: scan.excludedScope ?? null,
              exclusionPatterns: scan.exclusionPatterns ?? null,
              inclusionPatterns: scan.inclusionPatterns ?? null,
              workspaceId: scan.workspaceId ?? null,
              teamLabel: scan.teamLabel ?? null,
              tableCount: scan.tableCount,
              totalSizeBytes: BigInt(scan.totalSizeBytes),
              totalFiles: scan.totalFiles,
              totalRows: BigInt(scan.totalRows),
              tablesWithStreaming: scan.tablesWithStreaming,
              tablesWithCDF: scan.tablesWithCDF,
              tablesNeedingOptimize: scan.tablesNeedingOptimize,
              tablesNeedingVacuum: scan.tablesNeedingVacuum,
              lineageDiscoveredCount: scan.lineageDiscoveredCount,
              domainCount: scan.domainCount,
              piiTablesCount: scan.piiTablesCount,
              redundancyPairsCount: scan.redundancyPairsCount,
              dataProductCount: scan.dataProductCount,
              avgGovernanceScore: scan.avgGovernanceScore,
              scanDurationMs: scan.scanDurationMs,
              scanSummaryJson: scan.scanSummary ? JSON.stringify(scan.scanSummary) : null,
              passResultsJson: JSON.stringify(scan.passResults),
              genieSpaceCount: scan.genieSpaceCount,
              dashboardCount: scan.dashboardCount,
              metricViewCount: scan.metricViewCount,
              analyticsCoveragePercent: scan.analyticsCoveragePercent,
            },
          });

          // Build a lookup for the LLM governance score per table. The
          // canonical source is the detail's own governanceScore (filled by
          // the intelligence layer); fall back to the governance_gap insight
          // payloads so the column is correct regardless of scan path. This
          // replaces the historical bug where the rule-based HEALTH score was
          // written into the governance column. See
          // docs/ESTATE_INTELLIGENCE_DESIGN.md bug 1.
          const governanceScoreMap = new Map<string, number>();
          for (const ins of insights) {
            if (ins.insightType !== "governance_gap" || !ins.tableFqn) continue;
            try {
              const payload = JSON.parse(ins.payloadJson) as { overallScore?: number };
              if (typeof payload.overallScore === "number") {
                governanceScoreMap.set(ins.tableFqn, payload.overallScore);
              }
            } catch {
              /* ignore malformed insight payloads */
            }
          }

          // 2. Insert table details (batched)
          for (let i = 0; i < details.length; i += BATCH_SIZE) {
            await tx.forgeTableDetail.createMany({
              data: details.slice(i, i + BATCH_SIZE).map((d) => ({
                scanId: scan.scanId,
                tableFqn: d.fqn,
                catalog: d.catalog,
                schema: d.schema,
                tableName: d.tableName,
                tableType: d.tableType,
                comment: d.comment,
                generatedDescription: d.generatedDescription,
                format: d.format,
                provider: d.provider,
                location: d.location,
                isManaged: d.isManaged,
                owner: d.owner,
                sizeInBytes: d.sizeInBytes != null ? BigInt(d.sizeInBytes) : null,
                numFiles: d.numFiles,
                numRows: d.numRows != null ? BigInt(d.numRows) : null,
                partitionColumns: JSON.stringify(d.partitionColumns),
                clusteringColumns: JSON.stringify(d.clusteringColumns),
                deltaMinReaderVersion: d.deltaMinReaderVersion,
                deltaMinWriterVersion: d.deltaMinWriterVersion,
                cdfEnabled: d.tableProperties["delta.enableChangeDataFeed"] === "true",
                autoOptimize: d.tableProperties["delta.autoOptimize.optimizeWrite"] === "true",
                tableCreatedAt: d.createdAt,
                lastModified: d.lastModified,
                createdBy: d.createdBy,
                lastAccess: d.lastAccess,
                isManagedLocation: d.isManagedLocation,
                columnsJson: JSON.stringify(columnsByTable.get(d.fqn.toLowerCase()) ?? []),
                propertiesJson: JSON.stringify(d.tableProperties),
                tagsJson: JSON.stringify(tagsByTable.get(d.fqn.toLowerCase()) ?? []),
                columnTagsJson: JSON.stringify(columnTagsByTable.get(d.fqn.toLowerCase()) ?? []),
                dataDomain: d.dataDomain,
                dataSubdomain: d.dataSubdomain,
                dataTier: d.dataTier,
                tierReasoning: d.tierReasoning ?? null,
                dataAssetId: d.dataAssetId ?? null,
                dataAssetName: d.dataAssetName ?? null,
                sensitivityLevel: d.sensitivityLevel,
                governancePriority: d.governancePriority,
                governanceScore: d.governanceScore ?? governanceScoreMap.get(d.fqn) ?? null,
                discoveredVia: d.discoveredVia,
              })),
              skipDuplicates: true,
            });
          }

          // 3. Insert history summaries (batched)
          for (let i = 0; i < histories.length; i += BATCH_SIZE) {
            await tx.forgeTableHistorySummary.createMany({
              data: histories.slice(i, i + BATCH_SIZE).map((h) => ({
                scanId: scan.scanId,
                tableFqn: h.tableFqn,
                lastWriteTimestamp: h.lastWriteTimestamp,
                lastWriteOperation: h.lastWriteOperation,
                lastWriteRows: h.lastWriteRows != null ? BigInt(h.lastWriteRows) : null,
                lastWriteBytes: h.lastWriteBytes != null ? BigInt(h.lastWriteBytes) : null,
                totalWriteOps: h.totalWriteOps,
                totalStreamingOps: h.totalStreamingOps,
                totalOptimizeOps: h.totalOptimizeOps,
                totalVacuumOps: h.totalVacuumOps,
                totalMergeOps: h.totalMergeOps,
                lastOptimizeTimestamp: h.lastOptimizeTimestamp,
                lastVacuumTimestamp: h.lastVacuumTimestamp,
                hasStreamingWrites: h.hasStreamingWrites,
                historyDays: h.historyDays,
                topOperationsJson: JSON.stringify(h.topOperations),
                healthScore: h.healthScore,
                issuesJson: JSON.stringify(h.issues),
                recommendationsJson: JSON.stringify(h.recommendations),
              })),
              skipDuplicates: true,
            });
          }

          // 4. Insert lineage edges (batched)
          for (let i = 0; i < lineageEdges.length; i += BATCH_SIZE) {
            await tx.forgeTableLineage.createMany({
              data: lineageEdges.slice(i, i + BATCH_SIZE).map((e) => ({
                scanId: scan.scanId,
                sourceTableFqn: e.sourceTableFqn,
                targetTableFqn: e.targetTableFqn,
                sourceType: e.sourceType,
                targetType: e.targetType,
                entityType: toStoredLineageEntityType(e.entityType),
                lastEventTime: e.lastEventTime,
                eventCount: e.eventCount,
              })),
              skipDuplicates: true,
            });
          }

          // 5. Insert insights (batched)
          for (let i = 0; i < insights.length; i += BATCH_SIZE) {
            await tx.forgeTableInsight.createMany({
              data: insights.slice(i, i + BATCH_SIZE).map((ins) => ({
                scanId: scan.scanId,
                insightType: ins.insightType,
                tableFqn: ins.tableFqn,
                payloadJson: ins.payloadJson,
                severity: ins.severity,
              })),
              skipDuplicates: true,
            });
          }
        },
        {
          maxWait: 10_000,
          timeout: 120_000,
        },
      );
    });

    logger.info("[environment-scans] Saved scan", {
      scanId: scan.scanId,
      tables: details.length,
      histories: histories.length,
      lineageEdges: lineageEdges.length,
      insights: insights.length,
    });
  } catch (error) {
    logger.error("[environment-scans] Failed to save scan", {
      scanId: scan.scanId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Persist Master Repo data-asset classifications back onto the scan's table
 * details so the world model carries them (and estate data-gap can replay
 * without re-classifying). Best-effort per row.
 */
export async function updateDetailDataAssets(
  scanId: string,
  mappings: Array<{ fqn: string; dataAssetId: string; dataAssetName: string }>,
): Promise<void> {
  if (mappings.length === 0) return;
  await withPrisma(async (prisma) => {
    for (const m of mappings) {
      await prisma.forgeTableDetail.updateMany({
        where: { scanId, tableFqn: m.fqn },
        data: { dataAssetId: m.dataAssetId, dataAssetName: m.dataAssetName },
      });
    }
  });
}

/**
 * Mark an existing scan checkpoint as `failed` (outer-catch path). Idempotent
 * and best-effort: matches only a row that is not already `complete`, so a
 * late failure signal can never demote a scan that actually finished.
 */
export async function markScanFailed(scanId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeEnvironmentScan.updateMany({
      where: { scanId, scanStatus: { not: "complete" } },
      data: { scanStatus: "failed", finishedAt: new Date() },
    });
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a single environment scan and all related data.
 * Prisma cascade deletes handle child tables (details, histories, lineage, insights).
 */
export async function deleteEnvironmentScan(scanId: string): Promise<void> {
  // Delete vector embeddings before Prisma cascade deletes source records
  try {
    const { deleteEmbeddingsByScan } = await import("@/lib/embeddings/store");
    await deleteEmbeddingsByScan(scanId);
  } catch (err) {
    logger.warn("[environment-scans] Embedding cleanup failed (non-fatal)", {
      scanId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await withPrisma(async (prisma) => {
    await prisma.forgeEnvironmentScan.delete({
      where: { scanId },
    });
  });
  logger.info("[environment-scans] Deleted scan", { scanId });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get a full environment scan with all related data.
 */
export async function getEnvironmentScan(scanId: string) {
  return withPrisma(async (prisma) => {
    const scan = await prisma.forgeEnvironmentScan.findUnique({
      where: { scanId },
      include: {
        details: true,
        histories: true,
        lineage: true,
        insights: true,
      },
    });
    return scan ? { ...scan, lineage: scan.lineage.map(fromStoredLineageEdge) } : null;
  });
}

/**
 * Get environment scan linked to a pipeline run.
 */
export async function getEnvironmentScanByRunId(runId: string) {
  return withPrisma(async (prisma) => {
    const scan = await prisma.forgeEnvironmentScan.findFirst({
      where: { runId },
      include: {
        details: true,
        histories: true,
        lineage: true,
        insights: true,
      },
      orderBy: [{ createdAt: "desc" }, { scanId: "desc" }],
    });
    return scan ? { ...scan, lineage: scan.lineage.map(fromStoredLineageEdge) } : null;
  });
}

/**
 * Find the best available scan for a run: first by run linkage, then by matching ucPath.
 * Returns just the scanId or null.
 */
export async function getLatestScanIdForRun(
  runId: string,
  ucPath?: string,
): Promise<string | null> {
  return withPrisma(async (prisma) => {
    const linked = await prisma.forgeEnvironmentScan.findFirst({
      where: { runId },
      select: { scanId: true },
      orderBy: { createdAt: "desc" },
    });
    if (linked) return linked.scanId;

    if (ucPath) {
      const byPath = await prisma.forgeEnvironmentScan.findFirst({
        where: { ucPath },
        select: { scanId: true },
        orderBy: { createdAt: "desc" },
      });
      if (byPath) return byPath.scanId;
    }

    return null;
  });
}

/**
 * List recent environment scans (summary only, no related data).
 *
 * When `userEmail` is provided, results include scans the user owns plus
 * those shared with them via the ACL (scan ids in `sharedIds`). When
 * omitted, returns all scans (legacy behaviour, used by background callers).
 */
export async function listEnvironmentScans(
  limit = 20,
  offset = 0,
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
) {
  return withPrisma(async (prisma) => {
    let where: Record<string, unknown> = {};
    if (userEmail) {
      const email = userEmail.toLowerCase().trim();
      if (viewMode === "owned") {
        where = { ownerEmail: email };
      } else if (viewMode === "shared") {
        where = { scanId: { in: sharedIds } };
      } else {
        where = { OR: [{ ownerEmail: email }, { scanId: { in: sharedIds } }] };
      }
    }
    return prisma.forgeEnvironmentScan.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregate Estate View
// ---------------------------------------------------------------------------

export interface AggregateEstateView {
  details: Array<Record<string, unknown>>;
  histories: Array<Record<string, unknown>>;
  lineage: Array<Record<string, unknown>>;
  insights: Array<Record<string, unknown>>;
  stats: {
    totalTables: number;
    totalScans: number;
    totalSizeBytes: string;
    totalRows: string;
    domainCount: number;
    piiTablesCount: number;
    avgGovernanceScore: number;
    oldestScanAt: string | null;
    newestScanAt: string | null;
    /** Deployed estate assets beyond tables (summed across member scans). */
    assetInventory: {
      models: number;
      functions: number;
      genieSpaces: number;
      dashboards: number;
      metricViews: number;
    };
    /** Server-computed data maturity (null when there are no scans). */
    maturity: import("@/lib/domain/data-maturity").DataMaturityScore | null;
    /**
     * Server-computed metadata-quality coverage over the MERGED estate details
     * (uses tagsJson + columnsJson). The single source of truth for the program
     * UI and PDF/Excel exports — no client-side empty-tag placeholder.
     */
    metadataCoverage: MetadataQualityCoverage;
    coverageByScope: Array<{
      ucPath: string;
      scanId: string;
      runId: string | null;
      tableCount: number;
      scannedAt: string;
    }>;
  };
}

type AggregateAssetScan = {
  scanId: string;
  workspaceId: string | null;
  genieSpaceCount: number | null;
  dashboardCount: number | null;
  metricViewCount: number | null;
};

type AggregateAssetInsight = {
  scanId: string;
  insightType: string;
  payloadJson: string;
};

/**
 * Count workspace assets without inflating overlapping scopes or re-scans.
 * Stable identities are de-duplicated within each workspace. Scan counters
 * are only a conservative floor: the largest header per workspace, never a
 * sum. Scans without a workspace ID intentionally share one unknown group.
 */
export function computeAggregateAssetInventory(
  scans: AggregateAssetScan[],
  insights: AggregateAssetInsight[],
): AggregateEstateView["stats"]["assetInventory"] {
  const workspaceForScan = new Map(
    scans.map((scan) => [scan.scanId, scan.workspaceId?.trim() || "__unknown__"]),
  );
  const groups = new Map<
    string,
    {
      headers: { genie_space: number; dashboard: number; metric_view: number };
      identities: Map<PortfolioAssetKind, Set<string>>;
    }
  >();
  const group = (key: string) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created = {
      headers: { genie_space: 0, dashboard: 0, metric_view: 0 },
      identities: new Map<PortfolioAssetKind, Set<string>>(),
    };
    groups.set(key, created);
    return created;
  };

  for (const scan of scans) {
    const current = group(workspaceForScan.get(scan.scanId) ?? "__unknown__");
    current.headers.genie_space = Math.max(current.headers.genie_space, scan.genieSpaceCount ?? 0);
    current.headers.dashboard = Math.max(current.headers.dashboard, scan.dashboardCount ?? 0);
    current.headers.metric_view = Math.max(current.headers.metric_view, scan.metricViewCount ?? 0);
  }
  for (const insight of insights) {
    const current = group(workspaceForScan.get(insight.scanId) ?? "__unknown__");
    for (const asset of portfolioAssetIdentitiesFromInsight(
      insight.scanId,
      insight.insightType,
      insight.payloadJson,
    )) {
      const identities = current.identities.get(asset.kind) ?? new Set<string>();
      identities.add(asset.identity);
      current.identities.set(asset.kind, identities);
    }
  }

  const count = (kind: PortfolioAssetKind): number =>
    [...groups.values()].reduce((total, current) => {
      const identityCount = current.identities.get(kind)?.size ?? 0;
      const headerCount =
        kind === "genie_space" || kind === "dashboard" || kind === "metric_view"
          ? current.headers[kind]
          : 0;
      return total + Math.max(identityCount, headerCount);
    }, 0);

  return {
    models: count("model"),
    functions: count("function"),
    genieSpaces: count("genie_space"),
    dashboards: count("dashboard"),
    metricViews: count("metric_view"),
  };
}

/**
 * Build an aggregate estate view by merging the latest data per table
 * across all environment scans (pipeline runs + standalone).
 *
 * Strategy: for each unique tableFqn, keep the record from the most
 * recent scan (by createdAt). Same for histories, lineage edges, and insights.
 */
const _aggregateCache = new Map<string, { data: AggregateEstateView; ts: number }>();
const AGGREGATE_CACHE_TTL_MS = 30_000;

/**
 * Invalidate the aggregate-estate cache. Call after a scan is attached to or
 * detached from a program so the program-scoped view refreshes immediately
 * rather than waiting out the 30s TTL. With no argument, clears everything.
 */
export function clearAggregateEstateCache(programId?: string | null): void {
  if (programId === undefined) {
    _aggregateCache.clear();
    return;
  }
  _aggregateCache.delete(programId ?? "__all__");
  // The global ("__all__") view also reflects program member scans.
  _aggregateCache.delete("__all__");
}

/**
 * Build an aggregate estate view. When `programId` is provided the merge is
 * scoped to that program's member scans (company-level estate); otherwise it
 * spans every scan (legacy global behaviour). Results are cached for 30s,
 * keyed by program scope.
 */
export async function getAggregateEstateView(
  programId?: string | null,
): Promise<AggregateEstateView> {
  const cacheKey = programId ?? "__all__";
  const cached = _aggregateCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < AGGREGATE_CACHE_TTL_MS) {
    return cached.data;
  }
  const result = await _getAggregateEstateViewUncached(programId ?? null);
  _aggregateCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

/**
 * Fetch the winning insight row IDs for a scoped set of scans, using the
 * type-aware semantic merge (see lib/environment/insight-merge.ts) instead of a
 * brittle SQL DISTINCT ON. Returns the IDs to hydrate with a typed findMany.
 */
async function _mergedInsightIds(
  prisma: Prisma.TransactionClient | PrismaClientLike,
  programFilter: Prisma.Sql,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      insight_type: string;
      table_fqn: string | null;
      payload_json: string;
      program_id: string | null;
      scan_id: string;
      created_at: Date;
    }>
  >`
    SELECT i.id, i.insight_type, i.table_fqn, i.payload_json,
           s.program_id, s.scan_id, s.created_at
    FROM forge_table_insights i
    JOIN forge_environment_scans s ON s.scan_id = i.scan_id
    ${programFilter}`;
  const winners = mergeInsights(
    rows.map((r) => ({
      id: r.id,
      insightType: r.insight_type,
      tableFqn: r.table_fqn,
      payloadJson: r.payload_json,
      estateId: r.program_id ?? `scan:${r.scan_id}`,
      scanCreatedAt: new Date(r.created_at).getTime(),
    })),
  );
  return winners.map((w) => w.id);
}

type PrismaClientLike = {
  $queryRaw: <T>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<T>;
};

async function _getAggregateEstateViewUncached(
  programId: string | null,
): Promise<AggregateEstateView> {
  return withPrisma(async (prisma) => {
    // Only fully-saved (`complete`) scans count toward the estate roll-up;
    // in-progress (`running`) or crashed (`failed`) checkpoints are excluded.
    const scans = await prisma.forgeEnvironmentScan.findMany({
      where: programId ? { programId, scanStatus: "complete" } : { scanStatus: "complete" },
      orderBy: [{ createdAt: "desc" }, { scanId: "desc" }],
      select: {
        scanId: true,
        runId: true,
        ucPath: true,
        tableCount: true,
        createdAt: true,
        workspaceId: true,
        genieSpaceCount: true,
        dashboardCount: true,
        metricViewCount: true,
        lineageDiscoveredCount: true,
      },
    });

    if (scans.length === 0) {
      return {
        details: [],
        histories: [],
        lineage: [],
        insights: [],
        stats: {
          totalTables: 0,
          totalScans: 0,
          totalSizeBytes: "0",
          totalRows: "0",
          domainCount: 0,
          piiTablesCount: 0,
          avgGovernanceScore: 0,
          oldestScanAt: null,
          newestScanAt: null,
          assetInventory: {
            models: 0,
            functions: 0,
            genieSpaces: 0,
            dashboards: 0,
            metricViews: 0,
          },
          maturity: null,
          metadataCoverage: {
            tableCount: 0,
            tablesWithCommentPct: 0,
            columnsWithCommentPct: 0,
            tablesWithTagsPct: 0,
            tablesWithOwnerPct: 0,
            tablesWithTierPct: 0,
            tablesWithDomainPct: 0,
          },
          coverageByScope: [],
        },
      };
    }

    // DB-side dedup: DISTINCT ON picks the latest row per dedup key
    // (ordered by scan created_at DESC), returning only IDs.
    // Then Prisma findMany fetches the full typed rows by those IDs.
    // When scoped to a program, the JOIN is constrained to member scans.
    // Always exclude non-`complete` scans so partial/failed checkpoints don't
    // leak table details into the merged world model.
    const programFilter = programId
      ? Prisma.sql`WHERE s.program_id = ${programId} AND s.scan_status = 'complete'`
      : Prisma.sql`WHERE s.scan_status = 'complete'`;
    const [detailIds, historyIds, lineageIds, insightIds] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT ON (d.table_fqn) d.id
      FROM forge_table_details d
      JOIN forge_environment_scans s ON s.scan_id = d.scan_id
      ${programFilter}
      ORDER BY d.table_fqn, s.created_at DESC, s.scan_id DESC, d.id DESC`,
      prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT ON (h.table_fqn) h.id
      FROM forge_table_history_summaries h
      JOIN forge_environment_scans s ON s.scan_id = h.scan_id
      ${programFilter}
      ORDER BY h.table_fqn, s.created_at DESC, s.scan_id DESC, h.id DESC`,
      prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT ON (l.source_table_fqn, l.target_table_fqn) l.id
      FROM forge_table_lineage l
      JOIN forge_environment_scans s ON s.scan_id = l.scan_id
      ${programFilter}
      ORDER BY l.source_table_fqn, l.target_table_fqn, s.created_at DESC, s.scan_id DESC, l.id DESC`,
      // Insights use the type-aware semantic merge (JS) instead of a SQL
      // DISTINCT ON: ontology types (canonical_entity, business_glossary_term)
      // de-dup by normalized name + estate scope so a changed payload replaces
      // the stale one; multi-valued findings (PII, relationships) all survive;
      // table-singleton types keep latest-per-table. See insight-merge.ts.
      _mergedInsightIds(prisma, programFilter).then((ids) => ids.map((id) => ({ id }))),
    ]);

    const [mergedDetails, mergedHistories, mergedLineage, mergedInsights] = await Promise.all([
      detailIds.length > 0
        ? prisma.forgeTableDetail.findMany({
            where: { id: { in: detailIds.map((r) => r.id) } },
          })
        : Promise.resolve([]),
      historyIds.length > 0
        ? prisma.forgeTableHistorySummary.findMany({
            where: { id: { in: historyIds.map((r) => r.id) } },
          })
        : Promise.resolve([]),
      lineageIds.length > 0
        ? prisma.forgeTableLineage.findMany({
            where: { id: { in: lineageIds.map((r) => r.id) } },
          })
        : Promise.resolve([]),
      insightIds.length > 0
        ? prisma.forgeTableInsight.findMany({
            where: { id: { in: insightIds.map((r) => r.id) } },
          })
        : Promise.resolve([]),
    ]);

    // Compute aggregate stats
    const domains = new Set(mergedDetails.map((d) => d.dataDomain).filter(Boolean));
    const piiCount = mergedDetails.filter(
      (d) => d.sensitivityLevel === "confidential" || d.sensitivityLevel === "restricted",
    ).length;
    const govScores = mergedDetails
      .filter((d) => d.governanceScore != null)
      .map((d) => d.governanceScore!);
    const avgGov =
      govScores.length > 0 ? govScores.reduce((a, b) => a + b, 0) / govScores.length : 0;
    const totalSize = mergedDetails.reduce(
      (sum, d) => sum + (d.sizeInBytes ?? BigInt(0)),
      BigInt(0),
    );
    const totalRows = mergedDetails.reduce((sum, d) => sum + (d.numRows ?? BigInt(0)), BigInt(0));

    // Coverage: which scans contributed
    const coverageByScope = scans.map((s) => ({
      ucPath: s.ucPath,
      scanId: s.scanId,
      runId: s.runId,
      tableCount: s.tableCount,
      scannedAt: s.createdAt.toISOString(),
    }));

    const assetInventory = computeAggregateAssetInventory(scans, mergedInsights);

    // Data maturity computed server-side from the FULL merged world model
    // (details + histories + lineage + insights) -- replaces the client-side
    // version that was fed hardcoded zeros for tags/lineage/ops/health.
    const hasTags = (json: string | null): boolean => {
      if (!json) return false;
      try {
        const arr = JSON.parse(json);
        return Array.isArray(arr) && arr.length > 0;
      } catch {
        return false;
      }
    };
    const healthScores = mergedHistories
      .filter((h) => h.healthScore != null)
      .map((h) => h.healthScore!);
    const tablesNeedingOptimize = mergedHistories.filter((h) => {
      try {
        const issues = h.issuesJson ? (JSON.parse(h.issuesJson) as string[]) : [];
        return issues.some((i) => i.includes("OPTIMIZE"));
      } catch {
        return false;
      }
    }).length;
    const tablesNeedingVacuum = mergedHistories.filter((h) => {
      try {
        const issues = h.issuesJson ? (JSON.parse(h.issuesJson) as string[]) : [];
        return issues.some((i) => i.includes("VACUUM"));
      } catch {
        return false;
      }
    }).length;
    const maturity = computeDataMaturity({
      tableCount: mergedDetails.length,
      avgGovernanceScore: avgGov,
      piiTablesCount: piiCount,
      tablesWithDescription: mergedDetails.filter((d) => d.comment || d.generatedDescription)
        .length,
      tablesWithTags: mergedDetails.filter((d) => hasTags(d.tagsJson)).length,
      tablesWithOwner: mergedDetails.filter((d) => d.owner).length,
      tablesWithTier: mergedDetails.filter((d) => d.dataTier).length,
      tierCount: new Set(mergedDetails.map((d) => d.dataTier).filter(Boolean)).size,
      redundancyPairsCount: mergedInsights.filter((i) => i.insightType === "redundancy").length,
      dataProductCount: mergedInsights.filter((i) => i.insightType === "data_product").length,
      lineageEdgeCount: mergedLineage.length,
      lineageDiscoveredCount: scans.reduce((s, x) => s + (x.lineageDiscoveredCount ?? 0), 0),
      domainCount: domains.size,
      tablesNeedingOptimize,
      tablesNeedingVacuum,
      tablesWithStreaming: mergedHistories.filter((h) => h.hasStreamingWrites).length,
      tablesWithCDF: mergedDetails.filter((d) => d.cdfEnabled).length,
      avgHealthScore:
        healthScores.length > 0 ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length : 0,
      tablesWithAutoOptimize: mergedDetails.filter((d) => d.autoOptimize).length,
      tablesWithLiquidClustering: mergedDetails.filter((d) => {
        try {
          const cc = d.clusteringColumns ? (JSON.parse(d.clusteringColumns) as string[]) : [];
          return Array.isArray(cc) && cc.length > 0;
        } catch {
          return false;
        }
      }).length,
    });

    // Metadata-quality coverage over the merged details — server-computed from
    // tagsJson + columnsJson so the program UI and exports consume one value
    // (no client-side empty-tag placeholder).
    const tagsByFqn = new Map(mergedDetails.map((d) => [d.tableFqn, d.tagsJson]));
    const columnsByFqn = new Map(mergedDetails.map((d) => [d.tableFqn, d.columnsJson]));
    const metadataCoverage = computeMetadataQualityCoverage(
      mergedDetails.map((d) => ({
        fqn: d.tableFqn,
        comment: d.comment,
        generatedDescription: d.generatedDescription,
        owner: d.owner,
        dataTier: d.dataTier as import("@/lib/domain/types").TableDetail["dataTier"],
        dataDomain: d.dataDomain,
      })),
      {
        hasTags: (fqn) => hasTags(tagsByFqn.get(fqn) ?? null),
        columnsByFqn: (fqn) => columnsByFqn.get(fqn) ?? null,
      },
    );

    // Serialize BigInts for JSON
    const serializeDetail = (d: (typeof mergedDetails)[number]) => {
      const { sizeInBytes, numRows, ...rest } = d;
      return {
        ...rest,
        sizeInBytes: sizeInBytes?.toString() ?? null,
        numRows: numRows?.toString() ?? null,
      };
    };
    const serializeHistory = (h: (typeof mergedHistories)[number]) => {
      const { lastWriteRows, lastWriteBytes, ...rest } = h;
      return {
        ...rest,
        lastWriteRows: lastWriteRows?.toString() ?? null,
        lastWriteBytes: lastWriteBytes?.toString() ?? null,
      };
    };

    return {
      details: mergedDetails.map(serializeDetail),
      histories: mergedHistories.map(serializeHistory),
      lineage: mergedLineage.map(fromStoredLineageEdge),
      insights: mergedInsights,
      stats: {
        totalTables: mergedDetails.length,
        totalScans: scans.length,
        totalSizeBytes: totalSize.toString(),
        totalRows: totalRows.toString(),
        domainCount: domains.size,
        piiTablesCount: piiCount,
        avgGovernanceScore: avgGov,
        oldestScanAt: scans.length > 0 ? scans[scans.length - 1].createdAt.toISOString() : null,
        newestScanAt: scans.length > 0 ? scans[0].createdAt.toISOString() : null,
        assetInventory,
        maturity,
        metadataCoverage,
        coverageByScope,
      },
    };
  });
}

/**
 * Fetch deterministic inputs for the program-aware Relationships graph across
 * ALL completed member scans. Table domains select latest scan per FQN;
 * canonical entities use semantic latest-by-name merge; repeated relationship
 * payloads collapse. Failed/in-progress scans are excluded (Task 4 invariant).
 * Graph derivation happens in `buildRelationshipGraph`.
 */
export async function getProgramRelationshipInputs(programId: string): Promise<{
  lineage: Array<{ sourceTableFqn: string; targetTableFqn: string; eventCount: number | null }>;
  details: Array<{ tableFqn: string; dataDomain: string | null }>;
  canonicalEntities: Array<{ payloadJson: string }>;
  entityRelationships: Array<{ payloadJson: string }>;
}> {
  return withPrisma(async (prisma) => {
    const scans = await prisma.forgeEnvironmentScan.findMany({
      where: { programId, scanStatus: "complete" },
      select: { scanId: true, createdAt: true },
    });
    const scanIds = scans.map((s) => s.scanId);
    if (scanIds.length === 0) {
      return { lineage: [], details: [], canonicalEntities: [], entityRelationships: [] };
    }
    const [lineage, details, canonicalEntities, entityRelationships] = await Promise.all([
      prisma.forgeTableLineage.findMany({
        where: { scanId: { in: scanIds } },
        select: { sourceTableFqn: true, targetTableFqn: true, eventCount: true },
      }),
      prisma.forgeTableDetail.findMany({
        where: { scanId: { in: scanIds } },
        select: { id: true, scanId: true, tableFqn: true, dataDomain: true },
      }),
      prisma.forgeTableInsight.findMany({
        where: { scanId: { in: scanIds }, insightType: "canonical_entity" },
        select: { id: true, scanId: true, payloadJson: true },
      }),
      prisma.forgeTableInsight.findMany({
        where: { scanId: { in: scanIds }, insightType: "entity_relationship" },
        select: { id: true, scanId: true, payloadJson: true },
      }),
    ]);
    const scanTime = new Map(scans.map((scan) => [scan.scanId, scan.createdAt.getTime()]));
    const merged = mergeProgramRelationshipInputs(programId, [
      ...details.map((detail) => ({
        kind: "detail" as const,
        id: detail.id,
        scanId: detail.scanId,
        scanCreatedAt: scanTime.get(detail.scanId) ?? 0,
        tableFqn: detail.tableFqn,
        dataDomain: detail.dataDomain,
        payloadJson: null,
      })),
      ...canonicalEntities.map((insight) => ({
        kind: "canonical_entity" as const,
        id: insight.id,
        scanId: insight.scanId,
        scanCreatedAt: scanTime.get(insight.scanId) ?? 0,
        tableFqn: null,
        dataDomain: null,
        payloadJson: insight.payloadJson,
      })),
      ...entityRelationships.map((insight) => ({
        kind: "entity_relationship" as const,
        id: insight.id,
        scanId: insight.scanId,
        scanCreatedAt: scanTime.get(insight.scanId) ?? 0,
        tableFqn: null,
        dataDomain: null,
        payloadJson: insight.payloadJson,
      })),
    ]);
    return { lineage, ...merged };
  });
}

/**
 * Get insights for a scan, optionally filtered by type.
 */
export async function getInsightsByScanId(scanId: string, insightType?: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeTableInsight.findMany({
      where: {
        scanId,
        ...(insightType ? { insightType } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { scanId: "desc" }],
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregate Estate — Excel-ready (preserves bigints for the Excel generator)
// ---------------------------------------------------------------------------

import type { ScanWithRelations } from "@/lib/export/environment-excel";

/**
 * Build an aggregate estate view suitable for the Excel export generator.
 *
 * Same merge logic as `getAggregateEstateView()` but returns data in the
 * `ScanWithRelations` shape with bigints intact (no JSON serialisation).
 * Returns null when no scans exist.
 */
export async function getAggregateForExcel(
  programId?: string | null,
): Promise<ScanWithRelations | null> {
  return withPrisma(async (prisma) => {
    const scans = await prisma.forgeEnvironmentScan.findMany({
      where: programId ? { programId, scanStatus: "complete" } : { scanStatus: "complete" },
      orderBy: { createdAt: "desc" },
    });

    if (scans.length === 0) return null;

    const programFilter = programId
      ? Prisma.sql`WHERE s.program_id = ${programId} AND s.scan_status = 'complete'`
      : Prisma.sql`WHERE s.scan_status = 'complete'`;

    // DB-side dedup via DISTINCT ON, then fetch full rows by ID
    const [detailIds, historyIds, lineageIds, insightIds] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT ON (d.table_fqn) d.id
        FROM forge_table_details d
        JOIN forge_environment_scans s ON s.scan_id = d.scan_id
        ${programFilter}
        ORDER BY d.table_fqn, s.created_at DESC, s.scan_id DESC, d.id DESC`,
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT ON (h.table_fqn) h.id
        FROM forge_table_history_summaries h
        JOIN forge_environment_scans s ON s.scan_id = h.scan_id
        ${programFilter}
        ORDER BY h.table_fqn, s.created_at DESC, s.scan_id DESC, h.id DESC`,
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT ON (l.source_table_fqn, l.target_table_fqn) l.id
        FROM forge_table_lineage l
        JOIN forge_environment_scans s ON s.scan_id = l.scan_id
        ${programFilter}
        ORDER BY l.source_table_fqn, l.target_table_fqn, s.created_at DESC, s.scan_id DESC, l.id DESC`,
      _mergedInsightIds(prisma, programFilter).then((ids) => ids.map((id) => ({ id }))),
    ]);

    const [details, histories, lineage, insights] = await Promise.all([
      detailIds.length > 0
        ? prisma.forgeTableDetail.findMany({
            where: { id: { in: detailIds.map((r) => r.id) } },
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof prisma.forgeTableDetail.findMany>>),
      historyIds.length > 0
        ? prisma.forgeTableHistorySummary.findMany({
            where: { id: { in: historyIds.map((r) => r.id) } },
          })
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof prisma.forgeTableHistorySummary.findMany>>,
          ),
      lineageIds.length > 0
        ? prisma.forgeTableLineage.findMany({
            where: { id: { in: lineageIds.map((r) => r.id) } },
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof prisma.forgeTableLineage.findMany>>),
      insightIds.length > 0
        ? prisma.forgeTableInsight.findMany({
            where: { id: { in: insightIds.map((r) => r.id) } },
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof prisma.forgeTableInsight.findMany>>),
    ]);

    // --- Aggregate scan-level stats ---
    const domains = new Set(details.map((d) => d.dataDomain).filter(Boolean));
    const piiCount = details.filter(
      (d) => d.sensitivityLevel === "confidential" || d.sensitivityLevel === "restricted",
    ).length;
    const govScores = details
      .filter((d) => d.governanceScore != null)
      .map((d) => d.governanceScore!);
    const avgGov =
      govScores.length > 0 ? govScores.reduce((a, b) => a + b, 0) / govScores.length : 0;
    const totalSize = details.reduce((sum, d) => sum + (d.sizeInBytes ?? BigInt(0)), BigInt(0));
    const totalFiles = details.reduce((sum, d) => sum + (d.numFiles ?? 0), 0);
    const redundancyCount = insights.filter((i) => i.insightType === "redundancy").length;
    const dataProductCount = insights.filter((i) => i.insightType === "data_product").length;
    const lineageDiscovered = details.filter((d) => d.discoveredVia === "lineage").length;
    const streamingCount = histories.filter((h) => h.hasStreamingWrites).length;
    const cdfCount = details.filter((d) => d.cdfEnabled).length;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const needsOptimize = histories.filter(
      (h) => !h.lastOptimizeTimestamp || h.lastOptimizeTimestamp < thirtyDaysAgo,
    ).length;
    const needsVacuum = histories.filter(
      (h) => !h.lastVacuumTimestamp || h.lastVacuumTimestamp < thirtyDaysAgo,
    ).length;

    const ucPaths = [...new Set(scans.map((s) => s.ucPath))].join(", ");

    return {
      scanId: "aggregate",
      ucPath: ucPaths || "All Scans (Aggregate)",
      tableCount: details.length,
      totalSizeBytes: totalSize,
      totalFiles,
      tablesWithStreaming: streamingCount,
      tablesWithCDF: cdfCount,
      tablesNeedingOptimize: needsOptimize,
      tablesNeedingVacuum: needsVacuum,
      lineageDiscoveredCount: lineageDiscovered,
      domainCount: domains.size,
      piiTablesCount: piiCount,
      redundancyPairsCount: redundancyCount,
      dataProductCount,
      avgGovernanceScore: avgGov,
      scanDurationMs: null,
      passResultsJson: null,
      createdAt: scans[0].createdAt,
      details,
      histories,
      lineage: lineage.map(fromStoredLineageEdge),
      insights,
    };
  });
}
