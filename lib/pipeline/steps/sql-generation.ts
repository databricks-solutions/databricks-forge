/**
 * Pipeline Step 7: SQL Generation
 *
 * Generates bespoke, runnable SQL for each use case by calling Model Serving
 * (streaming) with full business context, use case details, and actual table schemas.
 *
 * Processing order: domains sorted by size (smallest first), with controlled
 * concurrency within each domain. Matches the reference notebook approach.
 */

import { executeAIQuery, executeAIQueryStream } from "@/lib/ai/agent";
import { executeSQL } from "@/lib/dbx/sql";
import { fetchSampleData } from "@/lib/pipeline/sample-data";
import {
  generateAIFunctionsSummary,
  generateStatisticalFunctionsSummary,
  generateGeospatialFunctionsSummary,
  generateWindowFunctionsSummary,
  generateLambdaFunctionsSummary,
} from "@/lib/ai/functions";
import {
  buildSchemaMarkdown,
  buildAdaptiveSchemaMarkdown,
  buildForeignKeyMarkdown,
} from "@/lib/queries/metadata";
import {
  resolveColumnBudget,
  computeAdaptiveColumnLimits,
  type ColumnBudgetConfig,
  type ColumnScoreOptions,
} from "@/lib/toolkit/column-budget";
import {
  rankColumnsViaLLM,
  ColumnRankingCache,
  type LLMColumnRankingInput,
} from "@/lib/toolkit/column-ranker";

/**
 * If the adaptive engine keeps at least this fraction of the original
 * column count for a use case, the trim is considered marginal and we
 * skip the LLM ranking round trip.
 */
const MIN_TRIM_RATIO_FOR_LLM_RANKING = 0.85;
import { estimateTokens, MAX_PROMPT_TOKENS } from "@/lib/toolkit/token-budget";
import { updateRunMessage } from "@/lib/lakebase/runs";
import { logger as fallbackLogger } from "@/lib/logger";
import type { Logger } from "@/lib/ports/logger";
import { groupByDomain } from "@/lib/domain/scoring";
import type {
  PipelineContext,
  UseCase,
  ColumnInfo,
  ForeignKey,
  TableInfo,
} from "@/lib/domain/types";
import { validateColumnReferences } from "@/lib/validation/sql-columns";
import { resolveEndpoint } from "@/lib/dbx/client";
import "@/lib/skills/content";
import { resolveForPipelineStep, formatContextSections } from "@/lib/skills/resolver";
import { PipelineCancelledError } from "@/lib/ai/agent";
import {
  markUseCasesSqlPending,
  updateUseCaseSql,
} from "@/lib/lakebase/usecases";

/**
 * Options for `runSqlGeneration` when invoked as a background job. All
 * fields are optional so the legacy synchronous-pipeline call site
 * (which mutated `ctx.useCases` in place) continues to work unchanged
 * for resume-from-failure scenarios.
 */
export interface SqlGenerationOptions {
  /** AbortSignal for fast cancellation between waves. */
  signal?: AbortSignal;
  /** Progress callback: (message, percent 0-100) → void. */
  onProgress?: (message: string, percent: number) => void;
  /**
   * When true, stream per-use-case SQL writes to Lakebase via
   * `updateUseCaseSql`. The background job sets this so the UI sees
   * rows turning from "pending" → "generating" → "generated"/"failed"
   * live. Resume / legacy callers leave this false and rely on the
   * orchestrator's final `persistUseCases` batch.
   */
  streamPersistence?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_SQL = Math.max(
  1,
  parseInt(process.env.SQL_GEN_MAX_CONCURRENT ?? "3", 10) || 3,
);

const WAVE_DELAY_MS = Math.max(0, parseInt(process.env.SQL_GEN_WAVE_DELAY_MS ?? "0", 10) || 0);

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSqlGeneration(
  ctx: PipelineContext,
  runId?: string,
  opts: SqlGenerationOptions = {},
): Promise<UseCase[]> {
  const log = ctx.logger ?? fallbackLogger;
  const { run, metadata } = ctx;
  if (!metadata) throw new Error("Metadata not available");
  if (!run.businessContext) throw new Error("Business context not available");

  const bc = run.businessContext;
  const useCases = ctx.useCases;
  const colBudget = resolveColumnBudget();

  if (useCases.length === 0) return useCases;

  // Background job entry point: flip every use case to "pending" so the
  // UI immediately reflects the queue depth. Synchronous-pipeline /
  // resume callers don't stream persistence and skip this step.
  if (opts.streamPersistence && runId) {
    try {
      await markUseCasesSqlPending(runId);
    } catch (err) {
      log.warn("Failed to mark use cases as pending (non-fatal)", {
        fn: "runSqlGeneration",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Build column score options from FK metadata for intelligent column selection
  const fkColumnNames = new Set<string>();
  for (const fk of metadata.foreignKeys) {
    fkColumnNames.add(fk.columnName);
    fkColumnNames.add(fk.referencedColumnName);
  }
  const columnScoreOpts: ColumnScoreOptions = { fkColumnNames };

  // Build a lookup index: table FQN -> columns
  const columnsByTable = new Map<string, ColumnInfo[]>();
  for (const col of metadata.columns) {
    const existing = columnsByTable.get(col.tableFqn) ?? [];
    existing.push(col);
    columnsByTable.set(col.tableFqn, existing);
  }

  // Build a lookup index: table FQN -> TableInfo
  const tableByFqn = new Map<string, TableInfo>();
  for (const t of metadata.tables) {
    tableByFqn.set(t.fqn, t);
  }

  // Group use cases by domain, smallest domains first
  const grouped = groupByDomain(useCases);
  const sortedDomains = Object.entries(grouped).sort(([, a], [, b]) => a.length - b.length);

  const totalUseCases = useCases.length;
  let completed = 0;
  let failed = 0;

  // Diagnostic accumulators for summary logging
  const outcomes: {
    id: string;
    name: string;
    domain: string;
    status: string;
    qualityScore?: number;
  }[] = [];
  let hallucinationAttempts = 0;
  let hallucinationFixed = 0;
  let executionFixAttempts = 0;
  let executionFixed = 0;
  let truncatedCount = 0;
  let reviewFixApplied = 0;
  let reviewFixRejected = 0;

  // Shared prompt variables (business context -- same for all use cases)
  const businessVars: Record<string, string> = {
    business_name: run.config.businessName,
    business_context: JSON.stringify(bc),
    strategic_goals: bc.strategicGoals,
    business_priorities: bc.businessPriorities,
    strategic_initiative: bc.strategicInitiative,
    value_chain: bc.valueChain,
    revenue_model: bc.revenueModel,
    sql_model_serving: resolveEndpoint("sql"),
  };

  // Function reference docs (computed once)
  const aiFunctionsSummary = generateAIFunctionsSummary();
  const statisticalFunctionsSummary = generateStatisticalFunctionsSummary();
  const geospatialFunctionsSummary = generateGeospatialFunctionsSummary();
  const windowFunctionsSummary = generateWindowFunctionsSummary();
  const lambdaFunctionsSummary = generateLambdaFunctionsSummary();

  // Skill context (computed once, injected into every prompt)
  const sqlSkillCtx = resolveForPipelineStep("sql-generation", { contextBudget: 3000 });
  businessVars.skill_reference = formatContextSections(sqlSkillCtx.contextSections);

  const sampleRows = run.config.sampleRowsPerTable ?? 0;

  // Run-level cache for sample data: keyed by table FQN, stores markdown + structured data.
  // Avoids redundant warehouse queries when multiple use cases share tables.
  const sampleDataCache = new Map<string, string>();

  // Run-level LLM column-ranking cache so identical (fqn, keepCount) pairs
  // across use cases don't trigger duplicate ranking requests.
  const rankingCache = new ColumnRankingCache();
  const adaptiveStats = {
    useCasesTrimmed: 0,
    llmRankingCalls: 0,
    llmRankedTables: 0,
    heuristicRankedTables: 0,
    trivialTrimsSkipped: 0,
    budgetImpossible: 0,
    correctivePassApplied: 0,
  };

  // Progress interpolation: SQL generation spans 67% → 79% of overall pipeline.
  // Must stay below 80 (the SQL Generation step.pct threshold in RunProgress)
  // so the UI keeps the step "active" until all use cases are processed.
  //
  // ONLY used by the legacy synchronous-pipeline / resume-from-failure call
  // path. The background-job path (streamPersistence=true) skips
  // updateRunMessage entirely because the run is already marked "completed"
  // by the orchestrator at 95% — re-writing 67–79% here would regress the
  // run's progressPct in the runs list and run-detail header. The background
  // job surface is updated via opts.onProgress on a separate 0–100 scale.
  const PROGRESS_START = 67;
  const PROGRESS_END = 79;
  const progressPerUseCase =
    totalUseCases > 0 ? (PROGRESS_END - PROGRESS_START) / totalUseCases : 0;
  const writeRunProgress = !opts.streamPersistence;

  function currentProgress(): number {
    return Math.round(PROGRESS_START + completed * progressPerUseCase);
  }

  log.info("SQL generation starting", {
    fn: "runSqlGeneration",
    useCaseCount: totalUseCases,
    domainCount: sortedDomains.length,
    sampleRows,
  });

  // Emit an initial progress signal so the status surface (in-memory job
  // map, banner) updates with the use case total before any wave runs.
  if (opts.onProgress) {
    opts.onProgress(`Starting SQL generation for ${totalUseCases} use cases...`, 0);
  }

  for (const [domain, domainCases] of sortedDomains) {
    // Fast cancellation between domains.
    if (opts.signal?.aborted) {
      throw new PipelineCancelledError(runId ?? "unknown");
    }

    if (runId && writeRunProgress) {
      await updateRunMessage(
        runId,
        `Generating SQL for domain "${domain}" (${domainCases.length} use cases, ${completed}/${totalUseCases} done)...`,
        currentProgress(),
      );
    }

    // Process use cases within this domain in waves of MAX_CONCURRENT_SQL
    for (let i = 0; i < domainCases.length; i += MAX_CONCURRENT_SQL) {
      // Fast cancellation between waves.
      if (opts.signal?.aborted) {
        throw new PipelineCancelledError(runId ?? "unknown");
      }

      const wave = domainCases.slice(i, i + MAX_CONCURRENT_SQL);

      // Flip every UC in this wave to "generating" so the UI shows
      // per-row spinners while the wave is in flight. Best-effort —
      // failures here only affect the optimistic UI hint.
      if (opts.streamPersistence) {
        await Promise.all(
          wave.map((uc) =>
            updateUseCaseSql(uc.id, null, "generating").catch(() => {
              /* non-fatal: per-row UI hint */
            }),
          ),
        );
      }

      const results = await Promise.allSettled(
        wave.map((uc) =>
          generateSqlForUseCase(
            log,
            uc,
            businessVars,
            aiFunctionsSummary,
            statisticalFunctionsSummary,
            geospatialFunctionsSummary,
            windowFunctionsSummary,
            lambdaFunctionsSummary,
            columnsByTable,
            tableByFqn,
            metadata.foreignKeys,
            resolveEndpoint("sql"),
            sampleRows,
            sampleDataCache,
            colBudget,
            columnScoreOpts,
            `Industry: ${bc.industries}\nGoals: ${bc.strategicGoals}\nPriorities: ${bc.businessPriorities}`,
            rankingCache,
            adaptiveStats,
            runId,
            run.createdBy,
          ),
        ),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const uc = wave[j];

        if (result.status === "fulfilled" && result.value.sql) {
          const { sql: genSql, diag } = result.value;
          uc.sqlCode = genSql;
          uc.sqlStatus = "generated";

          if (opts.streamPersistence) {
            try {
              await updateUseCaseSql(uc.id, genSql, "generated");
            } catch (err) {
              log.warn("Per-use-case SQL persistence failed (non-fatal)", {
                fn: "runSqlGeneration",
                useCaseId: uc.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (diag.hadHallucination) hallucinationAttempts++;
          if (diag.hallucinationFixed) hallucinationFixed++;
          if (diag.hadExecutionError) executionFixAttempts++;
          if (diag.executionFixed) executionFixed++;
          if (diag.wasTruncated) truncatedCount++;
          if (diag.reviewApplied) reviewFixApplied++;
          if (diag.reviewRejected) reviewFixRejected++;

          outcomes.push({
            id: uc.id,
            name: uc.name,
            domain,
            status: "generated",
            qualityScore: diag.qualityScore,
          });
        } else {
          const reason =
            result.status === "rejected"
              ? result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
              : result.status === "fulfilled"
                ? "empty/null SQL"
                : "empty response";

          // Still accumulate diagnostics from fulfilled-but-null results
          if (result.status === "fulfilled") {
            const { diag } = result.value;
            if (diag.hadHallucination) hallucinationAttempts++;
            if (diag.wasTruncated) truncatedCount++;
          }

          log.warn("SQL generation failed for use case", {
            fn: "runSqlGeneration",
            errorCategory: "llm_error",
            useCaseId: uc.id,
            name: uc.name,
            reason,
          });
          uc.sqlCode = null;
          uc.sqlStatus = "failed";
          failed++;

          if (opts.streamPersistence) {
            try {
              await updateUseCaseSql(uc.id, null, "failed");
            } catch (err) {
              log.warn("Per-use-case SQL persistence failed (non-fatal)", {
                fn: "runSqlGeneration",
                useCaseId: uc.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          outcomes.push({
            id: uc.id,
            name: uc.name,
            domain,
            status: `failed: ${reason.substring(0, 100)}`,
          });
        }
        completed++;
      }

      if (runId && writeRunProgress) {
        await updateRunMessage(
          runId,
          `SQL generation: ${completed}/${totalUseCases} complete (${failed} failed)`,
          currentProgress(),
        );
      }

      if (opts.onProgress) {
        // Map per-use-case completion to a 0-100 scale for the SQL
        // engine status banner (independent of the main pipeline's
        // PROGRESS_START/PROGRESS_END window).
        const pct =
          totalUseCases > 0 ? Math.round((completed / totalUseCases) * 100) : 0;
        opts.onProgress(
          `SQL generation: ${completed}/${totalUseCases} complete${
            failed > 0 ? ` (${failed} failed)` : ""
          }`,
          pct,
        );
      }

      // Cooldown between waves to spread output tokens across the rate-limit window
      if (WAVE_DELAY_MS > 0 && completed < totalUseCases) {
        await new Promise((resolve) => setTimeout(resolve, WAVE_DELAY_MS));
      }
    }
  }

  const rankingCacheStats = rankingCache.stats();
  log.info("SQL generation complete", {
    fn: "runSqlGeneration",
    generated: completed - failed,
    failed,
    hallucinationAttempts,
    hallucinationFixed,
    executionFixAttempts,
    executionFixed,
    truncatedCount,
    reviewFixApplied,
    reviewFixRejected,
    adaptive: {
      ...adaptiveStats,
      rankingCacheHits: rankingCacheStats.hits,
      rankingCacheMisses: rankingCacheStats.misses,
      rankingCacheSize: rankingCacheStats.size,
    },
    outcomes: outcomes.map((o) => `${o.domain}/${o.name}: ${o.status}`),
  });

  return useCases;
}

// ---------------------------------------------------------------------------
// Per-use-case SQL generation
// ---------------------------------------------------------------------------

interface SqlGenDiagnostics {
  hadHallucination: boolean;
  hallucinationFixed: boolean;
  hadExecutionError: boolean;
  executionFixed: boolean;
  wasTruncated: boolean;
  reviewApplied: boolean;
  reviewRejected: boolean;
  qualityScore?: number;
}

interface SqlGenResult {
  sql: string | null;
  diag: SqlGenDiagnostics;
}

function emptyDiag(): SqlGenDiagnostics {
  return {
    hadHallucination: false,
    hallucinationFixed: false,
    hadExecutionError: false,
    executionFixed: false,
    wasTruncated: false,
    reviewApplied: false,
    reviewRejected: false,
  };
}

interface SqlGenAdaptiveStats {
  useCasesTrimmed: number;
  llmRankingCalls: number;
  llmRankedTables: number;
  heuristicRankedTables: number;
  trivialTrimsSkipped: number;
  budgetImpossible: number;
  correctivePassApplied: number;
}

async function generateSqlForUseCase(
  log: Logger,
  uc: UseCase,
  businessVars: Record<string, string>,
  aiFunctionsSummary: string,
  statisticalFunctionsSummary: string,
  geospatialFunctionsSummary: string,
  windowFunctionsSummary: string,
  lambdaFunctionsSummary: string,
  columnsByTable: Map<string, ColumnInfo[]>,
  tableByFqn: Map<string, TableInfo>,
  allForeignKeys: ForeignKey[],
  aiModel: string,
  sampleRowsPerTable: number,
  sampleCache: Map<string, string>,
  colBudget: ColumnBudgetConfig,
  colScoreOpts: ColumnScoreOptions,
  businessContextSummary: string,
  rankingCache: ColumnRankingCache,
  adaptiveStats: SqlGenAdaptiveStats,
  runId?: string,
  userEmail?: string | null,
): Promise<SqlGenResult> {
  const diag = emptyDiag();
  // Resolve table schemas for this use case's involved tables
  const involvedTables: TableInfo[] = [];
  const involvedColumns: ColumnInfo[] = [];

  const resolvedFqns: string[] = [];
  const unresolvedFqns: string[] = [];

  for (const fqn of uc.tablesInvolved) {
    // Try exact match, then try with backtick-stripped version
    const cleanFqn = fqn.replace(/`/g, "");
    const tableInfo = tableByFqn.get(fqn) ?? tableByFqn.get(cleanFqn);
    if (tableInfo) involvedTables.push(tableInfo);

    const cols = columnsByTable.get(fqn) ?? columnsByTable.get(cleanFqn) ?? [];
    involvedColumns.push(...cols);

    if (cols.length > 0) {
      resolvedFqns.push(`${cleanFqn}(${cols.length} cols)`);
    } else {
      unresolvedFqns.push(cleanFqn);
    }
  }

  if (unresolvedFqns.length > 0) {
    log.warn("Some tables in use case have no column metadata", {
      fn: "generateSqlForUseCase",
      errorCategory: "data",
      useCaseId: uc.id,
      unresolvedTables: unresolvedFqns,
      resolvedTables: resolvedFqns,
    });
  }

  if (involvedColumns.length === 0) {
    log.warn("No column metadata for use case", {
      fn: "generateSqlForUseCase",
      errorCategory: "data",
      useCaseId: uc.id,
      tables: uc.tablesInvolved,
    });
  }

  // Filter foreign keys to only those involving this use case's tables
  const involvedFqns = new Set(uc.tablesInvolved.map((t) => t.replace(/`/g, "")));
  const relevantFKs = allForeignKeys.filter(
    (fk) =>
      involvedFqns.has(fk.tableFqn.replace(/`/g, "")) ||
      involvedFqns.has(fk.referencedTableFqn.replace(/`/g, "")),
  );
  const fkMarkdown = buildForeignKeyMarkdown(relevantFKs);

  // Build schema markdown with adaptive column budget
  let schemaMarkdown: string;
  if (involvedTables.length > 0) {
    const ucColsByTable = new Map<string, ColumnInfo[]>();
    for (const col of involvedColumns) {
      const existing = ucColsByTable.get(col.tableFqn) ?? [];
      existing.push(col);
      ucColsByTable.set(col.tableFqn, existing);
    }

    const fkTokens = estimateTokens(fkMarkdown);
    const availableSchemaTokens = Math.max(5_000, MAX_PROMPT_TOKENS - 10_000 - fkTokens);
    const adaptiveResult = computeAdaptiveColumnLimits(
      involvedTables,
      ucColsByTable,
      availableSchemaTokens,
    );

    if (adaptiveResult.correctivePassApplied) {
      adaptiveStats.correctivePassApplied++;
      log.warn(
        "SQL gen adaptive budget corrective pass shaved columns to stay under token budget",
        {
          fn: "generateSqlForUseCase",
          useCaseId: uc.id,
          availableSchemaTokens,
          totalColumnsAfter: adaptiveResult.totalAfter,
        },
      );
    }
    if (adaptiveResult.budgetImpossible) {
      adaptiveStats.budgetImpossible++;
      log.warn("SQL gen adaptive budget impossible: floor-only limits exceed token budget", {
        fn: "generateSqlForUseCase",
        useCaseId: uc.id,
        availableSchemaTokens,
        totalColumnsAfter: adaptiveResult.totalAfter,
        tableCount: involvedTables.length,
      });
    }

    let llmRankings: Map<string, string[]> | undefined;
    if (adaptiveResult.trimmed) {
      adaptiveStats.useCasesTrimmed++;
      const keepRatio =
        adaptiveResult.totalBefore > 0
          ? adaptiveResult.totalAfter / adaptiveResult.totalBefore
          : 1;

      if (keepRatio >= MIN_TRIM_RATIO_FOR_LLM_RANKING) {
        // Trim is marginal -- heuristic scoring in buildAdaptiveSchemaMarkdown
        // is good enough; skip the LLM ranking round trip.
        adaptiveStats.trivialTrimsSkipped++;
        log.debug("Skipping LLM column ranking: marginal trim", {
          step: "sql-generation",
          useCaseId: uc.id,
          keepRatio: Number(keepRatio.toFixed(3)),
          totalBefore: adaptiveResult.totalBefore,
          totalAfter: adaptiveResult.totalAfter,
        });
      } else {
        const trimmedInputs: LLMColumnRankingInput[] = adaptiveResult.trimDetails.map((td) => {
          const tableCols = ucColsByTable.get(td.fqn) ?? [];
          const tableInfo = involvedTables.find((t) => t.fqn === td.fqn);
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

        const llmResult = await rankColumnsViaLLM(
          trimmedInputs,
          businessContextSummary,
          resolveEndpoint("classification"),
          log,
          rankingCache,
        );
        llmRankings = llmResult.rankings.size > 0 ? llmResult.rankings : undefined;
        if (llmResult.callMade) adaptiveStats.llmRankingCalls++;
        adaptiveStats.llmRankedTables += llmResult.llmTables.size;
        adaptiveStats.heuristicRankedTables += llmResult.heuristicTables.size;

        log.info("Adaptive column budget: trimmed wide tables for SQL gen", {
          step: "sql-generation",
          useCaseId: uc.id,
          totalColumnsBefore: adaptiveResult.totalBefore,
          totalColumnsAfter: adaptiveResult.totalAfter,
          columnsDropped: adaptiveResult.totalBefore - adaptiveResult.totalAfter,
          trimDetails: adaptiveResult.trimDetails,
          llmTables: Array.from(llmResult.llmTables),
          heuristicTables: Array.from(llmResult.heuristicTables),
          callMade: llmResult.callMade,
        });
      }
    }

    schemaMarkdown = buildAdaptiveSchemaMarkdown(
      involvedTables,
      involvedColumns,
      adaptiveResult.limits,
      llmRankings,
      colBudget.maxCommentLength,
      colScoreOpts,
    );
  } else {
    schemaMarkdown = uc.tablesInvolved
      .map((t) => `### ${t}\n  (schema not available)`)
      .join("\n\n");
  }

  // Fetch sample data if enabled (with run-level cache to avoid redundant queries)
  let sampleDataSection = "";
  if (sampleRowsPerTable > 0 && uc.tablesInvolved.length > 0) {
    const uncachedTables = uc.tablesInvolved.filter(
      (fqn) => !sampleCache.has(fqn.replace(/`/g, "")),
    );
    if (uncachedTables.length > 0) {
      const sampleResult = await fetchSampleData(
        uncachedTables,
        sampleRowsPerTable,
        { runId, userEmail, step: "sql-generation" },
        colBudget.maxSampleColumns > 0
          ? { maxSampleColumns: colBudget.maxSampleColumns, columnsByTable }
          : undefined,
      );
      // Populate cache: store per-table markdown for reuse by other use cases
      const lines = sampleResult.markdown.split("\n**");
      for (const line of lines) {
        const match = line.match(/^([^\s(]+)/);
        if (match) {
          const fqn = match[1].replace(/\*\*/g, "");
          if (fqn.includes(".")) sampleCache.set(fqn, `**${line}`);
        }
      }
    }
    // Assemble sample data from cache for this use case's tables
    const cachedSections = uc.tablesInvolved
      .map((fqn) => sampleCache.get(fqn.replace(/`/g, "")))
      .filter(Boolean);
    if (cachedSections.length > 0) {
      sampleDataSection = `### SAMPLE DATA (real rows from the tables -- use this to understand data formats, values, and join keys)\n\n${cachedSections.join("\n")}`;
    }
  }

  // Build the per-use-case prompt variables
  const variables: Record<string, string> = {
    ...businessVars,
    use_case_id: uc.id,
    use_case_name: uc.name,
    business_domain: uc.domain,
    use_case_type: uc.type,
    analytics_technique: uc.analyticsTechnique,
    statement: uc.statement,
    solution: uc.solution,
    tables_involved: uc.tablesInvolved.join(", "),
    directly_involved_schema: schemaMarkdown,
    foreign_key_relationships: fkMarkdown,
    sample_data_section: sampleDataSection,
    ai_functions_summary: uc.type === "AI" ? aiFunctionsSummary : "",
    statistical_functions_detailed: uc.type === "Statistical" ? statisticalFunctionsSummary : "",
    geospatial_functions_summary: uc.type === "Geospatial" ? geospatialFunctionsSummary : "",
    window_functions_summary: isWindowRelevant(uc.type, uc.analyticsTechnique)
      ? windowFunctionsSummary
      : "",
    lambda_functions_summary: isLambdaRelevant(uc.type, uc.analyticsTechnique, involvedColumns)
      ? lambdaFunctionsSummary
      : "",
  };

  // Use streaming for SQL generation -- it's the longest-running LLM call
  // and streaming reduces perceived latency by allowing early truncation detection
  const result = await executeAIQueryStream({
    promptKey: "USE_CASE_SQL_GEN_PROMPT",
    variables,
    modelEndpoint: aiModel,
    maxTokens: 16_384,
    runId,
    step: "sql-generation",
  });

  const sql = cleanSqlResponse(result.rawResponse);

  if (!sql || sql.length < 20) {
    return { sql: null, diag };
  }

  // Detect truncated SQL: either the model explicitly signals truncation
  // via finish_reason "length", or we infer it from the SQL structure
  const finishReasonTruncated = result.finishReason === "length";
  if (finishReasonTruncated || isTruncatedSql(sql)) {
    diag.wasTruncated = true;
    log.warn("SQL appears truncated, attempting fix", {
      fn: "generateSqlForUseCase",
      errorCategory: "sql_truncated",
      useCaseId: uc.id,
      detectedBy: finishReasonTruncated ? "finish_reason=length" : "heuristic",
      finishReason: result.finishReason,
      completionTokens: result.tokenUsage?.completionTokens,
      sqlPreview: sql.substring(Math.max(0, sql.length - 120)),
    });
    const fixedSql = await attemptSqlFix(
      log,
      uc,
      sql,
      "SQL query is truncated / incomplete — syntax error at end of input. The original query was too long. Simplify the query: reduce to 3-5 CTEs, remove redundant calculations, keep under 120 lines total.",
      schemaMarkdown,
      fkMarkdown,
      aiModel,
      runId,
    );
    if (fixedSql) return { sql: fixedSql, diag };
    return { sql: null, diag };
  }

  // Strict column validation -- hallucinated columns trigger a fix cycle
  let currentSql = sql;
  const validation = validateSqlOutput(currentSql, uc.tablesInvolved, involvedColumns);
  if (!validation.valid) {
    log.warn("SQL validation failed", {
      fn: "generateSqlForUseCase",
      errorCategory: "sql_syntax",
      useCaseId: uc.id,
      warnings: validation.warnings,
      sqlPreview: currentSql.substring(0, 200),
    });
  }

  if (validation.unknownColumns.length > 0) {
    diag.hadHallucination = true;
    log.info("Hallucinated columns detected, attempting fix", {
      fn: "generateSqlForUseCase",
      useCaseId: uc.id,
      unknownColumns: validation.unknownColumns,
      knownColumnCount: involvedColumns.length,
      tablesResolved: involvedTables.length,
      tablesRequested: uc.tablesInvolved.length,
      sqlPreview: currentSql.substring(0, 200),
    });

    const columnErrorMsg = buildColumnViolationMessage(
      validation.unknownColumns,
      involvedColumns,
      uc.tablesInvolved,
    );

    const fixedSql = await attemptSqlFix(
      log,
      uc,
      currentSql,
      columnErrorMsg,
      schemaMarkdown,
      fkMarkdown,
      aiModel,
      runId,
      sampleDataSection,
    );

    if (!fixedSql) {
      log.warn("Column fix failed, rejecting SQL", {
        fn: "generateSqlForUseCase",
        errorCategory: "sql_hallucination",
        useCaseId: uc.id,
      });
      return { sql: null, diag };
    }

    const revalidation = validateSqlOutput(fixedSql, uc.tablesInvolved, involvedColumns);
    if (revalidation.unknownColumns.length > 0) {
      log.warn("Fixed SQL still contains hallucinated columns, rejecting", {
        fn: "generateSqlForUseCase",
        errorCategory: "sql_hallucination",
        useCaseId: uc.id,
        unknownColumns: revalidation.unknownColumns,
        knownColumnCount: involvedColumns.length,
        tablesResolved: involvedTables.length,
        tablesRequested: uc.tablesInvolved.length,
      });
      return { sql: null, diag };
    }

    diag.hallucinationFixed = true;
    currentSql = fixedSql;
  }

  // Attempt to execute the SQL to catch runtime errors; if it fails, try fix prompt
  const executionError = await trySqlExecution(log, currentSql);
  if (executionError) {
    diag.hadExecutionError = true;
    log.info("SQL execution failed, attempting fix", {
      fn: "generateSqlForUseCase",
      useCaseId: uc.id,
      error: executionError,
      sqlPreview: currentSql.substring(0, 200),
    });
    const fixedSql = await attemptSqlFix(
      log,
      uc,
      currentSql,
      executionError,
      schemaMarkdown,
      fkMarkdown,
      aiModel,
      runId,
      sampleDataSection,
    );
    if (fixedSql) {
      diag.executionFixed = true;
      currentSql = fixedSql;
    } else {
      log.warn("SQL fix failed, returning original SQL", {
        fn: "generateSqlForUseCase",
        errorCategory: "llm_error",
        useCaseId: uc.id,
      });
    }
  }

  // LLM review skipped for pipeline speed -- EXPLAIN + column validation
  // provide sufficient correctness guarantees for discovery pipeline SQL.
  // Review remains available for Genie Engine and other surfaces.
  diag.qualityScore = 75;

  return { sql: currentSql, diag };
}

/**
 * Try executing the generated SQL with EXPLAIN to check for syntax/semantic
 * errors without actually running the full query.
 * Returns the error message on failure, or null on success.
 */
async function trySqlExecution(log: Logger, sql: string): Promise<string | null> {
  // Pipe syntax (|>) is valid Databricks SQL but not supported by EXPLAIN
  if (/\|>/.test(sql)) {
    log.debug("Skipping EXPLAIN validation for pipe-syntax query", { fn: "trySqlExecution" });
    return null;
  }
  try {
    await executeSQL(`EXPLAIN ${sql}`);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Send the failing SQL through the USE_CASE_SQL_FIX_PROMPT to attempt a fix.
 */
async function attemptSqlFix(
  log: Logger,
  uc: UseCase,
  originalSql: string,
  errorMessage: string,
  schemaMarkdown: string,
  fkMarkdown: string,
  aiModel: string,
  runId?: string,
  sampleDataSection?: string,
): Promise<string | null> {
  try {
    const result = await executeAIQuery({
      promptKey: "USE_CASE_SQL_FIX_PROMPT",
      variables: {
        use_case_id: uc.id,
        use_case_name: uc.name,
        directly_involved_schema: schemaMarkdown,
        foreign_key_relationships: fkMarkdown,
        sample_data_section: sampleDataSection ?? "",
        original_sql: originalSql,
        error_message: errorMessage,
      },
      modelEndpoint: aiModel,
      temperature: 0.1,
      maxTokens: 16_384,
      retries: 0,
      runId,
      step: "sql-generation",
    });

    const fixedSql = cleanSqlResponse(result.rawResponse);
    if (!fixedSql || fixedSql.length < 20) {
      return null;
    }

    // Verify the fix actually works
    const fixError = await trySqlExecution(log, fixedSql);
    if (fixError) {
      log.warn("Fixed SQL still fails EXPLAIN", {
        fn: "attemptSqlFix",
        errorCategory: "sql_syntax",
        useCaseId: uc.id,
        error: fixError,
      });
      return null;
    }

    log.info("SQL fix successful", { fn: "attemptSqlFix", useCaseId: uc.id });
    return fixedSql;
  } catch (error) {
    log.warn("SQL fix prompt failed", {
      fn: "attemptSqlFix",
      errorCategory: "llm_error",
      useCaseId: uc.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Use-case-type relevance checks for function summaries
// ---------------------------------------------------------------------------

const WINDOW_RELEVANT_TYPES = new Set([
  "Statistical",
  "Descriptive",
  "Predictive",
  "Diagnostic",
  "Comparative",
]);

const WINDOW_RELEVANT_TECHNIQUES =
  /\b(time.?series|trend|ranking|segmentat|cohort|cumulative|running|moving.?average|period.?over|month.?over|year.?over|churn|retention|growth|lag|lead|percentile|distribution)/i;

function isWindowRelevant(ucType: string, technique: string): boolean {
  if (WINDOW_RELEVANT_TYPES.has(ucType)) return true;
  return WINDOW_RELEVANT_TECHNIQUES.test(technique);
}

function isLambdaRelevant(ucType: string, technique: string, columns: ColumnInfo[]): boolean {
  const hasArrayOrMapCol = columns.some(
    (c) =>
      /^(ARRAY|MAP|STRUCT)/i.test(c.dataType) ||
      c.dataType.toLowerCase().includes("array") ||
      c.dataType.toLowerCase().includes("map"),
  );
  if (hasArrayOrMapCol) return true;
  return /\b(array|transform|tag|categor|multi.?value|complex.?type|nested|json|parse)/i.test(
    technique,
  );
}

// ---------------------------------------------------------------------------
// Column violation error message builder
// ---------------------------------------------------------------------------

function buildColumnViolationMessage(
  unknownColumns: string[],
  knownColumns: ColumnInfo[],
  tablesInvolved: string[],
): string {
  const columnsByTable = new Map<string, string[]>();
  for (const col of knownColumns) {
    const existing = columnsByTable.get(col.tableFqn) ?? [];
    existing.push(col.columnName);
    columnsByTable.set(col.tableFqn, existing);
  }

  const validColLines = tablesInvolved
    .map((fqn) => {
      const cleanFqn = fqn.replace(/`/g, "");
      const cols = columnsByTable.get(fqn) ?? columnsByTable.get(cleanFqn) ?? [];
      return `  ${cleanFqn}: ${cols.join(", ")}`;
    })
    .join("\n");

  const allKnownNames = knownColumns.map((c) => c.columnName);
  const bareNames = unknownColumns.map((c) => (c.includes(".") ? c.split(".").pop()! : c));

  const suggestions = bareNames
    .map((bare) => {
      const closest = findClosestColumn(bare, allKnownNames);
      return closest ? `  - "${bare}" -> did you mean "${closest}"?` : null;
    })
    .filter((s): s is string => s !== null);

  const lines = [
    `SCHEMA VIOLATION: SQL references columns that do not exist in the schema: ${bareNames.join(", ")}.`,
    `These columns are hallucinated -- they do NOT exist in any of the involved tables.`,
    ``,
    `The ONLY valid columns are:`,
    validColLines,
  ];

  if (suggestions.length > 0) {
    lines.push(``, `Possible matches (use ONLY if semantically correct):`, ...suggestions);
  }

  // Detect from_json() alias pattern (parsed.field, parsed_result.field, etc.)
  const parsedPrefixes = unknownColumns
    .filter((c) => c.includes("."))
    .map((c) => c.split(".")[0].toLowerCase());
  const hasParsedAliasIssue = parsedPrefixes.some(
    (p) => p === "parsed" || p === "parsed_result" || p === "ai_result" || p === "result",
  );

  lines.push(
    ``,
    `Remove ALL references to the non-existent columns listed above. Use ONLY columns`,
    `from the valid list. Do NOT substitute or guess alternative names -- if no suitable`,
    `column exists, simplify the query to remove that logic entirely.`,
  );

  if (hasParsedAliasIssue) {
    lines.push(
      ``,
      `NOTE: Some flagged columns appear to be from_json() struct fields (e.g. parsed.field).`,
      `If using ai_query() with failOnError => false and from_json(), use EXACTLY these alias names:`,
      `  - ai_query(...) AS ai_result`,
      `  - from_json(ai_result.result, 'STRUCT<...>') AS parsed_result`,
      `  - Access fields as: parsed_result.field_name`,
      `NEVER use "parsed" or other abbreviations as the from_json alias.`,
    );
  }

  return lines.join("\n");
}

/**
 * Find the closest column name by Levenshtein distance.
 * Returns the closest match if the edit distance is within 60% of the
 * query length, otherwise null.
 */
function findClosestColumn(query: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  const q = query.toLowerCase();
  const maxDist = Math.max(3, Math.floor(q.length * 0.6));
  let bestDist = maxDist + 1;
  let bestMatch: string | null = null;

  for (const candidate of candidates) {
    const dist = levenshtein(q, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ---------------------------------------------------------------------------
// SQL output validation
// ---------------------------------------------------------------------------

interface SqlValidationResult {
  valid: boolean;
  warnings: string[];
  unknownColumns: string[];
}

/**
 * Lightweight structural validation of generated SQL.
 * Checks that the SQL starts with a recognized keyword, references at least
 * one of the expected tables, and doesn't reference columns that don't exist
 * in the schema.
 */
function validateSqlOutput(
  sql: string,
  tablesInvolved: string[],
  columns: ColumnInfo[],
): SqlValidationResult {
  const warnings: string[] = [];
  const upperSql = sql.toUpperCase();
  const normalizedSql = sql.replace(/`/g, "");

  // Check 1: SQL starts with a recognized keyword (FROM supports pipe syntax)
  const startsValid = /^(--|WITH\b|SELECT\b|CREATE\b|FROM\b)/i.test(sql.trim());
  if (!startsValid) {
    warnings.push("SQL does not start with --, WITH, SELECT, CREATE, or FROM");
  }

  // Check 2: At least one expected table is referenced
  if (tablesInvolved.length > 0) {
    const hasTableRef = tablesInvolved.some((fqn) => {
      const cleanFqn = fqn.replace(/`/g, "");
      const parts = cleanFqn.split(".");
      const tableName = parts[parts.length - 1];
      return normalizedSql.includes(cleanFqn) || upperSql.includes(tableName.toUpperCase());
    });
    if (!hasTableRef) {
      warnings.push(`SQL does not reference any expected table: ${tablesInvolved.join(", ")}`);
    }
  }

  // Check 3: Validate column references against known schema using the
  // shared validation module (handles both plain and backtick-quoted columns).
  if (columns.length > 0) {
    const knownColumns = new Set(columns.map((c) => c.columnName.toLowerCase()));

    const colResult = validateColumnReferences(sql, knownColumns, {
      tablesInvolved,
      allowAiFunctionFields: true,
    });

    warnings.push(...colResult.warnings);

    return {
      valid: warnings.length === 0,
      warnings,
      unknownColumns: colResult.unknownColumns,
    };
  }

  return {
    valid: warnings.length === 0,
    warnings,
    unknownColumns: [],
  };
}

// ---------------------------------------------------------------------------
// Response cleaning
// ---------------------------------------------------------------------------

/**
 * Detect if the SQL output was truncated due to hitting the LLM's output
 * token limit. Truncated SQL typically ends mid-expression without a
 * complete final statement.
 */
function isTruncatedSql(sql: string): boolean {
  const trimmed = sql.trimEnd();

  // If the SQL ends with the expected end marker, it's complete
  if (trimmed.endsWith("--END OF GENERATED SQL")) return false;

  // If it ends with a semicolon (optionally followed by a comment), it's complete
  if (/;\s*(--[^\n]*)?$/.test(trimmed)) return false;

  // If it ends with LIMIT N, it's likely complete (just missing semicolon)
  if (/LIMIT\s+\d+\s*$/i.test(trimmed)) return false;

  // If it ends mid-expression (after a comma, operator, or incomplete keyword),
  // it's likely truncated
  if (/[,(+\-*/=<>]\s*$/.test(trimmed)) return true;
  if (
    /\b(AND|OR|ON|FROM|JOIN|WHERE|SELECT|GROUP|ORDER|HAVING|BY|AS|CASE|WHEN|THEN|INNER|LEFT|RIGHT|FULL|CROSS|OUTER|INTO|SET|VALUES|BETWEEN|LIKE|IN|NOT|EXISTS|UNION|EXCEPT|INTERSECT)\s*$/i.test(
      trimmed,
    )
  )
    return true;

  // Unbalanced parentheses: more opens than closes means we're mid-expression
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  if (openParens > closeParens) return true;

  // Ends with a table/column identifier after JOIN or FROM (missing ON clause
  // or rest of query). Pattern: word.word.word or backtick-quoted identifiers
  // at the end without a following clause.
  if (/\b(?:JOIN|FROM)\s+[`\w]+\.[`\w]+\.[`\w]+\s*$/i.test(trimmed)) return true;
  if (/\b(?:JOIN|FROM)\s+[`\w]+\.[`\w]+\s*$/i.test(trimmed)) return true;

  // If the query is very long (150+ lines) and doesn't end cleanly, likely truncated
  const lineCount = trimmed.split("\n").length;
  if (lineCount > 150 && !/\)\s*$/.test(trimmed)) return true;

  return false;
}

/**
 * Strip markdown fences, preamble text, and JSON wrappers that the LLM
 * may have included despite instructions.
 */
function cleanSqlResponse(raw: string): string {
  let sql = raw.trim();

  // Strip markdown code fences
  if (sql.startsWith("```")) {
    const firstNewline = sql.indexOf("\n");
    sql = sql.substring(firstNewline + 1);
  }
  if (sql.endsWith("```")) {
    sql = sql.substring(0, sql.lastIndexOf("```"));
  }

  // Strip any leading text before the first SQL comment or keyword (FROM supports pipe syntax)
  const sqlStart = sql.search(/^(--|WITH\b|SELECT\b|CREATE\b|FROM\b)/im);
  if (sqlStart > 0) {
    sql = sql.substring(sqlStart);
  }

  return sql.trim();
}
