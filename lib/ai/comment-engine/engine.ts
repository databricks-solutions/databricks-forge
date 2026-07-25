/**
 * Comment Engine -- main orchestrator.
 *
 * Wires the shared metadata context layer, industry knowledge adapter,
 * and all comment generation passes into a single `runCommentEngine()`
 * call. The engine does NOT touch persistence (Lakebase) -- callers are
 * responsible for persisting results.
 *
 * Architecture:
 *   Phase 0+1: buildSchemaContext()  -- metadata fetch + deterministic + LLM classification
 *   Phase 2:   runTableCommentPass() -- batched table descriptions with full context
 *   Phase 3:   runColumnCommentPass() -- parallel column descriptions with domain context
 *   Phase 4:   runConsistencyReview() -- terminology + quality review (optional)
 *
 * @module ai/comment-engine/engine
 */

import { buildSchemaContext } from "@/lib/metadata/context-builder";
import {
  buildIndustryContextPrompt,
  buildDataAssetContext,
  buildUseCaseLinkageContext,
} from "@/lib/domain/industry-outcomes-server";
import { runTableCommentPass, buildLineageContextBlock } from "./table-pass";
import { runColumnCommentPass } from "./column-pass";
import { runConsistencyReview, applyConsistencyFixes } from "./consistency-pass";
import { createScopedLogger } from "@/lib/logger";
import type { SchemaContext, MetadataScope } from "@/lib/metadata/types";
import type { Logger } from "@/lib/ports/logger";
import type {
  CommentEngineConfig,
  CommentEngineResult,
  TableCommentInput,
  ColumnCommentInput,
  MetadataCounters,
} from "./types";
import { DEFAULT_COMMENT_OUTPUT_LANGUAGE } from "./types";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runCommentEngine(
  scope: MetadataScope,
  config: CommentEngineConfig = {},
): Promise<CommentEngineResult> {
  const startTime = Date.now();
  const {
    industryId,
    businessContext,
    outputLanguage = DEFAULT_COMMENT_OUTPUT_LANGUAGE,
    enableConsistencyReview = true,
    enableLineage = true,
    enableHistory = true,
    signal,
    onProgress,
    onMetadataProgress,
    deps,
  } = config;

  const log: Logger =
    deps?.logger ??
    createScopedLogger({ origin: "CommentEngine", module: "ai/comment-engine/engine" });
  const counters: MetadataCounters = {};

  log.info("Starting", {
    catalogs: scope.catalogs,
    schemas: scope.schemas?.length,
    tables: scope.tables?.length,
    industryId,
    enableConsistencyReview,
    enableLineage,
    enableHistory,
    prebuiltSchemaContext: !!deps?.schemaContext,
  });

  // =======================================================================
  // Phase 0+1: Build Schema Context (skipped when pre-built context provided)
  // =======================================================================
  let industryContext = deps?.industryContext ?? "";
  let dataAssetText = deps?.dataAssetContext ?? "";
  let dataAssetList = deps?.dataAssetList ?? [];
  let useCaseLinkage = deps?.useCaseLinkage ?? "";
  let schemaContext: SchemaContext;

  if (deps?.schemaContext) {
    schemaContext = deps.schemaContext;
    log.info("Using pre-built schema context", {
      tables: schemaContext.tables.length,
    });
  } else {
    onProgress?.("schema-context", 0, "Building schema context...");

    if (industryId && !deps?.industryContext) {
      const [icPrompt, daContext] = await Promise.all([
        buildIndustryContextPrompt(industryId),
        buildDataAssetContext(industryId),
      ]);
      industryContext = icPrompt;
      dataAssetText = daContext.text;
      dataAssetList = daContext.assets;
    }

    schemaContext = await buildSchemaContext(scope, {
      industryId,
      dataAssetNames: dataAssetList,
      includeLineage: enableLineage,
      includeHistory: enableHistory,
      signal,
      onProgress: (_phase, pct, detail) => {
        onProgress?.("schema-context", Math.round(pct * 0.3), detail);
      },
      onMetadataCounters: (mc) => {
        Object.assign(counters, mc);
        onMetadataProgress?.(counters);
      },
    });
  }

  if (schemaContext.tables.length === 0) {
    log.warn("No tables found in schema context", {
      fn: "runCommentEngine",
      errorCategory: "empty_scope",
    });
    return emptyResult(schemaContext, Date.now() - startTime);
  }

  // Update counters after schema context is built
  counters.tablesFound = schemaContext.tables.length;
  counters.columnsFound = schemaContext.tables.reduce((s, t) => s + t.columns.length, 0);
  counters.lineageEdgesFound = schemaContext.lineageEdges.length;
  onMetadataProgress?.(counters);

  if (signal?.aborted) throw new Error("Cancelled");

  // Build use case linkage for matched data assets (unless pre-built)
  if (!useCaseLinkage && industryId) {
    const matchedAssetIds = schemaContext.tables
      .map((t) => t.dataAssetId)
      .filter((id): id is string => id !== null);
    const uniqueAssetIds = [...new Set(matchedAssetIds)];

    if (uniqueAssetIds.length > 0) {
      useCaseLinkage = await buildUseCaseLinkageContext(industryId, uniqueAssetIds);
    }
  }

  // =======================================================================
  // Phase 2: Table Comments
  // =======================================================================
  onProgress?.("tables", 0, "Generating table descriptions...");

  const targetFqnSet = new Set(schemaContext.tables.map((t) => t.fqn.toLowerCase()));
  const lineageContext = buildLineageContextBlock(schemaContext.lineageEdges, targetFqnSet);

  const tableInputs: TableCommentInput[] = schemaContext.tables.map((t) => ({
    fqn: t.fqn,
    columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
    existingComment: t.comment,
    domain: t.domain,
    role: t.role,
    tier: t.tier,
    dataAssetId: t.dataAssetId,
    dataAssetName: t.dataAssetName,
    writeFrequency: t.writeFrequency,
    owner: t.owner,
    tags: t.tags,
    relatedTableFqns: t.relatedTableFqns,
  }));

  const tableComments = await runTableCommentPass(
    tableInputs,
    {
      industryContext,
      businessContext: businessContext ?? "",
      dataAssetContext: dataAssetText,
      useCaseLinkage,
      schemaSummary: schemaContext.schemaSummary,
      lineageContext,
      outputLanguage,
    },
    {
      signal,
      onProgress,
      onCounters: (c) => {
        Object.assign(counters, c);
        onMetadataProgress?.(counters);
      },
      logger: log,
    },
  );

  if (signal?.aborted) throw new Error("Cancelled");

  // =======================================================================
  // Phase 3: Column Comments
  // =======================================================================
  onProgress?.("columns", 0, "Generating column descriptions...");

  // Build a lookup for data asset descriptions
  const assetDescLookup = new Map(dataAssetList.map((a) => [a.id, a.description]));

  // Build a lookup for table descriptions (from Phase 2 output or existing)
  const tableDescLookup = new Map<string, string>();
  for (const t of schemaContext.tables) {
    const generated = tableComments.get(t.fqn.toLowerCase());
    tableDescLookup.set(t.fqn.toLowerCase(), generated ?? t.comment ?? "No description available");
  }

  // For each table, find related tables and their descriptions
  const columnInputs: ColumnCommentInput[] = schemaContext.tables.map((t) => {
    const relatedTables = t.relatedTableFqns
      .map((fqn) => ({
        fqn,
        description: tableDescLookup.get(fqn.toLowerCase()) ?? "",
      }))
      .filter((r) => r.description);

    // Also include tables in the same domain
    if (t.domain) {
      const domainSiblings = schemaContext.tables.filter(
        (s) =>
          s.domain === t.domain &&
          s.fqn.toLowerCase() !== t.fqn.toLowerCase() &&
          !t.relatedTableFqns.some((r) => r.toLowerCase() === s.fqn.toLowerCase()),
      );
      for (const sib of domainSiblings.slice(0, 5)) {
        relatedTables.push({
          fqn: sib.fqn,
          description: tableDescLookup.get(sib.fqn.toLowerCase()) ?? "",
        });
      }
    }

    return {
      tableFqn: t.fqn,
      tableDescription: tableDescLookup.get(t.fqn.toLowerCase()) ?? "No description",
      tableDomain: t.domain,
      tableRole: t.role,
      dataAssetId: t.dataAssetId,
      dataAssetDescription: t.dataAssetId ? (assetDescLookup.get(t.dataAssetId) ?? null) : null,
      columns: t.columns.map((c) => ({
        name: c.name,
        dataType: c.dataType,
        isNullable: c.isNullable,
        existingComment: c.comment,
        inferredRole: c.inferredRole,
        inferredFkTarget: c.inferredFkTarget,
      })),
      relatedTables: relatedTables.slice(0, 10),
    };
  });

  const columnComments = await runColumnCommentPass(columnInputs, industryContext, outputLanguage, {
    signal,
    onProgress,
    onCounters: (c) => {
      Object.assign(counters, c);
      onMetadataProgress?.(counters);
    },
    logger: log,
  });

  if (signal?.aborted) throw new Error("Cancelled");

  // =======================================================================
  // Phase 4: Consistency Review (optional)
  // =======================================================================
  let consistencyFixes: Array<{
    tableFqn: string;
    columnName: string | null;
    issue: string;
    original: string;
    fixed: string;
  }> = [];
  let fixesApplied = 0;

  if (enableConsistencyReview && tableComments.size + columnComments.size > 0) {
    onProgress?.("consistency", 0, "Reviewing consistency...");

    try {
      consistencyFixes = await runConsistencyReview(
        tableComments,
        columnComments,
        schemaContext.schemaSummary,
        outputLanguage,
        { signal, onProgress, logger: log },
      );

      if (consistencyFixes.length > 0) {
        fixesApplied = applyConsistencyFixes(tableComments, columnComments, consistencyFixes);
        log.info("Consistency fixes applied", {
          found: consistencyFixes.length,
          applied: fixesApplied,
        });
      }
    } catch (err) {
      log.warn("Consistency review failed, skipping", {
        fn: "runCommentEngine",
        errorCategory: "consistency_review",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // =======================================================================
  // Done
  // =======================================================================
  const totalColumns = Array.from(columnComments.values()).reduce((sum, m) => sum + m.size, 0);
  const durationMs = Date.now() - startTime;

  log.info("Complete", {
    tables: tableComments.size,
    columns: totalColumns,
    consistencyFixes: consistencyFixes.length,
    fixesApplied,
    durationMs,
  });

  onProgress?.(
    "done",
    100,
    `${tableComments.size} table + ${totalColumns} column descriptions ready`,
  );

  return {
    tableComments,
    columnComments,
    schemaContext,
    consistencyFixes,
    stats: {
      tables: tableComments.size,
      columns: totalColumns,
      skipped: schemaContext.tables.length - tableComments.size,
      consistencyFixesApplied: fixesApplied,
      durationMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(schemaContext: SchemaContext, durationMs: number): CommentEngineResult {
  return {
    tableComments: new Map(),
    columnComments: new Map(),
    schemaContext,
    consistencyFixes: [],
    stats: { tables: 0, columns: 0, skipped: 0, consistencyFixesApplied: 0, durationMs },
  };
}
