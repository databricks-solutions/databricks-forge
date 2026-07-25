/**
 * CRUD operations for use cases — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import type {
  BlastRadiusSummary,
  ConsultingScorecard,
  ScoreRationale,
  UseCase,
  UseCaseType,
} from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function parseTablesInvolved(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return raw.split(",").map((s) => s.trim());
  }
}

function dbRowToUseCase(row: {
  id: string;
  runId: string;
  useCaseNo: number | null;
  name: string | null;
  type: string | null;
  analyticsTechnique: string | null;
  statement: string | null;
  solution: string | null;
  businessValue: string | null;
  beneficiary: string | null;
  sponsor: string | null;
  domain: string | null;
  subdomain: string | null;
  tablesInvolved: string | null;
  priorityScore: number | null;
  feasibilityScore: number | null;
  impactScore: number | null;
  overallScore: number | null;
  userPriorityScore: number | null;
  userFeasibilityScore: number | null;
  userImpactScore: number | null;
  userOverallScore: number | null;
  scoreRationale?: string | null;
  consultingScorecard?: string | null;
  sqlCode: string | null;
  sqlStatus: string | null;
  feedback: string | null;
  feedbackAt: Date | null;
  enrichmentTags: string | null;
  sourceSystems?: string | null;
  sourceSystemsOrigin?: string | null;
  blastRadiusJson?: string | null;
  referenceUseCaseName?: string | null;
  referenceUseCaseResolvedAt?: Date | null;
}): UseCase {
  return {
    id: row.id,
    runId: row.runId,
    useCaseNo: row.useCaseNo ?? 0,
    name: row.name ?? "",
    type: (row.type as UseCaseType) ?? "AI",
    analyticsTechnique: row.analyticsTechnique ?? "",
    statement: row.statement ?? "",
    solution: row.solution ?? "",
    businessValue: row.businessValue ?? "",
    beneficiary: row.beneficiary ?? "",
    sponsor: row.sponsor ?? "",
    domain: row.domain ?? "",
    subdomain: row.subdomain ?? "",
    tablesInvolved: parseTablesInvolved(row.tablesInvolved),
    priorityScore: row.priorityScore ?? 0,
    feasibilityScore: row.feasibilityScore ?? 0,
    impactScore: row.impactScore ?? 0,
    overallScore: row.overallScore ?? 0,
    userPriorityScore: row.userPriorityScore ?? null,
    userFeasibilityScore: row.userFeasibilityScore ?? null,
    userImpactScore: row.userImpactScore ?? null,
    userOverallScore: row.userOverallScore ?? null,
    scoreRationale: parseJSON<ScoreRationale | null>(row.scoreRationale, null),
    consultingScorecard: parseJSON<ConsultingScorecard | null>(row.consultingScorecard, null),
    sqlCode: row.sqlCode ?? null,
    sqlStatus: row.sqlStatus ?? null,
    feedback: (row.feedback as UseCase["feedback"]) ?? null,
    feedbackAt: row.feedbackAt?.toISOString() ?? null,
    enrichmentTags: parseJSON<string[] | null>(row.enrichmentTags, null),
    sourceSystems: parseJSON<string[] | null>(row.sourceSystems, null),
    sourceSystemsOrigin: (row.sourceSystemsOrigin as UseCase["sourceSystemsOrigin"]) ?? null,
    blastRadius: parseJSON<BlastRadiusSummary | null>(row.blastRadiusJson, null),
    referenceUseCaseName: row.referenceUseCaseName ?? null,
    referenceUseCaseResolvedAt: row.referenceUseCaseResolvedAt?.toISOString() ?? null,
  };
}

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a batch of use cases for a given run.
 */
export async function insertUseCases(useCases: UseCase[]): Promise<void> {
  if (useCases.length === 0) return;

  await withPrisma(async (prisma) => {
    await prisma.forgeUseCase.createMany({
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
        scoreRationale: uc.scoreRationale ? JSON.stringify(uc.scoreRationale) : null,
        consultingScorecard: uc.consultingScorecard ? JSON.stringify(uc.consultingScorecard) : null,
        sqlCode: uc.sqlCode,
        sqlStatus: uc.sqlStatus,
        enrichmentTags: uc.enrichmentTags ? JSON.stringify(uc.enrichmentTags) : null,
        sourceSystems: uc.sourceSystems ? JSON.stringify(uc.sourceSystems) : null,
        sourceSystemsOrigin: uc.sourceSystemsOrigin,
        blastRadiusJson: uc.blastRadius ? JSON.stringify(uc.blastRadius) : null,
        referenceUseCaseName: uc.referenceUseCaseName ?? null,
        referenceUseCaseResolvedAt: uc.referenceUseCaseResolvedAt
          ? new Date(uc.referenceUseCaseResolvedAt)
          : null,
      })),
      skipDuplicates: true,
    });
  });
}

/**
 * Get all use cases for a run, ordered by overall_score descending.
 */
export async function getUseCasesByRunId(runId: string): Promise<UseCase[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUseCase.findMany({
      where: { runId },
      orderBy: [{ overallScore: "desc" }, { useCaseNo: "asc" }],
    });
    return rows.map(dbRowToUseCase);
  });
}

/**
 * Lightweight variant that omits sqlCode to reduce payload size.
 * Used for initial page loads where SQL isn't displayed upfront.
 */
export async function getUseCaseSummariesByRunId(runId: string): Promise<UseCase[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUseCase.findMany({
      where: { runId },
      orderBy: [{ overallScore: "desc" }, { useCaseNo: "asc" }],
      omit: { sqlCode: true },
    });
    return rows.map((r) => dbRowToUseCase({ ...r, sqlCode: null }));
  });
}

/**
 * Get use cases for a run filtered by domain.
 */
export async function getUseCasesByDomain(runId: string, domain: string): Promise<UseCase[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUseCase.findMany({
      where: { runId, domain },
      orderBy: { overallScore: "desc" },
    });
    return rows.map(dbRowToUseCase);
  });
}

/**
 * Get distinct domains for a run.
 */
export async function getDomainsForRun(runId: string): Promise<string[]> {
  return withPrisma(async (prisma) => {
    const results = await prisma.forgeUseCase.findMany({
      where: { runId },
      select: { domain: true },
      distinct: ["domain"],
      orderBy: { domain: "asc" },
    });
    return results.map((r: { domain: string | null }) => r.domain ?? "").filter(Boolean);
  });
}

/**
 * Persist the source-system attribution (Phase 3.1) for a batch of use
 * cases. Designed for the post-generation attribution pass, which walks
 * lineage once per run and writes the results in a single transaction.
 *
 * `sourceSystems` is JSON-serialised to a String column to match the
 * surrounding storage convention. `sourceSystemsResolvedAt` is set to
 * `now()` for every updated row so the UI can show freshness.
 */
export async function updateUseCaseSourceSystems(
  updates: Array<{
    useCaseId: string;
    sourceSystems: string[];
    origin: "lineage" | "naming" | "comment" | "mixed";
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date();
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.forgeUseCase.update({
          where: { id: u.useCaseId },
          data: {
            sourceSystems: JSON.stringify(u.sourceSystems),
            sourceSystemsOrigin: u.origin,
            sourceSystemsResolvedAt: now,
          },
        }),
      ),
    );
  });
}

/**
 * Persist the master-repo reference-use-case bridge for a batch of use
 * cases. Designed for two callers:
 *
 *   1. Use case generation — the LLM emits `reference_use_case_name`
 *      alongside the customer-facing `name`; the parser pre-validates
 *      against the known master-repo names for the run's industry and
 *      calls this helper to fill the column.
 *   2. Data Gap backfill — when a legacy run is opened for the first
 *      time after this feature ships, a one-shot LLM call maps every UC
 *      to its closest master-repo title and writes the result here so
 *      future Data Gap loads are deterministic and cheap.
 *
 * `referenceUseCaseName` may be null when the LLM judged no reference
 * applied (e.g. a deliberately bespoke UC). `referenceUseCaseResolvedAt`
 * is set to `now()` regardless, so the Data Gap cache invalidator can
 * distinguish "never resolved" from "resolved as null".
 */
export async function updateUseCaseReferenceLinks(
  updates: Array<{
    useCaseId: string;
    referenceUseCaseName: string | null;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date();
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.forgeUseCase.update({
          where: { id: u.useCaseId },
          data: {
            referenceUseCaseName: u.referenceUseCaseName,
            referenceUseCaseResolvedAt: now,
          },
        }),
      ),
    );
  });
}

/**
 * Newest `referenceUseCaseResolvedAt` recorded against any use case in
 * the run. Used by the Data Gap cache invalidator to detect runs whose
 * backfill landed after the cached analysis was written.
 *
 * Returns `null` when no use case in the run has ever had its reference
 * link resolved.
 */
export async function getNewestReferenceUseCaseResolvedAt(
  runId: string,
): Promise<Date | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeUseCase.findFirst({
      where: { runId, referenceUseCaseResolvedAt: { not: null } },
      orderBy: { referenceUseCaseResolvedAt: "desc" },
      select: { referenceUseCaseResolvedAt: true },
    });
    return row?.referenceUseCaseResolvedAt ?? null;
  });
}

/**
 * Update a single use case's SQL fields. Used by the background SQL
 * generation job to stream results in as each use case completes.
 *
 * The wider `sqlStatus` enum convention is:
 *   - null         → not in scope yet (legacy or pre-SQL-job rows)
 *   - "pending"    → queued for background SQL generation
 *   - "generating" → currently being generated
 *   - "generated"  → success
 *   - "failed"     → terminal failure
 */
export async function updateUseCaseSql(
  useCaseId: string,
  sqlCode: string | null,
  sqlStatus: "pending" | "generating" | "generated" | "failed",
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeUseCase.update({
      where: { id: useCaseId },
      data: { sqlCode, sqlStatus },
    });
  });
}

/**
 * Bulk-update every use case for a run to `sqlStatus = "pending"`. Called
 * at the start of a background SQL job so the UI can show a "pending"
 * badge on each row before the per-use-case `updateUseCaseSql` writes
 * begin to land.
 */
export async function markUseCasesSqlPending(runId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeUseCase.updateMany({
      where: { runId },
      data: { sqlStatus: "pending", sqlCode: null },
    });
  });
}

/**
 * Aggregate per-use-case `sqlStatus` counts for a run. Drives the SQL
 * background-job status endpoint's progress summary.
 */
export async function getSqlStatusCounts(runId: string): Promise<{
  pending: number;
  generating: number;
  generated: number;
  failed: number;
  total: number;
}> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUseCase.groupBy({
      by: ["sqlStatus"],
      where: { runId },
      _count: { _all: true },
    });
    const counts = { pending: 0, generating: 0, generated: 0, failed: 0, total: 0 };
    for (const row of rows) {
      const n = row._count._all;
      counts.total += n;
      switch (row.sqlStatus) {
        case "pending":
          counts.pending = n;
          break;
        case "generating":
          counts.generating = n;
          break;
        case "generated":
          counts.generated = n;
          break;
        case "failed":
          counts.failed = n;
          break;
      }
    }
    return counts;
  });
}

/**
 * Delete all use cases for a run (used when re-running).
 * Also clears associated vector embeddings for the use cases.
 */
export async function deleteUseCasesForRun(runId: string): Promise<void> {
  try {
    const { deleteEmbeddingsByKindAndRun } = await import("@/lib/embeddings/store");
    await deleteEmbeddingsByKindAndRun("use_case", runId);
  } catch {
    // best-effort: embeddings table may not exist
  }

  await withPrisma(async (prisma) => {
    await prisma.forgeUseCase.deleteMany({ where: { runId } });
  });
}

/**
 * Retrieve accepted use cases from previous runs targeting the same UC scope.
 * Used as few-shot examples in the use case generation prompt.
 */
export async function getFeedbackExamples(ucMetadata: string, limit = 10): Promise<UseCase[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUseCase.findMany({
      where: {
        feedback: "accepted",
        run: { ucMetadata },
      },
      orderBy: { overallScore: "desc" },
      take: limit,
    });
    return rows.map(dbRowToUseCase);
  });
}
