import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listDashboards: vi.fn(),
  createDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  getDashboard: vi.fn(),
  publishDashboard: vi.fn(),
  getPublishedDashboard: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth/route-user", () => ({
  requireUser: mocks.requireUser,
  ForgeAuthError: class ForgeAuthError extends Error {
    status = 401;
  },
}));
vi.mock("@/lib/dbx/client", () => ({
  getConfig: vi.fn(() => ({
    host: "https://example.cloud.databricks.com",
    warehouseId: "warehouse-1",
  })),
}));
vi.mock("@/lib/dbx/dashboards", () => ({
  listDashboards: mocks.listDashboards,
  createDashboard: mocks.createDashboard,
  updateDashboard: mocks.updateDashboard,
  getDashboard: mocks.getDashboard,
  publishDashboard: mocks.publishDashboard,
  getPublishedDashboard: mocks.getPublishedDashboard,
  DEFAULT_DASHBOARD_PARENT_PATH: "/Shared/Forge Dashboards/",
}));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/api-utils", () => ({
  handleApiError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    ),
}));

import { POST } from "@/app/api/assessment/dashboard/route";
import { buildWafDashboardJson } from "@/lib/engines/waf-assessment/dashboard/builder";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FORGE_DASHBOARD_DRAFT_READBACK", "false");
  mocks.requireUser.mockResolvedValue({
    email: "waf-user@example.com",
  });
  mocks.listDashboards.mockResolvedValue([]);
  mocks.createDashboard.mockResolvedValue({
    dashboard_id: "waf-dash-1",
    displayName: "Forge WAF Assessment",
    display_name: "Forge WAF Assessment",
    warehouse_id: "warehouse-1",
    parent_path: "/Shared/Forge Dashboards/",
  });
  mocks.updateDashboard.mockResolvedValue({
    dashboard_id: "existing-waf",
    display_name: "Forge WAF Assessment",
    warehouse_id: "warehouse-1",
    parent_path: "/Shared/Forge Dashboards/",
  });
  mocks.publishDashboard.mockResolvedValue(undefined);
  mocks.getPublishedDashboard.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("WAF dashboard lifecycle route", () => {
  it("runs the real WAF builder output through lifecycle pre-validation before creating", async () => {
    const response = await POST(
      new Request("http://localhost/api/assessment/dashboard", {
        method: "POST",
        body: JSON.stringify({ parentPath: "/Users/attacker" }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.createDashboard).toHaveBeenCalledOnce();
    expect(mocks.createDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Forge WAF Assessment",
        warehouseId: "warehouse-1",
        parentPath: "/Shared/Forge Dashboards/",
        auth: { mode: "app" },
      }),
    );
    const serializedDashboard = mocks.createDashboard.mock.calls[0][0].serializedDashboard;
    expect(JSON.parse(serializedDashboard)).toEqual(JSON.parse(await buildWafDashboardJson()));
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      dashboardId: "waf-dash-1",
      publicationStatus: "draft",
    });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "waf_dashboard_generated",
      expect.objectContaining({
        userId: "waf-user@example.com",
        resourceId: "waf-dash-1",
      }),
    );
  });

  it("selects update before mutation and never retries lifecycle as create", async () => {
    mocks.listDashboards.mockResolvedValue([
      {
        dashboard_id: "existing-waf",
        display_name: "Forge WAF Assessment",
        lifecycle_state: "ACTIVE",
      },
    ]);
    mocks.updateDashboard.mockRejectedValueOnce(new Error("update denied"));

    const response = await POST(
      new Request("http://localhost/api/assessment/dashboard", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
    );

    expect(response.status).toBe(500);
    expect(mocks.updateDashboard).toHaveBeenCalledOnce();
    expect(mocks.updateDashboard).toHaveBeenCalledWith(
      "existing-waf",
      expect.objectContaining({ displayName: "Forge WAF Assessment" }),
    );
    expect(mocks.createDashboard).not.toHaveBeenCalled();
  });

  it("returns retained draft details when explicit publication fails", async () => {
    vi.stubEnv("FORGE_DASHBOARD_DRAFT_READBACK", "true");
    const serializedDashboard = await buildWafDashboardJson();
    mocks.getDashboard.mockResolvedValueOnce({
      dashboard_id: "waf-dash-1",
      display_name: "Forge WAF Assessment",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: serializedDashboard,
    });
    mocks.publishDashboard.mockRejectedValueOnce(new Error("published state missing"));

    const response = await POST(
      new Request("http://localhost/api/assessment/dashboard", {
        method: "POST",
        body: JSON.stringify({ publish: true }),
      }) as never,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      dashboardId: "waf-dash-1",
      dashboardUrl: expect.stringContaining("waf-dash-1"),
      publicationStatus: "publish_failed",
      error: "published state missing",
    });
  });
});
