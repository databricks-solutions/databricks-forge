/**
 * CRUD operations for pipeline runs — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import packageJson from "@/package.json";
import type {
  PipelineRun,
  PipelineRunConfig,
  PipelineStep,
  RunStatus,
  RunContextSources,
  BusinessContext,
  BusinessPriority,
  GenerationOption,
  StepLogEntry,
} from "@/lib/domain/types";
import { PROMPT_VERSIONS } from "@/lib/ai/templates";
import { archiveCurrentPromptTemplates } from "@/lib/lakebase/prompt-templates";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    logger.debug("[runs] Failed to parse JSON, using fallback", { error: String(e) });
    return fallback;
  }
}

function dbRowToRun(row: {
  runId: string;
  businessName: string;
  ucMetadata: string;
  excludedScope: string | null;
  exclusionPatterns: string | null;
  operation: string;
  businessPriorities: string | null;
  strategicGoals: string | null;
  businessDomains: string | null;
  aiModel: string | null;
  languages: string | null;
  generationOptions: string | null;
  generationPath: string | null;
  status: string;
  currentStep: string | null;
  progressPct: number;
  statusMessage: string | null;
  businessContext: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  ownerEmail?: string | null;
  contextSourcesJson: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): PipelineRun {
  const genOpts = parseGenerationOptions(row.generationOptions);
  return {
    runId: row.runId,
    config: {
      businessName: row.businessName,
      ucMetadata: row.ucMetadata,
      excludedScope: row.excludedScope ?? "",
      exclusionPatterns: row.exclusionPatterns ?? "",
      operation: row.operation as PipelineRunConfig["operation"],
      businessDomains: row.businessDomains ?? "",
      businessPriorities: parseJSON<BusinessPriority[]>(row.businessPriorities, []),
      strategicGoals: row.strategicGoals ?? "",
      additionalContext: genOpts.additionalContext ?? "",
      customerMaturity: genOpts.customerMaturity ?? "developing",
      riskPosture: genOpts.riskPosture ?? "balanced",
      transformationHorizon: genOpts.transformationHorizon ?? "half-year",
      generationOptions: genOpts.generationOptions,
      sampleRowsPerTable: genOpts.sampleRowsPerTable,
      industry: genOpts.industry,
      discoveryDepth: (genOpts.discoveryDepth ?? "balanced") as PipelineRunConfig["discoveryDepth"],
      depthConfig: genOpts.depthConfig,
      generationPath: row.generationPath ?? "./forge_gen/",
      languages: parseJSON<string[]>(row.languages, ["English"]),
      aiModel: row.aiModel ?? "databricks-claude-opus-5-5",
      estateScanEnabled: genOpts.estateScanEnabled,
      assetDiscoveryEnabled: genOpts.assetDiscoveryEnabled,
      fabricScanId: genOpts.fabricScanId,
      sourceScanId: genOpts.sourceScanId,
      businessValueEnabled: genOpts.businessValueEnabled ?? true,
    },
    status: row.status as RunStatus,
    currentStep: (row.currentStep as PipelineStep) ?? null,
    progressPct: row.progressPct,
    statusMessage: row.statusMessage ?? null,
    businessContext: parseJSON<BusinessContext | null>(row.businessContext, null),
    errorMessage: row.errorMessage ?? null,
    appVersion: genOpts.appVersion,
    promptVersions: genOpts.promptVersions,
    stepLog: genOpts.stepLog,
    industryAutoDetected: genOpts.industryAutoDetected,
    contextSources: parseJSON<RunContextSources | null>(row.contextSourcesJson, null),
    createdBy: row.createdBy ?? null,
    ownerEmail: row.ownerEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Generation options -- packs sampleRowsPerTable alongside the options array
// into a single JSON field to avoid schema changes.
//
// New format: {"options":["SQL Code"],"sampleRowsPerTable":10}
// Old format: ["SQL Code"]  (backward-compatible, sampleRowsPerTable = 0)
// ---------------------------------------------------------------------------

function parseGenerationOptions(raw: string | null): {
  generationOptions: GenerationOption[];
  sampleRowsPerTable: number;
  industry: string;
  additionalContext: string;
  customerMaturity: PipelineRunConfig["customerMaturity"];
  riskPosture: PipelineRunConfig["riskPosture"];
  transformationHorizon: PipelineRunConfig["transformationHorizon"];
  discoveryDepth: string;
  depthConfig: PipelineRunConfig["depthConfig"];
  estateScanEnabled: boolean;
  assetDiscoveryEnabled: boolean;
  fabricScanId: string | null;
  sourceScanId: string | null;
  businessValueEnabled: boolean;
  industryAutoDetected: boolean;
  appVersion: string | null;
  promptVersions: Record<string, string> | null;
  stepLog: StepLogEntry[];
} {
  const defaults = {
    generationOptions: ["SQL Code"] as GenerationOption[],
    sampleRowsPerTable: 0,
    industry: "",
    additionalContext: "",
    customerMaturity: "developing" as PipelineRunConfig["customerMaturity"],
    riskPosture: "balanced" as PipelineRunConfig["riskPosture"],
    transformationHorizon: "half-year" as PipelineRunConfig["transformationHorizon"],
    discoveryDepth: "balanced",
    depthConfig: undefined as PipelineRunConfig["depthConfig"],
    estateScanEnabled: false,
    assetDiscoveryEnabled: false,
    fabricScanId: null as string | null,
    sourceScanId: null as string | null,
    businessValueEnabled: true,
    industryAutoDetected: false,
    appVersion: null as string | null,
    promptVersions: null as Record<string, string> | null,
    stepLog: [] as StepLogEntry[],
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { ...defaults, generationOptions: parsed };
    }
    if (typeof parsed === "object" && parsed !== null) {
      return {
        generationOptions: parsed.options ?? ["SQL Code"],
        sampleRowsPerTable: parsed.sampleRowsPerTable ?? 0,
        industry: parsed.industry ?? "",
        additionalContext: parsed.additionalContext ?? "",
        customerMaturity: parsed.customerMaturity ?? "developing",
        riskPosture: parsed.riskPosture ?? "balanced",
        transformationHorizon: parsed.transformationHorizon ?? "half-year",
        discoveryDepth: parsed.discoveryDepth ?? "balanced",
        depthConfig: parsed.depthConfig ?? undefined,
        estateScanEnabled: parsed.estateScanEnabled === true,
        assetDiscoveryEnabled: parsed.assetDiscoveryEnabled === true,
        fabricScanId: parsed.fabricScanId ?? null,
        sourceScanId: parsed.sourceScanId ?? null,
        // Business value defaults ON: legacy rows where the field is
        // absent now opt-in to BV. Explicit `false` from older opt-out
        // runs is still honored.
        businessValueEnabled: parsed.businessValueEnabled !== false,
        industryAutoDetected: parsed.industryAutoDetected === true,
        appVersion: parsed.appVersion ?? null,
        promptVersions: parsed.promptVersions ?? null,
        stepLog: Array.isArray(parsed.stepLog) ? parsed.stepLog : [],
      };
    }
  } catch (e) {
    logger.debug("[runs] Failed to parse generation options", { error: String(e) });
  }
  return defaults;
}

function serializeGenerationOptions(config: PipelineRunConfig): string {
  return JSON.stringify({
    options: config.generationOptions,
    sampleRowsPerTable: config.sampleRowsPerTable,
    industry: config.industry,
    additionalContext: config.additionalContext,
    customerMaturity: config.customerMaturity,
    riskPosture: config.riskPosture,
    transformationHorizon: config.transformationHorizon,
    discoveryDepth: config.discoveryDepth,
    depthConfig: config.depthConfig ?? null,
    estateScanEnabled: config.estateScanEnabled,
    assetDiscoveryEnabled: config.assetDiscoveryEnabled,
    fabricScanId: config.fabricScanId ?? null,
    sourceScanId: config.sourceScanId ?? null,
    businessValueEnabled: config.businessValueEnabled ?? true,
    appVersion: packageJson.version,
    promptVersions: PROMPT_VERSIONS,
    stepLog: [],
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createRun(
  runId: string,
  config: PipelineRunConfig,
  createdBy?: string | null,
): Promise<void> {
  const owner = createdBy ? createdBy.toLowerCase().trim() : null;
  await withPrisma(async (prisma) => {
    await prisma.forgeRun.create({
      data: {
        runId,
        businessName: config.businessName,
        ucMetadata: config.ucMetadata,
        excludedScope: config.excludedScope || null,
        exclusionPatterns: config.exclusionPatterns || null,
        operation: config.operation,
        businessPriorities: JSON.stringify(config.businessPriorities),
        strategicGoals: config.strategicGoals,
        businessDomains: config.businessDomains,
        aiModel: config.aiModel,
        languages: JSON.stringify(config.languages),
        generationOptions: serializeGenerationOptions(config),
        generationPath: config.generationPath,
        createdBy: createdBy ?? null,
        ownerEmail: owner,
        status: "pending",
        progressPct: 0,
      },
    });
  });

  archiveCurrentPromptTemplates().catch((e) =>
    logger.warn("[runs] Failed to archive prompt templates", { error: String(e) }),
  );
}

export async function getRunById(runId: string): Promise<PipelineRun | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({ where: { runId } });
    return row ? dbRowToRun(row) : null;
  });
}

/**
 * Return the most recent completed run (by `completedAt`) that the calling
 * user can access -- i.e. one they own OR one shared with them via the ACL.
 *
 * Used by Business Value pages (e.g. /business-value/data-gap) that need to
 * surface a deliverable for the user's latest discovery run without making
 * them pick a runId from a list. Returns just the lightweight identity tuple
 * the page needs to fetch deeper data through other helpers.
 *
 * Returns `null` when the user has no completed runs.
 */
export async function getLatestCompletedRunForOwner(
  userEmail: string,
  accessibleRunIds: string[],
): Promise<{ runId: string; businessName: string; completedAt: Date | null } | null> {
  const email = userEmail.toLowerCase().trim();
  if (!email) return null;
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findFirst({
      where: {
        status: "completed",
        OR: [{ ownerEmail: email }, { runId: { in: accessibleRunIds } }],
      },
      orderBy: { completedAt: "desc" },
      select: { runId: true, businessName: true, completedAt: true },
    });
    return row;
  });
}

/**
 * List runs visible to the calling user.
 *
 * When `userEmail` is provided, results include runs the user owns plus
 * those shared with them via the ACL. When omitted, returns all runs
 * (legacy behaviour, used by background callers and admin tools).
 *
 * `viewMode`:
 *   - "all"    -- owner OR shared via ACL (default)
 *   - "owned"  -- only rows where ownerEmail matches
 *   - "shared" -- only rows with an ACL entry for the user
 */
export async function listRuns(
  limit = 50,
  offset = 0,
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<PipelineRun[]> {
  return withPrisma(async (prisma) => {
    let where: Record<string, unknown> = {};
    if (userEmail) {
      const email = userEmail.toLowerCase().trim();
      if (viewMode === "owned") {
        where = { ownerEmail: email };
      } else if (viewMode === "shared") {
        where = { runId: { in: sharedIds } };
      } else {
        where = { OR: [{ ownerEmail: email }, { runId: { in: sharedIds } }] };
      }
    }
    const rows = await prisma.forgeRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map(dbRowToRun);
  });
}

// ---------------------------------------------------------------------------
// Lean summary view for list surfaces
// ---------------------------------------------------------------------------
//
// `listRuns` returns the full `PipelineRun` including parsed `businessContext`,
// `stepLog`, and other LLM-generated JSON. For the `/runs` list page (and any
// other list surface) we only need the columns rendered in the row -- shipping
// the heavy JSON across the RSC boundary is wasteful and, with deeply nested
// LLM output, can overflow V8's recursive `JSON.stringify` and surface as
// "Maximum call stack size exceeded" in the browser.
//
// `PipelineRunSummary` is intentionally a strict subset; the Prisma `select`
// below MUST NOT pull `businessContext`, `synthesisJson`, `schemaSnapshotJson`,
// `contextSourcesJson`, `filteredTablesJson`, `degradedStepsJson`, or
// `generationOptions`.

export interface PipelineRunSummary {
  runId: string;
  status: RunStatus;
  currentStep: PipelineStep | null;
  progressPct: number;
  statusMessage: string | null;
  ownerEmail: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  config: {
    businessName: string;
    ucMetadata: string;
  };
}

function dbRowToRunSummary(row: {
  runId: string;
  businessName: string;
  ucMetadata: string;
  status: string;
  currentStep: string | null;
  progressPct: number;
  statusMessage: string | null;
  ownerEmail: string | null;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): PipelineRunSummary {
  return {
    runId: row.runId,
    status: row.status as RunStatus,
    currentStep: (row.currentStep as PipelineStep) ?? null,
    progressPct: row.progressPct,
    statusMessage: row.statusMessage ?? null,
    ownerEmail: row.ownerEmail ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    config: {
      businessName: row.businessName,
      ucMetadata: row.ucMetadata,
    },
  };
}

/**
 * List runs as lean summaries for table-style list surfaces.
 *
 * Same visibility semantics as `listRuns`, but only selects the columns the
 * list UI actually renders. Avoids deserialising / re-serialising heavy
 * JSON fields (`businessContext`, `stepLog`, `synthesisJson`, ...) that
 * would otherwise be passed through the RSC boundary and risk a recursive
 * `JSON.stringify` stack overflow on pathological LLM-generated payloads.
 */
export async function listRunSummaries(
  limit = 50,
  offset = 0,
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<PipelineRunSummary[]> {
  return withPrisma(async (prisma) => {
    let where: Record<string, unknown> = {};
    if (userEmail) {
      const email = userEmail.toLowerCase().trim();
      if (viewMode === "owned") {
        where = { ownerEmail: email };
      } else if (viewMode === "shared") {
        where = { runId: { in: sharedIds } };
      } else {
        where = { OR: [{ ownerEmail: email }, { runId: { in: sharedIds } }] };
      }
    }
    const rows = await prisma.forgeRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        runId: true,
        businessName: true,
        ucMetadata: true,
        status: true,
        currentStep: true,
        progressPct: true,
        statusMessage: true,
        ownerEmail: true,
        createdBy: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return rows.map(dbRowToRunSummary);
  });
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  currentStep: PipelineStep | null,
  progressPct: number,
  errorMessage?: string,
  statusMessage?: string,
): Promise<void> {
  const data: Record<string, unknown> = {
    status,
    currentStep: currentStep ?? null,
    progressPct,
  };

  if (errorMessage !== undefined) {
    data.errorMessage = errorMessage;
  }

  if (statusMessage !== undefined) {
    data.statusMessage = statusMessage;
  }

  if (status === "completed" || status === "failed") {
    data.completedAt = new Date();
  }

  await withPrisma(async (prisma) => {
    await prisma.forgeRun.update({ where: { runId }, data });
  });
}

/**
 * Startup helper: find every `running` run and re-queue it.
 *
 * Called once on app boot (`instrumentation.ts`). After a graceful
 * redeploy, in-flight pipelines lost their AbortController -- we don't
 * want to surface them as failed. Setting status back to `queued` lets
 * the scheduler pick them up on the next tick.
 *
 * Returns the number of runs requeued.
 */
export async function requeueOrphanedRunsOnStartup(): Promise<number> {
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeRun.updateMany({
      where: { status: "running" },
      data: {
        status: "queued",
        statusMessage: "Re-queued after app restart -- waiting for scheduler.",
      },
    });
    return result.count;
  });
}

/**
 * Reconcile a `running` run that no longer has an active in-process
 * controller. Two modes:
 *
 *   - `"fail"` (default, legacy behaviour) -- mark the run as failed
 *     with a "interrupted by app restart" error message. The user can
 *     manually resume from the run detail page.
 *
 *   - `"requeue"` -- transition the run back to `queued` so the
 *     pipeline scheduler can promote it on the next tick. Use this when
 *     a process restart is expected (graceful redeploy) and we don't
 *     want to surface every in-flight run as failed to users.
 *
 * Both branches are atomic single-row updates and ignored when the run
 * is not in `running` state (someone else already reconciled it).
 */
export async function failOrphanedRunningRun(
  runId: string,
  activeRunIds: string[],
  mode: "fail" | "requeue" = "fail",
): Promise<boolean> {
  return withPrisma(async (prisma) => {
    if (activeRunIds.includes(runId)) return false;

    if (mode === "requeue") {
      const result = await prisma.forgeRun.updateMany({
        where: { runId, status: "running" },
        data: {
          status: "queued",
          statusMessage: "Re-queued after app restart -- waiting for scheduler.",
          // Do NOT clear errorMessage here; if the run was in trouble before
          // the restart, the next attempt should still surface that.
        },
      });
      return result.count > 0;
    }

    const result = await prisma.forgeRun.updateMany({
      where: {
        runId,
        status: "running",
      },
      data: {
        status: "failed",
        errorMessage:
          "Run was interrupted by app restart or deployment. Please retry or resume this run.",
        statusMessage: "Run interrupted by app restart/deployment. Please retry or resume.",
        completedAt: new Date(),
      },
    });
    return result.count > 0;
  });
}

/**
 * Lightweight helper that updates just statusMessage (and optionally progressPct).
 * Called frequently from pipeline steps to report granular progress.
 * Throttled to at most one write per MIN_INTERVAL_MS to reduce DB load.
 */
const MIN_PROGRESS_INTERVAL_MS = 500;
const lastProgressUpdate = new Map<string, number>();

export async function updateRunMessage(
  runId: string,
  statusMessage: string,
  progressPct?: number,
): Promise<void> {
  const now = Date.now();
  const lastUpdate = lastProgressUpdate.get(runId) ?? 0;
  if (now - lastUpdate < MIN_PROGRESS_INTERVAL_MS) return;
  lastProgressUpdate.set(runId, now);

  const data: Record<string, unknown> = { statusMessage };
  if (progressPct !== undefined) {
    data.progressPct = progressPct;
  }
  await withPrisma(async (prisma) => {
    await prisma.forgeRun.update({ where: { runId }, data });
  });
}

// ---------------------------------------------------------------------------
// Degraded steps tracking
// ---------------------------------------------------------------------------
//
// `degradedStepsJson` is a JSON-encoded array of pipeline step ids that
// produced incomplete output. The Business Value page reads this to render
// an amber "Recompute" banner so users never see a silent green tick + $0.

/**
 * Read the executive-synthesis provenance recorded against a run.
 * Returns `{ generatedByModel: null, generatedAt: null }` when the run
 * has not produced a synthesis yet (legacy rows or BV-disabled runs).
 *
 * Lives here (not on the run summary type) because the Business Value
 * pages are the only consumer today and adding it to every run reader
 * would inflate the cross-RSC payload unnecessarily.
 */
export async function getSynthesisProvenance(
  runId: string,
): Promise<{ generatedByModel: string | null; generatedAt: Date | null }> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { synthesisGeneratedByModel: true, synthesisGeneratedAt: true },
    });
    if (!row) return { generatedByModel: null, generatedAt: null };
    return {
      generatedByModel: row.synthesisGeneratedByModel ?? null,
      generatedAt: row.synthesisGeneratedAt ?? null,
    };
  });
}

/** Read the degraded-step list for a run. Returns [] when none are flagged. */
export async function getDegradedSteps(runId: string): Promise<string[]> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { degradedStepsJson: true },
    });
    if (!row?.degradedStepsJson) return [];
    return parseJSON<string[]>(row.degradedStepsJson, []);
  });
}

/** Add a step id to the run's degraded-step list (idempotent / additive). */
export async function markRunStepDegraded(runId: string, stepId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { degradedStepsJson: true },
    });
    const current = parseJSON<string[]>(row?.degradedStepsJson ?? null, []);
    if (current.includes(stepId)) return;
    const next = [...current, stepId];
    await prisma.forgeRun.update({
      where: { runId },
      data: { degradedStepsJson: JSON.stringify(next) },
    });
  });
}

/** Remove a step id from the degraded list (e.g. after a successful rerun). */
export async function clearRunStepDegraded(runId: string, stepId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { degradedStepsJson: true },
    });
    const current = parseJSON<string[]>(row?.degradedStepsJson ?? null, []);
    if (!current.includes(stepId)) return;
    const next = current.filter((s) => s !== stepId);
    await prisma.forgeRun.update({
      where: { runId },
      data: { degradedStepsJson: next.length === 0 ? null : JSON.stringify(next) },
    });
  });
}

/**
 * Delete a pipeline run and all associated data (use cases, exports,
 * environment scans, Genie data). Cascade deletes are handled by the
 * database schema.
 */
export async function deleteRun(runId: string): Promise<void> {
  // Delete vector embeddings before Prisma cascade deletes source records
  try {
    const { deleteEmbeddingsByRun } = await import("@/lib/embeddings/store");
    await deleteEmbeddingsByRun(runId);
  } catch (err) {
    logger.warn("[runs] Embedding cleanup failed (non-fatal)", {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await withPrisma(async (prisma) => {
    await prisma.forgeRun.delete({ where: { runId } });
  });
}

export async function updateRunBusinessContext(
  runId: string,
  context: BusinessContext,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeRun.update({
      where: { runId },
      data: { businessContext: JSON.stringify(context) },
    });
  });
}

/**
 * Persist the table filtering classification results on the run.
 * Stores the full [{fqn, classification, reason}] array as JSON.
 */
export async function updateRunFilteredTables(
  runId: string,
  classifications: Array<{ fqn: string; classification: string; reason: string }>,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeRun.update({
      where: { runId },
      data: { filteredTablesJson: JSON.stringify(classifications) },
    });
  });
}

/**
 * Link a metadata cache key to a run so we know which cached metadata
 * snapshot was used for this run's analysis.
 */
export async function updateRunMetadataCacheKey(runId: string, cacheKey: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeRun.update({
      where: { runId },
      data: { metadataCacheKey: cacheKey },
    });
  });
}

/**
 * Update the industry field inside the generationOptions JSON.
 * Used by the pipeline engine when auto-detecting the industry outcome map
 * after Step 1 (Business Context) completes.
 *
 * @param autoDetected - true when set by auto-detection (vs manual user selection)
 */
export async function updateRunIndustry(
  runId: string,
  industry: string,
  autoDetected: boolean = false,
): Promise<void> {
  await withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { generationOptions: true },
    });

    let genOpts: Record<string, unknown> = {};
    try {
      genOpts = row?.generationOptions ? JSON.parse(row.generationOptions) : {};
      if (typeof genOpts !== "object" || genOpts === null) genOpts = {};
    } catch (e) {
      logger.debug("[runs] Failed to parse generationOptions", { runId, error: String(e) });
    }

    genOpts.industry = industry;
    genOpts.industryAutoDetected = autoDetected;

    await prisma.forgeRun.update({
      where: { runId },
      data: { generationOptions: JSON.stringify(genOpts) },
    });
  });
}

/**
 * Read the raw filteredTablesJson from a run row.
 * Returns the array of FQNs classified as "business", or null if not yet set.
 */
export async function getRunFilteredTables(runId: string): Promise<string[] | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { filteredTablesJson: true },
    });
    if (!row?.filteredTablesJson) return null;
    try {
      const classifications = JSON.parse(row.filteredTablesJson) as Array<{
        fqn: string;
        classification: string;
      }>;
      return classifications.filter((c) => c.classification === "business").map((c) => c.fqn);
    } catch (e) {
      logger.debug("[runs] Failed to parse filteredTablesJson", { runId, error: String(e) });
      return null;
    }
  });
}

/**
 * Maximum number of entries we keep in the per-run `stepLog`. Pipelines
 * normally produce 8-12 entries (one per step) but resumes, reruns, and
 * sub-steps can push the count up. Capping defends against pathological
 * growth that would inflate the run row and make later JSON serialization
 * (especially across the RSC boundary on `/runs`) brittle.
 */
const MAX_STEP_LOG_ENTRIES = 200;

/**
 * Append or update a step log entry in the generationOptions JSON.
 * Reads the current value, merges the entry, and writes back atomically.
 * The list is capped at {@link MAX_STEP_LOG_ENTRIES} -- when full, the
 * oldest entries are dropped first (FIFO).
 */
export async function updateRunStepLog(runId: string, entry: StepLogEntry): Promise<void> {
  await withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { generationOptions: true },
    });

    let genOpts: Record<string, unknown> = {};
    try {
      genOpts = row?.generationOptions ? JSON.parse(row.generationOptions) : {};
      if (typeof genOpts !== "object" || genOpts === null) genOpts = {};
    } catch (e) {
      logger.debug("[runs] Failed to parse generationOptions", { runId, error: String(e) });
    }

    const stepLog: StepLogEntry[] = Array.isArray(genOpts.stepLog) ? genOpts.stepLog : [];

    const existingIdx = stepLog.findIndex((e) => e.step === entry.step);
    if (existingIdx >= 0) {
      stepLog[existingIdx] = { ...stepLog[existingIdx], ...entry };
    } else {
      stepLog.push(entry);
    }

    // Cap to the most recent entries so the row stays serializable.
    const capped =
      stepLog.length > MAX_STEP_LOG_ENTRIES
        ? stepLog.slice(stepLog.length - MAX_STEP_LOG_ENTRIES)
        : stepLog;

    genOpts.stepLog = capped;

    await prisma.forgeRun.update({
      where: { runId },
      data: { generationOptions: JSON.stringify(genOpts) },
    });
  });
}

// ---------------------------------------------------------------------------
// Schema snapshot helpers
// ---------------------------------------------------------------------------

export type SchemaSnapshotEntry = {
  columns: Array<{ name: string; type: string }>;
  tableType: string;
  comment: string | null;
  isBusinessTable: boolean | null;
};

export type SchemaSnapshot = Record<string, SchemaSnapshotEntry>;

export async function updateSchemaSnapshot(runId: string, snapshot: SchemaSnapshot): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeRun.update({
      where: { runId },
      data: { schemaSnapshotJson: JSON.stringify(snapshot) },
    });
  });
}

export async function getSchemaSnapshot(runId: string): Promise<SchemaSnapshot | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRun.findUnique({
      where: { runId },
      select: { schemaSnapshotJson: true },
    });
    if (!row?.schemaSnapshotJson) return null;
    try {
      return JSON.parse(row.schemaSnapshotJson) as SchemaSnapshot;
    } catch {
      return null;
    }
  });
}
