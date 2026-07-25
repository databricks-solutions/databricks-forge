/**
 * Databricks Lakeview Dashboards REST API client.
 *
 * Follows the same pattern as genie.ts: uses getConfig() for host,
 * getAppHeaders() for auth, fetchWithTimeout with TIMEOUTS.WORKSPACE.
 *
 * API docs: https://docs.databricks.com/api/workspace/lakeview
 */

import { getConfig, getAppHeaders } from "./client";
import { fetchWithTimeout, TIMEOUTS } from "./fetch-with-timeout";
import { logger } from "@/lib/logger";
import type {
  LakeviewDashboardResponse,
  LakeviewPublishedDashboardResponse,
} from "@/lib/dashboard/types";
import { dashboardApiError, type DashboardAuthMode } from "./dashboard-capability";

export const DEFAULT_DASHBOARD_PARENT_PATH = "/Shared/Forge Dashboards/";

export type DashboardAuth = { mode: "user"; oboToken: string } | { mode: "app"; oboToken?: never };

async function resolveHeaders(auth: DashboardAuth): Promise<Record<string, string>> {
  if (auth.mode === "app") {
    return getAppHeaders();
  }
  if (!auth.oboToken) {
    throw new Error("An OBO token is required for user-owned dashboard operations");
  }
  return {
    Authorization: `Bearer ${auth.oboToken}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface DashboardListItem {
  dashboard_id: string;
  display_name: string;
  path?: string;
  parent_path?: string;
  lifecycle_state?: string;
  create_time?: string;
  update_time?: string;
  warehouse_id?: string;
  creator_user_name?: string;
  serialized_dashboard?: string;
}

interface DashboardListResponse {
  dashboards?: DashboardListItem[];
  next_page_token?: string;
}

/**
 * List all Lakeview (AI/BI) dashboards in the workspace.
 * Paginates automatically, returning all non-trashed dashboards.
 */
async function listDashboardsWithHeaders(
  headers: Record<string, string>,
  pageSize: number,
  authMode: DashboardAuthMode,
): Promise<DashboardListItem[]> {
  const config = getConfig();
  const all: DashboardListItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) params.set("page_token", pageToken);

    const url = `${config.host}/api/2.0/lakeview/dashboards?${params}`;
    const response = await fetchWithTimeout(url, { method: "GET", headers }, TIMEOUTS.WORKSPACE);

    if (!response.ok) {
      const text = await response.text();
      throw dashboardApiError(response.status, text, "list dashboards", authMode);
    }

    const data = (await response.json()) as DashboardListResponse;
    if (data.dashboards) {
      for (const d of data.dashboards) {
        if (d.lifecycle_state !== "TRASHED") {
          all.push(d);
        }
      }
    }
    pageToken = data.next_page_token;
  } while (pageToken);

  return all;
}

/** App-owned listing for workspace-shared Forge assets only. */
export async function listDashboards(pageSize = 100): Promise<DashboardListItem[]> {
  return listDashboardsWithHeaders(await getAppHeaders(), pageSize, "app");
}

/** User-owned/external listing. Never falls back to app credentials. */
export async function listDashboardsAsUser(
  oboToken: string,
  pageSize = 100,
): Promise<DashboardListItem[]> {
  return listDashboardsWithHeaders(
    await resolveHeaders({ mode: "user", oboToken }),
    pageSize,
    "user",
  );
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

export async function getDashboard(
  dashboardId: string,
  auth: DashboardAuth,
): Promise<LakeviewDashboardResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards/${dashboardId}`;
  const headers = await resolveHeaders(auth);

  const response = await fetchWithTimeout(url, { method: "GET", headers }, TIMEOUTS.WORKSPACE);

  if (!response.ok) {
    const text = await response.text();
    throw dashboardApiError(response.status, text, "get dashboard", auth.mode);
  }

  return (await response.json()) as LakeviewDashboardResponse;
}

/** App-owned read used only by workspace-wide discovery jobs. */
export async function getDashboardAsApp(dashboardId: string): Promise<LakeviewDashboardResponse> {
  return getDashboard(dashboardId, { mode: "app" });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDashboard(opts: {
  displayName: string;
  serializedDashboard: string;
  warehouseId: string;
  parentPath?: string;
  auth: DashboardAuth;
}): Promise<LakeviewDashboardResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards`;
  const headers = await resolveHeaders(opts.auth);

  const parentPath = opts.parentPath ?? DEFAULT_DASHBOARD_PARENT_PATH;

  const body = {
    display_name: opts.displayName,
    serialized_dashboard: opts.serializedDashboard,
    warehouse_id: opts.warehouseId,
    parent_path: parentPath,
  };

  const response = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("RESOURCE_ALREADY_EXISTS")) {
      return await createDashboardWithSuffix(
        url,
        headers,
        body,
        opts.displayName,
        2,
        opts.auth.mode,
      );
    }
    throw dashboardApiError(response.status, text, "create dashboard", opts.auth.mode);
  }

  return (await response.json()) as LakeviewDashboardResponse;
}

const MAX_SUFFIX_ATTEMPTS = 5;

async function createDashboardWithSuffix(
  url: string,
  headers: HeadersInit,
  body: Record<string, string>,
  baseName: string,
  startSuffix: number,
  authMode: DashboardAuthMode,
): Promise<LakeviewDashboardResponse> {
  for (let suffix = startSuffix; suffix < startSuffix + MAX_SUFFIX_ATTEMPTS; suffix++) {
    const suffixedName = `${baseName} (${suffix})`;
    body.display_name = suffixedName;
    const retryResponse = await fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      TIMEOUTS.WORKSPACE,
    );
    if (retryResponse.ok) {
      logger.info("Dashboard created with suffixed name", { name: suffixedName });
      return (await retryResponse.json()) as LakeviewDashboardResponse;
    }
    const retryText = await retryResponse.text();
    if (!retryText.includes("RESOURCE_ALREADY_EXISTS")) {
      throw dashboardApiError(retryResponse.status, retryText, "create dashboard", authMode);
    }
    logger.warn("Dashboard name still exists, trying next suffix", { name: suffixedName });
  }
  throw new Error(
    `Dashboard "${baseName}" already exists and all suffix attempts (2–${startSuffix + MAX_SUFFIX_ATTEMPTS - 1}) failed`,
  );
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateDashboard(
  dashboardId: string,
  opts: {
    displayName?: string;
    serializedDashboard?: string;
    warehouseId?: string;
    auth: DashboardAuth;
  },
): Promise<LakeviewDashboardResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards/${dashboardId}`;
  const headers = await resolveHeaders(opts.auth);

  const body: Record<string, string> = {};
  if (opts.displayName !== undefined) body.display_name = opts.displayName;
  if (opts.serializedDashboard !== undefined) body.serialized_dashboard = opts.serializedDashboard;
  if (opts.warehouseId !== undefined) body.warehouse_id = opts.warehouseId;

  const response = await fetchWithTimeout(
    url,
    { method: "PATCH", headers, body: JSON.stringify(body) },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    throw dashboardApiError(response.status, text, "update dashboard", opts.auth.mode);
  }

  return (await response.json()) as LakeviewDashboardResponse;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function publishDashboard(
  dashboardId: string,
  warehouseId: string,
  embedCredentials: boolean,
  auth: DashboardAuth,
): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards/${dashboardId}/published`;
  const headers = await resolveHeaders(auth);

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        warehouse_id: warehouseId,
        embed_credentials: embedCredentials,
      }),
    },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    throw dashboardApiError(response.status, text, "publish dashboard", auth.mode);
  }
}

export async function getPublishedDashboard(
  dashboardId: string,
  auth: DashboardAuth,
): Promise<LakeviewPublishedDashboardResponse | null> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards/${dashboardId}/published`;
  const headers = await resolveHeaders(auth);
  const response = await fetchWithTimeout(url, { method: "GET", headers }, TIMEOUTS.WORKSPACE);

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw dashboardApiError(response.status, text, "get published dashboard", auth.mode);
  }

  const published = (await response.json()) as Omit<
    LakeviewPublishedDashboardResponse,
    "dashboard_id"
  >;
  return { dashboard_id: dashboardId, ...published };
}

// ---------------------------------------------------------------------------
// Unpublish
// ---------------------------------------------------------------------------

export async function unpublishDashboard(dashboardId: string): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards/${dashboardId}/published`;
  const headers = await getAppHeaders();

  const response = await fetchWithTimeout(url, { method: "DELETE", headers }, TIMEOUTS.WORKSPACE);

  if (!response.ok) {
    const text = await response.text();
    if (response.status !== 404) {
      throw new Error(`Lakeview unpublish dashboard failed (${response.status}): ${text}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Trash (soft delete)
// ---------------------------------------------------------------------------

export async function trashDashboard(dashboardId: string): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/lakeview/dashboards/${dashboardId}`;
  const headers = await getAppHeaders();

  const response = await fetchWithTimeout(url, { method: "DELETE", headers }, TIMEOUTS.WORKSPACE);

  if (!response.ok) {
    const text = await response.text();
    if (response.status !== 404) {
      throw new Error(`Lakeview trash dashboard failed (${response.status}): ${text}`);
    }
  }
}
