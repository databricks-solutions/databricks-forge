/**
 * CRUD operations for roadmap phase assignments — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import type { RoadmapPhaseAssignment, RoadmapPhase, EffortEstimate } from "@/lib/domain/types";

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function dbRowToPhase(row: {
  id: string;
  runId: string;
  useCaseId: string;
  phase: string;
  phaseOrder: number;
  effortEstimate: string | null;
  dependencies: string | null;
  enablers: string | null;
  rationale: string | null;
  manualOverride: boolean;
}): RoadmapPhaseAssignment {
  return {
    id: row.id,
    runId: row.runId,
    useCaseId: row.useCaseId,
    phase: row.phase as RoadmapPhase,
    phaseOrder: row.phaseOrder,
    effortEstimate: row.effortEstimate as EffortEstimate | null,
    dependencies: parseJSON<string[]>(row.dependencies, []),
    enablers: parseJSON<string[]>(row.enablers, []),
    rationale: row.rationale,
    manualOverride: row.manualOverride,
  };
}

export async function getRoadmapPhasesForRun(runId: string): Promise<RoadmapPhaseAssignment[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeRoadmapPhase.findMany({
      where: { runId },
      orderBy: [{ phase: "asc" }, { phaseOrder: "asc" }],
    });
    return rows.map(dbRowToPhase);
  });
}

export async function upsertRoadmapPhases(
  runId: string,
  phases: Array<{
    useCaseId: string;
    phase: RoadmapPhase;
    phaseOrder?: number;
    effortEstimate?: EffortEstimate;
    dependencies?: string[];
    enablers?: string[];
    rationale?: string;
  }>,
  provenance?: {
    generatedByModel?: string | null;
    generatedAt?: Date;
  },
): Promise<void> {
  const generatedByModel = provenance?.generatedByModel ?? null;
  const generatedAt = provenance?.generatedAt ?? new Date();
  await withPrisma(async (prisma) => {
    await prisma.$transaction(
      phases.map((p, idx) =>
        prisma.forgeRoadmapPhase.upsert({
          where: { runId_useCaseId: { runId, useCaseId: p.useCaseId } },
          create: {
            runId,
            useCaseId: p.useCaseId,
            phase: p.phase,
            phaseOrder: p.phaseOrder ?? idx,
            effortEstimate: p.effortEstimate ?? null,
            dependencies: p.dependencies ? JSON.stringify(p.dependencies) : null,
            enablers: p.enablers ? JSON.stringify(p.enablers) : null,
            rationale: p.rationale ?? null,
            generatedByModel,
            generatedAt,
          },
          update: {
            phase: p.phase,
            phaseOrder: p.phaseOrder ?? idx,
            effortEstimate: p.effortEstimate ?? null,
            dependencies: p.dependencies ? JSON.stringify(p.dependencies) : null,
            enablers: p.enablers ? JSON.stringify(p.enablers) : null,
            rationale: p.rationale ?? null,
            generatedByModel,
            generatedAt,
          },
        }),
      ),
    );
  });
}

/** Most recent provenance recorded against roadmap phases for this run. */
export async function getRoadmapPhasesProvenance(
  runId: string,
): Promise<{ generatedByModel: string | null; generatedAt: Date | null }> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeRoadmapPhase.findFirst({
      where: { runId, generatedAt: { not: null } },
      orderBy: { generatedAt: "desc" },
      select: { generatedByModel: true, generatedAt: true },
    });
    if (!row) return { generatedByModel: null, generatedAt: null };
    return {
      generatedByModel: row.generatedByModel ?? null,
      generatedAt: row.generatedAt ?? null,
    };
  });
}

export async function updateRoadmapPhaseManual(
  runId: string,
  useCaseId: string,
  phase: RoadmapPhase,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeRoadmapPhase.update({
      where: { runId_useCaseId: { runId, useCaseId } },
      data: { phase, manualOverride: true },
    });
  });
}

export async function deleteRoadmapPhasesForRun(runId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeRoadmapPhase.deleteMany({ where: { runId } });
  });
}
