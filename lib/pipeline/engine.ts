/**
 * Pipeline Engine -- orchestrates the 8 pipeline steps sequentially.
 *
 * Updates Lakebase progress after each step. Handles errors and allows
 * the frontend to poll for status.
 */

import { PipelineStep } from "@/lib/domain/types";
import type { PipelineContext, MetadataSnapshot, LineageGraph } from "@/lib/domain/types";
import { PipelineCancelledError, markRunCancelled, clearRunCancelled } from "@/lib/ai/agent";
import { createScopedLogger, type ScopedLogger } from "@/lib/logger";
import {
  updateRunStatus,
  updateRunBusinessContext,
  updateRunStepLog,
  updateRunMetadataCacheKey,
  updateRunIndustry,
  updateRunMessage,
  getRunById,
  getRunFilteredTables,
} from "@/lib/lakebase/runs";
import { detectIndustryFromContext } from "@/lib/domain/industry-outcomes-server";
// insertUseCases/deleteUseCasesForRun are now handled inline via $transaction
import { runBusinessContext } from "./steps/business-context";
import { runMetadataExtraction } from "./steps/metadata-extraction";
import { runTableFiltering } from "./steps/table-filtering";
import { runUsecaseGeneration } from "./steps/usecase-generation";
import { runSourceSystemAttribution } from "./steps/source-system-attribution";
import { runBlastRadiusPass } from "./steps/blast-radius";
import { runDomainClustering } from "./steps/domain-clustering";
import { runScoring } from "./steps/scoring";
import { runSqlGeneration } from "./steps/sql-generation";
import { applyDeterministicQualityFilter } from "./usecase-quality";
import { computeRunQualityBaseline } from "./run-quality";
import { insertQualityMetrics } from "@/lib/lakebase/quality-metrics";
import { runAssetDiscovery } from "./steps/asset-discovery";
import { ensureCommentEnrichment } from "./comment-prerequisite";
import { runGenieRecommendations } from "./steps/genie-recommendations";
import { runDashboardRecommendations } from "./steps/dashboard-recommendations";
import { runBusinessValueAnalysis } from "./steps/business-value-analysis";
import {
  runBackgroundJobGraph,
  runGenieSemanticJob,
  type GenieDependentJobOutcome,
} from "./background-job-orchestration";
import {
  startJob,
  updateJob,
  updateJobDomainProgress,
  addCompletedDomainName,
  initDomainList,
  updateDomainPhase,
  completeJob,
  failJob,
  getJobController,
  getJobStatus,
} from "@/lib/genie/engine-status";
import { EngineCancelledError } from "@/lib/genie/engine";
import {
  startDashboardJob,
  updateDashboardJob,
  completeDashboardJob,
  failDashboardJob,
} from "@/lib/dashboard/engine-status";
import { startBvJob, updateBvJob, completeBvJob, failBvJob } from "@/lib/pipeline/bv-engine-status";
import {
  startSqlJob,
  updateSqlJob,
  setSqlJobTotal,
  completeSqlJob,
  failSqlJob,
  cancelSqlJob,
  getSqlJobController,
} from "@/lib/pipeline/sql-engine-status";
import { markUseCasesSqlPending } from "@/lib/lakebase/usecases";
import { logActivity } from "@/lib/lakebase/activity-log";
import { flushPromptLogs } from "@/lib/lakebase/prompt-logs";
import { logMemoryUsage } from "@/lib/pipeline/memory-monitor";
import { registerPipelineStarter, notifyScheduler } from "@/lib/pipeline/scheduler";
import { runWithDatabricksAuthContext } from "@/lib/dbx/auth-context";

// ---------------------------------------------------------------------------
// Step definitions with progress percentages
// ---------------------------------------------------------------------------

interface StepDef {
  step: PipelineStep;
  progressPct: number;
  label: string;
}

const activePipelineRuns = new Map<string, AbortController>();

/**
 * Throw PipelineCancelledError if the signal has been aborted.
 * Called between pipeline steps for fast cancellation.
 */
function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PipelineCancelledError("unknown");
  }
}

/**
 * Resolve the metadata snapshot + lineage graph for the MetadataExtraction
 * step. When the run is seeded with `sourceScanId` (decoupled discovery —
 * Workstream C), metadata is reconstituted from a completed estate scan
 * instead of extracted live from Unity Catalog. Otherwise the normal live
 * extraction runs. Used by both `startPipeline` and `resumePipeline` so the
 * branch stays in one place.
 */
async function resolveMetadataForStep(
  ctx: PipelineContext,
  runId: string,
): Promise<{ snapshot: MetadataSnapshot; lineageGraph: LineageGraph | null }> {
  const sourceScanId = ctx.run.config.sourceScanId;
  if (sourceScanId) {
    await updateRunStatus(
      runId,
      "running",
      PipelineStep.MetadataExtraction,
      12,
      undefined,
      `Loading metadata from estate scan ${sourceScanId}...`,
    );
    const { resolveSourceScanMetadata } = await import("@/lib/pipeline/source-run-metadata");
    // Reconstitutes snapshot + lineage AND persists the run's schema snapshot
    // (Ask Forge grounding), exactly like live extraction.
    const reconstituted = await resolveSourceScanMetadata(
      sourceScanId,
      ctx.run.config.ucMetadata,
      runId,
    );
    if (!reconstituted) {
      throw new Error(
        `Source scan ${sourceScanId} could not be loaded (missing or has no tables). Re-run the estate scan or create the run without a source scan.`,
      );
    }
    return { snapshot: reconstituted.snapshot, lineageGraph: reconstituted.lineageGraph };
  }
  await updateRunStatus(
    runId,
    "running",
    PipelineStep.MetadataExtraction,
    12,
    undefined,
    `Extracting metadata from ${ctx.run.config.ucMetadata}...`,
  );
  const extractionResult = await runMetadataExtraction(ctx, runId);
  return { snapshot: extractionResult.snapshot, lineageGraph: extractionResult.lineageGraph };
}

// NOTE: SqlGeneration is intentionally absent from this array. As of the
// Async SQL Generation refactor, SQL generation runs as a background job
// after the pipeline marks the run "completed" — it is no longer a
// blocking, synchronous step. The PipelineStep.SqlGeneration enum member
// is preserved for backwards compatibility with old `forge_run.step_log`
// rows but never appears here.
const STEPS: StepDef[] = [
  { step: PipelineStep.BusinessContext, progressPct: 10, label: "Generating business context" },
  { step: PipelineStep.MetadataExtraction, progressPct: 18, label: "Extracting metadata" },
  { step: PipelineStep.AssetDiscovery, progressPct: 22, label: "Discovering existing assets" },
  { step: PipelineStep.TableFiltering, progressPct: 30, label: "Filtering tables" },
  { step: PipelineStep.UsecaseGeneration, progressPct: 45, label: "Generating use cases" },
  { step: PipelineStep.DomainClustering, progressPct: 55, label: "Clustering domains" },
  { step: PipelineStep.Scoring, progressPct: 65, label: "Scoring use cases" },
  { step: PipelineStep.BusinessValueAnalysis, progressPct: 90, label: "Analyzing business value" },
  { step: PipelineStep.GenieRecommendations, progressPct: 100, label: "Building Genie Spaces" },
];

// ---------------------------------------------------------------------------
// Use case persistence helper
// ---------------------------------------------------------------------------

import type { UseCase } from "@/lib/domain/types";

/**
 * Atomically persist use cases for a run (delete old + insert new in a
 * single transaction). Called as a checkpoint after Steps 4, 5, 6, and 7
 * so partial results survive crashes.
 */
export async function persistUseCases(
  runId: string,
  useCases: UseCase[],
  log: ScopedLogger,
): Promise<void> {
  const { withPrisma } = await import("@/lib/prisma");
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
        await tx.forgeUseCase.deleteMany({ where: { runId } });
        if (useCases.length > 0) {
          await tx.forgeUseCase.createMany({
            data: useCases.map((uc) => ({
              id: uc.id,
              runId: uc.runId,
              useCaseNo: uc.useCaseNo,
              name: uc.name,
              type: uc.type,
              analyticsTechnique: uc.analyticsTechnique,
              statement: uc.statement,
              solution: uc.solution,
              businessValue: uc.businessValue,
              beneficiary: uc.beneficiary,
              sponsor: uc.sponsor,
              domain: uc.domain,
              subdomain: uc.subdomain,
              tablesInvolved: JSON.stringify(uc.tablesInvolved),
              priorityScore: uc.priorityScore,
              feasibilityScore: uc.feasibilityScore,
              impactScore: uc.impactScore,
              overallScore: uc.overallScore,
              sqlCode: uc.sqlCode,
              sqlStatus: uc.sqlStatus,
              sourceSystems: uc.sourceSystems ? JSON.stringify(uc.sourceSystems) : null,
              sourceSystemsOrigin: uc.sourceSystemsOrigin,
              blastRadiusJson: uc.blastRadius ? JSON.stringify(uc.blastRadius) : null,
            })),
          });
        }
      },
    );
  });
  log.info(`Checkpointed ${useCases.length} use cases`, { fn: "persistUseCases" });
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface PipelineRunOptions {
  /** Owner email captured at request time. Falls back to run.ownerEmail. */
  ownerEmail?: string | null;
  /** OBO token captured at request time for user-as-actor calls. */
  oboToken?: string | null;
}

/**
 * Start the pipeline for a given run. This is called asynchronously from
 * the API route -- the caller does not await the result.
 *
 * Progress is tracked in Lakebase so the frontend can poll.
 */
export async function startPipeline(runId: string, opts: PipelineRunOptions = {}): Promise<void> {
  if (opts.oboToken) {
    return runWithDatabricksAuthContext({ oboToken: opts.oboToken }, () =>
      startPipelineInner(runId, opts),
    );
  }
  return startPipelineInner(runId, opts);
}

async function startPipelineInner(runId: string, opts: PipelineRunOptions = {}): Promise<void> {
  const controller = new AbortController();
  activePipelineRuns.set(runId, controller);
  const log = createScopedLogger({ origin: "DiscoveryRun", module: "pipeline/engine", runId });
  try {
    const run = await getRunById(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const ctx: PipelineContext = {
      run,
      metadata: null,
      filteredTables: [],
      useCases: [],
      lineageGraph: null,
      sampleData: null,
      discoveryResult: null,
      signal: controller.signal,
      logger: log,
      ownerEmail: opts.ownerEmail ?? run.ownerEmail ?? null,
      oboToken: opts.oboToken ?? null,
    };

    /** Helper: record step start/end timing in the run's stepLog. */
    async function logStep(
      step: PipelineStep,
      stepLog: ScopedLogger,
      fn: () => Promise<void>,
    ): Promise<void> {
      const startedAt = new Date().toISOString();
      logMemoryUsage(`Before step: ${step}`, { runId, step });
      stepLog.info("Step starting", { phase: "start" });
      try {
        // Wrap the step body in an AsyncLocalStorage context so any LLM
        // call (no matter how deeply nested) can attribute waiting and
        // throttle ms back to this (runId, step) pair.
        const { runWithStep } = await import("@/lib/pipeline/run-context");
        await runWithStep(runId, String(step), fn);
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
        logMemoryUsage(`After step: ${step}`, { runId, step, durationMs });
        stepLog.info("Step completed", { phase: "end", durationMs });
        await updateRunStepLog(runId, { step, startedAt, completedAt, durationMs });
      } catch (err) {
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
        const errorMsg = err instanceof Error ? err.message : String(err);
        logMemoryUsage(`Step failed: ${step}`, { runId, step, durationMs, error: errorMsg });
        stepLog.error("Step failed", { phase: "error", durationMs, error: errorMsg });
        await updateRunStepLog(runId, {
          step,
          startedAt,
          completedAt,
          durationMs,
          error: errorMsg,
        });
        throw err;
      }
    }

    try {
      // Mark as running
      await updateRunStatus(
        runId,
        "running",
        STEPS[0].step,
        0,
        undefined,
        "Initialising pipeline...",
      );
      ctx.run = { ...ctx.run, status: "running" };
      log.info("Pipeline started", { phase: "start", businessName: ctx.run.config.businessName });

      // Step 1: Business Context
      checkCancelled(ctx.signal);
      {
        const stepLog = log.child({
          task: "BusinessContext",
          module: "pipeline/steps/business-context",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.BusinessContext, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.BusinessContext,
            5,
            undefined,
            `Generating business context for ${ctx.run.config.businessName}...`,
          );
          const businessContext = await runBusinessContext(ctx, runId);
          ctx.run = { ...ctx.run, businessContext };
          await updateRunBusinessContext(runId, businessContext);
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.BusinessContext,
            10,
            undefined,
            "Business context generated",
          );
        });
      }

      // Auto-detect industry outcome map if not manually selected
      const detectedIndustries = ctx.run.businessContext?.industries;
      if (!ctx.run.config.industry && detectedIndustries) {
        const detected = await detectIndustryFromContext(detectedIndustries);
        if (detected) {
          ctx.run = {
            ...ctx.run,
            config: { ...ctx.run.config, industry: detected },
          };
          await updateRunIndustry(runId, detected, true);
          log.info("Auto-detected industry outcome map", {
            detected,
            from: detectedIndustries,
          });
          await updateRunMessage(runId, `Auto-detected industry: ${detected}`);
        }
      }

      // Step 2: Metadata Extraction
      checkCancelled(ctx.signal);
      {
        const stepLog = log.child({
          task: "MetadataExtraction",
          module: "pipeline/steps/metadata-extraction",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.MetadataExtraction, stepLog, async () => {
          const extractionResult = await resolveMetadataForStep(ctx, runId);
          ctx.metadata = extractionResult.snapshot;
          ctx.lineageGraph = extractionResult.lineageGraph;
          if (ctx.metadata.cacheKey) {
            await updateRunMetadataCacheKey(runId, ctx.metadata.cacheKey);
            const { saveMetadataSnapshot } = await import("@/lib/lakebase/metadata-cache");
            await saveMetadataSnapshot(ctx.metadata);
          }
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.MetadataExtraction,
            18,
            undefined,
            `Found ${ctx.metadata.tableCount} tables, ${ctx.metadata.columnCount} columns`,
          );
        });
      }

      // Step 2b: Asset Discovery (conditional -- skipped when assetDiscoveryEnabled is false)
      checkCancelled(ctx.signal);
      if (ctx.run.config.assetDiscoveryEnabled) {
        const stepLog = log.child({
          task: "AssetDiscovery",
          module: "pipeline/steps/asset-discovery",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.AssetDiscovery, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.AssetDiscovery,
            19,
            undefined,
            "Discovering existing Genie spaces, dashboards, and metric views...",
          );
          ctx.discoveryResult = await runAssetDiscovery(ctx, runId);
          const summary = ctx.discoveryResult
            ? `Found ${ctx.discoveryResult.genieSpaces.length} Genie spaces, ${ctx.discoveryResult.dashboards.length} dashboards, ${ctx.discoveryResult.metricViews.length} metric views`
            : "Discovery skipped";
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.AssetDiscovery,
            22,
            undefined,
            summary,
          );
        });
      }

      // Step 2c: Comment Enrichment (runs Comment Engine as a prerequisite)
      checkCancelled(ctx.signal);
      {
        const enrichLog = log.child({
          task: "CommentEnrichment",
          module: "pipeline/comment-prerequisite",
        });
        await updateRunMessage(runId, "Enriching metadata with AI-generated comments...");
        const commentResult = await ensureCommentEnrichment(
          ctx.metadata!,
          ctx.run.config.industry ?? undefined,
          ctx.run.businessContext?.strategicGoals,
          runId,
          ctx.signal,
          ctx.run.config.outputLanguage,
          ctx.ownerEmail,
        );
        if (commentResult.enriched) {
          const msg = commentResult.reused
            ? `Reused AI comments: ${commentResult.tablesEnriched} tables, ${commentResult.columnsEnriched} columns enriched`
            : `AI Comment Engine: ${commentResult.tablesEnriched} tables, ${commentResult.columnsEnriched} columns enriched`;
          await updateRunMessage(runId, msg);
          enrichLog.info("Comment enrichment complete", { ...commentResult });
        } else {
          enrichLog.info("Comment enrichment skipped or failed, continuing with UC comments");
        }
      }

      // Step 3: Table Filtering
      checkCancelled(ctx.signal);
      {
        const stepLog = log.child({
          task: "TableFiltering",
          module: "pipeline/steps/table-filtering",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.TableFiltering, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.TableFiltering,
            24,
            undefined,
            `Filtering ${ctx.metadata!.tableCount} tables for business relevance...`,
          );
          ctx.filteredTables = await runTableFiltering(ctx, runId);
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.TableFiltering,
            30,
            undefined,
            `Identified ${ctx.filteredTables.length} business-relevant tables out of ${ctx.metadata!.tableCount}`,
          );
        });
      }

      // Prune metadata to only filtered tables. On large schemas (12k+ tables)
      // this frees 50-80% of column/FK memory before the expensive LLM steps.
      if (ctx.metadata && ctx.filteredTables.length > 0) {
        const beforeCols = ctx.metadata.columns.length;
        const beforeFks = ctx.metadata.foreignKeys.length;
        const fqnSet = new Set(ctx.filteredTables.map((f) => f.replace(/`/g, "")));
        ctx.metadata.columns = ctx.metadata.columns.filter((c) =>
          fqnSet.has(c.tableFqn.replace(/`/g, "")),
        );
        ctx.metadata.foreignKeys = ctx.metadata.foreignKeys.filter(
          (fk) =>
            fqnSet.has(fk.tableFqn.replace(/`/g, "")) ||
            fqnSet.has(fk.referencedTableFqn.replace(/`/g, "")),
        );
        if (
          beforeCols !== ctx.metadata.columns.length ||
          beforeFks !== ctx.metadata.foreignKeys.length
        ) {
          log.info("Pruned metadata to filtered tables", {
            columnsBefore: beforeCols,
            columnsAfter: ctx.metadata.columns.length,
            fksBefore: beforeFks,
            fksAfter: ctx.metadata.foreignKeys.length,
          });
          logMemoryUsage("After metadata pruning", { runId });
        }
      }

      // Step 4: Use Case Generation
      checkCancelled(ctx.signal);
      {
        const stepLog = log.child({
          task: "UsecaseGeneration",
          module: "pipeline/steps/usecase-generation",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.UsecaseGeneration, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.UsecaseGeneration,
            32,
            undefined,
            `Generating AI use cases from ${ctx.filteredTables.length} tables...`,
          );
          ctx.useCases = await runUsecaseGeneration(ctx, runId);

          // Post-generation validation: strip hallucinated table references
          const validFqns = new Set([
            ...ctx.filteredTables,
            ...ctx.filteredTables.map((fqn) => fqn.replace(/`/g, "")),
          ]);
          let hallucinated = 0;
          ctx.useCases = ctx.useCases.filter((uc) => {
            uc.tablesInvolved = uc.tablesInvolved.filter((t) => {
              const clean = t.replace(/`/g, "");
              return validFqns.has(t) || validFqns.has(clean);
            });
            if (uc.tablesInvolved.length === 0) {
              hallucinated++;
              return false;
            }
            return true;
          });
          if (hallucinated > 0) {
            stepLog.warn("Removed use cases with hallucinated table references", {
              fn: "startPipeline",
              errorCategory: "sql_hallucination",
              removedCount: hallucinated,
              remainingCount: ctx.useCases.length,
            });
          }

          // Deterministic anti-slop quality gate (pre-scoring).
          const qualityFilter = applyDeterministicQualityFilter(ctx.useCases, ctx.filteredTables);
          if (qualityFilter.rejected.length > 0) {
            stepLog.warn("Rejected low-quality use cases by deterministic gate", {
              fn: "startPipeline",
              errorCategory: "schema_validation",
              rejected: qualityFilter.rejected.length,
              sampleReasons: qualityFilter.rejected.slice(0, 5).map((r) => r.reasons.join("; ")),
            });
          }
          ctx.useCases = qualityFilter.accepted;

          if (ctx.useCases.length === 0) {
            throw new Error(
              "Use case generation returned only invalid results after table validation. Please retry this run.",
            );
          }

          await updateRunStatus(
            runId,
            "running",
            PipelineStep.UsecaseGeneration,
            45,
            undefined,
            `Generated ${ctx.useCases.length} validated use cases${hallucinated > 0 ? ` (${hallucinated} removed — invalid table refs)` : ""}`,
          );

          // Source-system attribution (Phase 3.1): mutates ctx.useCases
          // in place with sourceSystems + sourceSystemsOrigin so the next
          // persistUseCases call writes the attribution alongside the
          // freshly generated rows. Pure deterministic; non-blocking on
          // lineage availability (falls back to naming + comments).
          const attribution = runSourceSystemAttribution(ctx);
          if (attribution.attributedCount > 0) {
            stepLog.info("Attributed source systems to use cases", {
              fn: "startPipeline",
              attributedCount: attribution.attributedCount,
              totalUseCases: attribution.totalUseCases,
              systemsSeen: attribution.systemsSeen,
            });
          }

          await persistUseCases(runId, ctx.useCases, stepLog);
        });
      }

      // Step 5: Domain Clustering
      checkCancelled(ctx.signal);
      {
        const stepLog = log.child({
          task: "DomainClustering",
          module: "pipeline/steps/domain-clustering",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.DomainClustering, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.DomainClustering,
            47,
            undefined,
            `Assigning domains to ${ctx.useCases.length} use cases...`,
          );
          ctx.useCases = await runDomainClustering(ctx, runId);
          const domainCount = new Set(ctx.useCases.map((uc) => uc.domain)).size;
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.DomainClustering,
            55,
            undefined,
            `Organised use cases into ${domainCount} domains`,
          );
          await persistUseCases(runId, ctx.useCases, stepLog);
        });
      }

      // Step 6: Scoring & Deduplication
      checkCancelled(ctx.signal);
      {
        const stepLog = log.child({ task: "Scoring", module: "pipeline/steps/scoring" });
        ctx.logger = stepLog;
        await logStep(PipelineStep.Scoring, stepLog, async () => {
          const preScoringCount = ctx.useCases.length;
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.Scoring,
            57,
            undefined,
            `Scoring and deduplicating ${preScoringCount} use cases...`,
          );
          ctx.useCases = await runScoring(ctx, runId);
          const baseline = computeRunQualityBaseline(ctx.useCases, ctx.filteredTables);
          const minReadiness = Number(process.env.FORGE_MIN_CONSULTANT_READINESS ?? "0.55");
          await insertQualityMetrics([
            {
              metricType: "run",
              metricName: "consultant_readiness",
              metricValue: baseline.consultantReadinessScore,
              floorValue: minReadiness,
              passed: baseline.consultantReadinessScore >= minReadiness,
              runId,
              metadata: { findings: baseline.findings },
            },
            {
              metricType: "run",
              metricName: "low_specificity_rate",
              metricValue: baseline.lowSpecificityRate,
              floorValue: 0.25,
              passed: baseline.lowSpecificityRate <= 0.25,
              runId,
            },
            {
              metricType: "run",
              metricName: "schema_coverage_pct",
              metricValue: baseline.schemaCoveragePct,
              floorValue: 0.3,
              passed: baseline.schemaCoveragePct >= 0.3,
              runId,
            },
            {
              metricType: "run",
              metricName: "sql_generated_rate",
              metricValue: baseline.sqlGeneratedRate,
              floorValue: 0.7,
              passed: baseline.sqlGeneratedRate >= 0.7,
              runId,
            },
          ]);
          stepLog.info("Run quality baseline computed", {
            fn: "startPipeline",
            consultantReadiness: baseline.consultantReadinessScore,
            lowSpecificityRate: baseline.lowSpecificityRate,
            schemaCoveragePct: baseline.schemaCoveragePct,
            sqlGeneratedRate: baseline.sqlGeneratedRate,
          });
          if (baseline.consultantReadinessScore < minReadiness) {
            throw new Error(
              `Run quality gate failed (consultantReadiness=${baseline.consultantReadinessScore.toFixed(2)} < ${minReadiness.toFixed(2)}). ${baseline.findings.join(" | ") || "Insufficient quality for customer-facing output."}`,
            );
          }
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.Scoring,
            65,
            undefined,
            `Scored ${ctx.useCases.length} use cases`,
          );

          // Downstream blast-radius (Phase 3.2): apply feasibility boost
          // for use cases whose tables already power downstream consumers.
          // Stores the per-use-case summary on `uc.blastRadius` so the next
          // persistUseCases checkpoint writes blast_radius_json alongside
          // the boosted feasibility / overall scores. Non-blocking on
          // lineage availability — degrades to a no-op zeroed summary.
          const blastRadius = runBlastRadiusPass(ctx);
          if (blastRadius.boostedCount > 0) {
            stepLog.info("Applied blast-radius feasibility boost", {
              fn: "startPipeline",
              boostedCount: blastRadius.boostedCount,
              totalDownstreamTables: blastRadius.totalDownstreamTables,
              topUseCaseIds: blastRadius.topUseCaseIds,
            });
          }

          await persistUseCases(runId, ctx.useCases, stepLog);
        });
      }

      // SQL generation now runs as a background job (see startBackgroundJobs).
      // Mark every persisted use case as "pending" so the UI immediately
      // shows the SQL queue depth when the run transitions to completed.
      try {
        await markUseCasesSqlPending(runId);
      } catch (err) {
        log.warn("Failed to mark use cases as SQL pending (non-fatal)", {
          fn: "startPipeline",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      for (const uc of ctx.useCases) {
        uc.sqlStatus = "pending";
        uc.sqlCode = null;
      }

      // Step 8 (Business Value Analysis) also runs as a background job after
      // the main pipeline marks the run "completed". See startBackgroundJobs.
      if (!ctx.run.config.businessValueEnabled) {
        log.info("Business value analysis skipped (not enabled in config)");
      }

      // Generate vector embeddings for use cases + business context (best-effort).
      // BV-output embedding is handled inside the background BV task so it
      // does not block the main pipeline from reaching "completed".
      try {
        const { embedRunResults } = await import("@/lib/embeddings/embed-pipeline");
        const bcJson = ctx.run.businessContext ? JSON.stringify(ctx.run.businessContext) : null;
        await embedRunResults(runId, ctx.useCases, bcJson, ctx.run.config.businessName);
      } catch (embedErr) {
        log.warn("Use case embedding failed (non-fatal)", {
          fn: "startPipeline",
          errorCategory: "data",
          error: embedErr instanceof Error ? embedErr.message : String(embedErr),
        });
      }

      // Mark as completed at 95% — SQL / BV / Genie / Dashboard all run in
      // the background. The 5% headroom is intentional: it gives the UI a
      // visual hint that background jobs are still running. Setting status
      // to "completed" here is what unlocks the API gate that lets users
      // explore use cases immediately (previously blocked behind ~12-16%
      // of pipeline runtime spent on synchronous SQL generation).
      const finalDomains = new Set(ctx.useCases.map((uc) => uc.domain)).size;
      await updateRunStatus(
        runId,
        "completed",
        null,
        95,
        undefined,
        `Pipeline complete: ${ctx.useCases.length} use cases across ${finalDomains} domains (SQL generating in background)`,
      );
      log.info("Pipeline completed, starting background jobs", {
        phase: "end",
        useCaseCount: ctx.useCases.length,
      });

      // Fire SQL, Business Value, Genie Engine and Dashboard Engine in the
      // background. SQL runs first, then Genie persists semantic manifests,
      // then Dashboard reloads them. BV runs in parallel with SQL (no SQL
      // dependency).
      startBackgroundJobs(ctx, runId, log, { includeBv: ctx.run.config.businessValueEnabled });
    } catch (error) {
      if (error instanceof PipelineCancelledError) {
        log.info("Pipeline cancelled by user", { phase: "end" });
        try {
          await updateRunStatus(
            runId,
            "cancelled",
            ctx.run.currentStep,
            ctx.run.progressPct,
            "Cancelled by user",
            "Pipeline cancelled",
          );
        } catch (statusError) {
          log.error("Failed to update run status after cancellation", {
            errorCategory: "db",
            statusError: statusError instanceof Error ? statusError.message : String(statusError),
          });
        }
      } else {
        const message = error instanceof Error ? error.message : "Unknown pipeline error";
        log.error("Pipeline failed", { phase: "error", error: message });
        try {
          await updateRunStatus(
            runId,
            "failed",
            ctx.run.currentStep,
            ctx.run.progressPct,
            message,
            `Pipeline failed: ${message}`,
          );
        } catch (statusError) {
          log.error("Failed to update run status after pipeline failure", {
            errorCategory: "db",
            originalError: message,
            statusError: statusError instanceof Error ? statusError.message : String(statusError),
          });
        }
      }
    }
  } finally {
    await flushPromptLogs();
    clearRunCancelled(runId);
    activePipelineRuns.delete(runId);
    try {
      const { clearRunCounters } = await import("@/lib/pipeline/step-instrumentation");
      clearRunCounters(runId);
    } catch {
      /* counters module may not have loaded */
    }
    notifyScheduler();
  }
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/**
 * Resume a failed pipeline from the first incomplete step.
 * Restores persisted context (business context, metadata, filtered tables)
 * so that expensive early steps are not re-run.
 */
export async function resumePipeline(runId: string, opts: PipelineRunOptions = {}): Promise<void> {
  if (opts.oboToken) {
    return runWithDatabricksAuthContext({ oboToken: opts.oboToken }, () =>
      resumePipelineInner(runId, opts),
    );
  }
  return resumePipelineInner(runId, opts);
}

async function resumePipelineInner(runId: string, opts: PipelineRunOptions = {}): Promise<void> {
  const controller = new AbortController();
  activePipelineRuns.set(runId, controller);
  const log = createScopedLogger({
    origin: "DiscoveryRun",
    module: "pipeline/engine",
    runId,
    fn: "resumePipeline",
  });
  try {
    const run = await getRunById(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== "failed" && run.status !== "cancelled") {
      throw new Error(`Cannot resume run with status "${run.status}"`);
    }

    const completedSteps = new Set(
      (run.stepLog ?? []).filter((e) => e.completedAt && !e.error).map((e) => e.step),
    );

    const resumeIndex = STEPS.findIndex((s) => !completedSteps.has(s.step));
    if (resumeIndex < 0) {
      throw new Error("All steps already completed — nothing to resume");
    }

    const ctx: PipelineContext = {
      run,
      metadata: null,
      filteredTables: [],
      useCases: [],
      lineageGraph: null,
      sampleData: null,
      discoveryResult: null,
      signal: controller.signal,
      logger: log,
      ownerEmail: opts.ownerEmail ?? run.ownerEmail ?? null,
      oboToken: opts.oboToken ?? null,
    };

    // Restore business context (persisted after step 1)
    if (completedSteps.has(PipelineStep.BusinessContext) && run.businessContext) {
      ctx.run = { ...ctx.run, businessContext: run.businessContext };
    }

    // Restore metadata snapshot (persisted after step 2). For source-scan
    // (decoupled discovery) runs, deterministically reconstitute BOTH the
    // snapshot AND the lineage graph from the source scan so `ctx.lineageGraph`
    // is populated on resume exactly as on the initial path — the metadata
    // cache only stores the snapshot (no lineage edges), so a plain cache load
    // would leave downstream consumers (source-system attribution,
    // blast-radius) without lineage after a resume.
    if (completedSteps.has(PipelineStep.MetadataExtraction)) {
      const sourceScanId = ctx.run.config.sourceScanId;
      if (sourceScanId) {
        const { resolveSourceScanMetadata } = await import("@/lib/pipeline/source-run-metadata");
        const reconstituted = await resolveSourceScanMetadata(
          sourceScanId,
          ctx.run.config.ucMetadata,
          runId,
          { persistSchemaSnapshot: false },
        );
        if (reconstituted) {
          ctx.metadata = reconstituted.snapshot;
          ctx.lineageGraph = reconstituted.lineageGraph;
        }
      } else {
        const { loadMetadataForRun } = await import("@/lib/lakebase/metadata-cache");
        const snapshot = await loadMetadataForRun(runId);
        if (snapshot) ctx.metadata = snapshot;
      }
    }

    // Restore discovery result (persisted after step 2b)
    if (completedSteps.has(PipelineStep.AssetDiscovery)) {
      const { getDiscoveryResultsByRunId } = await import("@/lib/lakebase/discovered-assets");
      const discoveryData = await getDiscoveryResultsByRunId(runId);
      if (discoveryData) {
        ctx.discoveryResult = {
          genieSpaces: discoveryData.genieSpaces.map((s) => ({
            ...s,
            description: null,
            instructionLength: 0,
          })),
          dashboards: discoveryData.dashboards.map((d) => ({
            ...d,
            creatorEmail: undefined,
            updatedAt: undefined,
            parentPath: undefined,
          })),
          metricViews: [],
          discoveredAt: new Date().toISOString(),
        };
      }
    }

    // Restore filtered tables (persisted after step 3)
    if (completedSteps.has(PipelineStep.TableFiltering)) {
      const tables = await getRunFilteredTables(runId);
      if (tables) ctx.filteredTables = tables;
    }

    // Restore use cases (persisted after step 7)
    if (completedSteps.has(PipelineStep.UsecaseGeneration)) {
      const { getUseCasesByRunId } = await import("@/lib/lakebase/usecases");
      ctx.useCases = await getUseCasesByRunId(runId);
    }

    log.info("Resuming pipeline", {
      phase: "start",
      resumeFromStep: STEPS[resumeIndex].step,
      completedSteps: [...completedSteps],
    });

    /** Helper: record step start/end timing in the run's stepLog. */
    async function logStep(
      step: PipelineStep,
      stepLog: ScopedLogger,
      fn: () => Promise<void>,
    ): Promise<void> {
      const startedAt = new Date().toISOString();
      stepLog.info("Step starting", { phase: "start" });
      try {
        const { runWithStep } = await import("@/lib/pipeline/run-context");
        await runWithStep(runId, String(step), fn);
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
        stepLog.info("Step completed", { phase: "end", durationMs });
        await updateRunStepLog(runId, { step, startedAt, completedAt, durationMs });
      } catch (err) {
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
        const errorMsg = err instanceof Error ? err.message : String(err);
        stepLog.error("Step failed", { phase: "error", durationMs, error: errorMsg });
        await updateRunStepLog(runId, {
          step,
          startedAt,
          completedAt,
          durationMs,
          error: errorMsg,
        });
        throw err;
      }
    }

    try {
      await updateRunStatus(
        runId,
        "running",
        STEPS[resumeIndex].step,
        STEPS[resumeIndex].progressPct,
        undefined,
        `Resuming from ${STEPS[resumeIndex].label}...`,
      );
      ctx.run = { ...ctx.run, status: "running" };

      // Step 1: Business Context
      if (resumeIndex <= 0) {
        checkCancelled(ctx.signal);
        const stepLog = log.child({
          task: "BusinessContext",
          module: "pipeline/steps/business-context",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.BusinessContext, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.BusinessContext,
            5,
            undefined,
            `Generating business context for ${ctx.run.config.businessName}...`,
          );
          const businessContext = await runBusinessContext(ctx, runId);
          ctx.run = { ...ctx.run, businessContext };
          await updateRunBusinessContext(runId, businessContext);
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.BusinessContext,
            10,
            undefined,
            "Business context generated",
          );
        });

        const detectedIndustries = ctx.run.businessContext?.industries;
        if (!ctx.run.config.industry && detectedIndustries) {
          const detected = await detectIndustryFromContext(detectedIndustries);
          if (detected) {
            ctx.run = { ...ctx.run, config: { ...ctx.run.config, industry: detected } };
            await updateRunIndustry(runId, detected, true);
            await updateRunMessage(runId, `Auto-detected industry: ${detected}`);
          }
        }
      }

      // Step 2: Metadata Extraction
      if (resumeIndex <= 1) {
        checkCancelled(ctx.signal);
        const stepLog = log.child({
          task: "MetadataExtraction",
          module: "pipeline/steps/metadata-extraction",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.MetadataExtraction, stepLog, async () => {
          const extractionResult = await resolveMetadataForStep(ctx, runId);
          ctx.metadata = extractionResult.snapshot;
          ctx.lineageGraph = extractionResult.lineageGraph;
          if (ctx.metadata.cacheKey) {
            await updateRunMetadataCacheKey(runId, ctx.metadata.cacheKey);
            const { saveMetadataSnapshot } = await import("@/lib/lakebase/metadata-cache");
            await saveMetadataSnapshot(ctx.metadata);
          }
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.MetadataExtraction,
            18,
            undefined,
            `Found ${ctx.metadata.tableCount} tables, ${ctx.metadata.columnCount} columns`,
          );
        });
      }

      // Step 2b: Asset Discovery (conditional)
      checkCancelled(ctx.signal);
      if (resumeIndex <= 2 && ctx.run.config.assetDiscoveryEnabled) {
        const stepLog = log.child({
          task: "AssetDiscovery",
          module: "pipeline/steps/asset-discovery",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.AssetDiscovery, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.AssetDiscovery,
            19,
            undefined,
            "Discovering existing Genie spaces, dashboards, and metric views...",
          );
          ctx.discoveryResult = await runAssetDiscovery(ctx, runId);
          const summary = ctx.discoveryResult
            ? `Found ${ctx.discoveryResult.genieSpaces.length} Genie spaces, ${ctx.discoveryResult.dashboards.length} dashboards, ${ctx.discoveryResult.metricViews.length} metric views`
            : "Discovery skipped";
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.AssetDiscovery,
            22,
            undefined,
            summary,
          );
        });
      }

      // Step 3: Table Filtering
      if (resumeIndex <= 3) {
        checkCancelled(ctx.signal);
        const stepLog = log.child({
          task: "TableFiltering",
          module: "pipeline/steps/table-filtering",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.TableFiltering, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.TableFiltering,
            24,
            undefined,
            `Filtering ${ctx.metadata!.tableCount} tables for business relevance...`,
          );
          ctx.filteredTables = await runTableFiltering(ctx, runId);
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.TableFiltering,
            30,
            undefined,
            `Identified ${ctx.filteredTables.length} business-relevant tables out of ${ctx.metadata!.tableCount}`,
          );
        });
      }

      // Prune metadata to only filtered tables (same as primary path)
      if (ctx.metadata && ctx.filteredTables.length > 0) {
        const fqnSet = new Set(ctx.filteredTables.map((f) => f.replace(/`/g, "")));
        ctx.metadata.columns = ctx.metadata.columns.filter((c) =>
          fqnSet.has(c.tableFqn.replace(/`/g, "")),
        );
        ctx.metadata.foreignKeys = ctx.metadata.foreignKeys.filter(
          (fk) =>
            fqnSet.has(fk.tableFqn.replace(/`/g, "")) ||
            fqnSet.has(fk.referencedTableFqn.replace(/`/g, "")),
        );
      }

      // Step 4: Use Case Generation
      if (resumeIndex <= 4) {
        checkCancelled(ctx.signal);
        const stepLog = log.child({
          task: "UsecaseGeneration",
          module: "pipeline/steps/usecase-generation",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.UsecaseGeneration, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.UsecaseGeneration,
            32,
            undefined,
            `Generating AI use cases from ${ctx.filteredTables.length} tables...`,
          );
          ctx.useCases = await runUsecaseGeneration(ctx, runId);

          const validFqns = new Set([
            ...ctx.filteredTables,
            ...ctx.filteredTables.map((fqn) => fqn.replace(/`/g, "")),
          ]);
          let hallucinated = 0;
          ctx.useCases = ctx.useCases.filter((uc) => {
            uc.tablesInvolved = uc.tablesInvolved.filter((t) => {
              const clean = t.replace(/`/g, "");
              return validFqns.has(t) || validFqns.has(clean);
            });
            if (uc.tablesInvolved.length === 0) {
              hallucinated++;
              return false;
            }
            return true;
          });
          if (hallucinated > 0) {
            stepLog.warn("Removed use cases with hallucinated table references", {
              errorCategory: "sql_hallucination",
              removedCount: hallucinated,
              remainingCount: ctx.useCases.length,
            });
          }
          if (ctx.useCases.length === 0) {
            throw new Error(
              "Use case generation returned only invalid results after table validation. Please retry this run.",
            );
          }
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.UsecaseGeneration,
            45,
            undefined,
            `Generated ${ctx.useCases.length} validated use cases${hallucinated > 0 ? ` (${hallucinated} removed)` : ""}`,
          );

          // Source-system attribution (Phase 3.1).
          const attribution = runSourceSystemAttribution(ctx);
          if (attribution.attributedCount > 0) {
            stepLog.info("Attributed source systems to use cases", {
              fn: "resumePipeline",
              attributedCount: attribution.attributedCount,
              totalUseCases: attribution.totalUseCases,
              systemsSeen: attribution.systemsSeen,
            });
          }

          await persistUseCases(runId, ctx.useCases, stepLog);
        });
      }

      // Step 5: Domain Clustering
      if (resumeIndex <= 5) {
        checkCancelled(ctx.signal);
        const stepLog = log.child({
          task: "DomainClustering",
          module: "pipeline/steps/domain-clustering",
        });
        ctx.logger = stepLog;
        await logStep(PipelineStep.DomainClustering, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.DomainClustering,
            47,
            undefined,
            `Assigning domains to ${ctx.useCases.length} use cases...`,
          );
          ctx.useCases = await runDomainClustering(ctx, runId);
          const domainCount = new Set(ctx.useCases.map((uc) => uc.domain)).size;
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.DomainClustering,
            55,
            undefined,
            `Organised use cases into ${domainCount} domains`,
          );
          await persistUseCases(runId, ctx.useCases, stepLog);
        });
      }

      // Step 6: Scoring
      if (resumeIndex <= 6) {
        checkCancelled(ctx.signal);
        const stepLog = log.child({ task: "Scoring", module: "pipeline/steps/scoring" });
        ctx.logger = stepLog;
        await logStep(PipelineStep.Scoring, stepLog, async () => {
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.Scoring,
            57,
            undefined,
            `Scoring and deduplicating ${ctx.useCases.length} use cases...`,
          );
          ctx.useCases = await runScoring(ctx, runId);
          await updateRunStatus(
            runId,
            "running",
            PipelineStep.Scoring,
            65,
            undefined,
            `Scored ${ctx.useCases.length} use cases`,
          );

          // Downstream blast-radius (Phase 3.2): see the start-path branch
          // above for the rationale. Same call, mirrored into the resume
          // path so re-runs from any step after Scoring still produce a
          // consistent blast_radius_json column.
          const blastRadius = runBlastRadiusPass(ctx);
          if (blastRadius.boostedCount > 0) {
            stepLog.info("Applied blast-radius feasibility boost", {
              fn: "resumePipeline",
              boostedCount: blastRadius.boostedCount,
              totalDownstreamTables: blastRadius.totalDownstreamTables,
              topUseCaseIds: blastRadius.topUseCaseIds,
            });
          }

          await persistUseCases(runId, ctx.useCases, stepLog);
        });
      }

      // SQL generation now runs as a background job. If the prior failed
      // attempt got past scoring, we still need to flip every use case to
      // "pending" so the background job picks them up and the UI shows
      // the queue depth correctly.
      try {
        await markUseCasesSqlPending(runId);
      } catch (err) {
        log.warn("Failed to mark use cases as SQL pending on resume (non-fatal)", {
          fn: "resumePipeline",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      for (const uc of ctx.useCases) {
        uc.sqlStatus = "pending";
        uc.sqlCode = null;
      }

      // Step 8 (Business Value Analysis) now runs as a background job after
      // the main pipeline marks the run "completed". See startBackgroundJobs.
      // We still respect the resumeIndex check: if BV had already completed
      // in a prior attempt (resumeIndex > 8), we don't re-queue it.
      const includeBv = resumeIndex <= 8 && ctx.run.config.businessValueEnabled;

      // Step 9: Genie Recommendations (handled by the background engine below)
      if (resumeIndex <= 9) {
        // no-op — Genie Engine runs in background after completion
      }

      // Generate vector embeddings for use cases + business context (best-effort).
      // BV-output embedding is handled inside the background BV task.
      try {
        const { embedRunResults } = await import("@/lib/embeddings/embed-pipeline");
        const bcJson = ctx.run.businessContext ? JSON.stringify(ctx.run.businessContext) : null;
        await embedRunResults(runId, ctx.useCases, bcJson, ctx.run.config.businessName);
      } catch (embedErr) {
        log.warn("Use case embedding failed (non-fatal)", {
          errorCategory: "data",
          error: embedErr instanceof Error ? embedErr.message : String(embedErr),
        });
      }

      const finalDomains = new Set(ctx.useCases.map((uc) => uc.domain)).size;
      await updateRunStatus(
        runId,
        "completed",
        null,
        95,
        undefined,
        `Pipeline complete: ${ctx.useCases.length} use cases across ${finalDomains} domains (SQL generating in background)`,
      );
      log.info("Resumed pipeline completed", {
        phase: "end",
        useCaseCount: ctx.useCases.length,
      });

      startBackgroundJobs(ctx, runId, log, { includeBv });
    } catch (error) {
      if (error instanceof PipelineCancelledError) {
        log.info("Pipeline cancelled by user", { phase: "end" });
        try {
          await updateRunStatus(
            runId,
            "cancelled",
            ctx.run.currentStep,
            ctx.run.progressPct,
            "Cancelled by user",
            "Pipeline cancelled",
          );
        } catch (statusError) {
          log.error("Failed to update run status after cancellation", {
            errorCategory: "db",
            statusError: statusError instanceof Error ? statusError.message : String(statusError),
          });
        }
      } else {
        const message = error instanceof Error ? error.message : "Unknown pipeline error";
        log.error("Resumed pipeline failed", { phase: "error", error: message });
        try {
          await updateRunStatus(
            runId,
            "failed",
            ctx.run.currentStep,
            ctx.run.progressPct,
            message,
            `Pipeline failed: ${message}`,
          );
        } catch (statusError) {
          log.error("Failed to update run status after resume failure", {
            errorCategory: "db",
            originalError: message,
            statusError: statusError instanceof Error ? statusError.message : String(statusError),
          });
        }
      }
    }
  } finally {
    await flushPromptLogs();
    clearRunCancelled(runId);
    activePipelineRuns.delete(runId);
    try {
      const { clearRunCounters } = await import("@/lib/pipeline/step-instrumentation");
      clearRunCounters(runId);
    } catch {
      /* counters module may not have loaded */
    }
    notifyScheduler();
  }
}

// ---------------------------------------------------------------------------
// Background Jobs (BV parallel; SQL -> Genie -> Dashboard)
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget background jobs. SQL generation, Business Value, Genie,
 * and Dashboard all run after the main pipeline marks the run "completed".
 *
 * Sequencing:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Steps 1-6 complete (run flipped to "completed" at 95%)           │
 *   └────────────────────────┬─────────────────────────────────────────┘
 *                            │
 *           ┌────────────────┴────────────────┐
 *           ▼                                 ▼
 *      sqlTask (SQL generation)         bvTask (in parallel — no SQL dep)
 *           │
 *           ▼ (only after SQL resolves; preserves SQL grounding)
 *      genieTask (includes MV validation + manifest persistence)
 *           │
 *           ▼ (only after Genie succeeds)
 *      dashboardTask (reloads persisted semantic manifests)
 *
 * - SQL: per-use-case SQL generation, written through to Lakebase as each
 *   row completes. Independent status module: `sql-engine-status`.
 * - Business Value: 4 LLM passes (financial / roadmap / synthesis /
 *   stakeholders) pinned to a premium reasoning model, plus a downstream
 *   embedding step. Status: `bv-engine-status`.
 * - Genie: per-domain Genie Space generation. Reads `uc.sqlCode` for
 *   benchmark + example grounding, so it deliberately waits for SQL.
 * - Dashboard: AI/BI dashboard recommendations. Also benefits from
 *   SQL-grounded use cases when picking measures and filters.
 *
 * Each task's progress is tracked independently. The BV / SQL tasks write
 * directly to Lakebase incrementally, so any UI page polling Lakebase
 * will see partial data appear while later passes are still running.
 */
function startBackgroundJobs(
  ctx: PipelineContext,
  runId: string,
  parentLog: ScopedLogger,
  opts: { includeBv: boolean },
): void {
  const bvLog = parentLog.child({
    task: "BusinessValueAnalysis",
    module: "pipeline/steps/business-value-analysis",
  });
  const bvTask = async () => {
    await startBvJob(runId);
    try {
      ctx.logger = bvLog;
      await runBusinessValueAnalysis(ctx);

      // Eagerly invalidate any cached Data Gap analysis for this run so the
      // next GET on /api/runs/<runId>/data-gap recomputes with the freshly
      // generated value estimates. Without this, the card may serve a row
      // written before BV completed (which carries `valueAtRiskMid=0` and
      // pre-P3.3 schema). The GET handler also runs a defensive staleness
      // check, but invalidating here means the very first read after BV
      // finishes is correct.
      try {
        const { deleteDataGapAnalysesForRun } = await import("@/lib/lakebase/data-gap-analyses");
        await deleteDataGapAnalysesForRun(runId);
      } catch (cacheErr) {
        bvLog.warn("Data gap cache invalidation failed (non-fatal)", {
          errorCategory: "data",
          error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        });
      }

      // BV-output embedding (best-effort, runs inside the background task)
      updateBvJob(runId, "Embedding business value outputs for Strategic Advisor...", 95);
      try {
        const { embedBusinessValueResults } = await import("@/lib/embeddings/embed-pipeline");
        const { getValueEstimatesForRun } = await import("@/lib/lakebase/value-estimates");
        const { getRoadmapPhasesForRun } = await import("@/lib/lakebase/roadmap-phases");
        const { getStakeholderProfilesForRun } =
          await import("@/lib/lakebase/stakeholder-profiles");
        const { withPrisma } = await import("@/lib/prisma");
        const [bvEstimates, bvPhases, bvStakeholders] = await Promise.all([
          getValueEstimatesForRun(runId),
          getRoadmapPhasesForRun(runId),
          getStakeholderProfilesForRun(runId),
        ]);
        const bvSynthesisRow = await withPrisma(async (prisma) => {
          const row = await prisma.forgeRun.findUnique({
            where: { runId },
            select: { synthesisJson: true },
          });
          return row?.synthesisJson ?? null;
        });
        let bvSynthesis: import("@/lib/domain/types").ExecutiveSynthesis | null = null;
        if (bvSynthesisRow) {
          try {
            bvSynthesis = JSON.parse(bvSynthesisRow);
          } catch {
            /* ignore */
          }
        }
        await embedBusinessValueResults(runId, bvEstimates, bvPhases, bvStakeholders, bvSynthesis);
      } catch (embedErr) {
        bvLog.warn("Business value embedding failed (non-fatal)", {
          errorCategory: "data",
          error: embedErr instanceof Error ? embedErr.message : String(embedErr),
        });
      }

      await completeBvJob(runId);
      bvLog.info("Background Business Value Analysis completed", { phase: "end" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failBvJob(runId, msg);
      bvLog.error("Background Business Value Analysis failed", { phase: "error", error: msg });
    }
  };

  const genieLog = parentLog.child({
    task: "GenieRecommendations",
    module: "pipeline/steps/genie-recommendations",
  });
  const genieTask = async (): Promise<GenieDependentJobOutcome> => {
    await startJob(runId);
    const controller = getJobController(runId);
    ctx.logger = genieLog;
    const outcome = await runGenieSemanticJob({
      signal: controller?.signal,
      run: () =>
        runGenieRecommendations(
          ctx,
          runId,
          (message, percent, completedDomains, totalDomains, completedDomainName) => {
            updateJob(runId, message, percent);
            updateJobDomainProgress(runId, completedDomains, totalDomains);
            if (completedDomainName) {
              addCompletedDomainName(runId, completedDomainName);
            }
          },
          (domains) => initDomainList(runId, domains),
          (domain, phase) => updateDomainPhase(runId, domain, phase),
          {
            signal: controller?.signal,
            allowLegacyFallback: false,
            requireSemanticManifests: true,
          },
        ),
      completeJob: (count) => completeJob(runId, count),
      failJob: (error) => failJob(runId, error),
      getTerminalStatus: async () => (await getJobStatus(runId))?.status ?? null,
      isCancellationError: (error) => error instanceof EngineCancelledError,
    });
    if (outcome.status === "completed") {
      genieLog.info("Background Genie Engine completed", {
        phase: "end",
        genieCount: outcome.recommendationCount,
      });
    } else if (outcome.status === "cancelled") {
      genieLog.info("Background Genie Engine cancelled", { phase: "end" });
    } else {
      genieLog.error("Background Genie Engine failed", {
        phase: "error",
        error: outcome.error ?? outcome.status,
      });
    }
    return outcome;
  };

  const dashLog = parentLog.child({
    task: "DashboardRecommendations",
    module: "pipeline/steps/dashboard-recommendations",
  });
  const dashboardTask = async () => {
    await startDashboardJob(runId);
    try {
      const dashboardResult = await runDashboardRecommendations(ctx, runId, (message, percent) =>
        updateDashboardJob(runId, message, percent),
      );
      await completeDashboardJob(
        runId,
        dashboardResult.recommendationCount,
        dashboardResult.validationFailures,
      );
      dashLog.info("Background Dashboard Engine completed", {
        phase: "end",
        dashboardCount: dashboardResult.recommendationCount,
        validationFailureCount: dashboardResult.validationFailures.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failDashboardJob(runId, msg);
      dashLog.error("Background Dashboard Engine failed", { phase: "error", error: msg });
    }
  };

  const sqlLog = parentLog.child({
    task: "SqlGeneration",
    module: "pipeline/steps/sql-generation",
  });
  type SqlTaskOutcome = {
    generated: number;
    failed: number;
    cancelled: boolean;
  };
  const sqlTask = async (): Promise<SqlTaskOutcome> => {
    await startSqlJob(runId);
    setSqlJobTotal(runId, ctx.useCases.length);
    void logActivity("sql_engine_started", {
      userId: ctx.ownerEmail,
      resourceId: runId,
      metadata: { useCaseCount: ctx.useCases.length },
    });
    const controller = getSqlJobController(runId);
    try {
      ctx.logger = sqlLog;
      ctx.useCases = await runSqlGeneration(ctx, runId, {
        signal: controller?.signal,
        streamPersistence: true,
        onProgress: (message, percent) => updateSqlJob(runId, message, percent),
      });
      const generated = ctx.useCases.filter((uc) => uc.sqlStatus === "generated").length;
      const failed = ctx.useCases.filter((uc) => uc.sqlStatus === "failed").length;
      await completeSqlJob(runId, generated, failed);
      sqlLog.info("Background SQL generation completed", {
        phase: "end",
        generated,
        failed,
        total: ctx.useCases.length,
      });
      void logActivity("sql_engine_completed", {
        userId: ctx.ownerEmail,
        resourceId: runId,
        metadata: { generated, failed, total: ctx.useCases.length },
      });

      // Recompute the `sql_generated_rate` quality metric now that SQL has
      // finished. The metric written at scoring time was always ~0 because
      // SQL had not run yet.
      try {
        const { insertQualityMetrics } = await import("@/lib/lakebase/quality-metrics");
        const rate = ctx.useCases.length > 0 ? generated / ctx.useCases.length : 0;
        await insertQualityMetrics([
          {
            metricType: "run",
            metricName: "sql_generated_rate",
            metricValue: rate,
            floorValue: 0.7,
            passed: rate >= 0.7,
            runId,
          },
        ]);
      } catch (err) {
        sqlLog.warn("Failed to recompute sql_generated_rate (non-fatal)", {
          errorCategory: "db",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return { generated, failed, cancelled: false };
    } catch (err) {
      if (err instanceof PipelineCancelledError) {
        sqlLog.info("Background SQL generation cancelled");
        await cancelSqlJob(runId);
        void logActivity("sql_engine_cancelled", {
          userId: ctx.ownerEmail,
          resourceId: runId,
        });
        return { generated: 0, failed: 0, cancelled: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      await failSqlJob(runId, msg);
      sqlLog.error("Background SQL generation failed", { phase: "error", error: msg });
      void logActivity("sql_engine_failed", {
        userId: ctx.ownerEmail,
        resourceId: runId,
        metadata: { error: msg.substring(0, 500) },
      });
      throw err;
    }
  };

  // SQL must finish before Genie so it reads fully
  // grounded use cases (uc.sqlCode is critical for join inference and
  // example SQL in Genie spaces). Dashboard then waits for Genie to finish
  // metric-view validation and persist per-domain semantic manifests.
  // BV has no SQL dependency and runs in parallel with the SQL job.
  //
  // Gating semantics:
  //   - SQL FAILURE (some UCs generated, others failed): downstream still
  //     fires. Genie handles missing sqlCode gracefully and the
  //     subset that succeeded is valuable input.
  //   - SQL CANCELLATION (user clicked cancel; most UCs still "pending"):
  //     skip Genie + Dashboard. Running them now would burn compute on a
  //     half-empty dataset and contradict the user's stop intent.
  // Fire-and-forget the whole graph. The production helper absorbs all branch
  // rejections after each task has routed status/activity updates.
  void runBackgroundJobGraph(sqlTask, bvTask, genieTask, dashboardTask, opts.includeBv);
}

/**
 * Returns the ordered list of pipeline steps with labels and progress.
 * Used by the UI to render the progress stepper.
 */
export function getPipelineSteps(): StepDef[] {
  return STEPS;
}

export function getActivePipelineRunIds(): string[] {
  return [...activePipelineRuns.keys()];
}

export function isPipelineActive(runId: string): boolean {
  return activePipelineRuns.has(runId);
}

/**
 * Cancel a single pipeline run.
 *
 * - If the run is actively executing, signal the AbortController -- the
 *   pipeline will tear down through the normal cancelled path.
 * - If the run is `queued` (waiting for the scheduler to promote it),
 *   atomically transition it to `cancelled` directly. There is no
 *   AbortController to fire; the scheduler will skip it on next tick.
 *
 * Returns true on success, false if the run is not active and not queued.
 */
export async function cancelPipeline(runId: string): Promise<boolean> {
  const controller = activePipelineRuns.get(runId);
  if (controller) {
    markRunCancelled(runId);
    controller.abort();
    createScopedLogger({ origin: "DiscoveryRun", module: "pipeline/engine", runId }).info(
      "Pipeline cancellation requested",
    );
    return true;
  }

  // Queued case: cancel via DB transition. Atomic so the scheduler can't
  // race in and promote the run between the read and the write.
  const { withPrisma } = await import("@/lib/prisma");
  const queuedCancelled = await withPrisma(async (prisma) => {
    const result = await prisma.forgeRun.updateMany({
      where: { runId, status: "queued" },
      data: {
        status: "cancelled",
        statusMessage: "Cancelled while queued",
        completedAt: new Date(),
      },
    });
    return result.count > 0;
  });

  if (queuedCancelled) {
    createScopedLogger({ origin: "DiscoveryRun", module: "pipeline/engine", runId }).info(
      "Queued pipeline cancelled",
    );
    notifyScheduler();
    return true;
  }

  return false;
}

/**
 * Cancel all active pipeline runs. Returns the number of runs cancelled.
 * Called by deleteAllData() before truncating tables.
 */
export async function cancelAllPipelines(): Promise<number> {
  const runIds = [...activePipelineRuns.keys()];
  for (const runId of runIds) {
    await cancelPipeline(runId);
  }
  if (runIds.length > 0) {
    createScopedLogger({ origin: "DiscoveryRun", module: "pipeline/engine" }).info(
      "Cancelled all active pipelines",
      { count: runIds.length, runIds },
    );
  }
  return runIds.length;
}

// ---------------------------------------------------------------------------
// Scheduler wiring (registers a starter so the scheduler can promote queued runs)
// ---------------------------------------------------------------------------

registerPipelineStarter({
  start: async (runId, opts) => {
    await startPipeline(runId, opts);
  },
});
