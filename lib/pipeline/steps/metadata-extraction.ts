/**
 * Pipeline Step 2: Metadata Extraction
 *
 * Queries Unity Catalog information_schema for catalogs, schemas, tables,
 * columns, and foreign keys. Builds a MetadataSnapshot.
 *
 * After basic extraction, runs an enrichment pass:
 *   1. Lineage walk (BFS via system.access.table_lineage)
 *   2. DESCRIBE DETAIL + DESCRIBE HISTORY + SHOW TBLPROPERTIES
 *   3. Tags (table + column)
 *   4. Rule-based health scoring
 *   5. LLM intelligence layer (domains, PII, descriptions, etc.)
 *   6. Save to Lakebase as EnvironmentScan
 */

import {
  listTables,
  listColumns,
  listForeignKeys,
  listMetricViews,
  fetchTableComments,
  mergeTableComments,
  fetchTableTypes,
  mergeTableTypes,
  fetchTableInfoBatch,
  fetchColumnsBatch,
  fetchForeignKeysBatch,
  filterAccessibleScopes,
} from "@/lib/queries/metadata";
import { enrichTablesInBatches, getTableTags, getColumnTags } from "@/lib/queries/metadata-detail";
import { walkLineage } from "@/lib/queries/lineage";
import { runIntelligenceLayer, buildTableInputs } from "@/lib/ai/environment-intelligence";
import { computeAllTableHealth } from "@/lib/domain/health-score";
import { saveEnvironmentScan, type InsightRecord } from "@/lib/lakebase/environment-scans";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger as fallbackLogger } from "@/lib/logger";
import { parseExcludedString, parsePatternsString, globMatch } from "@/lib/domain/scope-selection";
import { DEFAULT_DEPTH_CONFIGS } from "@/lib/domain/types";
import type {
  MetadataSnapshot,
  MetricViewInfo,
  PipelineContext,
  TableInfo,
  ColumnInfo,
  ForeignKey,
  EnvironmentScan,
  TableDetail,
  TableHistorySummary,
  TableHealthInsight,
  LineageGraph,
  DiscoveryDepthConfig,
} from "@/lib/domain/types";
import { updateSchemaSnapshot, type SchemaSnapshot } from "@/lib/lakebase/runs";
import {
  resolveColumnBudget,
  detectWideSchema,
  WIDE_SCHEMA_FETCH_LIMITS,
} from "@/lib/toolkit/column-budget";
import { v4 as uuidv4 } from "uuid";

/**
 * Parse the uc_metadata input string into catalog/schema pairs.
 * Supports formats:
 *   - "catalog" (whole catalog)
 *   - "catalog.schema" (single schema)
 *   - "catalog1, catalog2" (multiple catalogs)
 *   - "catalog.schema1, catalog.schema2" (multiple schemas)
 */
function parseUCMetadata(ucMetadata: string): Array<{ catalog: string; schema?: string }> {
  const parts = ucMetadata.split(",").map((p) => p.trim());
  return parts.map((part) => {
    const segments = part.split(".");
    if (segments.length >= 2) {
      return { catalog: segments[0], schema: segments[1] };
    }
    return { catalog: segments[0] };
  });
}

export interface MetadataExtractionResult {
  snapshot: MetadataSnapshot;
  lineageGraph: LineageGraph | null;
}

export async function runMetadataExtraction(
  ctx: PipelineContext,
  runId?: string,
): Promise<MetadataExtractionResult> {
  const log = ctx.logger ?? fallbackLogger;
  const { config } = ctx.run;
  const scopes = parseUCMetadata(config.ucMetadata);
  const enrichmentStart = Date.now();
  const colBudget = resolveColumnBudget();

  const allTables: TableInfo[] = [];
  const allColumns: ColumnInfo[] = [];
  const allFKs: ForeignKey[] = [];
  const allMetricViews: MetricViewInfo[] = [];

  // --- Phase 0: Permission pre-check -- filter inaccessible scopes in parallel ---

  if (runId)
    await updateRunMessage(runId, `Probing ${scopes.length} scope(s) for access permissions...`);
  const { accessible: accessibleScopes, skipped } = await filterAccessibleScopes(scopes);

  if (skipped.length > 0) {
    log.info("Filtered inaccessible scopes", {
      skipped: skipped.map((s) => s.label),
    });
    if (runId) {
      await updateRunMessage(
        runId,
        `Filtered ${skipped.length} inaccessible scope(s): ${skipped.map((s) => s.label).join(", ")}. Scanning ${accessibleScopes.length} accessible scope(s)...`,
      );
    }
  }

  // --- Phase 1: Basic metadata extraction (existing logic) ---

  if (runId)
    await updateRunMessage(runId, `Scanning ${accessibleScopes.length} scope(s) in parallel...`);

  const scopeResults = await Promise.allSettled(
    accessibleScopes.map(async (scope) => {
      const scopeLabel = `${scope.catalog}${scope.schema ? "." + scope.schema : ""}`;
      const tables = await listTables(scope.catalog, scope.schema);

      // Run independent metadata queries in parallel once tables are listed
      const [tableComments, tableTypes, columns, fks, mvs] = await Promise.all([
        fetchTableComments(scope.catalog, scope.schema),
        fetchTableTypes(scope.catalog, scope.schema),
        listColumns(scope.catalog, scope.schema, colBudget.maxColumnRowsPerScope),
        listForeignKeys(scope.catalog, scope.schema),
        listMetricViews(scope.catalog, scope.schema),
      ]);

      mergeTableComments(tables, tableComments);
      mergeTableTypes(tables, tableTypes);

      return { scopeLabel, tables, columns, fks, mvs };
    }),
  );

  for (const result of scopeResults) {
    if (result.status === "fulfilled") {
      allTables.push(...result.value.tables);
      allColumns.push(...result.value.columns);
      allFKs.push(...result.value.fks);
      allMetricViews.push(...result.value.mvs);
    } else {
      log.warn("Failed to extract metadata for scope", {
        fn: "runMetadataExtraction",
        errorCategory: "data",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  if (runId && allTables.length > 0) {
    await updateRunMessage(
      runId,
      `Found ${allTables.length} tables across ${accessibleScopes.length} scope(s), ${allColumns.length} columns`,
    );
  }

  // Pre-flight check: warn operators about very large schemas
  const LARGE_SCHEMA_TABLE_THRESHOLD = 5_000;
  const LARGE_SCHEMA_COLUMN_THRESHOLD = 200_000;
  if (
    allTables.length > LARGE_SCHEMA_TABLE_THRESHOLD ||
    allColumns.length > LARGE_SCHEMA_COLUMN_THRESHOLD
  ) {
    log.warn("Large schema detected -- pipeline may require increased memory", {
      fn: "runMetadataExtraction",
      tableCount: allTables.length,
      columnCount: allColumns.length,
      fkCount: allFKs.length,
      threshold: { tables: LARGE_SCHEMA_TABLE_THRESHOLD, columns: LARGE_SCHEMA_COLUMN_THRESHOLD },
    });
    if (runId) {
      await updateRunMessage(
        runId,
        `Large schema detected: ${allTables.length} tables, ${allColumns.length} columns. Consider using schema-level scoping for faster runs.`,
      );
    }
  }

  if (allTables.length === 0) {
    throw new Error(
      `No tables found for UC metadata scope: ${config.ucMetadata}. Check permissions and paths.`,
    );
  }

  // Auto-detect wide tables and apply fetch-level memory limits
  const colsByTableForDetection = new Map<string, ColumnInfo[]>();
  for (const col of allColumns) {
    const existing = colsByTableForDetection.get(col.tableFqn) ?? [];
    existing.push(col);
    colsByTableForDetection.set(col.tableFqn, existing);
  }
  const wideSchemaInfo = detectWideSchema(colsByTableForDetection);
  if (wideSchemaInfo.hasWideTables) {
    // Downstream steps (use-case generation, SQL generation) re-run
    // detectWideSchema and call applyWideSchemaLimits to cap sample-data
    // fetching for memory safety. The initial listColumns fetch has
    // already happened at this point, so maxColumnRowsPerScope does not
    // apply retroactively -- we log what downstream consumers will enforce.
    log.info("Wide tables detected -- downstream fetch-level limits will apply", {
      fn: "runMetadataExtraction",
      wideTableCount: wideSchemaInfo.wideTableCount,
      maxColumnCount: wideSchemaInfo.maxColumnCount,
      downstreamMaxSampleColumns: WIDE_SCHEMA_FETCH_LIMITS.maxSampleColumns,
    });
  }

  // --- Phase 1b: Apply exclusions (explicit + patterns) ---
  const excludedPaths = parseExcludedString(config.excludedScope);
  const exPatterns = parsePatternsString(config.exclusionPatterns);

  if (excludedPaths.length > 0 || exPatterns.length > 0) {
    const excludedSchemaSet = new Set(
      excludedPaths.filter((p) => p.split(".").length === 2).map((p) => p.toLowerCase()),
    );
    const excludedTableSet = new Set(
      excludedPaths.filter((p) => p.split(".").length >= 3).map((p) => p.toLowerCase()),
    );

    const beforeCount = allTables.length;
    const isTableExcluded = (fqn: string): boolean => {
      const lower = fqn.toLowerCase();
      if (excludedTableSet.has(lower)) return true;
      const parts = lower.split(".");
      const schemaPath = `${parts[0]}.${parts[1]}`;
      if (excludedSchemaSet.has(schemaPath)) return true;
      if (exPatterns.length > 0) {
        const [cat, sch, tbl] = parts;
        if (
          exPatterns.some(
            (p) => globMatch(p, cat) || globMatch(p, sch) || (tbl && globMatch(p, tbl)),
          )
        )
          return true;
      }
      return false;
    };

    const excludedFqns = new Set<string>();
    for (let i = allTables.length - 1; i >= 0; i--) {
      if (isTableExcluded(allTables[i].fqn)) {
        excludedFqns.add(allTables[i].fqn.toLowerCase());
        allTables.splice(i, 1);
      }
    }
    // Also filter columns and FKs for excluded tables
    for (let i = allColumns.length - 1; i >= 0; i--) {
      if (excludedFqns.has(allColumns[i].tableFqn.toLowerCase())) {
        allColumns.splice(i, 1);
      }
    }

    if (allTables.length < beforeCount) {
      log.info("Applied exclusions", {
        excludedPaths,
        patterns: exPatterns,
        removedCount: beforeCount - allTables.length,
        remaining: allTables.length,
      });
      if (runId) {
        await updateRunMessage(
          runId,
          `Excluded ${beforeCount - allTables.length} tables via exclusion rules. ${allTables.length} tables remain.`,
        );
      }
    }
  }

  const snapshot: MetadataSnapshot = {
    cacheKey: uuidv4(),
    ucPath: config.ucMetadata,
    tables: allTables,
    columns: allColumns,
    foreignKeys: allFKs,
    metricViews: allMetricViews,
    tableCount: allTables.length,
    columnCount: allColumns.length,
    cachedAt: new Date().toISOString(),
    lineageDiscoveredFqns: [],
  };

  log.info(
    `Extracted ${snapshot.tableCount} tables, ${snapshot.columnCount} columns, ${allMetricViews.length} metric views`,
  );

  // --- Phase 2: Enrichment pass (estate scan) ---

  let lineageGraph: LineageGraph | null = null;
  if (config.estateScanEnabled) {
    try {
      const depth = config.discoveryDepth ?? "balanced";
      const dc = config.depthConfig ?? DEFAULT_DEPTH_CONFIGS[depth];
      lineageGraph = await runEnrichmentPass(
        snapshot,
        allTables,
        allColumns,
        allFKs,
        accessibleScopes,
        dc,
        log,
        runId,
        config.industry || undefined,
        ctx.ownerEmail ?? ctx.run.ownerEmail ?? null,
      );
    } catch (error) {
      log.error("Enrichment pass failed (non-fatal)", {
        fn: "runMetadataExtraction",
        errorCategory: "data",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const enrichmentMs = Date.now() - enrichmentStart;
    log.info("Enrichment pass duration", { durationMs: enrichmentMs });
  } else {
    log.info("Estate scan disabled -- skipping enrichment pass");
  }

  // --- Persist schema snapshot on the run for Ask Forge column grounding ---
  if (runId) {
    try {
      const schemaSnap = buildRunSchemaSnapshot(snapshot.tables, snapshot.columns);
      await updateSchemaSnapshot(runId, schemaSnap);
      log.info("Schema snapshot persisted", {
        runId,
        tableCount: Object.keys(schemaSnap).length,
      });
    } catch (err) {
      log.warn("Failed to persist schema snapshot (non-fatal)", {
        fn: "runMetadataExtraction",
        errorCategory: "db",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { snapshot, lineageGraph };
}

function buildRunSchemaSnapshot(tables: TableInfo[], columns: ColumnInfo[]): SchemaSnapshot {
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

// ---------------------------------------------------------------------------
// Enrichment pass
// ---------------------------------------------------------------------------

async function runEnrichmentPass(
  snapshot: MetadataSnapshot,
  allTables: TableInfo[],
  allColumns: ColumnInfo[],
  allFKs: ForeignKey[],
  scopes: Array<{ catalog: string; schema?: string }>,
  depthConfig: DiscoveryDepthConfig,
  log: typeof fallbackLogger,
  runId?: string,
  industryId?: string,
  ownerEmail: string | null = null,
): Promise<LineageGraph> {
  const scanId = uuidv4();
  const startTime = Date.now();

  // Build lookups from the original table list
  const tableTypeLookup = new Map<string, string>();
  const formatLookup = new Map<string, string | null>();
  for (const t of allTables) {
    tableTypeLookup.set(t.fqn, t.tableType);
    if (t.dataSourceFormat) formatLookup.set(t.fqn, t.dataSourceFormat);
  }

  // Step 1: Lineage walk (traversal depth + direction from config)
  const lineageEnabled = depthConfig.lineageEnabled ?? true;
  const lineageDirection = depthConfig.lineageDirection ?? "upstream";
  const seedFqns = allTables.map((t) => t.fqn);
  if (runId)
    await updateRunMessage(
      runId,
      lineageEnabled
        ? `Walking lineage (${lineageDirection}, up to ${depthConfig.lineageDepth} hops) to discover related tables...`
        : "Lineage walk disabled; using selected tables only...",
    );
  const lineageGraph = lineageEnabled
    ? await walkLineage(seedFqns, {
        maxDepth: depthConfig.lineageDepth,
        direction: lineageDirection,
      })
    : {
        edges: [],
        seedTables: seedFqns,
        discoveredTables: [],
        upstreamDepth: 0,
        downstreamDepth: 0,
        skippedSeeds: [],
      };

  if (lineageGraph.skippedSeeds && lineageGraph.skippedSeeds.length > 0) {
    log.info("Lineage skipped shared sample-catalog seeds", {
      skipped: lineageGraph.skippedSeeds.length,
    });
  }

  // Merge discovered tables into the working set
  const discoveredFqns = lineageGraph.discoveredTables;
  const expandedTables: Array<{
    fqn: string;
    discoveredVia: "selected" | "lineage";
    tableType: string;
    dataSourceFormat: string | null;
  }> = [
    ...seedFqns.map((fqn) => ({
      fqn,
      discoveredVia: "selected" as const,
      tableType: tableTypeLookup.get(fqn) ?? "TABLE",
      dataSourceFormat: formatLookup.get(fqn) ?? null,
    })),
    ...discoveredFqns.map((fqn) => ({
      fqn,
      discoveredVia: "lineage" as const,
      tableType: "TABLE",
      dataSourceFormat: null as string | null,
    })),
  ];

  log.info("Lineage expanded scope", {
    seed: seedFqns.length,
    discovered: discoveredFqns.length,
    total: expandedTables.length,
  });

  // Fetch metadata for lineage-discovered tables and merge into snapshot
  if (discoveredFqns.length > 0) {
    if (runId)
      await updateRunMessage(
        runId,
        `Fetching metadata for ${discoveredFqns.length} lineage-discovered tables...`,
      );
    try {
      const newTableInfos = await fetchTableInfoBatch(discoveredFqns);
      newTableInfos.forEach((t) => {
        t.discoveredVia = "lineage";
      });
      const newColumns = await fetchColumnsBatch(discoveredFqns);
      const newFKs = await fetchForeignKeysBatch(discoveredFqns);

      snapshot.tables.push(...newTableInfos);
      snapshot.columns.push(...newColumns);
      snapshot.foreignKeys.push(...newFKs);
      snapshot.lineageDiscoveredFqns = discoveredFqns;
      allColumns.push(...newColumns);
      snapshot.tableCount = snapshot.tables.length;
      snapshot.columnCount = snapshot.columns.length;

      // Backfill lineage-discovered entries in expandedTables with
      // real tableType + dataSourceFormat from information_schema
      const infoLookup = new Map(newTableInfos.map((t) => [t.fqn, t]));
      for (const entry of expandedTables) {
        const info = infoLookup.get(entry.fqn);
        if (info) {
          entry.tableType = info.tableType;
          entry.dataSourceFormat = info.dataSourceFormat ?? null;
        }
      }

      log.info("Merged lineage-discovered tables into snapshot", {
        newTables: newTableInfos.length,
        newColumns: newColumns.length,
        newFKs: newFKs.length,
      });
    } catch (error) {
      log.warn("Failed to fetch lineage table metadata (non-fatal)", {
        fn: "runMetadataExtraction",
        errorCategory: "data",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (runId) {
      await updateRunMessage(
        runId,
        `Lineage walk discovered ${discoveredFqns.length} additional tables (${seedFqns.length} selected + ${discoveredFqns.length} via lineage = ${snapshot.tableCount} total)`,
      );
    }
  }

  // Step 2: Deep metadata enrichment
  if (runId)
    await updateRunMessage(
      runId,
      `Enriching ${expandedTables.length} tables (DESCRIBE DETAIL + HISTORY)...`,
    );
  const enrichmentResults = await enrichTablesInBatches(expandedTables, 5, (completed, total) => {
    if (runId && completed % 10 === 0) {
      updateRunMessage(runId, `Enrichment: ${completed}/${total} tables...`).catch((e) =>
        log.debug("Progress update failed", {
          fn: "runMetadataExtraction",
          errorCategory: "db",
          error: String(e),
        }),
      );
    }
  });

  // Step 3: Tags
  if (runId) await updateRunMessage(runId, "Fetching tags...");
  const allTableTags = [];
  const allColumnTags = [];
  for (const scope of scopes) {
    const tTags = await getTableTags(scope.catalog, scope.schema);
    allTableTags.push(...tTags);
    const cTags = await getColumnTags(scope.catalog, scope.schema);
    allColumnTags.push(...cTags);
  }

  // Merge table comments from information_schema into enrichment details
  const commentLookup = new Map<string, string>();
  for (const t of allTables) {
    if (t.comment) commentLookup.set(t.fqn, t.comment);
  }
  for (const [fqn, result] of enrichmentResults) {
    if (result.detail && !result.detail.comment) {
      const comment = commentLookup.get(fqn);
      if (comment) result.detail.comment = comment;
    }
  }

  // Step 4: Health scoring
  if (runId) await updateRunMessage(runId, "Computing health scores...");
  const details: TableDetail[] = [];
  const histories = new Map<string, TableHistorySummary>();

  for (const [fqn, result] of enrichmentResults) {
    if (result.detail) details.push(result.detail);
    if (result.history) histories.set(fqn, result.history);
  }

  const healthScores = computeAllTableHealth(details, histories);

  // Step 5: LLM intelligence layer
  let intelligenceResult;
  try {
    const endpoint = resolveEndpoint("classification");
    if (runId) await updateRunMessage(runId, "Running LLM intelligence analysis...");
    const tableInputs = buildTableInputs(enrichmentResults, allColumns, allTableTags);

    intelligenceResult = await runIntelligenceLayer(tableInputs, lineageGraph, {
      endpoint,
      businessName: undefined,
      industryId,
      foreignKeys: allFKs,
      onProgress: (pass, pct) => {
        if (runId && pct === 0) {
          updateRunMessage(runId, `Intelligence: ${pass}...`).catch((e) =>
            log.debug("Progress update failed", {
              fn: "runMetadataExtraction",
              errorCategory: "db",
              error: String(e),
            }),
          );
        }
      },
    });

    // Apply LLM results to details
    for (const domain of intelligenceResult.domains) {
      for (const fqn of domain.tables) {
        const detail = details.find((d) => d.fqn === fqn);
        if (detail) {
          detail.dataDomain = domain.domain;
          detail.dataSubdomain = domain.subdomain;
        }
      }
    }

    for (const [fqn, tier] of intelligenceResult.tierAssignments) {
      const detail = details.find((d) => d.fqn === fqn);
      if (detail) detail.dataTier = tier.tier;
    }

    for (const [fqn, desc] of intelligenceResult.generatedDescriptions) {
      const detail = details.find((d) => d.fqn === fqn);
      if (detail) detail.generatedDescription = desc;
    }

    // Apply sensitivity levels
    const piiTables = new Set<string>();
    for (const s of intelligenceResult.sensitivities) {
      piiTables.add(s.tableFqn);
    }
    for (const detail of details) {
      if (piiTables.has(detail.fqn)) {
        detail.sensitivityLevel = "confidential";
      }
    }

    // Apply governance priorities
    for (const gap of intelligenceResult.governanceGaps) {
      const detail = details.find((d) => d.fqn === gap.tableFqn);
      if (detail) {
        if (gap.overallScore < 30) detail.governancePriority = "critical";
        else if (gap.overallScore < 50) detail.governancePriority = "high";
        else if (gap.overallScore < 70) detail.governancePriority = "medium";
        else detail.governancePriority = "low";
      }
    }
  } catch (error) {
    log.warn("LLM intelligence layer failed (non-fatal)", {
      fn: "runMetadataExtraction",
      errorCategory: "llm_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 6: Build scan record and save
  if (runId) await updateRunMessage(runId, "Saving environment scan...");

  const historiesWithHealth: Array<TableHistorySummary & TableHealthInsight> = [];
  for (const [fqn, history] of histories) {
    const health = healthScores.get(fqn) ?? {
      tableFqn: fqn,
      healthScore: 100,
      issues: [],
      recommendations: [],
    };
    historiesWithHealth.push({ ...history, ...health });
  }

  const scan: EnvironmentScan = {
    scanId,
    runId: runId ?? null,
    ucPath: snapshot.ucPath,
    scannedAt: new Date().toISOString(),
    tableCount: expandedTables.length,
    totalSizeBytes: details.reduce((sum, d) => sum + (d.sizeInBytes ?? 0), 0),
    totalFiles: details.reduce((sum, d) => sum + (d.numFiles ?? 0), 0),
    totalRows: details.reduce((sum, d) => sum + (d.numRows ?? 0), 0),
    tablesWithStreaming: Array.from(histories.values()).filter((h) => h.hasStreamingWrites).length,
    tablesWithCDF: details.filter((d) => d.tableProperties["delta.enableChangeDataFeed"] === "true")
      .length,
    tablesNeedingOptimize: Array.from(healthScores.values()).filter((h) =>
      h.issues.some((i) => i.includes("OPTIMIZE")),
    ).length,
    tablesNeedingVacuum: Array.from(healthScores.values()).filter((h) =>
      h.issues.some((i) => i.includes("VACUUM")),
    ).length,
    lineageDiscoveredCount: discoveredFqns.length,
    domainCount: intelligenceResult?.domains.length ?? 0,
    piiTablesCount: intelligenceResult?.sensitivities
      ? new Set(intelligenceResult.sensitivities.map((s) => s.tableFqn)).size
      : 0,
    redundancyPairsCount: intelligenceResult?.redundancies.length ?? 0,
    dataProductCount: intelligenceResult?.dataProducts.length ?? 0,
    avgGovernanceScore: intelligenceResult?.governanceGaps.length
      ? intelligenceResult.governanceGaps.reduce((s, g) => s + g.overallScore, 0) /
        intelligenceResult.governanceGaps.length
      : 0,
    genieSpaceCount: 0,
    dashboardCount: 0,
    metricViewCount: snapshot.metricViews.length,
    analyticsCoveragePercent: 0,
    scanDurationMs: Date.now() - startTime,
    passResults: intelligenceResult?.passResults ?? {},
  };

  // Build insight records
  const insightRecords: InsightRecord[] = [];

  if (intelligenceResult) {
    for (const s of intelligenceResult.sensitivities) {
      insightRecords.push({
        insightType: "pii_detection",
        tableFqn: s.tableFqn,
        payloadJson: JSON.stringify(s),
        severity: s.classification === "PII" || s.classification === "Health" ? "critical" : "high",
      });
    }

    for (const r of intelligenceResult.redundancies) {
      insightRecords.push({
        insightType: "redundancy",
        tableFqn: r.tableA,
        payloadJson: JSON.stringify(r),
        severity: r.similarityPercent > 90 ? "high" : "medium",
      });
    }

    for (const rel of intelligenceResult.implicitRelationships) {
      insightRecords.push({
        insightType: "implicit_relationship",
        tableFqn: rel.sourceTableFqn,
        payloadJson: JSON.stringify(rel),
        severity: "info",
      });
    }

    for (const dp of intelligenceResult.dataProducts) {
      insightRecords.push({
        insightType: "data_product",
        tableFqn: null,
        payloadJson: JSON.stringify(dp),
        severity: "info",
      });
    }

    for (const gap of intelligenceResult.governanceGaps) {
      insightRecords.push({
        insightType: "governance_gap",
        tableFqn: gap.tableFqn,
        payloadJson: JSON.stringify(gap),
        severity: gap.overallScore < 30 ? "critical" : gap.overallScore < 50 ? "high" : "medium",
      });
    }
  }

  await saveEnvironmentScan(
    scan,
    details,
    historiesWithHealth,
    lineageGraph.edges,
    insightRecords,
    allColumns,
    allTableTags,
    allColumnTags,
    ownerEmail,
  );

  log.info("Environment scan saved", {
    scanId,
    tables: details.length,
    lineageEdges: lineageGraph.edges.length,
    insights: insightRecords.length,
  });

  // Generate vector embeddings for estate data (best-effort, non-blocking)
  try {
    const { embedScanResults } = await import("@/lib/embeddings/embed-estate");
    await embedScanResults(
      scanId,
      details,
      historiesWithHealth,
      lineageGraph.edges,
      insightRecords,
      allColumns,
    );
  } catch (embedErr) {
    log.warn("Estate embedding failed (non-fatal)", {
      fn: "runMetadataExtraction",
      errorCategory: "data",
      scanId,
      error: embedErr instanceof Error ? embedErr.message : String(embedErr),
    });
  }

  return lineageGraph;
}
