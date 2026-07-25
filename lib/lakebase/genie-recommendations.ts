/**
 * CRUD operations for Genie Space Recommendations -- backed by Lakebase (Prisma).
 *
 * Recommendations are generated during the pipeline (step 8) and persisted
 * so the UI can display them immediately without on-demand recomputation.
 */

import { withPrisma } from "@/lib/prisma";
import type {
  GenieSpaceRecommendation,
  GenieEngineRecommendation,
  GenieEnginePassOutputs,
} from "@/lib/genie/types";
import { logger } from "@/lib/logger";
import { buildFallbackSemanticAssetManifest } from "@/lib/semantic-assets/manifest";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

interface DbRow {
  id: string;
  runId: string;
  domain: string;
  subdomains: string | null;
  title: string;
  description: string;
  tableCount: number;
  metricViewCount: number;
  useCaseCount: number;
  sqlExampleCount: number;
  joinCount: number;
  measureCount: number;
  filterCount: number;
  dimensionCount: number;
  tables: string | null;
  metricViews: string | null;
  serializedSpace: string;
  benchmarks: string | null;
  columnEnrichments: string | null;
  metricViewProposals: string | null;
  trustedFunctions: string | null;
  engineConfigVersion: number;
  recommendationType: string;
  existingAssetId: string | null;
  changeSummary: string | null;
}

function reusedSemanticColumn(value: string | null): {
  manifestJson: string | null;
  legacyFunctionsJson: string | null;
} {
  const empty = { manifestJson: null, legacyFunctionsJson: null };
  if (!value) return empty;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return {
        manifestJson: null,
        legacyFunctionsJson: value,
      };
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === "1" &&
      typeof (parsed as { domain?: unknown }).domain === "string" &&
      Array.isArray((parsed as { metricViews?: unknown }).metricViews) &&
      Array.isArray((parsed as { measures?: unknown }).measures) &&
      Array.isArray((parsed as { dimensions?: unknown }).dimensions) &&
      Array.isArray((parsed as { filters?: unknown }).filters)
    ) {
      return { manifestJson: value, legacyFunctionsJson: null };
    }
  } catch {
    // Malformed payload: expose neither compatibility representation.
  }
  return empty;
}

function dbRowToRecommendation(row: DbRow): GenieEngineRecommendation {
  let benchmarkCount = 0;
  let instructionCount = 0;
  let sampleQuestionCount = 0;
  let parsedSpace: unknown = null;
  try {
    const space: unknown = JSON.parse(row.serializedSpace);
    parsedSpace = space;
    const spaceRecord =
      typeof space === "object" && space !== null ? (space as Record<string, unknown>) : {};
    const instructions =
      typeof spaceRecord.instructions === "object" && spaceRecord.instructions !== null
        ? (spaceRecord.instructions as Record<string, unknown>)
        : {};
    const config =
      typeof spaceRecord.config === "object" && spaceRecord.config !== null
        ? (spaceRecord.config as Record<string, unknown>)
        : {};
    const benchmarks =
      typeof spaceRecord.benchmarks === "object" && spaceRecord.benchmarks !== null
        ? (spaceRecord.benchmarks as Record<string, unknown>)
        : {};
    benchmarkCount = Array.isArray(benchmarks.questions) ? benchmarks.questions.length : 0;
    instructionCount = Array.isArray(instructions.text_instructions)
      ? instructions.text_instructions.length
      : 0;
    sampleQuestionCount = Array.isArray(config.sample_questions)
      ? config.sample_questions.length
      : 0;
  } catch {
    // serializedSpace is malformed -- counts stay at 0
  }

  // If no pre-existing metric views but we have proposals, reflect the proposal count
  const metricViewsArr: string[] = row.metricViews ? JSON.parse(row.metricViews) : [];
  let metricViewCount = row.metricViewCount;
  if (metricViewCount === 0 && row.metricViewProposals) {
    try {
      const proposals = JSON.parse(row.metricViewProposals);
      if (Array.isArray(proposals)) metricViewCount = proposals.length;
    } catch {
      /* ignore */
    }
  }
  const subdomains: string[] = row.subdomains ? JSON.parse(row.subdomains) : [];
  const reusedColumn = reusedSemanticColumn(row.trustedFunctions);
  const adaptedManifest = reusedColumn.manifestJson
    ? null
    : buildFallbackSemanticAssetManifest({
        domain: row.domain,
        subdomains,
        serializedSpace: parsedSpace,
      });

  return {
    domain: row.domain,
    subdomains,
    title: row.title,
    description: row.description,
    tableCount: row.tableCount,
    metricViewCount,
    useCaseCount: row.useCaseCount,
    sqlExampleCount: row.sqlExampleCount,
    joinCount: row.joinCount,
    measureCount: row.measureCount,
    filterCount: row.filterCount,
    dimensionCount: row.dimensionCount,
    benchmarkCount,
    instructionCount,
    sampleQuestionCount,
    sqlFunctionCount: 0,
    tables: row.tables ? JSON.parse(row.tables) : [],
    metricViews: metricViewsArr,
    serializedSpace: row.serializedSpace,
    benchmarks: row.benchmarks,
    columnEnrichments: row.columnEnrichments,
    metricViewProposals: row.metricViewProposals,
    semanticAssetManifest:
      reusedColumn.manifestJson ?? (adaptedManifest ? JSON.stringify(adaptedManifest) : null),
    trustedFunctions: reusedColumn.legacyFunctionsJson,
    engineConfigVersion: row.engineConfigVersion,
    recommendationType: (row.recommendationType as "new" | "enhancement" | "replacement") ?? "new",
    existingAssetId: row.existingAssetId ?? undefined,
    changeSummary: row.changeSummary ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** List all stored Genie recommendations for a run (includes engine-extended fields). */
export async function getGenieRecommendationsByRunId(
  runId: string,
  ownerEmail?: string | null,
): Promise<GenieEngineRecommendation[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeGenieRecommendation.findMany({
      where: {
        runId,
        ...(ownerEmail !== undefined ? { run: { ownerEmail } } : {}),
      },
      orderBy: { useCaseCount: "desc" },
    });
    return rows.map(dbRowToRecommendation);
  });
}

// ---------------------------------------------------------------------------
// Write (bulk upsert -- called from pipeline step)
// ---------------------------------------------------------------------------

/**
 * Persist Genie recommendations for a run.
 *
 * When `replaceDomains` is provided, only the listed domains are deleted and
 * re-inserted (partial merge). Otherwise all recommendations are replaced.
 */
export async function saveGenieRecommendations(
  runId: string,
  recommendations: GenieSpaceRecommendation[],
  passOutputs?: GenieEnginePassOutputs[],
  engineConfigVersion?: number,
  replaceDomains?: string[],
): Promise<void> {
  const outputsByDomain = new Map<string, GenieEnginePassOutputs>();
  if (passOutputs) {
    for (const po of passOutputs) {
      outputsByDomain.set(po.domain, po);
    }
  }

  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
        if (replaceDomains?.length) {
          await tx.forgeGenieRecommendation.deleteMany({
            where: { runId, domain: { in: replaceDomains } },
          });
        } else {
          await tx.forgeGenieRecommendation.deleteMany({ where: { runId } });
        }

        if (recommendations.length === 0) return;

        // Deduplicate by domain -- keep the recommendation with more tables
        const deduped = new Map<string, (typeof recommendations)[number]>();
        for (const rec of recommendations) {
          const existing = deduped.get(rec.domain);
          if (!existing || rec.tableCount > existing.tableCount) {
            deduped.set(rec.domain, rec);
          }
        }
        const uniqueRecs = [...deduped.values()];

        await tx.forgeGenieRecommendation.createMany({
          data: uniqueRecs.map((rec, idx) => {
            const po = outputsByDomain.get(rec.domain);
            const id = replaceDomains?.length
              ? `${runId}_genie_${rec.domain.toLowerCase().replace(/\s+/g, "_")}`
              : `${runId}_genie_${idx}`;
            return {
              id,
              runId,
              domain: rec.domain,
              subdomains: JSON.stringify(rec.subdomains),
              title: rec.title,
              description: rec.description,
              tableCount: rec.tableCount,
              metricViewCount: rec.metricViewCount,
              useCaseCount: rec.useCaseCount,
              sqlExampleCount: rec.sqlExampleCount,
              joinCount: rec.joinCount,
              measureCount: rec.measureCount,
              filterCount: rec.filterCount,
              dimensionCount: rec.dimensionCount,
              tables: JSON.stringify(rec.tables),
              metricViews: JSON.stringify(rec.metricViews),
              serializedSpace: rec.serializedSpace,
              benchmarks: po ? JSON.stringify(po.benchmarkQuestions) : null,
              columnEnrichments: po ? JSON.stringify(po.columnEnrichments) : null,
              metricViewProposals: po ? JSON.stringify(po.metricViewProposals) : null,
              // Reuse the retired trusted-functions JSON column so the manifest
              // remains scoped to the existing run/domain recommendation row.
              trustedFunctions: po?.semanticAssetManifest
                ? JSON.stringify(po.semanticAssetManifest)
                : null,
              engineConfigVersion: engineConfigVersion ?? 0,
              recommendationType: rec.recommendationType ?? "new",
              existingAssetId: rec.existingAssetId ?? null,
              changeSummary: rec.changeSummary ?? null,
            };
          }),
          skipDuplicates: true,
        });
      },
    );
  });

  // Generate vector embeddings for Genie recommendations (best-effort)
  try {
    const { embedGenieRecommendations } = await import("@/lib/embeddings/embed-pipeline");
    await embedGenieRecommendations(runId, recommendations);
  } catch (err) {
    logger.warn("[genie-recommendations] Embedding failed (non-fatal)", {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
