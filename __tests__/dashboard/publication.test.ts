import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deployDashboardDraftAndVerify,
  type DashboardDeployDependencies,
} from "@/lib/dashboard/deploy-lifecycle";

const serializedDashboard = JSON.stringify({
  datasets: [{ name: "sales", displayName: "Sales", queryLines: ["SELECT 1 AS value"] }],
  pages: [
    {
      name: "overview",
      displayName: "Overview",
      pageType: "PAGE_TYPE_CANVAS",
      layoutVersion: "GRID_V1",
      layout: [
        {
          widget: { name: "heading", multilineTextboxSpec: { lines: ["# Sales"] } },
          position: { x: 0, y: 0, width: 12, height: 1 },
        },
      ],
    },
  ],
});

function dependencies(): DashboardDeployDependencies {
  return {
    createDashboard: vi.fn().mockResolvedValue({
      dashboard_id: "dash-1",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    }),
    updateDashboard: vi.fn(),
    getDashboard: vi.fn().mockResolvedValue({
      dashboard_id: "dash-1",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: serializedDashboard,
    }),
    publishDashboard: vi.fn(),
    getPublishedDashboard: vi.fn().mockResolvedValue({
      dashboard_id: "dash-1",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      embed_credentials: false,
      revision_create_time: "2026-07-24T08:00:00.000Z",
    }),
  };
}

describe("dashboard publication", () => {
  beforeEach(() => {
    vi.stubEnv("FORGE_DASHBOARD_DRAFT_READBACK", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps a verified deployment as a draft when publication was not requested", async () => {
    const deps = dependencies();

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: false,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(result.publicationStatus).toBe("draft");
    expect(deps.publishDashboard).not.toHaveBeenCalled();
    expect(deps.getPublishedDashboard).not.toHaveBeenCalled();
  });

  it("retains the draft ID and reports publish_failed without hidden success", async () => {
    const deps = dependencies();
    vi.mocked(deps.publishDashboard).mockRejectedValueOnce(new Error("publish denied"));

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: true,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(result).toMatchObject({
      dashboardId: "dash-1",
      action: "created",
      publicationStatus: "publish_failed",
      publishError: "publish denied",
    });
    expect(deps.getPublishedDashboard).not.toHaveBeenCalled();
  });

  it("defaults embedCredentials to false", async () => {
    const deps = dependencies();

    await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: true,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(deps.publishDashboard).toHaveBeenCalledWith(
      "dash-1",
      "warehouse-1",
      false,
      { mode: "user", oboToken: "obo-token" },
    );
  });

  it("marks published only after observing the matching published dashboard", async () => {
    const deps = dependencies();

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: true,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(result).toMatchObject({
      publicationStatus: "published",
      publishedAt: "2026-07-24T08:00:00.000Z",
      evidence: expect.arrayContaining([
        expect.objectContaining({
          stage: "dashboard_publication",
          status: "passed",
          code: "DASHBOARD_PUBLICATION_VERIFIED",
        }),
      ]),
    });
    expect(deps.getPublishedDashboard).toHaveBeenCalledWith("dash-1", {
      mode: "user",
      oboToken: "obo-token",
    });
  });

  it("reports publish_failed when published state is missing", async () => {
    const deps = dependencies();
    vi.mocked(deps.getPublishedDashboard).mockResolvedValueOnce(null);

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: true,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(result).toMatchObject({
      dashboardId: "dash-1",
      publicationStatus: "publish_failed",
      publishError: expect.stringContaining("missing"),
      evidence: expect.arrayContaining([
        expect.objectContaining({
          stage: "dashboard_publication",
          status: "failed",
          code: "DASHBOARD_PUBLICATION_FAILED",
        }),
      ]),
    });
  });

  it("reports publish_failed when published state identifies another dashboard", async () => {
    const deps = dependencies();
    vi.mocked(deps.getPublishedDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-other",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      embed_credentials: false,
      revision_create_time: "2026-07-24T08:00:00.000Z",
    });

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: true,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(result).toMatchObject({
      dashboardId: "dash-1",
      publicationStatus: "publish_failed",
      publishError: expect.stringContaining("dash-other"),
    });
  });

  it("reports publish_failed when published-state GET fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.getPublishedDashboard).mockRejectedValueOnce(new Error("published GET failed"));

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard,
        warehouseId: "warehouse-1",
        publish: true,
        auth: { mode: "user", oboToken: "obo-token" },
      },
      deps,
    );

    expect(result).toMatchObject({
      dashboardId: "dash-1",
      publicationStatus: "publish_failed",
      publishError: "published GET failed",
    });
  });
});
