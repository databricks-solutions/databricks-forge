/**
 * CRUD operations for external connections — backed by Lakebase (Prisma).
 */

import { randomUUID } from "crypto";
import { withPrisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/connections/crypto";
import { logger } from "@/lib/logger";
import type {
  ConnectionConfig,
  ConnectionSummary,
  CreateConnectionInput,
  UpdateConnectionInput,
} from "@/lib/connections/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function dbRowToConfig(row: {
  id: string;
  name: string;
  connectorType: string;
  accessLevel: string;
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  configJson: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastTestedAt: Date | null;
  lastScanCompletedAt: Date | null;
}): ConnectionConfig {
  const config = parseJSON<{ workspaceFilter?: string[] }>(row.configJson, {});
  return {
    id: row.id,
    name: row.name,
    connectorType: row.connectorType as ConnectionConfig["connectorType"],
    accessLevel: row.accessLevel as ConnectionConfig["accessLevel"],
    tenantId: row.tenantId ?? "",
    clientId: row.clientId ?? "",
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastScanCompletedAt: row.lastScanCompletedAt?.toISOString() ?? null,
    workspaceFilter: config.workspaceFilter,
  };
}

function dbRowToSummary(row: {
  id: string;
  name: string;
  connectorType: string;
  accessLevel: string;
  tenantId: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  lastTestedAt: Date | null;
  lastScanCompletedAt: Date | null;
}): ConnectionSummary {
  return {
    id: row.id,
    name: row.name,
    connectorType: row.connectorType as ConnectionSummary["connectorType"],
    accessLevel: row.accessLevel as ConnectionSummary["accessLevel"],
    tenantId: row.tenantId,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastScanCompletedAt: row.lastScanCompletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createConnection(
  input: CreateConnectionInput,
  createdBy?: string | null,
  ownerEmail?: string | null,
): Promise<ConnectionConfig> {
  const owner = ownerEmail
    ? ownerEmail.toLowerCase().trim()
    : createdBy
      ? createdBy.toLowerCase().trim()
      : null;
  return withPrisma(async (prisma) => {
    const id = randomUUID();
    const configJson = input.workspaceFilter
      ? JSON.stringify({ workspaceFilter: input.workspaceFilter })
      : null;

    const row = await prisma.forgeConnection.create({
      data: {
        id,
        name: input.name,
        connectorType: input.connectorType,
        accessLevel: input.accessLevel,
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientSecret: encrypt(input.clientSecret),
        configJson,
        createdBy: createdBy ?? null,
        ownerEmail: owner,
      },
    });
    return dbRowToConfig(row);
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getConnection(id: string): Promise<ConnectionConfig | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeConnection.findUnique({ where: { id } });
    return row ? dbRowToConfig(row) : null;
  });
}

export async function listConnections(
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<ConnectionSummary[]> {
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
    const rows = await prisma.forgeConnection.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        connectorType: true,
        accessLevel: true,
        tenantId: true,
        status: true,
        createdBy: true,
        createdAt: true,
        lastTestedAt: true,
        lastScanCompletedAt: true,
      },
    });
    return rows.map(dbRowToSummary);
  });
}

/**
 * Returns the decrypted client secret for API calls. Never expose to frontend.
 */
export async function getConnectionSecret(
  id: string,
): Promise<{ clientId: string; clientSecret: string; tenantId: string } | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeConnection.findUnique({
      where: { id },
      select: { clientId: true, clientSecret: true, tenantId: true },
    });
    if (!row?.clientSecret || !row.clientId || !row.tenantId) return null;
    return {
      clientId: row.clientId,
      clientSecret: decrypt(row.clientSecret),
      tenantId: row.tenantId,
    };
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateConnection(
  id: string,
  input: UpdateConnectionInput,
): Promise<ConnectionConfig | null> {
  return withPrisma(async (prisma) => {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.status !== undefined) data.status = input.status;
    if (input.clientSecret !== undefined) data.clientSecret = encrypt(input.clientSecret);
    if (input.workspaceFilter !== undefined)
      data.configJson = JSON.stringify({
        workspaceFilter: input.workspaceFilter,
      });

    try {
      const row = await prisma.forgeConnection.update({
        where: { id },
        data,
      });
      return dbRowToConfig(row);
    } catch {
      return null;
    }
  });
}

export async function markConnectionTested(id: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeConnection.update({
      where: { id },
      data: { lastTestedAt: new Date() },
    });
  });
}

export async function markConnectionScanned(id: string, at: Date): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeConnection.update({
      where: { id },
      data: { lastScanCompletedAt: at },
    });
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteConnection(id: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    try {
      await prisma.forgeConnection.delete({ where: { id } });
      return true;
    } catch (err) {
      logger.warn("[connections] Failed to delete connection", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  });
}
