/**
 * CRUD for ForgeEstateSynthesis — the persisted consultant-grade State of the
 * Nation for a scan (and, optionally, an estate roll-up).
 */

import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { EstateSynthesisResult } from "@/lib/domain/estate-synthesis-types";

export interface SavedSynthesis extends EstateSynthesisResult {
  id: string;
  scanId: string | null;
  estateId: string | null;
  industryId: string | null;
  createdAt: string;
}

export async function saveEstateSynthesis(args: {
  scanId?: string | null;
  estateId?: string | null;
  ownerEmail?: string | null;
  industryId?: string | null;
  result: EstateSynthesisResult;
}): Promise<string> {
  const { scanId = null, estateId = null, ownerEmail = null, industryId = null, result } = args;
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeEstateSynthesis.create({
      data: {
        scanId,
        estateId,
        ownerEmail,
        industryId,
        briefJson: JSON.stringify(result.brief),
        findingsJson: JSON.stringify(result.findings),
        evidenceJson: JSON.stringify(result.brief.evidence ?? []),
        valueAtRiskJson: result.valueAtRisk ? JSON.stringify(result.valueAtRisk) : null,
        scoresJson: JSON.stringify(result.scores),
        passResultsJson: JSON.stringify(result.passResults),
      },
      select: { id: true },
    });
    logger.info("[estate-synthesis] Saved synthesis", { id: row.id, scanId, estateId });
    return row.id;
  });
}

/** Latest synthesis for a scan, or null. */
export async function getLatestSynthesisForScan(scanId: string): Promise<SavedSynthesis | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeEstateSynthesis.findFirst({
      where: { scanId },
      orderBy: { createdAt: "desc" },
    });
    return row ? rowToSynthesis(row) : null;
  });
}

/** Latest synthesis for an estate roll-up, or null. */
export async function getLatestSynthesisForEstate(
  estateId: string,
): Promise<SavedSynthesis | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeEstateSynthesis.findFirst({
      where: { estateId },
      orderBy: { createdAt: "desc" },
    });
    return row ? rowToSynthesis(row) : null;
  });
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToSynthesis(row: {
  id: string;
  scanId: string | null;
  estateId: string | null;
  industryId: string | null;
  briefJson: string;
  findingsJson: string;
  evidenceJson: string | null;
  valueAtRiskJson: string | null;
  scoresJson: string | null;
  passResultsJson: string | null;
  createdAt: Date;
}): SavedSynthesis {
  return {
    id: row.id,
    scanId: row.scanId,
    estateId: row.estateId,
    industryId: row.industryId,
    createdAt: row.createdAt.toISOString(),
    brief: safeParse(row.briefJson, {} as EstateSynthesisResult["brief"]),
    findings: safeParse(row.findingsJson, [] as EstateSynthesisResult["findings"]),
    scores: safeParse(row.scoresJson, {} as EstateSynthesisResult["scores"]),
    valueAtRisk: safeParse(row.valueAtRiskJson, null as EstateSynthesisResult["valueAtRisk"]),
    passResults: safeParse(row.passResultsJson, {} as EstateSynthesisResult["passResults"]),
  };
}
