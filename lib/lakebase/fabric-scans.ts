/**
 * CRUD operations for Fabric/PBI scans — backed by Lakebase (Prisma).
 */

import { randomUUID } from "crypto";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
  FabricScanSummary,
  FabricScanDetail,
  FabricWorkspace,
  FabricDataset,
  FabricReport,
  FabricArtifact,
} from "@/lib/fabric/types";

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

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createFabricScan(opts: {
  connectionId: string;
  accessLevel: "admin" | "workspace";
  scanMode?: "full" | "incremental";
  createdBy?: string | null;
  ownerEmail?: string | null;
}): Promise<string> {
  const owner = opts.ownerEmail
    ? opts.ownerEmail.toLowerCase().trim()
    : opts.createdBy
      ? opts.createdBy.toLowerCase().trim()
      : null;
  return withPrisma(async (prisma) => {
    const id = randomUUID();
    await prisma.forgeFabricScan.create({
      data: {
        id,
        connectionId: opts.connectionId,
        accessLevel: opts.accessLevel,
        scanMode: opts.scanMode ?? "full",
        status: "pending",
        createdBy: opts.createdBy ?? null,
        ownerEmail: owner,
      },
    });
    return id;
  });
}

// ---------------------------------------------------------------------------
// Update scan status
// ---------------------------------------------------------------------------

export async function updateFabricScan(
  scanId: string,
  data: {
    status?: string;
    workspaceCount?: number;
    datasetCount?: number;
    reportCount?: number;
    measureCount?: number;
    artifactCount?: number;
    errorMessage?: string | null;
    rawResultJson?: string;
    completedAt?: Date;
  },
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeFabricScan.update({ where: { id: scanId }, data });
  });
}

// ---------------------------------------------------------------------------
// Bulk insert scan children
// ---------------------------------------------------------------------------

export async function insertScanWorkspaces(
  scanId: string,
  workspaces: FabricWorkspace[],
): Promise<void> {
  if (!workspaces.length) return;
  await withPrisma(async (prisma) => {
    await prisma.forgeFabricWorkspace.createMany({
      data: workspaces.map((ws) => ({
        id: randomUUID(),
        scanId,
        workspaceId: ws.workspaceId,
        name: ws.name,
        state: ws.state,
        type: ws.type,
      })),
    });
  });
}

export async function insertScanDatasets(scanId: string, datasets: FabricDataset[]): Promise<void> {
  if (!datasets.length) return;
  await withPrisma(async (prisma) => {
    await prisma.forgeFabricDataset.createMany({
      data: datasets.map((ds) => ({
        id: randomUUID(),
        scanId,
        workspaceId: ds.workspaceId,
        datasetId: ds.datasetId,
        name: ds.name,
        configuredBy: ds.configuredBy,
        tablesJson: JSON.stringify(ds.tables),
        measuresJson: JSON.stringify(ds.measures),
        relationshipsJson: JSON.stringify(ds.relationships),
        expressionsJson: ds.expressions.length ? JSON.stringify(ds.expressions) : null,
        rolesJson: ds.roles.length ? JSON.stringify(ds.roles) : null,
        datasourcesJson: ds.datasources.length ? JSON.stringify(ds.datasources) : null,
        sensitivityLabel: ds.sensitivityLabel,
      })),
    });
  });
}

export async function insertScanReports(scanId: string, reports: FabricReport[]): Promise<void> {
  if (!reports.length) return;
  await withPrisma(async (prisma) => {
    await prisma.forgeFabricReport.createMany({
      data: reports.map((r) => ({
        id: randomUUID(),
        scanId,
        workspaceId: r.workspaceId,
        reportId: r.reportId,
        name: r.name,
        datasetId: r.datasetId,
        reportType: r.reportType,
        tilesJson: r.tiles.length ? JSON.stringify(r.tiles) : null,
        sensitivityLabel: r.sensitivityLabel,
      })),
    });
  });
}

export async function insertScanArtifacts(
  scanId: string,
  artifacts: FabricArtifact[],
): Promise<void> {
  if (!artifacts.length) return;
  await withPrisma(async (prisma) => {
    await prisma.forgeFabricArtifact.createMany({
      data: artifacts.map((a) => ({
        id: randomUUID(),
        scanId,
        workspaceId: a.workspaceId,
        artifactId: a.artifactId,
        artifactType: a.artifactType,
        name: a.name,
        metadataJson: Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : null,
      })),
    });
  });
}

// ---------------------------------------------------------------------------
// Read -- list
// ---------------------------------------------------------------------------

export async function listFabricScans(
  connectionId?: string,
  userEmail?: string | null,
  viewMode: "all" | "owned" | "shared" = "all",
  sharedIds: string[] = [],
): Promise<FabricScanSummary[]> {
  return withPrisma(async (prisma) => {
    const owner = userEmail ? userEmail.toLowerCase().trim() : null;
    const where: Record<string, unknown> = {};
    if (connectionId) where.connectionId = connectionId;
    if (owner) {
      if (viewMode === "owned") {
        where.ownerEmail = owner;
      } else if (viewMode === "shared") {
        where.id = { in: sharedIds };
      } else {
        where.OR = [{ ownerEmail: owner }, { id: { in: sharedIds } }];
      }
    }
    const rows = await prisma.forgeFabricScan.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      connectionId: r.connectionId,
      accessLevel: r.accessLevel as "admin" | "workspace",
      status: r.status as FabricScanSummary["status"],
      workspaceCount: r.workspaceCount,
      datasetCount: r.datasetCount,
      reportCount: r.reportCount,
      measureCount: r.measureCount,
      artifactCount: r.artifactCount,
      scanMode: (r.scanMode ?? "full") as "full" | "incremental",
      errorMessage: r.errorMessage,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  });
}

// ---------------------------------------------------------------------------
// Read -- detail (with children)
// ---------------------------------------------------------------------------

export async function getFabricScanDetail(scanId: string): Promise<FabricScanDetail | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeFabricScan.findUnique({
      where: { id: scanId },
      include: {
        workspaces: true,
        datasets: true,
        reports: true,
        artifacts: true,
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      connectionId: row.connectionId,
      accessLevel: row.accessLevel as "admin" | "workspace",
      status: row.status as FabricScanSummary["status"],
      workspaceCount: row.workspaceCount,
      datasetCount: row.datasetCount,
      reportCount: row.reportCount,
      measureCount: row.measureCount,
      artifactCount: row.artifactCount,
      scanMode: (row.scanMode ?? "full") as "full" | "incremental",
      errorMessage: row.errorMessage,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      workspaces: row.workspaces.map((ws) => ({
        id: ws.id,
        workspaceId: ws.workspaceId,
        name: ws.name,
        state: ws.state,
        type: ws.type,
      })),
      datasets: row.datasets.map((ds) => ({
        id: ds.id,
        workspaceId: ds.workspaceId,
        datasetId: ds.datasetId,
        name: ds.name,
        configuredBy: ds.configuredBy,
        tables: parseJSON(ds.tablesJson, []),
        measures: parseJSON(ds.measuresJson, []),
        relationships: parseJSON(ds.relationshipsJson, []),
        expressions: parseJSON(ds.expressionsJson, []),
        roles: parseJSON(ds.rolesJson, []),
        datasources: parseJSON(ds.datasourcesJson, []),
        sensitivityLabel: ds.sensitivityLabel,
      })),
      reports: row.reports.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        reportId: r.reportId,
        name: r.name,
        datasetId: r.datasetId,
        reportType: r.reportType,
        tiles: parseJSON(r.tilesJson, []),
        sensitivityLabel: r.sensitivityLabel,
      })),
      artifacts: row.artifacts.map((a) => ({
        id: a.id,
        workspaceId: a.workspaceId,
        artifactId: a.artifactId,
        artifactType: a.artifactType,
        name: a.name,
        metadata: parseJSON(a.metadataJson ?? null, {}),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFabricScan(scanId: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    try {
      await prisma.forgeFabricScan.delete({ where: { id: scanId } });
      return true;
    } catch (err) {
      logger.warn("[fabric-scans] Failed to delete scan", {
        scanId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  });
}
