/**
 * Pipeline Step 4: Use Case Generation
 *
 * Generates AI and statistical use cases in parallel batches using Model
 * Serving (JSON mode). Each batch processes a subset of tables.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import {
  generateAIFunctionsSummary,
  generateStatisticalFunctionsSummary,
  generateGeospatialFunctionsSummary,
} from "@/lib/ai/functions";
import {
  buildSchemaMarkdown,
  buildAdaptiveSchemaMarkdown,
  buildForeignKeyMarkdown,
} from "@/lib/queries/metadata";
import { buildReferenceUseCasesPrompt } from "@/lib/domain/industry-outcomes-server";
import { getMasterRepoEnrichmentAsync } from "@/lib/domain/industry-outcomes/master-repo-registry";
import { buildBenchmarkContextPrompt } from "@/lib/domain/benchmark-context";
import { persistManifest, deriveTags, type EnrichmentTag } from "@/lib/pipeline/context-manifest";
import {
  buildTokenAwareBatches,
  estimateTokens,
  MAX_PROMPT_TOKENS,
} from "@/lib/toolkit/token-budget";
import {
  resolveColumnBudget,
  applyWideSchemaLimits,
  computeAdaptiveColumnLimits,
  detectWideSchema,
  BATCH_ESTIMATION_COL_CAP,
  type ColumnScoreOptions,
  type AdaptiveColumnLimits,
} from "@/lib/toolkit/column-budget";
import {
  rankColumnsViaLLM,
  ColumnRankingCache,
  type LLMColumnRankingInput,
  type LLMColumnRankings,
} from "@/lib/toolkit/column-ranker";
import { fetchSampleData } from "@/lib/pipeline/sample-data";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { logger as fallbackLogger } from "@/lib/logger";
import type { PipelineContext, UseCase, UseCaseType, LineageGraph } from "@/lib/domain/types";
import { DEFAULT_DEPTH_CONFIGS } from "@/lib/domain/types";
import type { CommentOutputLanguage } from "@/lib/ai/comment-engine/types";
import { v4 as uuidv4 } from "uuid";

/**
 * Build a natural-language directive that tells the LLM which language to
 * write the use case fields in. Returns "" for English (default), since the
 * prompts are already English-native.
 */
function buildOutputLanguageDirective(language?: CommentOutputLanguage): string {
  switch (language) {
    case "pt-BR":
      return "### OUTPUT LANGUAGE\n\n**Write all natural-language fields (name, statement, solution, business_value, beneficiary, sponsor, technical_design) in Brazilian Portuguese (pt-BR).** Keep technical identifiers (table names, function names like ai_forecast, JSON keys, SQL keywords, analytics_technique values) in English exactly as listed in the schema and function registry.";
    case "es":
      return "### OUTPUT LANGUAGE\n\n**Write all natural-language fields (name, statement, solution, business_value, beneficiary, sponsor, technical_design) in Spanish (es).** Keep technical identifiers (table names, function names like ai_forecast, JSON keys, SQL keywords, analytics_technique values) in English exactly as listed in the schema and function registry.";
    default:
      return "";
  }
}

const DEFAULT_CONCURRENT_BATCHES = 8;
const LARGE_SCHEMA_CONCURRENT_BATCHES = 3;
const LARGE_SCHEMA_TABLE_THRESHOLD = 3_000;
const MAX_GENERATION_RETRIES = 2;

/**
 * If the adaptive engine keeps at least this fraction of the original column
 * count, the trim is considered marginal and we skip the LLM ranking round
 * trip (heuristic scoring is good enough when the overall shave is small).
 */
const MIN_TRIM_RATIO_FOR_LLM_RANKING = 0.85;

/**
 * Floor for `availableSchemaTokens`. When computed values fall below this
 * (e.g. an unusually large shared context), we clamp and warn so the adaptive
 * engine doesn't produce unrealistically tiny per-table budgets that cascade
 * into over-budget prompts anyway.
 */
const AVAILABLE_SCHEMA_TOKENS_FLOOR = 5_000;

/** Shape of each use case object in the JSON array returned by the LLM. */
interface UseCaseItem {
  no?: number;
  name?: string;
  type?: string;
  analytics_technique?: string;
  statement?: string;
  solution?: string;
  business_value?: string;
  beneficiary?: string;
  sponsor?: string;
  tables_involved?: string[] | string;
  technical_design?: string;
  /**
   * Verbatim copy of the closest matching INDUSTRY REFERENCE USE CASE title.
   * `null` when no master-repo UC plausibly applies. Validated by the parser
   * against the known master-repo names for the run's industry; unrecognised
   * strings are normalised to `null` so the persisted column stays clean.
   */
  reference_use_case_name?: string | null;
}

/**
 * Build a case-insensitive lookup from master-repo UC titles for the given
 * industry. The map values preserve the canonical (master-repo) casing so
 * the parser can normalise minor LLM punctuation/case drift back to the
 * canonical form.
 *
 * Returns an empty Map when no industry is configured or the industry has
 * no master-repo enrichment. In that case the parser keeps whatever string
 * the LLM emitted (verbatim, trimmed), since there is no allow-list to
 * validate against.
 */
async function buildAllowedReferenceNames(
  industryId?: string | null,
): Promise<Map<string, string>> {
  if (!industryId) return new Map();
  try {
    const enrichment = await getMasterRepoEnrichmentAsync(industryId);
    if (!enrichment) return new Map();
    return new Map(
      enrichment.useCases.map((uc) => [uc.name.toLowerCase().trim(), uc.name] as const),
    );
  } catch {
    return new Map();
  }
}

/**
 * Normalise an LLM-emitted `reference_use_case_name` against the canonical
 * master-repo names for this run's industry.
 *
 * - Trims whitespace.
 * - Treats `null`, `""`, `"none"`, `"n/a"` as null.
 * - Looks up case-insensitively against `allowedReferenceNames`; returns the
 *   canonical casing on hit.
 * - When the allow-list is empty (no industry / no enrichment), passes the
 *   trimmed value through so a future Data Gap backfill or fuzzy matcher
 *   can still try.
 * - Returns `null` for anything that doesn't survive validation rather
 *   than persisting LLM hallucinations.
 *
 * Exported for unit testing; production callers go through the parser
 * inside {@link generateBatch}.
 */
export function normalizeReferenceUseCaseName(
  raw: unknown,
  allowedReferenceNames: Map<string, string>,
): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "null" || lower === "none" || lower === "n/a") return null;
  if (allowedReferenceNames.size === 0) return trimmed;
  return allowedReferenceNames.get(lower) ?? null;
}

export async function runUsecaseGeneration(
  ctx: PipelineContext,
  runId?: string,
): Promise<UseCase[]> {
  const log = ctx.logger ?? fallbackLogger;
  const { run, metadata, filteredTables } = ctx;
  if (!metadata) throw new Error("Metadata not available");
  if (!run.businessContext) throw new Error("Business context not available");

  const bc = run.businessContext;

  // Filter metadata to only business-relevant tables
  const tables = metadata.tables.filter((t) => filteredTables.includes(t.fqn));
  const columns = metadata.columns.filter((c) => filteredTables.includes(c.tableFqn));

  const sampleRows = run.config.sampleRowsPerTable ?? 0;
  const outputLanguageDirective = buildOutputLanguageDirective(run.config.outputLanguage);

  // Build shared context that goes into every prompt (used for base token calc).
  // Filter FKs to only those involving business-relevant tables to avoid
  // unbounded string growth on large schemas (12k+ tables).
  const filteredFqnSet = new Set(filteredTables.map((f) => f.replace(/`/g, "")));
  const relevantFks = metadata.foreignKeys.filter(
    (fk) =>
      filteredFqnSet.has(fk.tableFqn.replace(/`/g, "")) ||
      filteredFqnSet.has(fk.referencedTableFqn.replace(/`/g, "")),
  );
  const depth = run.config.discoveryDepth ?? "balanced";
  const dc = run.config.depthConfig ?? DEFAULT_DEPTH_CONFIGS[depth];
  const targetRange = { min: dc.batchTargetMin, max: dc.batchTargetMax };

  const lineageContext = ctx.lineageGraph
    ? buildFilteredLineageSummary(ctx.lineageGraph, filteredTables, 30)
    : "";

  // Build existing asset context from discovery results
  let assetContext = "";
  if (ctx.discoveryResult) {
    const { buildAssetContextForGeneration } = await import("@/lib/discovery/prompt-context");
    assetContext = buildAssetContextForGeneration(ctx.discoveryResult, filteredTables);
  }

  const focusAreasInstruction = run.config.businessDomains
    ? `**FOCUS AREAS**: Focus your use cases on these business areas: ${run.config.businessDomains}. At least 60% of generated use cases should directly address these domains.`
    : "";

  const industryReferenceUseCases = run.config.industry
    ? await buildReferenceUseCasesPrompt(run.config.industry, run.config.businessDomains)
    : "";

  // Pre-compute the set of valid master-repo use case titles for this run's
  // industry so the parser can validate the LLM's `reference_use_case_name`
  // output and drop hallucinated values without polluting the column. The
  // lookup is case-insensitive to absorb minor LLM punctuation drift, but we
  // always persist the canonical (master-repo) casing on the row.
  const allowedReferenceNames = await buildAllowedReferenceNames(run.config.industry);
  const benchmarkResult = await buildBenchmarkContextPrompt(
    run.config.industry || undefined,
    run.config.customerMaturity,
  );

  // Load accepted use cases from prior runs as few-shot examples
  let feedbackExamplesSection = "";
  try {
    const { getFeedbackExamples } = await import("@/lib/lakebase/usecases");
    const examples = await getFeedbackExamples(run.config.ucMetadata, 8);
    if (examples.length > 0) {
      feedbackExamplesSection =
        "\n\n**USER-APPROVED USE CASES FROM PRIOR RUNS** (generate similar quality and style):\n" +
        examples.map((ex, i) => `${i + 1}. "${ex.name}" (${ex.type}) — ${ex.statement}`).join("\n");
    }
  } catch {
    // Non-critical: proceed without feedback examples
  }

  // Retrieve relevant strategy/priority context from knowledge base (RAG)
  let documentContext = "";
  let docSourceIds: string[] = [];
  let docKinds: string[] = [];
  let docChunkCount = 0;
  try {
    const { retrieveContext, formatRetrievedContext } = await import("@/lib/embeddings/retriever");
    const chunks = await retrieveContext(
      `Use case generation for ${run.config.businessName}: ${bc.industries || ""} ${bc.businessPriorities || ""} ${bc.strategicGoals || ""}`,
      { kinds: ["document_chunk", "outcome_map", "business_context"], topK: 5, minScore: 0.4 },
    );
    if (chunks.length > 0) {
      documentContext = "\n\n" + formatRetrievedContext(chunks, 4000);
      docSourceIds = [...new Set(chunks.map((c) => c.sourceId))];
      docKinds = [...new Set(chunks.map((c) => c.kind))];
      docChunkCount = chunks.length;
    }
  } catch {
    // RAG is best-effort
  }

  // Load PBI/Fabric context when a scan is linked to this run
  let pbiContext = "";
  if (run.config.fabricScanId) {
    try {
      const { buildPbiContextForGeneration } = await import("@/lib/fabric/prompt-context");
      pbiContext = await buildPbiContextForGeneration(run.config.fabricScanId);
    } catch {
      // PBI context is best-effort
    }
  }

  // Persist enrichment provenance and derive use-case-level tags
  const outcomeMapSections: string[] = [];
  if (industryReferenceUseCases) outcomeMapSections.push("reference_usecases");
  const stepManifest: Parameters<typeof persistManifest>[1] = {
    benchmarks: benchmarkResult.sources,
    outcomeMap: { industryId: run.config.industry || null, sections: outcomeMapSections },
    documents: { sourceIds: docSourceIds, kinds: docKinds, chunkCount: docChunkCount },
    steps: ["usecase-generation"],
  };
  if (run.config.fabricScanId && pbiContext) {
    const { getFabricScanDetail } = await import("@/lib/lakebase/fabric-scans");
    const fbDetail = await getFabricScanDetail(run.config.fabricScanId).catch(() => null);
    stepManifest.fabric = {
      scanId: run.config.fabricScanId,
      datasetCount: fbDetail?.datasetCount ?? 0,
      measureCount: fbDetail?.measureCount ?? 0,
      reportCount: fbDetail?.reportCount ?? 0,
    };
  }
  const enrichmentTags: EnrichmentTag[] = deriveTags({
    benchmarks: stepManifest.benchmarks!,
    outcomeMap: { industryId: run.config.industry || null, sections: outcomeMapSections },
    documents: stepManifest.documents!,
    fabric: stepManifest.fabric,
  });
  if (runId) {
    try {
      await persistManifest(runId, stepManifest);
    } catch (e) {
      log.warn("persistManifest failed (non-fatal)", {
        fn: "runUsecaseGeneration",
        errorCategory: "db",
        error: e,
      });
    }
  }

  const baseColBudget = resolveColumnBudget();

  // Build column score options from FK metadata so buildSchemaMarkdown uses
  // intelligent three-tier column selection instead of ordinal truncation.
  const fkColumnNames = new Set<string>();
  for (const fk of relevantFks) {
    fkColumnNames.add(fk.columnName);
    fkColumnNames.add(fk.referencedColumnName);
  }
  const columnScoreOpts: ColumnScoreOptions = {
    fkColumnNames,
  };

  // Estimate base token cost (everything except schema_markdown, sample_data,
  // and FK markdown which are now scoped per batch)
  const sharedContextTokens = estimateTokens(
    JSON.stringify(bc) +
      lineageContext +
      focusAreasInstruction +
      industryReferenceUseCases +
      generateAIFunctionsSummary() +
      generateGeospatialFunctionsSummary(),
  );
  // Add overhead for the prompt template itself (~2000 tokens)
  const baseTokens = sharedContextTokens + 2000;

  // Pre-sort tables by catalog.schema so buildTokenAwareBatches groups
  // related tables together, improving LLM context coherence and making
  // per-batch FK scoping more effective.
  const sortedTables = [...tables].sort((a, b) => {
    const keyA = `${a.catalog}.${a.schema}`;
    const keyB = `${b.catalog}.${b.schema}`;
    return keyA.localeCompare(keyB);
  });

  // Token-aware batching: renderItem estimates the per-table schema size
  const columnsByTable = new Map<string, typeof columns>();
  for (const col of columns) {
    const existing = columnsByTable.get(col.tableFqn) ?? [];
    existing.push(col);
    columnsByTable.set(col.tableFqn, existing);
  }

  // Wide-schema detection drives fetch-level memory limits for sample data
  // fetching below (was previously logged but never applied -- see B3).
  const wideSchemaInfo = detectWideSchema(columnsByTable);
  const colBudget = applyWideSchemaLimits(baseColBudget, wideSchemaInfo.hasWideTables);
  if (wideSchemaInfo.hasWideTables) {
    log.info("Wide-schema detected in use-case generation -- applying fetch limits", {
      wideTableCount: wideSchemaInfo.wideTableCount,
      maxColumnCount: wideSchemaInfo.maxColumnCount,
      maxSampleColumns: colBudget.maxSampleColumns,
    });
  }

  // Use a capped column estimate for batch packing so wide tables don't
  // shatter batches (the adaptive engine still handles the real cap at
  // render time). See BATCH_ESTIMATION_COL_CAP.
  const batches = buildTokenAwareBatches(
    sortedTables,
    (table) =>
      buildSchemaMarkdown(
        [table],
        columnsByTable.get(table.fqn) ?? [],
        colBudget.maxCommentLength,
        undefined,
        BATCH_ESTIMATION_COL_CAP,
        columnScoreOpts,
      ),
    baseTokens,
  );

  // Reduce concurrency on large schemas to limit peak memory from
  // parallel LLM requests and their response payloads.
  const maxConcurrentBatches =
    tables.length >= LARGE_SCHEMA_TABLE_THRESHOLD
      ? LARGE_SCHEMA_CONCURRENT_BATCHES
      : DEFAULT_CONCURRENT_BATCHES;

  log.info("Use case generation starting", {
    tableCount: tables.length,
    batchCount: batches.length,
    sampleRowsPerTable: sampleRows,
    concurrency: maxConcurrentBatches,
  });

  const allUseCases: UseCase[] = [];
  let attemptedBatchCalls = 0;
  let failedBatchCalls = 0;
  let emptyBatchCalls = 0;

  // Run-scoped cache for LLM column rankings so identical (fqn, keepCount)
  // pairs across concurrent batches don't incur duplicate LLM calls.
  const rankingCache = new ColumnRankingCache();

  // Aggregate adaptive-trim statistics surfaced at end-of-step.
  const adaptiveStats = {
    batchesTotal: 0,
    batchesTrimmed: 0,
    totalColumnsBefore: 0,
    totalColumnsAfter: 0,
    llmRankingCalls: 0,
    llmRankedTables: 0,
    heuristicRankedTables: 0,
    trivialTrimsSkipped: 0,
    budgetImpossibleBatches: 0,
    correctivePassBatches: 0,
  };

  // Process batches with controlled concurrency and cross-batch feedback
  let batchGroupIdx = 0;
  for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
    batchGroupIdx++;
    const totalGroups = Math.ceil(batches.length / maxConcurrentBatches);
    const samplingNote = sampleRows > 0 ? ` with ${sampleRows}-row sampling` : "";
    if (runId)
      await updateRunMessage(
        runId,
        `Generating AI & statistical use cases${samplingNote} (batch group ${batchGroupIdx} of ${totalGroups})...`,
      );
    const concurrentBatches = batches.slice(i, i + maxConcurrentBatches);

    // Build cross-batch feedback: list of already-generated use case names
    const previousFeedback = buildPreviousUseCasesFeedback(allUseCases);

    // Fetch sample data for all tables in this concurrent group (if enabled).
    // The structured cache is shared, but markdown is built per-batch below
    // so each prompt only includes sample rows for its own tables.
    const concurrentTableFqns = concurrentBatches.flat().map((t) => t.fqn);
    let groupSampleCache: import("@/lib/genie/types").SampleDataCache = new Map();
    if (sampleRows > 0 && concurrentTableFqns.length > 0) {
      const sampleResult = await fetchSampleData(
        concurrentTableFqns,
        sampleRows,
        { runId, userEmail: run.createdBy, step: "usecase-generation" },
        colBudget.maxSampleColumns > 0
          ? { maxSampleColumns: colBudget.maxSampleColumns, columnsByTable }
          : undefined,
      );
      groupSampleCache = sampleResult.structured;
      // Accumulate structured sample data for downstream Genie Engine use
      if (sampleResult.structured.size > 0) {
        if (!ctx.sampleData) ctx.sampleData = new Map();
        for (const [fqn, entry] of sampleResult.structured) {
          ctx.sampleData.set(fqn, entry);
        }
      }
      if (sampleResult.tablesSampled > 0) {
        log.info("Sample data fetched for use case generation batch", {
          batchGroup: batchGroupIdx,
          tablesSampled: sampleResult.tablesSampled,
          tablesSkipped: sampleResult.tablesSkipped,
          totalRows: sampleResult.totalRows,
        });
      }
    }

    // ----------------------------------------------------------------
    // Phase A (sync) -- per-batch prep and adaptive limit computation.
    // Ranking calls are queued here but not awaited, so every batch in
    // this concurrent group can rank in parallel during Phase B.
    // ----------------------------------------------------------------
    interface BatchPrep {
      batch: typeof concurrentBatches[number];
      batchColumns: typeof columns;
      batchColsByTable: Map<string, typeof columns>;
      batchSampleSection: string;
      batchFkMarkdown: string;
      adaptiveResult: AdaptiveColumnLimits;
      availableSchemaTokens: number;
      rankingTask: Promise<LLMColumnRankings>;
      /** True when trim was skipped because the keep ratio was above MIN_TRIM_RATIO. */
      trimSkippedAsTrivial: boolean;
    }

    const preps: BatchPrep[] = [];

    for (const batch of concurrentBatches) {
      const batchColumns = columns.filter((c) => batch.some((t) => t.fqn === c.tableFqn));

      const batchSampleSection = buildSampleMarkdownFromCache(
        groupSampleCache,
        batch.map((t) => t.fqn),
      );

      const batchFqnSet = new Set(batch.map((t) => t.fqn.replace(/`/g, "")));
      const batchFks = relevantFks.filter(
        (fk) =>
          batchFqnSet.has(fk.tableFqn.replace(/`/g, "")) ||
          batchFqnSet.has(fk.referencedTableFqn.replace(/`/g, "")),
      );
      const batchFkMarkdown = buildForeignKeyMarkdown(batchFks);

      const batchFixedTokens = estimateTokens(
        batchSampleSection + batchFkMarkdown + previousFeedback + feedbackExamplesSection,
      );
      const rawAvailableSchemaTokens = MAX_PROMPT_TOKENS - baseTokens - batchFixedTokens;
      if (rawAvailableSchemaTokens <= 0) {
        log.warn("availableSchemaTokens non-positive; clamping to floor", {
          fn: "runUsecaseGeneration",
          batchGroupIndex: batchGroupIdx,
          rawAvailableSchemaTokens,
          floor: AVAILABLE_SCHEMA_TOKENS_FLOOR,
        });
      }
      const availableSchemaTokens = Math.max(
        AVAILABLE_SCHEMA_TOKENS_FLOOR,
        rawAvailableSchemaTokens,
      );

      const batchColsByTable = new Map<string, typeof batchColumns>();
      for (const col of batchColumns) {
        const existing = batchColsByTable.get(col.tableFqn) ?? [];
        existing.push(col);
        batchColsByTable.set(col.tableFqn, existing);
      }

      const adaptiveResult = computeAdaptiveColumnLimits(
        batch,
        batchColsByTable,
        availableSchemaTokens,
      );

      if (adaptiveResult.correctivePassApplied) {
        adaptiveStats.correctivePassBatches++;
        log.warn(
          "Adaptive budget corrective pass shaved columns to stay under token budget",
          {
            fn: "runUsecaseGeneration",
            batchGroupIndex: batchGroupIdx,
            availableSchemaTokens,
            totalColumnsAfter: adaptiveResult.totalAfter,
          },
        );
      }
      if (adaptiveResult.budgetImpossible) {
        adaptiveStats.budgetImpossibleBatches++;
        log.warn(
          "Adaptive budget impossible: floor-only limits exceed availableSchemaTokens",
          {
            fn: "runUsecaseGeneration",
            batchGroupIndex: batchGroupIdx,
            availableSchemaTokens,
            totalColumnsAfter: adaptiveResult.totalAfter,
            tableCount: batch.length,
          },
        );
      }

      // Decide whether to consult the LLM for column ranking.
      let rankingTask: Promise<LLMColumnRankings> = Promise.resolve({
        rankings: new Map(),
        llmTables: new Set(),
        heuristicTables: new Set(),
        callMade: false,
        fromLLM: false,
      });
      let trimSkippedAsTrivial = false;

      if (adaptiveResult.trimmed) {
        const keepRatio =
          adaptiveResult.totalBefore > 0
            ? adaptiveResult.totalAfter / adaptiveResult.totalBefore
            : 1;
        if (keepRatio >= MIN_TRIM_RATIO_FOR_LLM_RANKING) {
          // Trim is marginal -- heuristic scoring is good enough.
          trimSkippedAsTrivial = true;
        } else {
          const trimmedInputs: LLMColumnRankingInput[] = adaptiveResult.trimDetails.map((td) => {
            const tableCols = batchColsByTable.get(td.fqn) ?? [];
            const tableInfo = batch.find((t) => t.fqn === td.fqn);
            return {
              fqn: td.fqn,
              tableComment: tableInfo?.comment ?? null,
              columns: tableCols.map((c) => ({
                name: c.columnName,
                dataType: c.dataType,
                comment: c.comment ?? null,
              })),
              keepCount: td.kept,
            };
          });

          const bcSummary = `Industry: ${bc.industries}\nGoals: ${bc.strategicGoals}\nPriorities: ${bc.businessPriorities}`;
          rankingTask = rankColumnsViaLLM(
            trimmedInputs,
            bcSummary,
            resolveEndpoint("classification"),
            log,
            rankingCache,
          );
        }
      }

      preps.push({
        batch,
        batchColumns,
        batchColsByTable,
        batchSampleSection,
        batchFkMarkdown,
        adaptiveResult,
        availableSchemaTokens,
        rankingTask,
        trimSkippedAsTrivial,
      });
    }

    // ----------------------------------------------------------------
    // Phase B -- run every queued ranking call in parallel.
    // ----------------------------------------------------------------
    const rankingResults = await Promise.all(preps.map((p) => p.rankingTask));

    // Accumulate stats + emit a single aggregate run message for the group.
    let groupTablesTrimmed = 0;
    let groupColumnsBefore = 0;
    let groupColumnsAfter = 0;
    let groupLLMTables = 0;
    let groupHeuristicTables = 0;
    let groupLLMCallsMade = 0;
    let groupTrivialSkipped = 0;

    preps.forEach((p, idx) => {
      const r = rankingResults[idx];
      adaptiveStats.batchesTotal++;
      if (p.adaptiveResult.trimmed) {
        adaptiveStats.batchesTrimmed++;
        adaptiveStats.totalColumnsBefore += p.adaptiveResult.totalBefore;
        adaptiveStats.totalColumnsAfter += p.adaptiveResult.totalAfter;
        groupTablesTrimmed += p.adaptiveResult.trimDetails.length;
        groupColumnsBefore += p.adaptiveResult.totalBefore;
        groupColumnsAfter += p.adaptiveResult.totalAfter;
      }
      if (r.callMade) {
        adaptiveStats.llmRankingCalls++;
        groupLLMCallsMade++;
      }
      adaptiveStats.llmRankedTables += r.llmTables.size;
      adaptiveStats.heuristicRankedTables += r.heuristicTables.size;
      groupLLMTables += r.llmTables.size;
      groupHeuristicTables += r.heuristicTables.size;
      if (p.trimSkippedAsTrivial) {
        adaptiveStats.trivialTrimsSkipped++;
        groupTrivialSkipped++;
      }
    });

    if (runId && groupTablesTrimmed > 0) {
      const parts: string[] = [
        `Adaptive column budgeting active — ${groupTablesTrimmed} tables trimmed from ${groupColumnsBefore} to ${groupColumnsAfter} total columns`,
      ];
      if (groupLLMTables > 0 || groupHeuristicTables > 0) {
        parts.push(
          `${groupLLMTables} ranked by LLM, ${groupHeuristicTables} by heuristic`,
        );
      }
      if (groupTrivialSkipped > 0) {
        parts.push(`${groupTrivialSkipped} trivial trims skipped LLM`);
      }
      await updateRunMessage(runId, `${parts.join("; ")}.`);
    }

    if (groupTablesTrimmed > 0) {
      log.info("Adaptive column budget group summary", {
        step: "usecase-generation",
        batchGroupIndex: batchGroupIdx,
        batchesInGroup: preps.length,
        tablesTrimmed: groupTablesTrimmed,
        columnsBefore: groupColumnsBefore,
        columnsAfter: groupColumnsAfter,
        llmTables: groupLLMTables,
        heuristicTables: groupHeuristicTables,
        llmCallsMade: groupLLMCallsMade,
        trivialTrimsSkipped: groupTrivialSkipped,
      });
    }

    // ----------------------------------------------------------------
    // Phase C -- render schemas with per-batch rankings and dispatch.
    // ----------------------------------------------------------------
    const batchPromises: Promise<UseCase[]>[] = [];

    preps.forEach((p, idx) => {
      const r = rankingResults[idx];
      const llmRankings = r.rankings.size > 0 ? r.rankings : undefined;

      const schemaMarkdown = buildAdaptiveSchemaMarkdown(
        p.batch,
        p.batchColumns,
        p.adaptiveResult.limits,
        llmRankings,
        colBudget.maxCommentLength,
        columnScoreOpts,
      );

      const tableCount = p.batch.length;
      const targetCount = Math.max(targetRange.min, Math.min(targetRange.max, tableCount));

      const baseVars: Record<string, string> = {
        output_language_directive: outputLanguageDirective,
        business_context: JSON.stringify(bc),
        strategic_goals: bc.strategicGoals,
        business_priorities: bc.businessPriorities,
        strategic_initiative: bc.strategicInitiative,
        value_chain: bc.valueChain,
        revenue_model: bc.revenueModel,
        additional_context_section: bc.additionalContext || "None provided.",
        focus_areas_instruction: focusAreasInstruction,
        industry_reference_use_cases: industryReferenceUseCases,
        schema_markdown: schemaMarkdown,
        foreign_key_relationships: p.batchFkMarkdown,
        sample_data_section: p.batchSampleSection,
        previous_use_cases_feedback: previousFeedback + feedbackExamplesSection,
        target_use_case_count: String(targetCount),
        lineage_context: lineageContext,
        asset_context: assetContext,
        document_context: documentContext,
        benchmark_context: benchmarkResult.text,
        pbi_context: pbiContext,
        customer_profile_context: `Customer maturity: ${run.config.customerMaturity}\nRisk posture: ${run.config.riskPosture}\nTransformation horizon: ${run.config.transformationHorizon}\nAdditional context: ${run.config.additionalContext || "None provided"}`,
      };

      batchPromises.push(
        generateBatch(
          log,
          "AI_USE_CASE_GEN_PROMPT",
          {
            ...baseVars,
            ai_functions_summary: generateAIFunctionsSummary(),
            statistical_functions_detailed: "",
            geospatial_functions_summary: generateGeospatialFunctionsSummary(),
          },
          "AI",
          run.runId,
          resolveEndpoint("reasoning"),
          runId,
          enrichmentTags,
          allowedReferenceNames,
        ),
        generateBatch(
          log,
          "STATS_USE_CASE_GEN_PROMPT",
          {
            ...baseVars,
            ai_functions_summary: "",
            statistical_functions_detailed: generateStatisticalFunctionsSummary(),
          },
          "Statistical",
          run.runId,
          resolveEndpoint("reasoning"),
          runId,
          enrichmentTags,
          allowedReferenceNames,
        ),
      );
    });
    attemptedBatchCalls += batchPromises.length;

    const results = await Promise.allSettled(batchPromises);
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.length > 0) {
          allUseCases.push(...result.value);
        } else {
          emptyBatchCalls++;
        }
      } else {
        failedBatchCalls++;
        log.warn("Use case generation batch failed", {
          fn: "runUsecaseGeneration",
          errorCategory: "llm_error",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  // Re-number use cases
  allUseCases.forEach((uc, idx) => {
    uc.useCaseNo = idx + 1;
  });

  if (runId)
    await updateRunMessage(
      runId,
      `Generated ${allUseCases.length} raw use cases from ${tables.length} tables`,
    );

  if (allUseCases.length === 0 && tables.length > 0) {
    const allRequestsFailed = attemptedBatchCalls > 0 && failedBatchCalls === attemptedBatchCalls;
    const message = allRequestsFailed
      ? "Use case generation failed for all model requests. Please retry this run."
      : "No use cases were generated from model responses. Please retry this run.";
    log.error("Use case generation produced no output", {
      fn: "runUsecaseGeneration",
      errorCategory: "llm_empty",
      tableCount: tables.length,
      attemptedBatchCalls,
      failedBatchCalls,
      emptyBatchCalls,
    });
    throw new Error(message);
  }

  const rankingCacheStats = rankingCache.stats();
  log.info("Use case generation complete", {
    useCaseCount: allUseCases.length,
    adaptive: {
      ...adaptiveStats,
      rankingCacheHits: rankingCacheStats.hits,
      rankingCacheMisses: rankingCacheStats.misses,
      rankingCacheSize: rankingCacheStats.size,
    },
  });

  if (runId && adaptiveStats.batchesTrimmed > 0) {
    const avgKept =
      adaptiveStats.batchesTrimmed > 0
        ? Math.round(adaptiveStats.totalColumnsAfter / adaptiveStats.batchesTrimmed)
        : 0;
    const avgBefore =
      adaptiveStats.batchesTrimmed > 0
        ? Math.round(adaptiveStats.totalColumnsBefore / adaptiveStats.batchesTrimmed)
        : 0;
    await updateRunMessage(
      runId,
      `Adaptive column budget summary: ${adaptiveStats.batchesTrimmed}/${adaptiveStats.batchesTotal} batches trimmed (avg ${avgKept}/${avgBefore} cols kept); ${adaptiveStats.llmRankingCalls} LLM ranking call(s), ${rankingCacheStats.hits} cache hit(s), ${adaptiveStats.trivialTrimsSkipped} trivial trim(s) skipped.`,
    );
  }

  return allUseCases;
}

/**
 * Build a feedback string listing previously generated use case names so
 * subsequent batches avoid duplicating them.
 */
const MAX_FEEDBACK_USE_CASES = 100;

function buildPreviousUseCasesFeedback(existing: UseCase[]): string {
  if (existing.length === 0) {
    return "None -- this is the first batch.";
  }

  const names = existing.map((uc) => uc.name).filter(Boolean);
  const shown =
    names.length > MAX_FEEDBACK_USE_CASES ? names.slice(-MAX_FEEDBACK_USE_CASES) : names;
  const prefix =
    names.length > MAX_FEEDBACK_USE_CASES
      ? `The following ${MAX_FEEDBACK_USE_CASES} most recent use cases (of ${names.length} total) have ALREADY been generated. `
      : `The following ${names.length} use cases have ALREADY been generated. `;
  return (
    prefix +
    `Do NOT generate similar or overlapping use cases:\n` +
    shown.map((n) => `- ${n}`).join("\n")
  );
}

async function generateBatch(
  log: typeof fallbackLogger,
  promptKey: "AI_USE_CASE_GEN_PROMPT" | "STATS_USE_CASE_GEN_PROMPT",
  variables: Record<string, string>,
  type: UseCaseType,
  useCaseRunId: string,
  aiModel: string,
  logRunId?: string,
  tags?: EnrichmentTag[],
  allowedReferenceNames: Map<string, string> = new Map(),
): Promise<UseCase[]> {
  const result = await executeAIQuery({
    promptKey,
    variables,
    modelEndpoint: aiModel,
    responseFormat: "json_object",
    runId: logRunId,
    step: "usecase-generation",
    retries: MAX_GENERATION_RETRIES,
    maxTokens: 128000,
  });

  if (result.finishReason === "length") {
    log.warn("Use case generation response truncated, attempting recovery", {
      fn: "runUsecaseGeneration",
      errorCategory: "llm_empty",
      promptKey,
      completionTokens: result.tokenUsage?.completionTokens,
    });
  }

  let items: UseCaseItem[];
  try {
    const parsed = parseLLMJson(result.rawResponse, "usecase-generation") as
      | UseCaseItem[]
      | { use_cases: UseCaseItem[] };
    items = Array.isArray(parsed) ? parsed : (parsed.use_cases ?? []);
  } catch (parseErr) {
    log.warn("Failed to parse use case generation JSON", {
      fn: "runUsecaseGeneration",
      errorCategory: "llm_parse",
      promptKey,
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    return [];
  }

  return items
    .filter(
      (item) =>
        typeof item.name === "string" &&
        typeof item.statement === "string" &&
        typeof item.business_value === "string" &&
        typeof item.analytics_technique === "string",
    )
    .map((item) => {
      // tables_involved can be an array (expected) or comma-separated string (fallback)
      let tablesInvolved: string[];
      if (Array.isArray(item.tables_involved)) {
        tablesInvolved = item.tables_involved.map((t) => t.trim()).filter(Boolean);
      } else if (typeof item.tables_involved === "string") {
        tablesInvolved = item.tables_involved
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        tablesInvolved = [];
      }

      return {
        id: uuidv4(),
        runId: useCaseRunId,
        useCaseNo: item.no ?? 0,
        name: item.name?.trim() ?? "",
        type: (item.type?.trim() as UseCaseType) || type,
        analyticsTechnique: item.analytics_technique?.trim() ?? "",
        statement: item.statement?.trim() ?? "",
        solution: item.solution?.trim() ?? "",
        businessValue: item.business_value?.trim() ?? "",
        beneficiary: item.beneficiary?.trim() ?? "",
        sponsor: item.sponsor?.trim() ?? "",
        domain: "", // assigned in Step 5
        subdomain: "", // assigned in Step 5
        tablesInvolved,
        priorityScore: 0, // scored in Step 6
        feasibilityScore: 0,
        impactScore: 0,
        overallScore: 0,
        userPriorityScore: null,
        userFeasibilityScore: null,
        userImpactScore: null,
        userOverallScore: null,
        scoreRationale: null, // populated in Step 6
        consultingScorecard: null, // populated in Step 6
        sqlCode: null,
        sqlStatus: null,
        feedback: null,
        feedbackAt: null,
        enrichmentTags: tags && tags.length > 0 ? tags : null,
        sourceSystems: null,
        sourceSystemsOrigin: null,
        blastRadius: null,
        referenceUseCaseName: normalizeReferenceUseCaseName(
          item.reference_use_case_name,
          allowedReferenceNames,
        ),
        referenceUseCaseResolvedAt: new Date().toISOString(),
      };
    });
}

/**
 * Build a lineage summary filtered to business-relevant tables.
 * Only includes edges where at least one endpoint survived table filtering,
 * which naturally excludes bronze/raw staging tables that were classified as technical.
 */
function buildFilteredLineageSummary(
  graph: LineageGraph,
  filteredTables: string[],
  maxEdges: number,
): string {
  if (graph.edges.length === 0) return "";

  const filteredSet = new Set(filteredTables);
  const relevant = graph.edges.filter(
    (e) => filteredSet.has(e.sourceTableFqn) || filteredSet.has(e.targetTableFqn),
  );
  if (relevant.length === 0) return "";

  const edges = relevant.slice(0, maxEdges);
  const lines = edges.map(
    (e) =>
      `${e.sourceTableFqn} -> ${e.targetTableFqn}${e.entityType ? ` (via ${e.entityType})` : ""}`,
  );
  const header = "**Data Lineage Context** (actual pipeline data flows):";
  const suffix =
    relevant.length > maxEdges
      ? `\n... and ${relevant.length - maxEdges} more data flow edges`
      : "";
  return `${header}\n${lines.join("\n")}${suffix}`;
}

/**
 * Build sample data markdown from a pre-fetched cache, scoped to only the
 * given table FQNs. This avoids duplicating sample data for the entire
 * concurrent group into every batch prompt.
 */
function buildSampleMarkdownFromCache(
  cache: import("@/lib/genie/types").SampleDataCache,
  tableFqns: string[],
): string {
  if (cache.size === 0) return "";

  const sections: string[] = [
    "### SAMPLE DATA (real rows from the tables -- use this to understand data formats, values, and join keys)\n",
  ];

  for (const fqn of tableFqns) {
    const cleanFqn = fqn.replace(/`/g, "");
    const entry = cache.get(cleanFqn);
    if (!entry || entry.rows.length === 0) continue;

    const header = `| ${entry.columns.join(" | ")} |`;
    const separator = `| ${entry.columns.map(() => "---").join(" | ")} |`;
    const rows = entry.rows.map((row) => {
      const cells = (row as unknown[]).map((val) => {
        if (val === null || val === undefined) return "NULL";
        const s = String(val);
        return s.length > 60 ? s.substring(0, 57) + "..." : s;
      });
      return `| ${cells.join(" | ")} |`;
    });

    sections.push(
      `**${cleanFqn}** (${entry.rows.length} sample rows):\n${header}\n${separator}\n${rows.join("\n")}\n`,
    );
  }

  return sections.length > 1 ? sections.join("\n") : "";
}
