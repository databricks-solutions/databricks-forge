/**
 * CRUD operations for Meta Data Genie spaces -- backed by Lakebase (Prisma).
 *
 * Tracks metadata genie space generation, view deployment, and Genie Space
 * deployment lifecycle.
 */

import { withPrisma } from "@/lib/prisma";
import type {
  MetadataGenieSpace,
  MetadataGenieStatus,
  IndustryDetectionResult,
} from "@/lib/metadata-genie/types";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToSpace(row: any): MetadataGenieSpace {
  return {
    id: row.id,
    title: row.title,
    catalogScope: parseJsonArray(row.catalogScope),
    industryId: row.industryId,
    industryName: row.industryName,
    domains: parseJsonArray(row.domains),
    detection: parseJson<IndustryDetectionResult>(row.detection),
    sampleQuestions: parseJsonArray(row.sampleQuestions),
    aiDescriptions: parseJson<Record<string, string>>(row.aiDescriptions),
    lineageAccessible: row.lineageAccessible ?? false,
    viewCatalog: row.viewCatalog,
    viewSchema: row.viewSchema,
    viewsDeployed: row.viewsDeployed,
    viewNames: parseJsonArray(row.viewNames),
    serializedSpace: row.serializedSpace ?? "",
    spaceId: row.spaceId,
    spaceUrl: row.spaceUrl,
    status: row.status as MetadataGenieStatus,
    authMode: row.authMode,
    tableCount: row.tableCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseJsonArray(json: string | null): string[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseJson<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listMetadataGenieSpaces(): Promise<MetadataGenieSpace[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeMetadataGenieSpace.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map(dbRowToSpace);
  });
}

export async function getMetadataGenieSpace(id: string): Promise<MetadataGenieSpace | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeMetadataGenieSpace.findUnique({
      where: { id },
    });
    return row ? dbRowToSpace(row) : null;
  });
}

/** Save a draft space (generate step -- viewTarget chosen later at deploy). */
export async function saveMetadataGenieSpace(opts: {
  id: string;
  title: string;
  catalogScope?: string[];
  industryId?: string | null;
  industryName?: string | null;
  domains?: string[];
  detection?: IndustryDetectionResult;
  sampleQuestions?: string[];
  aiDescriptions?: Record<string, string>;
  lineageAccessible?: boolean;
  serializedSpace?: string;
  tableCount: number;
}): Promise<MetadataGenieSpace> {
  return withPrisma(async (prisma) => {
    const shared = {
      title: opts.title,
      catalogScope: opts.catalogScope ? JSON.stringify(opts.catalogScope) : null,
      industryId: opts.industryId ?? null,
      industryName: opts.industryName ?? null,
      domains: opts.domains ? JSON.stringify(opts.domains) : null,
      detection: opts.detection ? JSON.stringify(opts.detection) : null,
      sampleQuestions: opts.sampleQuestions ? JSON.stringify(opts.sampleQuestions) : null,
      aiDescriptions: opts.aiDescriptions ? JSON.stringify(opts.aiDescriptions) : null,
      lineageAccessible: opts.lineageAccessible ?? false,
      serializedSpace: opts.serializedSpace ?? null,
      tableCount: opts.tableCount,
      status: "draft" as const,
    };
    const row = await prisma.forgeMetadataGenieSpace.upsert({
      where: { id: opts.id },
      create: { id: opts.id, ...shared },
      update: shared,
    });
    return dbRowToSpace(row);
  });
}

/** Update a space after deploy (sets viewTarget, serializedSpace, spaceId, etc). */
export async function updateMetadataGenieOnDeploy(opts: {
  id: string;
  viewCatalog: string;
  viewSchema: string;
  viewNames: string[];
  serializedSpace: string;
  spaceId: string;
  spaceUrl: string;
}): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeMetadataGenieSpace.update({
      where: { id: opts.id },
      data: {
        viewCatalog: opts.viewCatalog,
        viewSchema: opts.viewSchema,
        viewsDeployed: true,
        viewNames: JSON.stringify(opts.viewNames),
        serializedSpace: opts.serializedSpace,
        spaceId: opts.spaceId,
        spaceUrl: opts.spaceUrl,
        status: "deployed",
      },
    });
  });
}

export async function updateMetadataGenieStatus(
  id: string,
  status: MetadataGenieStatus,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeMetadataGenieSpace.update({
      where: { id },
      data: { status },
    });
  });
}

export async function deleteMetadataGenieSpace(id: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeMetadataGenieSpace.delete({
      where: { id },
    });
  });
}
