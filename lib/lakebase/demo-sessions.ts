/**
 * CRUD operations for demo sessions -- backed by Lakebase (Prisma).
 */

import { randomUUID } from "crypto";
import { withPrisma } from "@/lib/prisma";
import type {
  DemoSessionStatus,
  DemoSessionSummary,
  ResearchPreset,
  DemoScope,
  TableDesign,
  ValidationSummary,
  ValidationResult,
} from "@/lib/demo/types";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import type { DemoDateWindow } from "@/lib/demo/data-engine/date-window";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateDemoSessionOpts {
  customerName: string;
  industryId: string;
  researchPreset: ResearchPreset;
  websiteUrl?: string;
  catalogName: string;
  schemaName: string;
  catalogCreated?: boolean;
  scope?: DemoScope;
  createdBy?: string;
  ownerEmail?: string | null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDemoSession(opts: CreateDemoSessionOpts): Promise<string> {
  const id = randomUUID();
  const owner = opts.ownerEmail
    ? opts.ownerEmail.toLowerCase().trim()
    : opts.createdBy
      ? opts.createdBy.toLowerCase().trim()
      : null;
  await withPrisma(async (prisma) => {
    await prisma.forgeDemoSession.create({
      data: {
        id,
        customerName: opts.customerName,
        industryId: opts.industryId,
        researchPreset: opts.researchPreset,
        websiteUrl: opts.websiteUrl ?? null,
        catalogName: opts.catalogName,
        schemaName: opts.schemaName,
        catalogCreated: opts.catalogCreated ?? false,
        scopeJson: opts.scope ? JSON.stringify(opts.scope) : null,
        createdBy: opts.createdBy ?? null,
        ownerEmail: owner,
      },
    });
  });
  return id;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getDemoSession(sessionId: string): Promise<DemoSessionSummary | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDemoSession.findUnique({ where: { id: sessionId } });
    if (!row) return null;
    return rowToSummary(row);
  });
}

export async function listDemoSessions(
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<DemoSessionSummary[]> {
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
    const rows = await prisma.forgeDemoSession.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(rowToSummary);
  });
}

export async function getDemoSessionResearch(
  sessionId: string,
): Promise<ResearchEngineResult | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDemoSession.findUnique({
      where: { id: sessionId },
      select: { researchJson: true },
    });
    if (!row?.researchJson) return null;
    try {
      return JSON.parse(row.researchJson) as ResearchEngineResult;
    } catch {
      return null;
    }
  });
}

/**
 * Envelope persisted in `dataModelJson` starting v2. Backward-compatible with
 * v1 (which stored a bare `TableDesign[]`).
 */
export interface DemoSessionDataModel {
  designs: TableDesign[];
  dateWindow?: DemoDateWindow;
  validationResults?: ValidationResult[];
  /** Whether this session was generated with Genie Mode on. */
  genieMode?: boolean;
  /** Databricks space_id of the Genie Space deployed by Pass 5 (Genie Mode). */
  genieSpaceId?: string;
  /** Deep link to the Genie Space (host + /genie/rooms/{space_id}). */
  genieSpaceUrl?: string;
  /** If Genie deploy was requested but failed or was skipped, the reason. */
  genieDeployError?: string;
}

/**
 * Read and parse the data-model envelope.  Handles both v1 (array) and v2
 * (object) shapes so older sessions still render.
 */
export async function getDemoSessionDataModel(
  sessionId: string,
): Promise<DemoSessionDataModel | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDemoSession.findUnique({
      where: { id: sessionId },
      select: { dataModelJson: true },
    });
    if (!row?.dataModelJson) return null;
    try {
      const parsed = JSON.parse(row.dataModelJson);
      if (Array.isArray(parsed)) {
        return { designs: parsed as TableDesign[] };
      }
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.designs)) {
        return parsed as DemoSessionDataModel;
      }
      return null;
    } catch {
      return null;
    }
  });
}

/**
 * Serialise a data-model envelope for persistence. Always emits v2 shape.
 */
export function serializeDemoSessionDataModel(
  designs: TableDesign[],
  dateWindow?: DemoDateWindow,
  validationSummary?: ValidationSummary,
  genie?: {
    genieMode?: boolean;
    genieSpaceId?: string;
    genieSpaceUrl?: string;
    genieDeployError?: string;
  },
): string {
  const envelope: DemoSessionDataModel = {
    designs,
    ...(dateWindow ? { dateWindow } : {}),
    ...(validationSummary?.results ? { validationResults: validationSummary.results } : {}),
    ...(genie?.genieMode !== undefined ? { genieMode: genie.genieMode } : {}),
    ...(genie?.genieSpaceId ? { genieSpaceId: genie.genieSpaceId } : {}),
    ...(genie?.genieSpaceUrl ? { genieSpaceUrl: genie.genieSpaceUrl } : {}),
    ...(genie?.genieDeployError ? { genieDeployError: genie.genieDeployError } : {}),
  };
  return JSON.stringify(envelope);
}

export async function getDemoSessionTables(sessionId: string): Promise<string[]> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDemoSession.findUnique({
      where: { id: sessionId },
      select: { tablesJson: true },
    });
    if (!row?.tablesJson) return [];
    try {
      return JSON.parse(row.tablesJson) as string[];
    } catch {
      return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateDemoSessionStatus(
  sessionId: string,
  status: DemoSessionStatus,
  extra?: {
    researchJson?: string;
    dataModelJson?: string;
    tablesJson?: string;
    sourceDocsJson?: string;
    catalogName?: string;
    schemaName?: string;
    tablesCreated?: number;
    totalRows?: number;
    durationMs?: number;
    errorMessage?: string;
    completedAt?: Date;
  },
): Promise<void> {
  await withPrisma(async (prisma) => {
    const data: Record<string, unknown> = { status };
    if (extra?.researchJson !== undefined) data.researchJson = extra.researchJson;
    if (extra?.dataModelJson !== undefined) data.dataModelJson = extra.dataModelJson;
    if (extra?.tablesJson !== undefined) data.tablesJson = extra.tablesJson;
    if (extra?.sourceDocsJson !== undefined) data.sourceDocsJson = extra.sourceDocsJson;
    if (extra?.catalogName !== undefined) data.catalogName = extra.catalogName;
    if (extra?.schemaName !== undefined) data.schemaName = extra.schemaName;
    if (extra?.tablesCreated !== undefined) data.tablesCreated = extra.tablesCreated;
    if (extra?.totalRows !== undefined) data.totalRows = extra.totalRows;
    if (extra?.durationMs !== undefined) data.durationMs = extra.durationMs;
    if (extra?.errorMessage !== undefined) data.errorMessage = extra.errorMessage;
    if (extra?.completedAt !== undefined) data.completedAt = extra.completedAt;

    await prisma.forgeDemoSession.update({ where: { id: sessionId }, data });
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteDemoSession(sessionId: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    try {
      await prisma.forgeDemoSession.delete({ where: { id: sessionId } });
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function rowToSummary(row: {
  id: string;
  customerName: string;
  industryId: string;
  researchPreset: string;
  catalogName: string;
  schemaName: string;
  status: string;
  tablesCreated: number;
  totalRows: number;
  durationMs: number;
  createdAt: Date;
  completedAt: Date | null;
  ownerEmail?: string | null;
}): DemoSessionSummary {
  return {
    sessionId: row.id,
    customerName: row.customerName,
    industryId: row.industryId,
    researchPreset: row.researchPreset as ResearchPreset,
    catalogName: row.catalogName,
    schemaName: row.schemaName,
    status: row.status as DemoSessionStatus,
    tablesCreated: row.tablesCreated,
    totalRows: row.totalRows,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    ownerEmail: row.ownerEmail ?? null,
  };
}
