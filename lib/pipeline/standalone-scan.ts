/**
 * Standalone Environment Scan runner.
 *
 * Runs the same enrichment pipeline as metadata-extraction but
 * without a pipeline run context. Used by the standalone scan API.
 */

import {
  listTables,
  listColumns,
  listForeignKeys,
  fetchTableComments,
  mergeTableComments,
  fetchTableTypes,
  mergeTableTypes,
  fetchColumnsBatch,
  fetchTableInfoBatch,
  filterAccessibleScopes,
} from "@/lib/queries/metadata";
import { enrichTablesInBatches, getTableTags, getColumnTags } from "@/lib/queries/metadata-detail";
import { walkLineage } from "@/lib/queries/lineage";
import { runIntelligenceLayer, buildTableInputs } from "@/lib/ai/environment-intelligence";
import { computeAllTableHealth } from "@/lib/domain/health-score";
import {
  saveEnvironmentScan,
  markScanFailed,
  type InsightRecord,
} from "@/lib/lakebase/environment-scans";
import { resolveEndpoint } from "@/lib/dbx/client";
import { initScanProgress, updateScanProgress } from "@/lib/pipeline/scan-progress";
import { discoverExistingAssets } from "@/lib/discovery/asset-scanner";
import { computeCoverage } from "@/lib/discovery/coverage";
import {
  resolveColumnBudget,
  detectWideSchema,
  WIDE_SCHEMA_FETCH_LIMITS,
} from "@/lib/toolkit/column-budget";
import { createScopedLogger } from "@/lib/logger";
import { parseExcludedString, parsePatternsString, globMatch } from "@/lib/domain/scope-selection";
import { getIndustryOutcome, resolveIndustryId } from "@/lib/domain/industry-outcomes";
import type {
  EnvironmentScan,
  TableDetail,
  TableHistorySummary,
  TableHealthInsight,
  LineageDirection,
} from "@/lib/domain/types";
import type { DiscoveryResult } from "@/lib/discovery/types";

/**
 * Infer a canonical industry ID from an explicit override or from catalog/schema
 * tokens in `ucMetadata` (e.g. `workshop_demo.energy_utilities` -> `energy-utilities`).
 */
export function inferIndustryIdFromScope(
  ucMetadata: string,
  explicitIndustryId?: string | null,
): string | undefined {
  if (explicitIndustryId && explicitIndustryId.trim()) {
    return resolveIndustryId(explicitIndustryId.trim()) ?? explicitIndustryId.trim();
  }
  const tokens = ucMetadata
    .split(/[,.\s]+/)
    .map((t) => t.trim().toLowerCase().replace(/_/g, "-"))
    .filter(Boolean);
  for (const token of tokens) {
    const outcome = getIndustryOutcome(token);
    if (outcome) return outcome.id;
  }
  return undefined;
}

export type StandaloneScanTerminalReason = "no_access" | "no_tables";

/** A deterministic terminal scan outcome that must fail the owning scope. */
export class StandaloneScanTerminalError extends Error {
  constructor(
    public readonly reason: StandaloneScanTerminalReason,
    message: string,
  ) {
    super(message);
    this.name = "StandaloneScanTerminalError";
  }
}

/**
 * Parse the uc_metadata scope string.
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

/**
 * Run a standalone environment scan (no pipeline run context).
 * @param lineageDepth Max BFS hops for lineage walk (default 5).
 */
export async function runStandaloneEnrichment(
  scanId: string,
  ucMetadata: string,
  lineageDepth = 5,
  assetDiscoveryEnabled = false,
  excludedScope?: string,
  exclusionPatternsStr?: string,
  ownerEmail: string | null = null,
  // OBO token captured from the request that initiated the scan. Currently
  // unused inside the scan -- SQL warehouse access already prefers OBO via
  // getHeaders() -- but we accept and forward for future Genie/Workspace
  // calls that need user context.
  _oboToken: string | null = null,
  // Estate-context overrides. industryId/subVertical/orgContext transiently
  // ground intelligence + ontology-synthesis prompts; they are not duplicated
  // onto scan rows. workspaceId/teamLabel stamp only the provenance needed for
  // portfolio roll-up. Supplied by the estate sequence runner.
  opts: {
    industryId?: string;
    subVertical?: string;
    /** Estate org-context blurb used only for transient prompt grounding. */
    orgContext?: string;
    workspaceId?: string | null;
    teamLabel?: string | null;
    /** Glob patterns a table must match (any segment) to be kept. Empty = keep all. */
    inclusionPatterns?: string;
    /** Walk lineage during the scan. Default true. */
    lineageEnabled?: boolean;
    /** Lineage walk direction. Default "upstream". */
    lineageDirection?: LineageDirection;
    /**
     * Promote out-of-scope lineage-discovered tables into first-class scan
     * tables (ForgeTableDetail). Default false so upstream staging/scratch
     * tables outside the selected catalog/schema do not pollute domain,
     * governance, and quality rollups while lineage edges are still captured.
     */
    expandLineageTables?: boolean;
    /**
     * Estate-program scans remain hidden as `running` after their final data
     * save. The orchestrator atomically completes the scope, attaches the scan,
     * and flips it to `complete` only if this attempt still owns the scope.
     */
    deferCompletion?: boolean;
  } = {},
): Promise<void> {
  const startTime = Date.now();
  const scopes = parseUCMetadata(ucMetadata);
  const effectiveIndustryId = inferIndustryIdFromScope(ucMetadata, opts.industryId);
  const colBudget = resolveColumnBudget();
  const log = createScopedLogger({
    origin: "EstateScan",
    module: "pipeline/standalone-scan",
    scanId,
  });

  initScanProgress(scanId, ownerEmail);
  log.info("Starting", { scanId, ucMetadata, scopes: scopes.length });

  try {
    // Phase 0: Permission pre-check -- filter out inaccessible scopes in parallel
    updateScanProgress(scanId, {
      phase: "listing-tables",
      message: `Probing ${scopes.length} scope${scopes.length !== 1 ? "s" : ""} for access permissions...`,
    });

    const { accessible: accessibleScopes, skipped } = await filterAccessibleScopes(scopes);

    if (skipped.length > 0) {
      log.info("Filtered inaccessible scopes", {
        skipped: skipped.map((s) => s.label),
      });
      updateScanProgress(scanId, {
        message: `Filtered ${skipped.length} inaccessible scope(s). Scanning ${accessibleScopes.length} accessible scope(s)...`,
      });
    }

    if (accessibleScopes.length === 0) {
      log.error("No accessible scopes", {
        fn: "runStandaloneEnrichment",
        errorCategory: "permission_denied",
        scanId,
        ucMetadata,
      });
      updateScanProgress(scanId, {
        phase: "failed",
        message:
          "No accessible scopes found. Check permissions for the configured catalogs/schemas.",
      });
      throw new StandaloneScanTerminalError(
        "no_access",
        "No accessible scopes found. Check permissions for the configured catalogs/schemas.",
      );
    }

    // Phase 1: Basic metadata
    updateScanProgress(scanId, {
      message: `Scanning ${accessibleScopes.length} scope${accessibleScopes.length !== 1 ? "s" : ""} for tables and columns...`,
    });

    const allTables = [];
    const allColumns = [];
    const allFKs = [];

    for (const scope of accessibleScopes) {
      const scopeLabel = `${scope.catalog}${scope.schema ? "." + scope.schema : ""}`;
      try {
        updateScanProgress(scanId, {
          message: `Listing tables in ${scopeLabel}...`,
        });
        const tables = await listTables(scope.catalog, scope.schema);
        const tableComments = await fetchTableComments(scope.catalog, scope.schema);
        mergeTableComments(tables, tableComments);
        const tableTypes = await fetchTableTypes(scope.catalog, scope.schema);
        mergeTableTypes(tables, tableTypes);
        allTables.push(...tables);
        updateScanProgress(scanId, {
          tablesFound: allTables.length,
          message: `Found ${allTables.length} tables. Fetching columns from ${scopeLabel}...`,
        });
        const columns = await listColumns(
          scope.catalog,
          scope.schema,
          colBudget.maxColumnRowsPerScope,
        );
        allColumns.push(...columns);
        updateScanProgress(scanId, { columnsFound: allColumns.length });
        const fks = await listForeignKeys(scope.catalog, scope.schema);
        allFKs.push(...fks);
      } catch (error) {
        log.warn("Scope failed", {
          fn: "runStandaloneEnrichment",
          errorCategory: "scope_listing_failed",
          scope,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (allTables.length === 0) {
      log.error("No tables found", {
        fn: "runStandaloneEnrichment",
        errorCategory: "no_tables",
        scanId,
        ucMetadata,
      });
      updateScanProgress(scanId, {
        phase: "failed",
        message: "No tables found. Check scope and permissions.",
      });
      throw new StandaloneScanTerminalError(
        "no_tables",
        "No tables found. Check scope and permissions.",
      );
    }

    // Auto-detect wide tables. Downstream consumers (use-case + SQL
    // generation) re-run detectWideSchema + applyWideSchemaLimits to cap
    // sample-data fetching. The initial listColumns fetch has already
    // happened at this point so maxColumnRowsPerScope does not apply
    // retroactively -- we log what downstream consumers will enforce.
    const colsByTableForDetection = new Map<string, unknown[]>();
    for (const col of allColumns as Array<{ tableFqn: string }>) {
      const existing = colsByTableForDetection.get(col.tableFqn) ?? [];
      existing.push(col);
      colsByTableForDetection.set(col.tableFqn, existing);
    }
    const wideSchemaInfo = detectWideSchema(colsByTableForDetection);
    if (wideSchemaInfo.hasWideTables) {
      log.info("Wide tables detected -- downstream fetch-level limits will apply", {
        fn: "runStandaloneEnrichment",
        wideTableCount: wideSchemaInfo.wideTableCount,
        maxColumnCount: wideSchemaInfo.maxColumnCount,
        downstreamMaxSampleColumns: WIDE_SCHEMA_FETCH_LIMITS.maxSampleColumns,
      });
    }

    // Apply exclusions (explicit + patterns) and inclusion patterns.
    const excludedPaths = parseExcludedString(excludedScope);
    const exPatterns = parsePatternsString(exclusionPatternsStr);
    const inPatterns = parsePatternsString(opts.inclusionPatterns);
    const excludedSchemaSet = new Set(
      excludedPaths.filter((p) => p.split(".").length === 2).map((p) => p.toLowerCase()),
    );
    const excludedTableSet = new Set(
      excludedPaths.filter((p) => p.split(".").length >= 3).map((p) => p.toLowerCase()),
    );
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
      // Inclusion patterns: when present, a table must match at least one
      // pattern on some segment, else it is dropped (exclusion still wins).
      if (inPatterns.length > 0) {
        const [cat, sch, tbl] = parts;
        const kept = inPatterns.some(
          (p) => globMatch(p, cat) || globMatch(p, sch) || (tbl && globMatch(p, tbl)),
        );
        if (!kept) return true;
      }
      return false;
    };

    if (excludedPaths.length > 0 || exPatterns.length > 0 || inPatterns.length > 0) {
      const beforeCount = allTables.length;
      const excludedFqns = new Set<string>();
      for (let i = allTables.length - 1; i >= 0; i--) {
        if (isTableExcluded(allTables[i].fqn)) {
          excludedFqns.add(allTables[i].fqn.toLowerCase());
          allTables.splice(i, 1);
        }
      }
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
        updateScanProgress(scanId, {
          message: `Excluded ${beforeCount - allTables.length} tables via exclusion rules. ${allTables.length} tables remain.`,
        });
      }
    }

    updateScanProgress(scanId, {
      phase: "fetching-metadata",
      tablesFound: allTables.length,
      columnsFound: allColumns.length,
      message: `Found ${allTables.length} tables and ${allColumns.length} columns.`,
    });

    // Build lookups from the original table list
    const tableTypeLookup = new Map<string, string>();
    const formatLookup = new Map<string, string | null>();
    for (const t of allTables) {
      tableTypeLookup.set(t.fqn, t.tableType);
      if (t.dataSourceFormat) formatLookup.set(t.fqn, t.dataSourceFormat);
    }

    // Phase 2: Lineage walk
    const lineageEnabled = opts.lineageEnabled ?? true;
    const lineageDirection: LineageDirection = opts.lineageDirection ?? "upstream";
    const seedFqns = allTables.map((t) => t.fqn);
    updateScanProgress(scanId, {
      phase: "walking-lineage",
      message: lineageEnabled
        ? `Walking lineage (${lineageDirection}) from ${allTables.length} seed tables...`
        : "Lineage walk disabled; scanning selected tables only...",
    });
    const lineageGraph = lineageEnabled
      ? await walkLineage(seedFqns, { maxDepth: lineageDepth, direction: lineageDirection })
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
        fn: "runStandaloneEnrichment",
        skipped: lineageGraph.skippedSeeds.length,
      });
      updateScanProgress(scanId, {
        message: `Skipped ${lineageGraph.skippedSeeds.length} shared sample-catalog table(s) as lineage seeds to keep scope bounded.`,
      });
    }

    const expandLineageTables =
      opts.expandLineageTables ?? process.env.FORGE_SCAN_EXPAND_LINEAGE_TABLES === "true";
    const promotedLineageTables = expandLineageTables
      ? lineageGraph.discoveredTables.filter((fqn) => !isTableExcluded(fqn))
      : [];

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
      ...promotedLineageTables.map((fqn) => ({
        fqn,
        discoveredVia: "lineage" as const,
        tableType: "TABLE",
        dataSourceFormat: null as string | null,
      })),
    ];

    // Fetch metadata for lineage-discovered tables when promoted into expandedTables
    if (promotedLineageTables.length > 0) {
      try {
        const [lineageInfos, lineageCols] = await Promise.all([
          fetchTableInfoBatch(promotedLineageTables),
          fetchColumnsBatch(promotedLineageTables),
        ]);
        allColumns.push(...lineageCols);

        const infoLookup = new Map(lineageInfos.map((t) => [t.fqn, t]));
        for (const entry of expandedTables) {
          const info = infoLookup.get(entry.fqn);
          if (info) {
            entry.tableType = info.tableType;
            entry.dataSourceFormat = info.dataSourceFormat ?? null;
          }
        }
      } catch (error) {
        log.warn("Failed to fetch lineage-discovered metadata (non-fatal)", {
          fn: "runStandaloneEnrichment",
          errorCategory: "lineage_metadata_fetch_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    updateScanProgress(scanId, {
      lineageTablesFound: lineageGraph.discoveredTables.length,
      lineageEdgesFound: lineageGraph.edges.length,
      tablesFound: expandedTables.length,
      message: `Lineage walk discovered ${lineageGraph.discoveredTables.length} additional tables and ${lineageGraph.edges.length} edges.`,
    });

    // Phase 3: Enrichment
    updateScanProgress(scanId, {
      phase: "enriching",
      enrichTotal: expandedTables.length,
      enrichedCount: 0,
      message: `Enriching ${expandedTables.length} tables (DESCRIBE DETAIL + HISTORY)...`,
    });
    const enrichmentResults = await enrichTablesInBatches(expandedTables, 5, (completed, total) => {
      updateScanProgress(scanId, {
        enrichedCount: completed,
        enrichTotal: total,
        message: `Enriching tables: ${completed}/${total}...`,
      });
    });

    // Merge table comments and owners from information_schema into enrichment details
    const commentLookup = new Map<string, string>();
    const ownerLookup = new Map<string, string>();
    for (const t of allTables) {
      if (t.comment) commentLookup.set(t.fqn, t.comment);
      if (t.owner) ownerLookup.set(t.fqn, t.owner);
    }
    for (const [fqn, result] of enrichmentResults) {
      if (result.detail && !result.detail.comment) {
        const comment = commentLookup.get(fqn);
        if (comment) result.detail.comment = comment;
      }
      if (result.detail && !result.detail.owner) {
        const owner = ownerLookup.get(fqn);
        if (owner) result.detail.owner = owner;
      }
    }

    // Phase 4: Tags
    updateScanProgress(scanId, {
      phase: "fetching-tags",
      message: "Fetching Unity Catalog tags...",
    });
    const allTableTags = [];
    const allColumnTags = [];
    for (const scope of accessibleScopes) {
      allTableTags.push(...(await getTableTags(scope.catalog, scope.schema)));
      allColumnTags.push(...(await getColumnTags(scope.catalog, scope.schema)));
    }

    // Phase 5: Health scoring
    updateScanProgress(scanId, {
      phase: "health-scoring",
      message: "Computing table health scores...",
    });
    const details: TableDetail[] = [];
    const histories = new Map<string, TableHistorySummary>();
    for (const [fqn, result] of enrichmentResults) {
      if (result.detail) details.push(result.detail);
      if (result.history) histories.set(fqn, result.history);
    }
    const healthScores = computeAllTableHealth(details, histories);

    // ---- Incremental save: persist deterministic results (Phases 1-5) ----
    // This ensures partial results survive even if the LLM intelligence layer
    // (Phase 6b) throws due to token budget or OOM errors.
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

    // Build the base scan record without intelligence results
    const buildScanRecord = (overrides: Partial<EnvironmentScan> = {}): EnvironmentScan => ({
      scanId,
      runId: null,
      ucPath: ucMetadata,
      excludedScope: excludedScope ?? null,
      exclusionPatterns: exclusionPatternsStr ?? null,
      inclusionPatterns: opts.inclusionPatterns ?? null,
      workspaceId: opts.workspaceId ?? null,
      teamLabel: opts.teamLabel ?? null,
      scannedAt: new Date().toISOString(),
      tableCount: expandedTables.length,
      totalSizeBytes: details.reduce((sum, d) => sum + (d.sizeInBytes ?? 0), 0),
      totalFiles: details.reduce((sum, d) => sum + (d.numFiles ?? 0), 0),
      totalRows: details.reduce((sum, d) => sum + (d.numRows ?? 0), 0),
      tablesWithStreaming: Array.from(histories.values()).filter((h) => h.hasStreamingWrites)
        .length,
      tablesWithCDF: details.filter(
        (d) => d.tableProperties["delta.enableChangeDataFeed"] === "true",
      ).length,
      tablesNeedingOptimize: Array.from(healthScores.values()).filter((h) =>
        h.issues.some((i) => i.includes("OPTIMIZE")),
      ).length,
      tablesNeedingVacuum: Array.from(healthScores.values()).filter((h) =>
        h.issues.some((i) => i.includes("VACUUM")),
      ).length,
      lineageDiscoveredCount: lineageGraph.discoveredTables.length,
      domainCount: 0,
      piiTablesCount: 0,
      redundancyPairsCount: 0,
      dataProductCount: 0,
      avgGovernanceScore: 0,
      genieSpaceCount: 0,
      dashboardCount: 0,
      metricViewCount: 0,
      analyticsCoveragePercent: 0,
      scanDurationMs: Date.now() - startTime,
      passResults: {},
      ...overrides,
    });

    // FK insight records (deterministic, always available)
    const fkInsightRecords: InsightRecord[] = allFKs.map((fk) => ({
      insightType: "foreign_key",
      tableFqn: fk.tableFqn,
      payloadJson: JSON.stringify(fk),
      severity: "info",
    }));

    // Checkpoint: persist only the scan record header, lineage edges, and FK
    // insights.  Table details are intentionally omitted because Phase 6b
    // mutates them (dataDomain, dataTier, generatedDescription, etc.) and
    // saveEnvironmentScan uses createMany(..., skipDuplicates) for child rows
    // -- a second save cannot overwrite details already written here.
    updateScanProgress(scanId, {
      phase: "saving",
      message: "Saving deterministic scan results...",
    });
    await saveEnvironmentScan(
      // Checkpoint: the scan is still in flight, so persist as `running`.
      // Estate aggregates / Excel / Portfolio / reconstitution exclude it until
      // the final save flips it to `complete`.
      buildScanRecord({ scanStatus: "running" }),
      [],
      [],
      lineageGraph.edges,
      fkInsightRecords,
      [],
      allTableTags,
      allColumnTags,
      ownerEmail,
    );
    log.info("Deterministic scan checkpoint saved (header + lineage + tags)", { scanId });

    // Phase 6a: Asset discovery (if enabled -- runs before LLM intelligence so results feed into analytics maturity pass)
    let assetCoveragePercent = 0;
    let genieSpaceCount = 0;
    let dashboardCount = 0;
    let metricViewCount = 0;
    let discoveryResult: DiscoveryResult | null = null;
    // Detailed discovery rows for standalone scans are persisted as scan-keyed
    // insights (the ForgeDiscovered* tables are runId-keyed FKs to ForgeRun and
    // cannot accept a scanId -- bug 2). The aggregate header still carries the
    // counts below.
    const discoveryInsightRecords: InsightRecord[] = [];

    if (assetDiscoveryEnabled) {
      updateScanProgress(scanId, {
        phase: "asset-discovery",
        message:
          "Discovering existing analytics assets (Genie spaces, dashboards, metric views)...",
      });

      try {
        const scopeStrings = accessibleScopes.map((s) =>
          s.schema ? `${s.catalog}.${s.schema}` : s.catalog,
        );

        discoveryResult = await discoverExistingAssets({
          scopeTables: allTables.map((t) => t.fqn),
          metricViewScope: scopeStrings,
        });

        const coverage = computeCoverage(
          allTables.map((t) => t.fqn),
          discoveryResult,
        );

        genieSpaceCount = discoveryResult.genieSpaces.length;
        dashboardCount = discoveryResult.dashboards.length;
        metricViewCount = discoveryResult.metricViews.length;
        assetCoveragePercent = coverage.coveragePercent;

        discoveryInsightRecords.push({
          insightType: "asset_discovery",
          tableFqn: null,
          payloadJson: JSON.stringify({ discovery: discoveryResult, coverage }),
          severity: "info",
        });

        updateScanProgress(scanId, {
          message: `Asset discovery: ${genieSpaceCount} Genie spaces, ${dashboardCount} dashboards, ${metricViewCount} metric views (${assetCoveragePercent}% coverage)`,
        });
      } catch (error) {
        log.warn("Asset discovery failed (non-fatal)", {
          fn: "runStandaloneEnrichment",
          errorCategory: "asset_discovery_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Phase 6b: LLM intelligence (passes 1-8 + optional pass 9 analytics maturity when discovery data is available)
    updateScanProgress(scanId, {
      phase: "llm-intelligence",
      message: "Running LLM intelligence analysis (domains, PII, governance)...",
    });
    let intelligenceResult;
    try {
      const endpoint = resolveEndpoint("classification");
      const tableInputs = buildTableInputs(enrichmentResults, allColumns, allTableTags);
      intelligenceResult = await runIntelligenceLayer(tableInputs, lineageGraph, {
        endpoint,
        discoveryResult,
        foreignKeys: allFKs,
        // Ground intelligence in the estate's industry (previously only the
        // pipeline path threaded this). Sub-vertical and organisation context
        // are transient prompt grounding only; they are not copied to scan rows.
        industryId: effectiveIndustryId,
        subVertical: opts.subVertical,
        orgContext: opts.orgContext,
        onProgress: (pass) => {
          updateScanProgress(scanId, {
            llmPass: pass,
            message: `LLM analysis: ${pass}...`,
          });
        },
      });

      // Index details by FQN once so applying LLM results is O(1) per row
      // instead of O(tables) per result (matters on large estates).
      const detailByFqn = new Map(details.map((d) => [d.fqn, d]));

      // Apply results to details
      for (const domain of intelligenceResult.domains) {
        for (const fqn of domain.tables) {
          const detail = detailByFqn.get(fqn);
          if (detail) {
            detail.dataDomain = domain.domain;
            detail.dataSubdomain = domain.subdomain;
          }
        }
      }
      for (const [fqn, tier] of intelligenceResult.tierAssignments) {
        const detail = detailByFqn.get(fqn);
        if (detail) {
          detail.dataTier = tier.tier;
          detail.tierReasoning = tier.reasoning;
        }
      }
      for (const [fqn, desc] of intelligenceResult.generatedDescriptions) {
        const detail = detailByFqn.get(fqn);
        if (detail) detail.generatedDescription = desc;
      }
      const piiTables = new Set(intelligenceResult.sensitivities.map((s) => s.tableFqn));
      for (const detail of details) {
        if (piiTables.has(detail.fqn)) detail.sensitivityLevel = "confidential";
      }
      for (const gap of intelligenceResult.governanceGaps) {
        const detail = detailByFqn.get(gap.tableFqn);
        if (detail) {
          // Persist the LLM governance score itself (bug 1 fix), not just the
          // derived priority band.
          detail.governanceScore = gap.overallScore;
          if (gap.overallScore < 30) detail.governancePriority = "critical";
          else if (gap.overallScore < 50) detail.governancePriority = "high";
          else if (gap.overallScore < 70) detail.governancePriority = "medium";
          else detail.governancePriority = "low";
        }
      }
      // Update progress with LLM results
      updateScanProgress(scanId, {
        domainsFound: intelligenceResult.domains.length,
        piiDetected: new Set(intelligenceResult.sensitivities.map((s) => s.tableFqn)).size,
        message: `LLM analysis complete: ${intelligenceResult.domains.length} domains, ${new Set(intelligenceResult.sensitivities.map((s) => s.tableFqn)).size} PII tables detected.`,
      });
    } catch (error) {
      log.warn("LLM intelligence failed (non-fatal)", {
        fn: "runStandaloneEnrichment",
        errorCategory: "llm_intelligence_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      updateScanProgress(scanId, {
        message: "LLM analysis skipped (non-fatal error). Saving results...",
      });
    }

    // Phase 6c: Estate ontology (canonical entities + relationships +
    // glossary) and estate-level quality/readiness rollup. Best-effort.
    let ontology: import("@/lib/domain/types").EstateOntology | null = null;
    let scanSummary: import("@/lib/domain/types").EstateScanSummary | null = null;
    try {
      updateScanProgress(scanId, {
        phase: "llm-intelligence",
        message: "Synthesising estate ontology (canonical entities + relationships)...",
      });
      const { runEstateOntology } = await import("@/lib/ai/estate-ontology");
      const { computeMetadataQualityCoverage, computeTierDistribution, computeReadinessScore } =
        await import("@/lib/domain/estate-readiness");

      const governanceByFqn = new Map<string, number>();
      for (const gap of intelligenceResult?.governanceGaps ?? []) {
        governanceByFqn.set(gap.tableFqn, gap.overallScore);
      }

      ontology = await runEstateOntology(
        {
          details,
          domains: intelligenceResult?.domains ?? [],
          dataProducts: intelligenceResult?.dataProducts ?? [],
          implicitRelationships: intelligenceResult?.implicitRelationships ?? [],
          foreignKeys: allFKs,
          lineageGraph,
          governanceByFqn,
        },
        {
          endpoint: resolveEndpoint("classification"),
          log,
          industryId: effectiveIndustryId,
          subVertical: opts.subVertical,
          orgContext: opts.orgContext,
        },
      );

      const tagSet = new Set(allTableTags.map((t) => t.tableFqn.toLowerCase()));
      // Build per-table column arrays (name + comment) from the scanned
      // columns so column-comment coverage can be measured.
      const colsByFqn = new Map<string, Array<{ name: string; comment: string | null }>>();
      for (const c of allColumns) {
        const key = c.tableFqn.toLowerCase();
        const arr = colsByFqn.get(key) ?? [];
        arr.push({ name: c.columnName, comment: c.comment });
        colsByFqn.set(key, arr);
      }
      const qualityCoverage = computeMetadataQualityCoverage(details, {
        hasTags: (fqn) => tagSet.has(fqn.toLowerCase()),
        columnsByFqn: (fqn) => {
          const arr = colsByFqn.get(fqn.toLowerCase());
          return arr ? JSON.stringify(arr) : null;
        },
      });
      const tierDistribution = computeTierDistribution(details);
      const overall = computeReadinessScore(
        details.map((d) => d.fqn),
        new Map(details.map((d) => [d.fqn, d])),
        governanceByFqn,
      );

      scanSummary = {
        qualityCoverage,
        tierDistribution,
        ontology: {
          entityCount: ontology.entities.length,
          relationshipCount: ontology.relationships.length,
          glossaryTermCount: ontology.glossary.length,
        },
        readinessScore: overall.score,
        readiness: overall.band,
      };
      updateScanProgress(scanId, {
        message: `Ontology: ${ontology.entities.length} canonical entities, ${ontology.relationships.length} relationships.`,
      });
    } catch (error) {
      log.warn("Estate ontology / rollup failed (non-fatal)", {
        fn: "runStandaloneEnrichment",
        errorCategory: "ontology_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Phase 6d: UC assets beyond tables — registered ML models + UC functions.
    // These are key C-level signals ("what AI / reusable logic is deployed").
    // Best-effort, per accessible scope. Persisted as insights + summary counts.
    const ucAssetInsights: InsightRecord[] = [];
    let modelCount = 0;
    let functionCount = 0;
    try {
      updateScanProgress(scanId, {
        phase: "llm-intelligence",
        message: "Inventorying UC models and functions...",
      });
      const { listFunctions, listRegisteredModels } = await import("@/lib/queries/uc-assets");
      for (const scope of accessibleScopes) {
        const [fns, models] = await Promise.all([
          listFunctions(scope.catalog, scope.schema),
          listRegisteredModels(scope.catalog, scope.schema),
        ]);
        functionCount += fns.length;
        modelCount += models.length;
        // Cap persisted rows to keep the insight table bounded on huge estates.
        for (const m of models.slice(0, 500)) {
          ucAssetInsights.push({
            insightType: "uc_model",
            tableFqn: null,
            payloadJson: JSON.stringify(m),
            severity: "info",
          });
        }
        for (const f of fns.slice(0, 500)) {
          ucAssetInsights.push({
            insightType: "uc_function",
            tableFqn: null,
            payloadJson: JSON.stringify(f),
            severity: "info",
          });
        }
      }
      // Fold asset counts into the summary (genie/dashboard/metric come from
      // the asset-discovery block above via the scan record counters).
      scanSummary = {
        ...(scanSummary ?? {}),
        assets: {
          models: modelCount,
          functions: functionCount,
          genieSpaces: genieSpaceCount,
          dashboards: dashboardCount,
          metricViews: metricViewCount,
        },
      };
      updateScanProgress(scanId, {
        message: `UC assets: ${modelCount} models, ${functionCount} functions.`,
      });
    } catch (error) {
      log.warn("UC asset inventory failed (non-fatal)", {
        fn: "runStandaloneEnrichment",
        errorCategory: "uc_assets_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Phase 7: Update scan with intelligence + asset discovery results
    updateScanProgress(scanId, {
      phase: "saving",
      message: "Saving intelligence results to database...",
    });

    const llmInsightRecords: InsightRecord[] = [...ucAssetInsights];

    if (ontology) {
      for (const entity of ontology.entities) {
        llmInsightRecords.push({
          insightType: "canonical_entity",
          tableFqn: null,
          payloadJson: JSON.stringify(entity),
          severity: "info",
        });
      }
      for (const rel of ontology.relationships) {
        llmInsightRecords.push({
          insightType: "entity_relationship",
          tableFqn: null,
          payloadJson: JSON.stringify(rel),
          severity: "info",
        });
      }
      for (const term of ontology.glossary) {
        llmInsightRecords.push({
          insightType: "business_glossary_term",
          tableFqn: null,
          payloadJson: JSON.stringify(term),
          severity: "info",
        });
      }
    }

    if (intelligenceResult) {
      for (const s of intelligenceResult.sensitivities) {
        llmInsightRecords.push({
          insightType: "pii_detection",
          tableFqn: s.tableFqn,
          payloadJson: JSON.stringify(s),
          severity:
            s.classification === "PII" || s.classification === "Health" ? "critical" : "high",
        });
      }
      for (const r of intelligenceResult.redundancies) {
        llmInsightRecords.push({
          insightType: "redundancy",
          tableFqn: r.tableA,
          payloadJson: JSON.stringify(r),
          severity: r.similarityPercent > 90 ? "high" : "medium",
        });
      }
      for (const rel of intelligenceResult.implicitRelationships) {
        llmInsightRecords.push({
          insightType: "implicit_relationship",
          tableFqn: rel.sourceTableFqn,
          payloadJson: JSON.stringify(rel),
          severity: "info",
        });
      }
      for (const dp of intelligenceResult.dataProducts) {
        llmInsightRecords.push({
          insightType: "data_product",
          tableFqn: null,
          payloadJson: JSON.stringify(dp),
          severity: "info",
        });
      }
      for (const gap of intelligenceResult.governanceGaps) {
        if (gap.gaps.length === 0 && gap.overallScore >= 85) continue;
        llmInsightRecords.push({
          insightType: "governance_gap",
          tableFqn: gap.tableFqn,
          payloadJson: JSON.stringify(gap),
          severity: gap.overallScore < 30 ? "critical" : gap.overallScore < 50 ? "high" : "medium",
        });
      }
      if (intelligenceResult.analyticsMaturity) {
        llmInsightRecords.push({
          insightType: "analytics_maturity",
          tableFqn: null,
          payloadJson: JSON.stringify(intelligenceResult.analyticsMaturity),
          severity:
            intelligenceResult.analyticsMaturity.overallScore < 25
              ? "critical"
              : intelligenceResult.analyticsMaturity.overallScore < 50
                ? "high"
                : "info",
        });
      }
    }

    // Full save: upsert scan header and write all child rows (details,
    // histories, columns, insights).  Details were omitted from the Phase 5
    // checkpoint so this is the single insert for ForgeTableDetail rows,
    // including any LLM-enriched fields applied above.
    const finalScan = buildScanRecord({
      domainCount: intelligenceResult?.domains.length ?? 0,
      piiTablesCount: intelligenceResult
        ? new Set(intelligenceResult.sensitivities.map((s) => s.tableFqn)).size
        : 0,
      redundancyPairsCount: intelligenceResult?.redundancies.length ?? 0,
      dataProductCount: intelligenceResult?.dataProducts.length ?? 0,
      avgGovernanceScore: intelligenceResult?.governanceGaps.length
        ? intelligenceResult.governanceGaps.reduce((s, g) => s + g.overallScore, 0) /
          intelligenceResult.governanceGaps.length
        : 0,
      genieSpaceCount,
      dashboardCount,
      metricViewCount,
      analyticsCoveragePercent: assetCoveragePercent,
      scanDurationMs: Date.now() - startTime,
      passResults: intelligenceResult?.passResults ?? {},
      scanSummary,
      // Program scans stay hidden until their scope+scan finalization
      // transaction wins. Ad-hoc scans become visible immediately.
      scanStatus: opts.deferCompletion ? "running" : "complete",
    });

    await saveEnvironmentScan(
      finalScan,
      details,
      historiesWithHealth,
      // Lineage edges + FK insights were already written by the Phase 5
      // checkpoint save; passing them again would duplicate rows because
      // ForgeTableInsight has no unique key. The final save owns details,
      // histories, columns/tags, and the LLM insights. (bug 3)
      [],
      [...discoveryInsightRecords, ...llmInsightRecords],
      allColumns,
      allTableTags,
      allColumnTags,
      ownerEmail,
    );

    // Phase 8: Auto-compute Data Gap Analysis (writes dataAssetId back onto
    // ForgeTableDetail) and State-of-the-Nation Synthesis when not deferred.
    if (!opts.deferCompletion && ownerEmail) {
      if (effectiveIndustryId) {
        try {
          updateScanProgress(scanId, {
            phase: "saving",
            message: `Computing ${effectiveIndustryId} Reference Data Asset coverage & value-at-risk...`,
          });
          const { computeEstateDataGap } = await import(
            "@/lib/engines/data-gap-analysis/estate-data-gap"
          );
          await computeEstateDataGap({
            scanId,
            industryId: effectiveIndustryId,
            ownerEmail,
          });
        } catch (gapErr) {
          log.warn("Auto data-gap analysis failed (non-fatal)", {
            fn: "runStandaloneEnrichment",
            scanId,
            industryId: effectiveIndustryId,
            error: gapErr instanceof Error ? gapErr.message : String(gapErr),
          });
        }
      }

      try {
        updateScanProgress(scanId, {
          phase: "saving",
          message: "Synthesising consultant-grade State of the Nation brief...",
        });
        const { buildSynthesisInputForScan } = await import(
          "@/lib/ai/estate-synthesis/build-input"
        );
        const { runEstateSynthesis } = await import("@/lib/ai/estate-synthesis/engine");
        const { saveEstateSynthesis } = await import("@/lib/lakebase/estate-synthesis");
        const synthInput = await buildSynthesisInputForScan(scanId, ownerEmail, {
          industryId: effectiveIndustryId ?? null,
        });
        if (synthInput) {
          const synthResult = await runEstateSynthesis(synthInput);
          await saveEstateSynthesis({
            scanId,
            ownerEmail,
            industryId: synthInput.industryId ?? null,
            result: synthResult,
          });
        }
      } catch (synthErr) {
        log.warn("Auto estate synthesis failed (non-fatal)", {
          fn: "runStandaloneEnrichment",
          scanId,
          error: synthErr instanceof Error ? synthErr.message : String(synthErr),
        });
      }
    }

    // Generate vector embeddings for semantic search (best-effort, non-blocking)
    try {
      const { embedScanResults } = await import("@/lib/embeddings/embed-estate");
      await embedScanResults(
        scanId,
        details,
        historiesWithHealth,
        lineageGraph.edges,
        [...fkInsightRecords, ...llmInsightRecords],
        allColumns,
      );
    } catch (embedErr) {
      log.warn("Embedding generation failed (non-fatal)", {
        fn: "runStandaloneEnrichment",
        errorCategory: "embedding_generation_failed",
        scanId,
        error: embedErr instanceof Error ? embedErr.message : String(embedErr),
      });
    }

    updateScanProgress(scanId, {
      phase: "complete",
      message: `Scan complete — ${details.length} tables, ${lineageGraph.edges.length} lineage edges, ${intelligenceResult?.domains.length ?? 0} domains.`,
    });
    log.info("Complete", {
      scanId,
      tables: details.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    updateScanProgress(scanId, {
      phase: "failed",
      message: error instanceof Error ? error.message : "Scan failed unexpectedly.",
    });
    // Demote any checkpoint we wrote to `failed` so a partial estate scan is
    // excluded from aggregates/Portfolio/reconstitution. Best-effort — never
    // masks the original error.
    try {
      await markScanFailed(scanId);
    } catch (markErr) {
      log.warn("Failed to mark scan failed (non-fatal)", {
        scanId,
        error: markErr instanceof Error ? markErr.message : String(markErr),
      });
    }
    throw error;
  }
}
