/**
 * CRUD operations for strategy documents and alignment — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import type {
  StrategyDocument,
  StrategyInitiative,
  StrategyAlignmentEntry,
  StrategyGapType,
} from "@/lib/domain/types";

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function dbRowToStrategy(row: {
  id: string;
  title: string;
  rawContent: string;
  parsedInitiatives: string | null;
  alignmentScore: number | null;
  status: string;
}): StrategyDocument {
  return {
    id: row.id,
    title: row.title,
    rawContent: row.rawContent,
    parsedInitiatives: parseJSON<StrategyInitiative[]>(row.parsedInitiatives, []),
    alignmentScore: row.alignmentScore,
    status: row.status as StrategyDocument["status"],
  };
}

function dbRowToAlignment(row: {
  id: string;
  strategyId: string;
  runId: string;
  initiativeIndex: number;
  useCaseId: string | null;
  confidence: number;
  gapType: string | null;
  notes: string | null;
}): StrategyAlignmentEntry {
  return {
    id: row.id,
    strategyId: row.strategyId,
    runId: row.runId,
    initiativeIndex: row.initiativeIndex,
    useCaseId: row.useCaseId,
    confidence: row.confidence,
    gapType: row.gapType as StrategyGapType | null,
    notes: row.notes,
  };
}

// ---------------------------------------------------------------------------
// Strategy Documents
// ---------------------------------------------------------------------------

export async function listStrategyDocuments(
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<StrategyDocument[]> {
  return withPrisma(async (prisma) => {
    const owner = userEmail ? userEmail.toLowerCase().trim() : null;
    const where: Record<string, unknown> = {};
    if (owner) {
      if (viewMode === "owned") {
        where.ownerEmail = owner;
      } else if (viewMode === "shared") {
        where.id = { in: sharedIds };
      } else {
        where.OR = [{ ownerEmail: owner }, { id: { in: sharedIds } }];
      }
    }
    const rows = await prisma.forgeStrategyDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(dbRowToStrategy);
  });
}

export async function getStrategyDocument(id: string): Promise<StrategyDocument | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeStrategyDocument.findUnique({ where: { id } });
    return row ? dbRowToStrategy(row) : null;
  });
}

export async function createStrategyDocument(data: {
  title: string;
  rawContent: string;
  parsedInitiatives?: StrategyInitiative[];
  createdBy?: string;
  ownerEmail?: string | null;
}): Promise<StrategyDocument> {
  return withPrisma(async (prisma) => {
    const owner = data.ownerEmail
      ? data.ownerEmail.toLowerCase().trim()
      : data.createdBy
        ? data.createdBy.toLowerCase().trim()
        : null;
    const row = await prisma.forgeStrategyDocument.create({
      data: {
        title: data.title,
        rawContent: data.rawContent,
        parsedInitiatives: data.parsedInitiatives ? JSON.stringify(data.parsedInitiatives) : null,
        createdBy: data.createdBy ?? null,
        ownerEmail: owner,
      },
    });
    return dbRowToStrategy(row);
  });
}

export async function updateStrategyDocument(
  id: string,
  data: {
    parsedInitiatives?: StrategyInitiative[];
    alignmentScore?: number;
    status?: StrategyDocument["status"];
  },
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeStrategyDocument.update({
      where: { id },
      data: {
        ...(data.parsedInitiatives !== undefined
          ? { parsedInitiatives: JSON.stringify(data.parsedInitiatives) }
          : {}),
        ...(data.alignmentScore !== undefined ? { alignmentScore: data.alignmentScore } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
  });
}

export async function deleteStrategyDocument(id: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeStrategyDocument.delete({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// Strategy Alignments
// ---------------------------------------------------------------------------

export async function getAlignmentsForStrategy(
  strategyId: string,
  runId: string,
): Promise<StrategyAlignmentEntry[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeStrategyAlignment.findMany({
      where: { strategyId, runId },
      orderBy: { initiativeIndex: "asc" },
    });
    return rows.map(dbRowToAlignment);
  });
}

export async function upsertAlignments(
  strategyId: string,
  runId: string,
  alignments: Array<{
    initiativeIndex: number;
    useCaseId: string | null;
    confidence: number;
    gapType: StrategyGapType;
    notes?: string;
  }>,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeStrategyAlignment.deleteMany({
      where: { strategyId, runId },
    });
    await prisma.forgeStrategyAlignment.createMany({
      data: alignments.map((a) => ({
        strategyId,
        runId,
        initiativeIndex: a.initiativeIndex,
        useCaseId: a.useCaseId,
        confidence: a.confidence,
        gapType: a.gapType,
        notes: a.notes ?? null,
      })),
    });
  });
}
