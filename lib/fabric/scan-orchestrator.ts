/**
 * Fabric scan orchestrator.
 *
 * Coordinates the end-to-end scan flow:
 * 1. Validate connection credentials (warm the token cache)
 * 2. List workspaces
 * 3. Trigger scan (admin) or fetch per-workspace (standard)
 * 4. Poll for completion (admin)
 * 5. Parse results and persist to Lakebase
 *
 * Token lifecycle is handled by token-manager.ts — each API call
 * resolves a fresh or cached token automatically, so long-running
 * scans survive token expiry.
 *
 * When FABRIC_USE_FIXTURES=true, skips real API calls and uses mock data.
 */

import { logger } from "@/lib/logger";
import {
  createFabricScan,
  updateFabricScan,
  insertScanWorkspaces,
  insertScanDatasets,
  insertScanReports,
  insertScanArtifacts,
} from "@/lib/lakebase/fabric-scans";
import {
  listWorkspaces,
  getModifiedWorkspaces,
  startAdminScan,
  getScanStatus,
  getScanResult,
  getWorkspaceDatasets,
  getWorkspaceReports,
  getWorkspaceDashboards,
} from "./client";
import { getToken } from "./token-manager";
import {
  parseAdminScanResult,
  parseWorkspaceDatasets,
  parseWorkspaceReports,
  parseWorkspaceDashboards,
} from "./parser";
import { setScanProgress } from "./scan-progress";
import { shouldUseFixtures, MOCK_ADMIN_SCAN_RESULT, MOCK_WORKSPACES } from "./fixtures";
import type {
  FabricWorkspace,
  FabricDataset,
  FabricReport,
  FabricArtifact,
  FabricScanDetail,
} from "./types";
import { markConnectionScanned } from "@/lib/lakebase/connections";
import type { ConnectionConfig } from "@/lib/connections/types";
import { deleteEmbeddingsByScan } from "@/lib/embeddings/store";
import { embedFabricScan } from "@/lib/embeddings/embed-pipeline";

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120;

export async function runFabricScan(
  connection: ConnectionConfig,
  createdBy?: string | null,
  incremental?: boolean,
  ownerEmail?: string | null,
): Promise<string> {
  const scanMode = incremental ? ("incremental" as const) : ("full" as const);

  const scanId = await createFabricScan({
    connectionId: connection.id,
    accessLevel: connection.accessLevel,
    scanMode,
    createdBy,
    ownerEmail: ownerEmail ?? createdBy,
  });

  setScanProgress(scanId, {
    status: "scanning",
    message: "Starting scan...",
    percent: 5,
    phase: "init",
  });

  const scanStartTime = new Date();
  runScanAsync(scanId, connection, incremental, scanStartTime).catch((err) => {
    logger.error("[fabric-scan] Unhandled error in async scan", {
      scanId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return scanId;
}

async function runScanAsync(
  scanId: string,
  connection: ConnectionConfig,
  incremental?: boolean,
  scanStartTime?: Date,
): Promise<void> {
  try {
    if (shouldUseFixtures()) {
      await runWithFixtures(scanId);
      return;
    }

    const connId = connection.id;

    setScanProgress(scanId, { message: "Acquiring token...", percent: 10, phase: "auth" });
    await getToken(connId);

    if (connection.accessLevel === "admin") {
      await runAdminScan(
        scanId,
        connId,
        connection.workspaceFilter,
        incremental ? connection.lastScanCompletedAt : undefined,
      );
    } else {
      await runWorkspaceScan(scanId, connId, connection.workspaceFilter);
    }

    await embedScanForAskForge(scanId);

    if (scanStartTime) {
      await markConnectionScanned(connId, scanStartTime);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[fabric-scan] Scan failed", { scanId, error: msg });
    await updateFabricScan(scanId, { status: "failed", errorMessage: msg });
    setScanProgress(scanId, { status: "failed", message: msg, percent: 100, phase: "error" });
  }
}

// ---------------------------------------------------------------------------
// Admin Scanner flow
// ---------------------------------------------------------------------------

async function runAdminScan(
  scanId: string,
  connectionId: string,
  workspaceFilter?: string[],
  lastScanCompletedAt?: string | null,
): Promise<void> {
  setScanProgress(scanId, { message: "Listing workspaces...", percent: 15, phase: "workspaces" });
  let allWorkspaces = await listWorkspaces(connectionId, "admin");

  if (workspaceFilter?.length) {
    const filterSet = new Set(workspaceFilter);
    allWorkspaces = allWorkspaces.filter((ws) => filterSet.has(ws.id));
  }

  if (lastScanCompletedAt) {
    setScanProgress(scanId, {
      message: "Checking for modified workspaces...",
      percent: 17,
      phase: "incremental",
    });
    const modifiedIds = await getModifiedWorkspaces(connectionId, new Date(lastScanCompletedAt));

    if (modifiedIds.length === 0) {
      await persistResults(scanId, {
        workspaces: [],
        datasets: [],
        reports: [],
        artifacts: [],
        measureCount: 0,
      });
      logger.info("[fabric-scan] Incremental scan: no changes detected", { scanId });
      return;
    }

    const modifiedSet = new Set(modifiedIds);
    allWorkspaces = allWorkspaces.filter((ws) => modifiedSet.has(ws.id));
    logger.info("[fabric-scan] Incremental scan: processing modified workspaces", {
      scanId,
      total: modifiedIds.length,
      afterFilter: allWorkspaces.length,
    });
  }

  await updateFabricScan(scanId, { status: "scanning", workspaceCount: allWorkspaces.length });

  const allResults: {
    workspaces: FabricWorkspace[];
    datasets: FabricDataset[];
    reports: FabricReport[];
    artifacts: FabricArtifact[];
    measureCount: number;
  } = { workspaces: [], datasets: [], reports: [], artifacts: [], measureCount: 0 };

  for (let i = 0; i < allWorkspaces.length; i += BATCH_SIZE) {
    const batch = allWorkspaces.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allWorkspaces.length / BATCH_SIZE);
    const pct = 20 + Math.floor((i / allWorkspaces.length) * 60);

    setScanProgress(scanId, {
      message: `Scanning batch ${batchNum}/${totalBatches} (${batch.length} workspaces)...`,
      percent: pct,
      phase: "scanning",
    });

    const { scanId: apiScanId } = await startAdminScan(
      connectionId,
      batch.map((ws) => ws.id),
    );

    let status = await getScanStatus(connectionId, apiScanId);
    let attempts = 0;
    while (
      status.status !== "Succeeded" &&
      status.status !== "Failed" &&
      attempts < MAX_POLL_ATTEMPTS
    ) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      status = await getScanStatus(connectionId, apiScanId);
      attempts++;
    }

    if (status.status === "Failed") {
      throw new Error(`Admin scan batch failed: ${status.error ?? "unknown"}`);
    }

    const result = await getScanResult(connectionId, apiScanId);
    const parsed = parseAdminScanResult(result);
    allResults.workspaces.push(...parsed.workspaces);
    allResults.datasets.push(...parsed.datasets);
    allResults.reports.push(...parsed.reports);
    allResults.artifacts.push(...parsed.artifacts);
    allResults.measureCount += parsed.measureCount;
  }

  await persistResults(scanId, allResults);
}

// ---------------------------------------------------------------------------
// Per-Workspace flow
// ---------------------------------------------------------------------------

async function runWorkspaceScan(
  scanId: string,
  connectionId: string,
  workspaceFilter?: string[],
): Promise<void> {
  setScanProgress(scanId, { message: "Listing workspaces...", percent: 15, phase: "workspaces" });
  const allWorkspaces = await listWorkspaces(connectionId, "workspace", workspaceFilter);

  await updateFabricScan(scanId, { status: "scanning", workspaceCount: allWorkspaces.length });

  const wsEntities: FabricWorkspace[] = allWorkspaces.map((ws) => ({
    id: "",
    workspaceId: ws.id,
    name: ws.name,
    state: ws.state ?? null,
    type: ws.type ?? null,
  }));

  const allDatasets: FabricDataset[] = [];
  const allReports: FabricReport[] = [];
  let measureCount = 0;

  for (let i = 0; i < allWorkspaces.length; i++) {
    const ws = allWorkspaces[i];
    const pct = 20 + Math.floor((i / allWorkspaces.length) * 60);
    setScanProgress(scanId, {
      message: `Scanning workspace ${i + 1}/${allWorkspaces.length}: ${ws.name}`,
      percent: pct,
      phase: "scanning",
    });

    const [rawDatasets, rawReports, rawDashboards] = await Promise.all([
      getWorkspaceDatasets(connectionId, ws.id),
      getWorkspaceReports(connectionId, ws.id),
      getWorkspaceDashboards(connectionId, ws.id),
    ]);

    const datasets = parseWorkspaceDatasets(rawDatasets, ws.id);
    const reports = parseWorkspaceReports(rawReports, ws.id);
    const dashboards = parseWorkspaceDashboards(rawDashboards, ws.id);
    allDatasets.push(...datasets);
    allReports.push(...reports, ...dashboards);
    measureCount += datasets.reduce((sum, ds) => sum + ds.measures.length, 0);
  }

  await persistResults(scanId, {
    workspaces: wsEntities,
    datasets: allDatasets,
    reports: allReports,
    artifacts: [],
    measureCount,
  });
}

// ---------------------------------------------------------------------------
// Fixture flow
// ---------------------------------------------------------------------------

async function runWithFixtures(scanId: string): Promise<void> {
  setScanProgress(scanId, { message: "Loading fixtures...", percent: 30, phase: "fixtures" });
  await new Promise((r) => setTimeout(r, 500));

  const parsed = parseAdminScanResult(MOCK_ADMIN_SCAN_RESULT);
  await persistResults(scanId, {
    ...parsed,
    workspaces: MOCK_WORKSPACES.map((ws) => ({
      id: "",
      workspaceId: ws.id,
      name: ws.name,
      state: ws.state ?? null,
      type: ws.type ?? null,
    })),
  });
}

// ---------------------------------------------------------------------------
// Shared persist
// ---------------------------------------------------------------------------

async function persistResults(
  scanId: string,
  data: {
    workspaces: FabricWorkspace[];
    datasets: FabricDataset[];
    reports: FabricReport[];
    artifacts: FabricArtifact[];
    measureCount: number;
  },
): Promise<void> {
  setScanProgress(scanId, { message: "Saving results...", percent: 85, phase: "persisting" });

  await insertScanWorkspaces(scanId, data.workspaces);
  await insertScanDatasets(scanId, data.datasets);
  await insertScanReports(scanId, data.reports);
  await insertScanArtifacts(scanId, data.artifacts);

  await updateFabricScan(scanId, {
    status: "completed",
    workspaceCount: data.workspaces.length,
    datasetCount: data.datasets.length,
    reportCount: data.reports.length,
    measureCount: data.measureCount,
    artifactCount: data.artifacts.length,
    completedAt: new Date(),
  });

  setScanProgress(scanId, {
    status: "completed",
    message: `Scan complete: ${data.workspaces.length} workspaces, ${data.datasets.length} datasets, ${data.reports.length} reports`,
    percent: 100,
    phase: "done",
  });
}

// ---------------------------------------------------------------------------
// Embedding: generate Ask Forge embeddings for the completed scan
// ---------------------------------------------------------------------------

function transformFabricDetailForEmbedding(
  detail: FabricScanDetail,
): Parameters<typeof embedFabricScan>[1] {
  const wsNameMap = new Map(detail.workspaces.map((ws) => [ws.workspaceId, ws.name]));

  return {
    datasets: detail.datasets.map((ds) => ({
      datasetId: ds.datasetId,
      name: ds.name,
      workspaceName: wsNameMap.get(ds.workspaceId),
      tables: [
        ...ds.tables.map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
          measures: (t.measures ?? []).map((m) => ({
            name: m.name,
            expression: m.expression,
            description: m.description,
          })),
        })),
        ...(ds.measures.length > 0
          ? [
              {
                name: ds.name,
                columns: [] as Array<{ name: string; dataType: string }>,
                measures: ds.measures.map((m) => ({
                  name: m.name,
                  expression: m.expression,
                  description: m.description,
                })),
              },
            ]
          : []),
      ],
      relationships: ds.relationships.map((r) => ({
        fromTable: r.fromTable,
        fromColumn: r.fromColumn,
        toTable: r.toTable,
        toColumn: r.toColumn,
      })),
      sensitivityLabel: ds.sensitivityLabel,
    })),
    reports: detail.reports.map((r) => ({
      reportId: r.reportId,
      name: r.name,
      reportType: r.reportType,
      datasetName: detail.datasets.find((ds) => ds.datasetId === r.datasetId)?.name,
      workspaceName: wsNameMap.get(r.workspaceId),
      tiles: r.tiles.map((t) => ({ title: t.title })),
      sensitivityLabel: r.sensitivityLabel,
    })),
    artifacts: detail.artifacts.map((a) => ({
      artifactId: a.artifactId,
      name: a.name,
      artifactType: a.artifactType,
      workspaceName: wsNameMap.get(a.workspaceId),
      metadata: a.metadata,
    })),
  };
}

async function embedScanForAskForge(scanId: string): Promise<void> {
  try {
    const { getFabricScanDetail } = await import("@/lib/lakebase/fabric-scans");
    const detail = await getFabricScanDetail(scanId);
    if (!detail) return;

    await deleteEmbeddingsByScan(scanId);

    const data = transformFabricDetailForEmbedding(detail);
    await embedFabricScan(scanId, data);

    logger.info("[fabric-scan] Embeddings generated for scan", { scanId });
  } catch (err) {
    logger.warn("[fabric-scan] Embedding generation failed (non-fatal)", {
      scanId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
