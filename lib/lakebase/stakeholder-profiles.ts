/**
 * CRUD operations for stakeholder profiles — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import type { StakeholderProfile } from "@/lib/domain/types";

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function dbRowToProfile(row: {
  id: string;
  runId: string;
  role: string;
  department: string;
  useCaseCount: number;
  totalValue: number;
  domains: string | null;
  useCaseTypes: string | null;
  useCaseIds: string | null;
  changeComplexity: string | null;
  isChampion: boolean;
  isSponsor: boolean;
  championRationale: string | null;
  complexityRationale: string | null;
  keyRisks: string | null;
}): StakeholderProfile {
  return {
    id: row.id,
    runId: row.runId,
    role: row.role,
    department: row.department,
    useCaseCount: row.useCaseCount,
    totalValue: row.totalValue,
    domains: parseJSON<string[]>(row.domains, []),
    useCaseTypes: parseJSON<Record<string, number>>(row.useCaseTypes, {}),
    useCaseIds: parseJSON<string[]>(row.useCaseIds, []),
    changeComplexity: row.changeComplexity as StakeholderProfile["changeComplexity"],
    isChampion: row.isChampion,
    isSponsor: row.isSponsor,
    championRationale: row.championRationale,
    complexityRationale: row.complexityRationale,
    keyRisks: parseJSON<string[]>(row.keyRisks, []),
  };
}

export async function getStakeholderProfilesForRun(runId: string): Promise<StakeholderProfile[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeStakeholderProfile.findMany({
      where: { runId },
      orderBy: { totalValue: "desc" },
    });
    return rows.map(dbRowToProfile);
  });
}

export async function getStakeholderProfilesForLatestRun(
  userEmail?: string | null,
  accessibleRunIds: string[] = [],
): Promise<{
  runId: string | null;
  profiles: StakeholderProfile[];
}> {
  return withPrisma(async (prisma) => {
    const owner = userEmail ? userEmail.toLowerCase().trim() : null;
    const where: Record<string, unknown> = { status: "completed" };
    if (owner) {
      where.OR = [
        { ownerEmail: owner },
        ...(accessibleRunIds.length > 0 ? [{ runId: { in: accessibleRunIds } }] : []),
      ];
    }
    const latestRun = await prisma.forgeRun.findFirst({
      where,
      orderBy: { completedAt: "desc" },
      select: { runId: true },
    });
    if (!latestRun) return { runId: null, profiles: [] };
    const profiles = await getStakeholderProfilesForRun(latestRun.runId);
    return { runId: latestRun.runId, profiles };
  });
}

export async function replaceStakeholderProfiles(
  runId: string,
  profiles: Array<{
    role: string;
    department: string;
    useCaseCount: number;
    totalValue: number;
    domains: string[];
    useCaseTypes: Record<string, number>;
    useCaseIds?: string[];
    changeComplexity: "low" | "medium" | "high";
    isChampion: boolean;
    isSponsor: boolean;
    championRationale?: string | null;
    complexityRationale?: string | null;
    keyRisks?: string[] | null;
  }>,
  provenance?: {
    generatedByModel?: string | null;
    generatedAt?: Date;
  },
): Promise<void> {
  const generatedByModel = provenance?.generatedByModel ?? null;
  const generatedAt = provenance?.generatedAt ?? new Date();
  await withPrisma(async (prisma) => {
    await prisma.forgeStakeholderProfile.deleteMany({ where: { runId } });
    await prisma.forgeStakeholderProfile.createMany({
      data: profiles.map((p) => ({
        runId,
        role: p.role,
        department: p.department,
        useCaseCount: p.useCaseCount,
        totalValue: p.totalValue,
        domains: JSON.stringify(p.domains),
        useCaseTypes: JSON.stringify(p.useCaseTypes),
        useCaseIds: p.useCaseIds && p.useCaseIds.length > 0 ? JSON.stringify(p.useCaseIds) : null,
        changeComplexity: p.changeComplexity,
        isChampion: p.isChampion,
        isSponsor: p.isSponsor,
        championRationale: p.championRationale ?? null,
        complexityRationale: p.complexityRationale ?? null,
        keyRisks: p.keyRisks && p.keyRisks.length > 0 ? JSON.stringify(p.keyRisks) : null,
        generatedByModel,
        generatedAt,
      })),
    });
  });
}

export async function deleteStakeholderProfilesForRun(runId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeStakeholderProfile.deleteMany({ where: { runId } });
  });
}

/** Most recent provenance recorded against stakeholder profiles for this run. */
export async function getStakeholderProvenance(
  runId: string,
): Promise<{ generatedByModel: string | null; generatedAt: Date | null }> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeStakeholderProfile.findFirst({
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
