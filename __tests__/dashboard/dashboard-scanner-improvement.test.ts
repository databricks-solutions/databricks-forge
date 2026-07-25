import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";
import { assembleLakeviewDashboard } from "@/lib/dashboard/assembler";
import { fingerprintSerializedDashboard } from "@/lib/dashboard/live-artifact";

const mocks = vi.hoisted(() => ({
  listTracked: vi.fn(),
  getRecommendations: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@/lib/lakebase/dashboards", () => ({
  listOwnedTrackedDashboardsByIds: mocks.listTracked,
}));
vi.mock("@/lib/lakebase/dashboard-recommendations", () => ({
  getDashboardRecommendationsByRunId: mocks.getRecommendations,
}));
vi.mock("@/lib/dbx/dashboards", () => ({ getDashboard: mocks.getDashboard }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  enrichDiscoveredDashboardsWithDesigns,
  invertTrustedDashboardDesign,
} from "@/lib/dashboard/existing-designs";

const design: DashboardDesignV2 = {
  version: "2",
  title: "Sales",
  description: "",
  datasets: [],
  pages: [],
  globalFilters: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTracked.mockResolvedValue([]);
  mocks.getRecommendations.mockResolvedValue([]);
  mocks.getDashboard.mockRejectedValue(new Error("not found"));
});

describe("dashboard improvement discovery", () => {
  it("binds owner-scoped tracked designs to the exact discovered dashboard ID", async () => {
    mocks.listTracked.mockResolvedValue([
      {
        dashboardId: "tracked",
        runId: "source-run",
        domain: "Sales",
        ownerEmail: "owner@example.com",
      },
    ]);
    mocks.getRecommendations.mockResolvedValue([{ domain: "Sales", dashboardDesign: design }]);
    mocks.getDashboard.mockResolvedValue({
      dashboard_id: "tracked",
      display_name: "Tracked",
      serialized_dashboard: JSON.stringify(assembleLakeviewDashboard(design)),
    });

    const [result] = await enrichDiscoveredDashboardsWithDesigns(
      [
        {
          dashboardId: "tracked",
          displayName: "Tracked",
          tables: [],
          isPublished: false,
          datasetCount: 0,
          widgetCount: 0,
        },
      ],
      "owner@example.com",
      "obo-token",
    );

    expect(mocks.listTracked).toHaveBeenCalledWith(["tracked"], "owner@example.com");
    expect(result.dashboardDesign).toEqual(design);
    expect(result.liveSerializedFingerprint).toBe(
      fingerprintSerializedDashboard(assembleLakeviewDashboard(design)),
    );
    expect(mocks.getDashboard).toHaveBeenCalledWith("tracked", {
      mode: "user",
      oboToken: "obo-token",
    });
  });

  it("uses OBO live details only when a trustworthy embedded V2 design exists", async () => {
    mocks.getDashboard.mockResolvedValue({
      dashboard_id: "external",
      display_name: "External",
      serialized_dashboard: JSON.stringify({
        ...assembleLakeviewDashboard(design),
        forgeDesignV2: design,
      }),
    });

    const [result] = await enrichDiscoveredDashboardsWithDesigns(
      [
        {
          dashboardId: "external",
          displayName: "External",
          tables: [],
          isPublished: false,
          datasetCount: 0,
          widgetCount: 0,
        },
      ],
      "owner@example.com",
      "obo-token",
    );

    expect(mocks.getDashboard).toHaveBeenCalledWith("external", {
      mode: "user",
      oboToken: "obo-token",
    });
    expect(result.dashboardDesign).toEqual(design);
  });

  it("fails closed per external asset without blocking tracked assets", async () => {
    mocks.listTracked.mockResolvedValue([
      { dashboardId: "tracked", runId: "source-run", domain: "Sales" },
    ]);
    mocks.getRecommendations.mockResolvedValue([{ domain: "Sales", dashboardDesign: design }]);
    mocks.getDashboard.mockImplementation(async (dashboardId: string) =>
      dashboardId === "tracked"
        ? {
            dashboard_id: "tracked",
            display_name: "Tracked",
            serialized_dashboard: JSON.stringify(assembleLakeviewDashboard(design)),
          }
        : {
            dashboard_id: "external",
            display_name: "External",
            serialized_dashboard: JSON.stringify({ datasets: [], pages: [] }),
          },
    );

    const results = await enrichDiscoveredDashboardsWithDesigns(
      [
        {
          dashboardId: "tracked",
          displayName: "Tracked",
          tables: [],
          isPublished: false,
          datasetCount: 0,
          widgetCount: 0,
        },
        {
          dashboardId: "external",
          displayName: "External",
          tables: [],
          isPublished: false,
          datasetCount: 0,
          widgetCount: 0,
        },
      ],
      "owner@example.com",
      "obo-token",
    );

    expect(results).toHaveLength(1);
    expect(results[0].dashboardDesign).toEqual(design);
    expect(invertTrustedDashboardDesign('{"forgeDesignV2":{"version":"3"}}')).toBeNull();
  });

  it("rejects a tracked recommendation that was never deployed or is stale", async () => {
    mocks.listTracked.mockResolvedValue([
      { dashboardId: "tracked", runId: "source-run", domain: "Sales" },
    ]);
    mocks.getRecommendations.mockResolvedValue([{ domain: "Sales", dashboardDesign: design }]);
    mocks.getDashboard.mockResolvedValue({
      dashboard_id: "tracked",
      display_name: "Tracked",
      serialized_dashboard: JSON.stringify({
        datasets: [{ name: "external_edit", displayName: "Edit", queryLines: ["SELECT 1 "] }],
        pages: [],
      }),
    });

    const results = await enrichDiscoveredDashboardsWithDesigns(
      [
        {
          dashboardId: "tracked",
          displayName: "Tracked",
          tables: [],
          isPublished: false,
          datasetCount: 1,
          widgetCount: 0,
        },
      ],
      "owner@example.com",
      "obo-token",
    );

    expect(results).toEqual([]);
  });

  it("rejects a missing live dashboard without blocking discovery", async () => {
    mocks.listTracked.mockResolvedValue([
      { dashboardId: "missing", runId: "source-run", domain: "Sales" },
    ]);
    mocks.getRecommendations.mockResolvedValue([{ domain: "Sales", dashboardDesign: design }]);
    mocks.getDashboard.mockRejectedValue(new Error("RESOURCE_DOES_NOT_EXIST"));

    const results = await enrichDiscoveredDashboardsWithDesigns(
      [
        {
          dashboardId: "missing",
          displayName: "Missing",
          tables: [],
          isPublished: false,
          datasetCount: 0,
          widgetCount: 0,
        },
      ],
      "owner@example.com",
      "obo-token",
    );

    expect(results).toEqual([]);
  });
});
