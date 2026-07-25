/**
 * Microsoft Fabric / Power BI REST API client.
 *
 * Supports two strategies per connection (one per connection, OR not AND):
 *   - Admin Scanner: full tenant scan via /admin/workspaces/* APIs
 *   - Per-Workspace: standard /v1.0/myorg/groups/* APIs (no admin needed)
 *
 * Token lifecycle is managed by token-manager.ts. Every request function
 * accepts a `connectionId` and resolves a valid token transparently.
 *
 * HTTP helpers include:
 *   - Single-retry on 401 (invalidate + re-acquire token)
 *   - Exponential backoff on 429 with Retry-After support
 *   - OData pagination via pbiGetPaginated()
 */

import { logger } from "@/lib/logger";
import { getToken, invalidateToken } from "./token-manager";

const PBI_API_BASE = "https://api.powerbi.com/v1.0/myorg";

const MAX_429_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

// ---------------------------------------------------------------------------
// Legacy token acquisition (kept for connection-test route which has no
// connectionId context yet — it uses raw credentials directly)
// ---------------------------------------------------------------------------

const ENTRA_TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const PBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";

export async function acquireToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: PBI_SCOPE,
  });

  const res = await fetch(ENTRA_TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error("[fabric] Token acquisition failed", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(`Entra ID token acquisition failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// HTTP helpers with retry (401 + 429)
// ---------------------------------------------------------------------------

async function pbiGet(url: string, connectionId: string): Promise<unknown> {
  return pbiRequest(url, connectionId, "GET");
}

async function pbiPost(url: string, connectionId: string, body: unknown): Promise<unknown> {
  return pbiRequest(url, connectionId, "POST", body);
}

async function pbiRequest(
  url: string,
  connectionId: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  let token = await getToken(connectionId);

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (method === "POST") headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.ok) return res.json();

    if (res.status === 401 && attempt === 0) {
      logger.warn("[fabric] 401 received — refreshing token", { url });
      invalidateToken(connectionId);
      token = await getToken(connectionId);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      const delay = retryAfter ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
      logger.warn("[fabric] 429 rate-limited — backing off", {
        url,
        attempt,
        delayMs: delay,
      });
      await sleep(delay);
      continue;
    }

    const text = await res.text();
    logger.error("[fabric] API request failed", {
      url,
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(`Power BI API error (${res.status}): ${text.slice(0, 200)}`);
  }

  throw new Error(`Power BI API: max retries exceeded for ${url}`);
}

/**
 * Follows OData `@odata.nextLink` pagination, collecting all `value` arrays.
 */
async function pbiGetPaginated<T>(url: string, connectionId: string): Promise<T[]> {
  const all: T[] = [];
  let next: string | null = url;

  while (next) {
    const data = (await pbiGet(next, connectionId)) as {
      value: T[];
      "@odata.nextLink"?: string;
    };
    all.push(...(data.value ?? []));
    next = data["@odata.nextLink"] ?? null;
  }

  return all;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Workspace listing
// ---------------------------------------------------------------------------

export interface FabricWorkspaceSummary {
  id: string;
  name: string;
  state?: string;
  type?: string;
}

export async function listWorkspaces(
  connectionId: string,
  accessLevel: "admin" | "workspace",
  workspaceFilter?: string[],
): Promise<FabricWorkspaceSummary[]> {
  if (accessLevel === "admin") {
    return listWorkspacesAdmin(connectionId);
  }
  return listWorkspacesStandard(connectionId, workspaceFilter);
}

async function listWorkspacesAdmin(connectionId: string): Promise<FabricWorkspaceSummary[]> {
  type WsRow = { id: string; name: string; state: string; type: string };
  const rows = await pbiGetPaginated<WsRow>(`${PBI_API_BASE}/admin/groups?$top=5000`, connectionId);
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    state: g.state,
    type: g.type,
  }));
}

async function listWorkspacesStandard(
  connectionId: string,
  filter?: string[],
): Promise<FabricWorkspaceSummary[]> {
  type WsRow = { id: string; name: string; state: string; type: string };
  const rows = await pbiGetPaginated<WsRow>(`${PBI_API_BASE}/groups`, connectionId);
  let workspaces = rows.map((g) => ({
    id: g.id,
    name: g.name,
    state: g.state,
    type: g.type,
  }));
  if (filter?.length) {
    const filterSet = new Set(filter);
    workspaces = workspaces.filter((w) => filterSet.has(w.id));
  }
  return workspaces;
}

// ---------------------------------------------------------------------------
// Modified workspaces (incremental scan)
// ---------------------------------------------------------------------------

/**
 * Returns workspace IDs modified since the given timestamp.
 * Only available on the admin path; per-workspace connections
 * skip this and always do full scans.
 */
export async function getModifiedWorkspaces(
  connectionId: string,
  modifiedSince: Date,
): Promise<string[]> {
  const iso = modifiedSince.toISOString();
  const data = (await pbiGet(
    `${PBI_API_BASE}/admin/workspaces/modified?modifiedSince=${encodeURIComponent(iso)}`,
    connectionId,
  )) as Array<{ id: string }>;
  return (data ?? []).map((w) => w.id);
}

// ---------------------------------------------------------------------------
// Admin Scanner API flow
// ---------------------------------------------------------------------------

export interface ScanOptions {
  datasetSchema?: boolean;
  datasetExpressions?: boolean;
  datasourceDetails?: boolean;
  lineage?: boolean;
  getArtifactUsers?: boolean;
}

const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  datasetSchema: true,
  datasetExpressions: true,
  datasourceDetails: true,
  lineage: true,
  getArtifactUsers: true,
};

export async function startAdminScan(
  connectionId: string,
  workspaceIds: string[],
  options: ScanOptions = DEFAULT_SCAN_OPTIONS,
): Promise<{ scanId: string }> {
  const params = new URLSearchParams();
  if (options.datasetSchema) params.set("datasetSchema", "true");
  if (options.datasetExpressions) params.set("datasetExpressions", "true");
  if (options.datasourceDetails) params.set("datasourceDetails", "true");
  if (options.lineage) params.set("lineage", "true");
  if (options.getArtifactUsers) params.set("getArtifactUsers", "true");

  const url = `${PBI_API_BASE}/admin/workspaces/getInfo?${params.toString()}`;
  const data = (await pbiPost(url, connectionId, {
    workspaces: workspaceIds.map((id) => ({ id })),
  })) as { id: string };

  return { scanId: data.id };
}

export type ScanStatus = "NotStarted" | "Running" | "Succeeded" | "Failed";

export async function getScanStatus(
  connectionId: string,
  scanId: string,
): Promise<{ status: ScanStatus; error?: string }> {
  const data = (await pbiGet(
    `${PBI_API_BASE}/admin/workspaces/scanStatus/${scanId}`,
    connectionId,
  )) as { status: ScanStatus; error?: string };
  return { status: data.status, error: data.error };
}

export async function getScanResult(
  connectionId: string,
  scanId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  return pbiGet(
    `${PBI_API_BASE}/admin/workspaces/scanResult/${scanId}`,
    connectionId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as Promise<Record<string, any>>;
}

// ---------------------------------------------------------------------------
// Per-Workspace APIs (standard, no admin)
// ---------------------------------------------------------------------------

export async function getWorkspaceDatasets(
  connectionId: string,
  groupId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  return pbiGetPaginated(`${PBI_API_BASE}/groups/${groupId}/datasets`, connectionId);
}

export async function getWorkspaceReports(
  connectionId: string,
  groupId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  return pbiGetPaginated(`${PBI_API_BASE}/groups/${groupId}/reports`, connectionId);
}

export async function getWorkspaceDashboards(
  connectionId: string,
  groupId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  return pbiGetPaginated(`${PBI_API_BASE}/groups/${groupId}/dashboards`, connectionId);
}

// ---------------------------------------------------------------------------
// Token-free overloads for connection test (raw credentials, no connectionId)
// ---------------------------------------------------------------------------

/**
 * List workspaces using a raw bearer token (for the connection-test route
 * which doesn't yet have a persisted connectionId context).
 */
export async function listWorkspacesWithToken(
  token: string,
  accessLevel: "admin" | "workspace",
  workspaceFilter?: string[],
): Promise<FabricWorkspaceSummary[]> {
  type WsRow = { id: string; name: string; state: string; type: string };
  const url =
    accessLevel === "admin" ? `${PBI_API_BASE}/admin/groups?$top=5000` : `${PBI_API_BASE}/groups`;

  const all: WsRow[] = [];
  let next: string | null = url;
  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Power BI API error (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      value: WsRow[];
      "@odata.nextLink"?: string;
    };
    all.push(...(data.value ?? []));
    next = data["@odata.nextLink"] ?? null;
  }

  let workspaces = all.map((g) => ({
    id: g.id,
    name: g.name,
    state: g.state,
    type: g.type,
  }));
  if (workspaceFilter?.length) {
    const filterSet = new Set(workspaceFilter);
    workspaces = workspaces.filter((w) => filterSet.has(w.id));
  }
  return workspaces;
}
