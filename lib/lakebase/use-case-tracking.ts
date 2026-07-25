/**
 * CRUD operations for use case lifecycle tracking — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import type { UseCaseTrackingEntry, TrackingStage } from "@/lib/domain/types";

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function dbRowToTracking(row: {
  id: string;
  runId: string;
  useCaseId: string;
  stage: string;
  assignedOwner: string | null;
  plannedDate: Date | null;
  startedDate: Date | null;
  deliveredDate: Date | null;
  measuredDate: Date | null;
  notes: string | null;
}): UseCaseTrackingEntry {
  return {
    id: row.id,
    runId: row.runId,
    useCaseId: row.useCaseId,
    stage: row.stage as TrackingStage,
    assignedOwner: row.assignedOwner,
    plannedDate: row.plannedDate?.toISOString() ?? null,
    startedDate: row.startedDate?.toISOString() ?? null,
    deliveredDate: row.deliveredDate?.toISOString() ?? null,
    measuredDate: row.measuredDate?.toISOString() ?? null,
    notes: parseJSON<UseCaseTrackingEntry["notes"]>(row.notes, []),
  };
}

export async function getTrackingForRun(runId: string): Promise<UseCaseTrackingEntry[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeUseCaseTracking.findMany({ where: { runId } });
    return rows.map(dbRowToTracking);
  });
}

export async function getTrackingByStage(
  runIds?: string[] | null,
): Promise<Record<TrackingStage, number>> {
  return withPrisma(async (prisma) => {
    const where = runIds
      ? runIds.length > 0
        ? { runId: { in: runIds } }
        : { runId: "__no_run__" }
      : undefined;
    const groups = await prisma.forgeUseCaseTracking.groupBy({
      by: ["stage"],
      where,
      _count: { _all: true },
    });
    const result: Record<TrackingStage, number> = {
      discovered: 0,
      planned: 0,
      in_progress: 0,
      delivered: 0,
      measured: 0,
    };
    for (const g of groups) {
      result[g.stage as TrackingStage] = g._count._all;
    }
    return result;
  });
}

export async function upsertTracking(
  runId: string,
  useCaseId: string,
  data: {
    stage?: TrackingStage;
    assignedOwner?: string;
    notes?: Array<{ text: string; author?: string; createdAt: string }>;
  },
): Promise<UseCaseTrackingEntry> {
  return withPrisma(async (prisma) => {
    const now = new Date();
    const dateFields: Record<string, Date> = {};

    if (data.stage === "planned") dateFields.plannedDate = now;
    else if (data.stage === "in_progress") dateFields.startedDate = now;
    else if (data.stage === "delivered") dateFields.deliveredDate = now;
    else if (data.stage === "measured") dateFields.measuredDate = now;

    const row = await prisma.forgeUseCaseTracking.upsert({
      where: { runId_useCaseId: { runId, useCaseId } },
      create: {
        runId,
        useCaseId,
        stage: data.stage ?? "discovered",
        assignedOwner: data.assignedOwner ?? null,
        notes: data.notes ? JSON.stringify(data.notes) : null,
        ...dateFields,
      },
      update: {
        ...(data.stage ? { stage: data.stage } : {}),
        ...(data.assignedOwner !== undefined ? { assignedOwner: data.assignedOwner } : {}),
        ...(data.notes ? { notes: JSON.stringify(data.notes) } : {}),
        ...dateFields,
      },
    });
    return dbRowToTracking(row);
  });
}

export async function bulkInitTracking(runId: string, useCaseIds: string[]): Promise<void> {
  await withPrisma(async (prisma) => {
    const existing = await prisma.forgeUseCaseTracking.findMany({
      where: { runId },
      select: { useCaseId: true },
    });
    const existingIds = new Set(existing.map((e) => e.useCaseId));
    const newIds = useCaseIds.filter((id) => !existingIds.has(id));

    if (newIds.length > 0) {
      await prisma.forgeUseCaseTracking.createMany({
        data: newIds.map((useCaseId) => ({
          runId,
          useCaseId,
          stage: "discovered",
        })),
        skipDuplicates: true,
      });
    }
  });
}
