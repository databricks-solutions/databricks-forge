/**
 * Genie Engine — multi-pass, LLM-powered, configurable space generator.
 *
 * Orchestrates 7 passes (0-6) to produce production-grade Genie Space
 * recommendations with full knowledge stores, benchmarks, metric view
 * proposals, and trusted assets. All LLM output is grounded to the
 * physical schema via the SchemaAllowlist.
 */

import type {
  PipelineRun,
  UseCase,
  MetadataSnapshot,
  SensitivityClassification,
} from "@/lib/domain/types";
import type {
  GenieEngineConfig,
  GenieSpaceRecommendation,
  GenieEnginePassOutputs,
  SampleDataCache,
  QuestionComplexity,
} from "./types";
import { defaultGenieEngineConfig } from "./types";
import { buildSchemaAllowlist } from "./schema-allowlist";
import { runTableSelection, type DomainGroup } from "./passes/table-selection";
import { runColumnIntelligence } from "./passes/column-intelligence";
import { runSemanticExpressions } from "./passes/semantic-expressions";
import { runTrustedAssetAuthoring } from "./passes/trusted-assets";
import { runInstructionGeneration } from "./passes/instruction-generation";
import { runBenchmarkGeneration } from "./passes/benchmark-generation";
import { runBenchmarkAlignment } from "./passes/benchmark-alignment";
import { casingProfilesFromCandidates } from "@/lib/metadata/casing-profile";
import { isMetricViewsEnabled } from "./metric-views-config";
import { runTypedMetricViewEngineV2BySchema } from "@/lib/metric-views/typed-generation";
import { runLegacyMetricViewProposalsBySchema } from "@/lib/metric-views/legacy-generation";
import { isTypedMetricViewModelEnabled } from "@/lib/config/semantic-uplift-flags";
import { discoverExistingMetricViews } from "@/lib/metric-views/discovery";
import { runJoinInference } from "./passes/join-inference";
import { runTitleGeneration } from "./passes/title-generation";
import { runExampleQueryGeneration } from "./passes/example-query-generation";
import { assembleSerializedSpace, buildRecommendation } from "./assembler";
import { runHealthCheck } from "./space-health-check";
import { isValidTable } from "./schema-allowlist";
import { resolveEndpoint } from "@/lib/dbx/client";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import { createScopedLogger, logger as defaultLogger } from "@/lib/logger";
import type { Logger } from "@/lib/ports/logger";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { DiscoveredGenieSpace } from "@/lib/discovery/types";
import { tableHasSynonymPair } from "./key-synonyms";
import { normalizeDomainLabel } from "./domain-normalization";
import { evaluateJoinCandidates } from "./join-diagnostics";
import { saveMetricViewProposals } from "@/lib/lakebase/metric-view-proposals";
import { resolveBudget, type GenerationBudget } from "./quality-presets";
import { buildSemanticAssetManifest } from "@/lib/semantic-assets/manifest";
import { safeErrorMetadata } from "@/lib/logging/safe-error-metadata";

export class EngineCancelledError extends Error {
  constructor() {
    super("Genie Engine generation was cancelled");
    this.name = "EngineCancelledError";
  }
}

/**
 * Injectable dependencies for the Genie Engine.
 *
 * When provided, the engine uses these instead of hard-coded imports.
 * LLM client injection cascades to individual passes in future phases.
 */
export interface GenieEngineDeps {
  llm?: LLMClient;
  logger?: Logger;
}

export interface GenieEngineInput {
  run: PipelineRun;
  useCases: UseCase[];
  metadata: MetadataSnapshot;
  config?: GenieEngineConfig;
  sampleData?: SampleDataCache | null;
  piiClassifications?: SensitivityClassification[];
  /** Existing Genie spaces discovered via asset discovery (for dedup and enhancement). */
  existingSpaces?: DiscoveredGenieSpace[];
  /** When set, only regenerate the listed domains (partial run). */
  domainFilter?: string[];
  /** Abort signal for user-initiated cancellation. */
  signal?: AbortSignal;
  onProgress?: (
    message: string,
    percent: number,
    completedDomains: number,
    totalDomains: number,
    completedDomainName?: string,
  ) => void;
  /** Called once after Pass 0 with the full domain list. */
  onDomainsReady?: (domains: Array<{ domain: string; tables: number }>) => void;
  /** Called when a domain transitions between phases. */
  onDomainPhase?: (domain: string, phase: import("./engine-status").DomainPhase) => void;
  /** Injectable dependencies for portability and testing. */
  deps?: GenieEngineDeps;
}

export interface GenieEngineResult {
  recommendations: GenieSpaceRecommendation[];
  passOutputs: GenieEnginePassOutputs[];
  failedDomains: Array<{ domain: string; error: string }>;
}

/**
 * Run the full Genie Engine pipeline.
 *
 * Produces one recommendation per domain with:
 * - Column enrichments + entity matching candidates
 * - Semantic SQL expressions (auto time periods + LLM business expressions)
 * - Trusted assets (parameterized queries + UDF definitions)
 * - Text instructions (business context, clarification rules, entity guidance)
 * - Benchmark questions with expected SQL
 * - Metric view proposals (YAML + DDL)
 */
export async function runGenieEngine(input: GenieEngineInput): Promise<GenieEngineResult> {
  const {
    run,
    useCases,
    metadata,
    config: inputConfig = defaultGenieEngineConfig(),
    sampleData = null,
    piiClassifications,
    existingSpaces = [],
    domainFilter,
    signal,
    onProgress,
    onDomainsReady,
    onDomainPhase,
    deps,
  } = input;

  const log: Logger =
    deps?.logger ??
    createScopedLogger({ origin: "GenieEngine", module: "genie/engine", runId: run.runId });
  const allowlist = buildSchemaAllowlist(metadata);
  const budget = resolveBudget(inputConfig.qualityPreset);

  // Apply budget-driven metric view override
  const config: GenieEngineConfig = budget.enableMetricViews
    ? inputConfig
    : { ...inputConfig, generateMetricViews: false };

  // Apply budget-driven review surface disabling. Restore original on exit.
  const _savedReviewSurfaces = process.env.DATABRICKS_REVIEW_DISABLED_SURFACES;
  if (budget.disabledReviewSurfaces.length > 0) {
    const existing = _savedReviewSurfaces ? _savedReviewSurfaces.split(",") : [];
    const merged = [...new Set([...existing, ...budget.disabledReviewSurfaces])];
    process.env.DATABRICKS_REVIEW_DISABLED_SURFACES = merged.join(",");
  }

  const restoreReviewSurfaces = () => {
    if (_savedReviewSurfaces === undefined) {
      delete process.env.DATABRICKS_REVIEW_DISABLED_SURFACES;
    } else {
      process.env.DATABRICKS_REVIEW_DISABLED_SURFACES = _savedReviewSurfaces;
    }
  };

  try {
    log.info("Genie Engine starting", {
      runId: run.runId,
      useCaseCount: useCases.length,
      tableCount: metadata.tableCount,
      llmRefinement: config.llmRefinement,
      qualityPreset: config.qualityPreset,
      domainConcurrency: budget.domainConcurrency,
      sampleDataAvailable: sampleData ? sampleData.size : 0,
    });

    // Pass 0: Table Selection + Grouping
    onProgress?.("Grouping tables into domains...", 5, 0, 0);
    const allDomainGroups = runTableSelection(useCases, metadata, config);

    // Apply domain filter for partial regeneration
    const filteredGroups = domainFilter?.length
      ? allDomainGroups.filter((g) => domainFilter.includes(g.domain))
      : allDomainGroups;

    // Apply maxAutoSpaces cap (0 = unlimited)
    const domainGroups =
      config.maxAutoSpaces > 0 ? filteredGroups.slice(0, config.maxAutoSpaces) : filteredGroups;

    if (domainGroups.length === 0) {
      log.warn("No domain groups produced", {
        fn: "runGenieEngine",
        errorCategory: "data",
        runId: run.runId,
        domainFilter,
      });
      return { recommendations: [], passOutputs: [], failedDomains: [] };
    }

    if (domainGroups.length < filteredGroups.length) {
      log.info("Domain count capped by maxAutoSpaces", {
        maxAutoSpaces: config.maxAutoSpaces,
        totalAvailable: filteredGroups.length,
        processing: domainGroups.length,
      });
    }

    // Build existing-space-to-domain mapping for enhancement detection
    const existingSpaceByDomain = new Map<string, DiscoveredGenieSpace>();
    if (existingSpaces.length > 0) {
      for (const group of domainGroups) {
        const domainTableSet = new Set(group.tables.map((t) => t.toLowerCase()));
        let bestMatch: { space: DiscoveredGenieSpace; overlap: number } | null = null;
        for (const space of existingSpaces) {
          const overlap = space.tables.filter((t) => domainTableSet.has(t.toLowerCase())).length;
          if (overlap > 0 && (!bestMatch || overlap > bestMatch.overlap)) {
            bestMatch = { space, overlap };
          }
        }
        if (bestMatch && bestMatch.overlap >= 2) {
          existingSpaceByDomain.set(group.domain, bestMatch.space);
        }
      }
      log.info("Existing space mapping", {
        totalExisting: existingSpaces.length,
        domainsWithExisting: existingSpaceByDomain.size,
        mapped: Array.from(existingSpaceByDomain.entries()).map(
          ([d, s]) => `${d} -> ${s.title} (${s.spaceId})`,
        ),
      });
    }

    log.info("Pass 0 complete: table selection", {
      domainCount: domainGroups.length,
      totalDomains: allDomainGroups.length,
      filtered: !!domainFilter?.length,
      capped: domainGroups.length < filteredGroups.length,
      domains: domainGroups.map((g) => `${g.domain} (${g.tables.length} tables)`),
    });

    onDomainsReady?.(domainGroups.map((g) => ({ domain: g.domain, tables: g.tables.length })));

    // Process domains with bounded concurrency
    const totalDomainCount = domainGroups.length;
    let completedDomainCount = 0;

    onProgress?.("Processing domains...", 10, 0, totalDomainCount);

    const domainResults = await mapWithConcurrency(
      domainGroups.map((group) => async () => {
        if (signal?.aborted) {
          throw new EngineCancelledError();
        }

        if (group.tables.length === 0) {
          log.info("Skipping domain with no tables", { domain: group.domain });
          completedDomainCount++;
          return null;
        }

        const domainPct = Math.round(10 + (completedDomainCount / totalDomainCount) * 85);

        try {
          const outputs = await processDomain(
            group,
            run,
            metadata,
            allowlist,
            config,
            sampleData,
            piiClassifications,
            signal,
            (msg) =>
              onProgress?.(
                `[${group.domain}] ${msg}`,
                domainPct,
                completedDomainCount,
                totalDomainCount,
              ),
            log,
            budget,
            onDomainPhase,
          );

          onDomainPhase?.(group.domain, "assembly");
          const space = assembleSerializedSpace(outputs, {
            runId: run.runId,
            businessName: run.config.businessName,
            allowlist,
            metadata,
          });

          const titleResult = await runTitleGeneration({
            businessName: run.config.businessName,
            domain: normalizeDomainLabel(outputs.domain),
            subdomains: outputs.subdomains,
            tableFqns: outputs.tables,
            conversationSummary: run.businessContext?.strategicGoals || "",
            endpoint: resolveEndpoint("lightweight"),
            fallbackEndpoint: resolveEndpoint("generation"),
            signal,
          });
          const degradedReasons: string[] = [];
          if (outputs.tables.length > 1 && space.instructions.join_specs.length === 0)
            degradedReasons.push("no_validated_joins");
          if (
            space.instructions.join_specs.length > 0 &&
            space.instructions.example_question_sqls.length < 2
          ) {
            degradedReasons.push("insufficient_sample_sql");
          }
          if (titleResult.source === "fallback") degradedReasons.push("title_fallback_used");

          const healthReport = runHealthCheck(space as unknown as Record<string, unknown>);
          const actualScore = Math.round(healthReport.overallScore);

          const rec = buildRecommendation(outputs, space, run.config.businessName, {
            titleOverride: titleResult.title,
            titleSource: titleResult.source,
            degradedReasons,
            qualityScore: actualScore,
            joinDiagnostics: outputs.joinDiagnostics ?? [],
            promptVersion: "genie-v2-phase2",
          });
          rec.useCaseCount = group.useCases.length;

          // Tag with recommendation type based on existing space mapping
          const existingSpace = existingSpaceByDomain.get(group.domain);
          if (existingSpace) {
            rec.recommendationType = "enhancement";
            rec.existingAssetId = existingSpace.spaceId;
            rec.changeSummary = buildChangeSummary(existingSpace, rec);
          }

          completedDomainCount++;
          onDomainPhase?.(group.domain, "completed");
          onProgress?.(
            `[${group.domain}] Complete`,
            domainPct,
            completedDomainCount,
            totalDomainCount,
            group.domain,
          );

          log.info("Domain processed", {
            domain: group.domain,
            tables: outputs.tables.length,
            measures: outputs.measures.length,
            filters: outputs.filters.length,
            dimensions: outputs.dimensions.length,
            benchmarks: outputs.benchmarkQuestions.length,
            metricViews: outputs.metricViewProposals.length,
          });

          return { rec, outputs };
        } catch (err) {
          if (err instanceof EngineCancelledError) throw err;
          completedDomainCount++;
          const diagnostic = safeErrorMetadata(err, "Genie domain processing failed.");
          const errorMsg = `${diagnostic.errorName}: ${diagnostic.safeSummary}`;
          onDomainPhase?.(group.domain, "failed");
          log.error("Failed to process domain", {
            fn: "runGenieEngine",
            domain: group.domain,
            ...diagnostic,
          });
          return { failed: true as const, domain: group.domain, error: errorMsg };
        }
      }),
      budget.domainConcurrency,
    );

    const recommendations: GenieSpaceRecommendation[] = [];
    const allPassOutputs: GenieEnginePassOutputs[] = [];
    const failedDomains: Array<{ domain: string; error: string }> = [];
    for (const result of domainResults) {
      if (!result) continue;
      if ("failed" in result && result.failed) {
        failedDomains.push({ domain: result.domain as string, error: result.error as string });
      } else if ("rec" in result) {
        recommendations.push(result.rec);
        allPassOutputs.push(result.outputs);
      }
    }

    onProgress?.("Genie Engine complete", 100, totalDomainCount, totalDomainCount);

    recommendations.sort((a, b) => b.useCaseCount - a.useCaseCount);

    if (failedDomains.length > 0) {
      log.warn("Some domains failed during Genie Engine run", {
        fn: "runGenieEngine",
        errorCategory: "domain_processing",
        runId: run.runId,
        failedDomains,
      });
    }

    log.info("Genie Engine complete", {
      runId: run.runId,
      recommendationCount: recommendations.length,
      failedDomainCount: failedDomains.length,
    });

    return { recommendations, passOutputs: allPassOutputs, failedDomains };
  } finally {
    restoreReviewSurfaces();
  }
}

async function processDomain(
  group: DomainGroup,
  run: PipelineRun,
  metadata: MetadataSnapshot,
  allowlist: ReturnType<typeof buildSchemaAllowlist>,
  config: GenieEngineConfig,
  sampleData: SampleDataCache | null,
  piiClassifications: SensitivityClassification[] | undefined,
  signal: AbortSignal | undefined,
  onProgress: (msg: string) => void,
  log: Logger,
  budget: GenerationBudget,
  onDomainPhase?: (domain: string, phase: import("./engine-status").DomainPhase) => void,
): Promise<GenieEnginePassOutputs> {
  const { domain, subdomains, tables, metricViews, useCases } = group;
  const normalizedDomain = normalizeDomainLabel(domain);
  const sensitiveColumns = new Set(
    (piiClassifications ?? [])
      .filter(
        (p) =>
          tables.some((t) => t.toLowerCase() === p.tableFqn.toLowerCase()) &&
          p.classification !== "Public",
      )
      .map((p) => p.columnName.toLowerCase()),
  );

  // Pass 1 (fast) + Pass 2 (premium) run in parallel -- no shared dependencies
  onDomainPhase?.(domain, "expressions");
  onProgress("Analyzing columns & generating SQL expressions...");
  const [columnResult, exprResult] = await Promise.all([
    runColumnIntelligence({
      tableFqns: tables,
      metadata,
      allowlist,
      config,
      sampleData,
      piiClassifications,
      industryId: run.config.industry || undefined,
      endpoint: resolveEndpoint("classification"),
      signal,
    }),
    runSemanticExpressions({
      tableFqns: tables,
      metadata,
      allowlist,
      useCases,
      businessContext: run.businessContext,
      config,
      industryId: run.config.industry || undefined,
      sampleData,
      endpoint: resolveEndpoint("classification"),
      signal,
      budget,
    }),
  ]);

  // Build join specs from foreign keys, use case SQL, and LLM inference.
  // Computed before Passes 3-5 so all downstream passes have join context.
  const tableSet = new Set(tables.map((t) => t.toLowerCase()));
  const fkJoins = metadata.foreignKeys
    .filter(
      (fk) =>
        tableSet.has(fk.tableFqn.toLowerCase()) &&
        tableSet.has(fk.referencedTableFqn.toLowerCase()),
    )
    .map((fk) => ({
      leftTable: fk.tableFqn,
      rightTable: fk.referencedTableFqn,
      sql: `${fk.tableFqn}.${fk.columnName} = ${fk.referencedTableFqn}.${fk.referencedColumnName}`,
      relationshipType: "many_to_one" as const,
    }));

  const joinOverrides = config.joinOverrides.filter(
    (j) => tableSet.has(j.leftTable.toLowerCase()) && tableSet.has(j.rightTable.toLowerCase()),
  );
  const overrideKeys = new Set(
    joinOverrides.map((j) => `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`),
  );

  const fkAndOverrideJoins = [
    ...fkJoins
      .filter(
        (j) => !overrideKeys.has(`${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`),
      )
      .map((j) => ({ ...j, source: "fk" as const, confidence: "high" as const })),
    ...joinOverrides
      .filter((j) => j.enabled)
      .map((j) => ({
        leftTable: j.leftTable,
        rightTable: j.rightTable,
        sql: j.joinSql,
        relationshipType: j.relationshipType,
        source: "override" as const,
        confidence: "high" as const,
      })),
  ];

  const existingJoinKeys = new Set(
    fkAndOverrideJoins.map((j) => `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`),
  );
  const sqlInferredJoins = inferJoinsFromUseCaseSql(
    useCases,
    tableSet,
    existingJoinKeys,
    allowlist,
    log,
  ).map((j) => ({ ...j, source: "sql_mined" as const, confidence: "medium" as const }));

  let llmInferredJoins: Array<{
    leftTable: string;
    rightTable: string;
    sql: string;
    relationshipType: "many_to_one";
    source: "llm";
    confidence: "medium";
  }> = [];
  if (config.llmRefinement && fkAndOverrideJoins.length + sqlInferredJoins.length < 3) {
    try {
      onDomainPhase?.(domain, "joins");
      onProgress("Inferring table relationships...");
      const allExistingKeys = new Set([
        ...existingJoinKeys,
        ...sqlInferredJoins.map(
          (j) => `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`,
        ),
      ]);
      const llmResult = await runJoinInference({
        tableFqns: tables,
        metadata,
        allowlist,
        existingJoinKeys: allExistingKeys,
        endpoint: resolveEndpoint("classification"),
        signal,
      });
      llmInferredJoins = llmResult.joins.map((j) => ({
        ...j,
        source: "llm" as const,
        confidence: "medium" as const,
      }));
    } catch (err) {
      log.warn("LLM join inference failed, continuing with FK + SQL-inferred joins", {
        fn: "processDomain",
        errorCategory: "llm_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const existingHeuristicKeys = new Set(
    [...fkAndOverrideJoins, ...sqlInferredJoins, ...llmInferredJoins].flatMap((j) => [
      `${j.leftTable.toLowerCase()}|${j.rightTable.toLowerCase()}`,
      `${j.rightTable.toLowerCase()}|${j.leftTable.toLowerCase()}`,
    ]),
  );
  const heuristicJoins =
    tables.length > 1 &&
    fkAndOverrideJoins.length + sqlInferredJoins.length + llmInferredJoins.length === 0
      ? inferHeuristicJoins(metadata, tables, existingHeuristicKeys).map((j) => ({
          ...j,
          source: "heuristic" as const,
          confidence: "low" as const,
        }))
      : [];
  const { accepted: allJoins, diagnostics: joinDiagnostics } = evaluateJoinCandidates(
    allowlist,
    [...fkAndOverrideJoins, ...sqlInferredJoins, ...llmInferredJoins, ...heuristicJoins],
    `engine_join:${normalizedDomain}`,
  );

  log.info("Join specs assembled", {
    domain: normalizedDomain,
    fkJoins: fkAndOverrideJoins.length,
    sqlInferred: sqlInferredJoins.length,
    llmInferred: llmInferredJoins.length,
    total: allJoins.length,
  });

  // Phase B: Metric views + Passes 3-5 run in parallel
  onDomainPhase?.(domain, "assets");
  // All depend on
  // Phase 1 + Phase 2 + joins but are independent of each other.
  onProgress("Creating trusted assets, instructions, benchmarks & metric views...");

  const metricViewPromise = (async () => {
    if (!isMetricViewsEnabled() || !config.generateMetricViews) return { proposals: [] };

    // Deep discovery: fetch existing UC metric views with full YAML definitions
    const existingViews = await discoverExistingMetricViews([metadata.ucPath]).catch((err) => {
      log.warn("Metric view discovery failed, continuing without existing views", {
        fn: "processDomain",
        errorCategory: "data",
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    });

    const commonInput = {
      domain: normalizedDomain,
      tableFqns: tables,
      useCases,
      metadata,
      allowlist,
      measures: exprResult.measures,
      dimensions: exprResult.dimensions,
      joinSpecs: allJoins,
      columnEnrichments: columnResult.enrichments,
      endpoint: resolveEndpoint("generation"),
      signal,
    };
    // The typed planner is independently gated. The Release 1 YAML path remains
    // readable and keeps the same mandatory parser/probe validation.
    const result = isTypedMetricViewModelEnabled()
      ? await runTypedMetricViewEngineV2BySchema({
          ...commonInput,
          existingMetricViews: existingViews,
          businessContext: run.businessContext?.strategicGoals,
          skipPlanning: config.skipMetricViewPlanning,
        })
      : await runLegacyMetricViewProposalsBySchema(commonInput);

    // Persist metric view proposals to standalone table (best-effort)
    try {
      const schemaScope = metadata.ucPath;
      await saveMetricViewProposals(
        run.runId,
        schemaScope,
        normalizedDomain,
        result.proposals,
        run.ownerEmail,
      );
    } catch (err) {
      log.warn("Failed to persist metric view proposals (non-fatal)", {
        fn: "processDomain",
        errorCategory: "db",
        domain: normalizedDomain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return result;
  })();

  const [trustedResult, instructionResult, benchmarkResult, metricViewResult] = await Promise.all([
    // Pass 3: Trusted Asset Authoring (premium -- SQL quality critical)
    config.generateTrustedAssets
      ? runTrustedAssetAuthoring({
          tableFqns: tables,
          metadata,
          allowlist,
          useCases,
          entityCandidates: columnResult.entityCandidates,
          joinSpecs: allJoins,
          endpoint: resolveEndpoint("generation"),
          questionComplexity: config.questionComplexity,
          signal,
          useCaseCap: budget.trustedAssetUseCaseCap,
          maxTokens: budget.maxTokensTrustedAssets,
        })
      : Promise.resolve({ queries: [], functions: [] }),

    // Pass 4: Instruction Generation (fast -- short text output)
    runInstructionGeneration({
      domain: normalizedDomain,
      subdomains,
      businessName: run.config.businessName,
      businessContext: run.businessContext,
      config,
      entityCandidates: columnResult.entityCandidates,
      joinSpecs: allJoins,
      endpoint: resolveEndpoint("classification"),
      fallbackEndpoint: resolveEndpoint("generation"),
      metadata,
      tableFqns: tables,
      conversationSummary: run.businessContext?.strategicGoals || "",
      sensitiveColumns,
      casingProfiles: casingProfilesFromCandidates(columnResult.entityCandidates),
      industryId: run.config.industry || undefined,
      signal,
    }),

    // Pass 5: Benchmark Generation (premium -- SQL quality critical)
    config.generateBenchmarks
      ? runBenchmarkGeneration({
          tableFqns: tables,
          metadata,
          allowlist,
          useCases,
          entityCandidates: columnResult.entityCandidates,
          customerBenchmarks: config.benchmarkQuestions,
          joinSpecs: allJoins,
          endpoint: resolveEndpoint("generation"),
          industryId: run.config.industry || undefined,
          signal,
          useCaseCap: budget.benchmarkUseCaseCap,
          benchmarksPerBatch: budget.benchmarksPerBatch,
          maxTokens: budget.maxTokensBenchmarks,
        })
      : Promise.resolve({ benchmarks: [...config.benchmarkQuestions] }),

    // Metric views (runs alongside Passes 3-5 instead of sequentially before)
    metricViewPromise,
  ]);

  let trustedQueries = trustedResult.queries;
  if (trustedQueries.length === 0) {
    const exampleQueryResult = await runExampleQueryGeneration({
      domain: normalizedDomain,
      tableFqns: tables,
      metadata,
      allowlist,
      joinSpecs: allJoins,
      endpoint: resolveEndpoint("lightweight"),
      fallbackEndpoint: resolveEndpoint("generation"),
      sensitiveColumns,
      questionComplexity: config.questionComplexity,
      signal,
    });
    trustedQueries = exampleQueryResult.queries;
  }

  // Pass 5b: Benchmark Alignment Review (post-pass). Asks the review LLM
  // to tighten any benchmark whose expected_sql isn't the most direct query
  // for the question. No-op when FORGE_SQL_REPAIR_ENABLED is off.
  const alignedBenchmarkResult = await runBenchmarkAlignment({
    benchmarks: benchmarkResult.benchmarks,
    surface: "engine.benchmark-alignment",
    signal,
  });
  const alignedBenchmarks = alignedBenchmarkResult.aligned;

  // Sample questions: prefer trusted query questions (column-grounded)
  // over abstract use case statements for better Genie vocabulary learning
  const trustedQuestionTexts = trustedQueries
    .filter((tq) => tq.question.trim().length > 0)
    .map((tq) => tq.question);
  const fallbackQuestions = useCases
    .slice(0, 5)
    .map((uc) => statementToQuestion(uc.statement, config.questionComplexity));
  const sampleQuestions = [...trustedQuestionTexts.slice(0, 5), ...fallbackQuestions]
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .slice(0, 5);
  const semanticAssetManifest = buildSemanticAssetManifest({
    domain: normalizedDomain,
    subdomains,
    proposals: metricViewResult.proposals,
    genieMeasures: exprResult.measures,
    genieDimensions: exprResult.dimensions,
    genieFilters: exprResult.filters,
  });

  return {
    domain: normalizedDomain,
    subdomains,
    tables,
    metricViews: metricViews.map((mv) => mv.fqn),
    columnEnrichments: columnResult.enrichments,
    entityMatchingCandidates: columnResult.entityCandidates,
    measures: exprResult.measures,
    filters: exprResult.filters,
    dimensions: exprResult.dimensions,
    trustedQueries,
    trustedFunctions: [],
    textInstructions: instructionResult.instructions,
    sampleQuestions,
    benchmarkQuestions: alignedBenchmarks,
    metricViewProposals: metricViewResult.proposals,
    semanticAssetManifest,
    joinSpecs: allJoins,
    joinDiagnostics,
  };
}

/**
 * Extract JOIN relationships from use case SQL that already passed EXPLAIN
 * validation. Parses FROM and JOIN clauses to discover table pairs and their
 * join conditions, deduplicating against already-known joins.
 */
function inferJoinsFromUseCaseSql(
  useCases: UseCase[],
  tableSet: Set<string>,
  existingJoinKeys: Set<string>,
  allowlist: ReturnType<typeof buildSchemaAllowlist>,
  log: Logger = defaultLogger,
): Array<{ leftTable: string; rightTable: string; sql: string; relationshipType: "many_to_one" }> {
  const discovered = new Map<string, { leftTable: string; rightTable: string; sql: string }>();

  // Match: JOIN `catalog.schema.table` alias ON condition
  // Handles optional backticks/quotes and multi-word aliases
  const joinRegex =
    /JOIN\s+[`"]?([a-zA-Z_]\w*\.[a-zA-Z_]\w*\.[a-zA-Z_]\w*)[`"]?\s+(?:AS\s+)?(\w+)\s+ON\s+([^\n;]+)/gi;
  const fromRegex = /FROM\s+[`"]?([a-zA-Z_]\w*\.[a-zA-Z_]\w*\.[a-zA-Z_]\w*)[`"]?/gi;

  for (const uc of useCases) {
    if (!uc.sqlCode) continue;
    const sql = uc.sqlCode;

    // Collect FROM tables to pair with JOINed tables
    const fromTables: string[] = [];
    let fromMatch: RegExpExecArray | null;
    while ((fromMatch = fromRegex.exec(sql)) !== null) {
      fromTables.push(fromMatch[1]);
    }
    fromRegex.lastIndex = 0;

    let joinMatch: RegExpExecArray | null;
    while ((joinMatch = joinRegex.exec(sql)) !== null) {
      const rightTable = joinMatch[1];
      const onCondition = joinMatch[3].trim();

      // Find the most likely left table from FROM clauses
      const leftTable =
        fromTables.find((ft) =>
          onCondition.toLowerCase().includes(ft.split(".").pop()!.toLowerCase()),
        ) ?? fromTables[0];

      if (!leftTable) continue;

      // Both tables must be in the domain's table set and schema allowlist
      if (
        !tableSet.has(leftTable.toLowerCase()) ||
        !tableSet.has(rightTable.toLowerCase()) ||
        !isValidTable(allowlist, leftTable) ||
        !isValidTable(allowlist, rightTable)
      )
        continue;

      const pairKey = `${leftTable.toLowerCase()}|${rightTable.toLowerCase()}`;
      const reversePairKey = `${rightTable.toLowerCase()}|${leftTable.toLowerCase()}`;

      if (existingJoinKeys.has(pairKey) || existingJoinKeys.has(reversePairKey)) continue;
      if (discovered.has(pairKey) || discovered.has(reversePairKey)) continue;

      // Skip complex ON clauses (AND/OR) -- we can only reliably parse simple equi-joins
      if (/\b(AND|OR)\b/i.test(onCondition)) {
        log.debug("Skipping complex ON clause in join inference", {
          leftTable,
          rightTable,
          onCondition: onCondition.substring(0, 100),
        });
        continue;
      }

      const eqParts = onCondition.split("=");
      if (eqParts.length !== 2 || !eqParts[0].trim() || !eqParts[1].trim()) continue;

      const leftCol = eqParts[0].trim().split(".").pop();
      const rightCol = eqParts[1].trim().split(".").pop();
      if (!leftCol || !rightCol) continue;

      const joinSql = `${leftTable}.${leftCol} = ${rightTable}.${rightCol}`;
      discovered.set(pairKey, { leftTable, rightTable, sql: joinSql });
    }
    joinRegex.lastIndex = 0;
  }

  const results = [...discovered.values()].map((j) => ({
    ...j,
    relationshipType: "many_to_one" as const,
  }));

  if (results.length > 0) {
    log.info("Inferred joins from use case SQL", {
      count: results.length,
      pairs: results.map((j) => `${j.leftTable} -> ${j.rightTable}`),
    });
  }

  return results;
}

export function statementToQuestion(statement: string, complexity?: QuestionComplexity): string {
  const level = complexity ?? "simple";
  const s = statement.trim();
  if (s.endsWith("?")) return s;
  const lower = s.charAt(0).toLowerCase() + s.slice(1);

  if (level === "simple") {
    if (/^(identify|detect|find|discover|determine)/i.test(s)) return `How do we ${lower}?`;
    if (/^(analyse|analyze|assess|evaluate|measure)/i.test(s)) return `How do we ${lower}?`;
    if (/^(build|create|develop|implement|design)/i.test(s)) return `How would we ${lower}?`;
    return `${s}?`;
  }

  if (level === "medium") {
    if (/^(identify|detect|find|discover|determine)/i.test(s)) return `How can we ${lower}?`;
    if (/^(analyse|analyze|assess|evaluate|measure)/i.test(s)) return `${s}?`;
    if (/^(build|create|develop|implement|design)/i.test(s)) return `How would we ${lower}?`;
    return `${s}?`;
  }

  // complex -- original verbose style
  if (/^(identify|detect|find|discover|determine)/i.test(s)) return `How can we ${lower}?`;
  if (/^(analyse|analyze|assess|evaluate|measure)/i.test(s)) return `${s}?`;
  return `What insights can we gain from: ${s}?`;
}

/**
 * Build a human-readable change summary comparing an existing space with a new recommendation.
 */
function buildChangeSummary(existing: DiscoveredGenieSpace, rec: GenieSpaceRecommendation): string {
  const changes: string[] = [];

  const existingTableSet = new Set(existing.tables.map((t) => t.toLowerCase()));
  const newTables = rec.tables.filter((t) => !existingTableSet.has(t.toLowerCase()));
  if (newTables.length > 0) {
    changes.push(
      `+${newTables.length} new tables: ${newTables.slice(0, 5).join(", ")}${newTables.length > 5 ? "..." : ""}`,
    );
  }

  const recTableSet = new Set(rec.tables.map((t) => t.toLowerCase()));
  const removedTables = existing.tables.filter((t) => !recTableSet.has(t.toLowerCase()));
  if (removedTables.length > 0) {
    changes.push(`-${removedTables.length} tables no longer included`);
  }

  if (rec.measureCount > existing.measureCount) {
    changes.push(`+${rec.measureCount - existing.measureCount} new measures`);
  }

  if (rec.sampleQuestionCount > existing.sampleQuestionCount) {
    changes.push(`+${rec.sampleQuestionCount - existing.sampleQuestionCount} new sample questions`);
  }

  const existingMvSet = new Set(existing.metricViews.map((m) => m.toLowerCase()));
  const newMvs = rec.metricViews.filter((m) => !existingMvSet.has(m.toLowerCase()));
  if (newMvs.length > 0) {
    changes.push(`+${newMvs.length} new metric views`);
  }

  return changes.length > 0
    ? `Enhancement of "${existing.title}": ${changes.join("; ")}`
    : `Replacement of "${existing.title}" with updated configuration`;
}

function inferHeuristicJoins(
  metadata: MetadataSnapshot,
  tableFqns: string[],
  existingJoinKeys: Set<string>,
): Array<{ leftTable: string; rightTable: string; sql: string; relationshipType: "many_to_one" }> {
  const byTable = new Map<string, Set<string>>();
  for (const c of metadata.columns) {
    const key = c.tableFqn.toLowerCase();
    const cols = byTable.get(key) ?? new Set<string>();
    cols.add(c.columnName.toLowerCase());
    byTable.set(key, cols);
  }
  const joins: Array<{
    leftTable: string;
    rightTable: string;
    sql: string;
    relationshipType: "many_to_one";
  }> = [];
  for (let i = 0; i < tableFqns.length; i++) {
    for (let j = i + 1; j < tableFqns.length; j++) {
      const left = tableFqns[i];
      const right = tableFqns[j];
      const pair = `${left.toLowerCase()}|${right.toLowerCase()}`;
      const reverse = `${right.toLowerCase()}|${left.toLowerCase()}`;
      if (existingJoinKeys.has(pair) || existingJoinKeys.has(reverse)) continue;
      const leftCols = byTable.get(left.toLowerCase()) ?? new Set<string>();
      const rightCols = byTable.get(right.toLowerCase()) ?? new Set<string>();
      const synonym = tableHasSynonymPair(leftCols, rightCols);
      if (!synonym) continue;
      joins.push({
        leftTable: left,
        rightTable: right,
        sql: `${left}.${synonym.leftColumn} = ${right}.${synonym.rightColumn}`,
        relationshipType: "many_to_one",
      });
      existingJoinKeys.add(pair);
      existingJoinKeys.add(reverse);
    }
  }
  return joins;
}

/** @deprecated Kept as fallback; prefer runHealthCheck() for accurate scoring. */
function _qualityScoreFallback(degradedReasons: string[]): number {
  return Math.max(40, 100 - degradedReasons.length * 12);
}
