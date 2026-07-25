import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listDashboards: vi.fn(),
  deployLifecycle: vi.fn(),
  buildDashboard: vi.fn(),
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
  DEFAULT_DASHBOARD_PARENT_PATH: "/Shared/Forge Dashboards/",
}));
vi.mock("@/lib/dashboard/deploy-lifecycle", () => ({
  deployDashboardDraftAndVerify: mocks.deployLifecycle,
  dashboardDeployDependencies: {},
}));
vi.mock("@/lib/engines/waf-assessment/dashboard/builder", () => ({
  WAF_DASHBOARD_DISPLAY_NAME: "Forge WAF Assessment",
  buildWafDashboardJson: mocks.buildDashboard,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    email: "waf-user@example.com",
  });
  mocks.listDashboards.mockResolvedValue([]);
  mocks.buildDashboard.mockResolvedValue('{"datasets":[],"pages":[]}');
  mocks.deployLifecycle.mockResolvedValue({
    dashboardId: "waf-dash-1",
    displayName: "Forge WAF Assessment",
    action: "created",
    publicationStatus: "draft",
    readBack: { datasetCount: 0, widgetCount: 0, contractOk: true },
    evidence: [],
  });
});

describe("WAF dashboard lifecycle route", () => {
  it("creates an app-owned verified draft after user authorization with server parent path", async () => {
    const response = await POST(
      new Request("http://localhost/api/assessment/dashboard", {
        method: "POST",
        body: JSON.stringify({ parentPath: "/Users/attacker" }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).toHaveBeenCalledWith(
      {
        mode: "create",
        dashboardId: undefined,
        displayName: "Forge WAF Assessment",
        serializedDashboard: '{"datasets":[],"pages":[]}',
        warehouseId: "warehouse-1",
        parentPath: "/Shared/Forge Dashboards/",
        publish: false,
        embedCredentials: false,
        auth: { mode: "app" },
      },
      {},
    );
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
    mocks.deployLifecycle.mockRejectedValueOnce(new Error("update denied"));

    const response = await POST(
      new Request("http://localhost/api/assessment/dashboard", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
    );

    expect(response.status).toBe(500);
    expect(mocks.deployLifecycle).toHaveBeenCalledOnce();
    expect(mocks.deployLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "update", dashboardId: "existing-waf" }),
      {},
    );
  });

  it("returns retained draft details when explicit publication fails", async () => {
    mocks.deployLifecycle.mockResolvedValueOnce({
      dashboardId: "waf-dash-1",
      displayName: "Forge WAF Assessment",
      action: "created",
      publicationStatus: "publish_failed",
      readBack: { datasetCount: 0, widgetCount: 0, contractOk: true },
      evidence: [
        {
          stage: "dashboard_publication",
          status: "failed",
          code: "DASHBOARD_PUBLICATION_FAILED",
          message: "published state missing",
        },
      ],
      publishError: "published state missing",
    });

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
