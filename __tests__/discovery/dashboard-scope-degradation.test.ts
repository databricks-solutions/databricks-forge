import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDashboards: vi.fn(),
  listDashboardsAsUser: vi.fn(),
  getDashboardAsApp: vi.fn(),
}));

vi.mock("@/lib/dbx/dashboards", () => ({
  listDashboards: mocks.listDashboards,
  listDashboardsAsUser: mocks.listDashboardsAsUser,
  getDashboardAsApp: mocks.getDashboardAsApp,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { scanDashboards } from "@/lib/discovery/dashboard-scanner";

describe("dashboard discovery scope degradation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDashboards.mockRejectedValue(new Error("service principal must not be used"));
    mocks.listDashboardsAsUser.mockRejectedValue(
      Object.assign(new Error("unsupported"), {
        name: "DashboardScopeUnsupportedError",
        code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
        status: 403,
        requiredScope: "dashboards",
      }),
    );
  });

  it("uses only OBO discovery and omits unverified dashboards on missing scope", async () => {
    await expect(scanDashboards(undefined, "request-obo-token")).resolves.toEqual([]);

    expect(mocks.listDashboardsAsUser).toHaveBeenCalledWith("request-obo-token");
    expect(mocks.listDashboards).not.toHaveBeenCalled();
    expect(mocks.getDashboardAsApp).not.toHaveBeenCalled();
  });

  it("omits dashboard discovery entirely when no OBO token is available", async () => {
    await expect(scanDashboards()).resolves.toEqual([]);

    expect(mocks.listDashboardsAsUser).not.toHaveBeenCalled();
    expect(mocks.listDashboards).not.toHaveBeenCalled();
    expect(mocks.getDashboardAsApp).not.toHaveBeenCalled();
  });
});
