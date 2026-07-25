import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardDraftReadBackDisabledError,
  DashboardMutationUntrackableError,
  DashboardReadBackValidationError,
  deployDashboardDraftAndVerify,
  type DashboardDeployDependencies,
} from "@/lib/dashboard/deploy-lifecycle";

const OBO_TOKEN = "request-obo-token";

function serializedDashboard(title = "Sales"): string {
  return JSON.stringify({
    datasets: [
      {
        name: "sales",
        displayName: "Sales",
        queryLines: ["SELECT 1 AS value"],
      },
    ],
    pages: [
      {
        name: "overview",
        displayName: "Overview",
        pageType: "PAGE_TYPE_CANVAS",
        layoutVersion: "GRID_V1",
        layout: [
          {
            widget: {
              name: "heading",
              multilineTextboxSpec: { lines: [`# ${title}`] },
            },
            position: { x: 0, y: 0, width: 12, height: 1 },
          },
        ],
      },
    ],
  });
}

function dependencies(readBack = serializedDashboard()) {
  const calls: string[] = [];
  const deps: DashboardDeployDependencies = {
    createDashboard: vi.fn(async () => {
      calls.push("create");
      return {
        dashboard_id: "dash-1",
        display_name: "Sales",
        warehouse_id: "warehouse-1",
        parent_path: "/Shared/Forge Dashboards/",
      };
    }),
    updateDashboard: vi.fn(async () => {
      calls.push("update");
      return {
        dashboard_id: "dash-1",
        display_name: "Sales",
        warehouse_id: "warehouse-1",
        parent_path: "/Shared/Forge Dashboards/",
      };
    }),
    getDashboard: vi.fn(async () => {
      calls.push("get");
      return {
        dashboard_id: "dash-1",
        display_name: "Sales",
        warehouse_id: "warehouse-1",
        parent_path: "/Workspace/Shared/Forge Dashboards/",
        serialized_dashboard: readBack,
      };
    }),
    publishDashboard: vi.fn(async () => {
      calls.push("publish");
    }),
    getPublishedDashboard: vi.fn(async () => {
      calls.push("getPublished");
      return {
        dashboard_id: "dash-1",
        display_name: "Sales",
        warehouse_id: "warehouse-1",
        embed_credentials: false,
        revision_create_time: "2026-07-24T08:00:00.000Z",
      };
    }),
  };
  return { deps, calls };
}

describe("deployDashboardDraftAndVerify", () => {
  beforeEach(() => {
    vi.stubEnv("FORGE_DASHBOARD_DRAFT_READBACK", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses an explicit draft-only legacy path while read-back rollout is disabled", async () => {
    vi.stubEnv("FORGE_DASHBOARD_DRAFT_READBACK", "false");
    const { deps, calls } = dependencies();

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard: serializedDashboard(),
        warehouseId: "warehouse-1",
        publish: false,
        auth: { mode: "user", oboToken: OBO_TOKEN },
      },
      deps,
    );

    expect(calls).toEqual(["create"]);
    expect(result).toMatchObject({
      dashboardId: "dash-1",
      publicationStatus: "draft",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: false },
    });
  });

  it("fails closed before mutation when publication requests read-back rollout", async () => {
    vi.stubEnv("FORGE_DASHBOARD_DRAFT_READBACK", "false");
    const { deps } = dependencies();

    const deployment = deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: true,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      );
    await expect(deployment).rejects.toBeInstanceOf(
      DashboardDraftReadBackDisabledError,
    );
    await expect(deployment).rejects.toMatchObject({
      code: "DASHBOARD_DRAFT_READBACK_DISABLED",
    });

    expect(deps.createDashboard).not.toHaveBeenCalled();
    expect(deps.publishDashboard).not.toHaveBeenCalled();
  });

  it("creates a draft, reads it back, validates it, then publishes", async () => {
    const { deps, calls } = dependencies();
    const auth = { mode: "app" } as const;

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard: serializedDashboard(),
        warehouseId: "warehouse-1",
        publish: true,
        auth,
      },
      deps,
    );

    expect(calls).toEqual(["create", "get", "publish", "getPublished"]);
    expect(result).toMatchObject({
      dashboardId: "dash-1",
      action: "created",
      publicationStatus: "published",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
    });
    expect(deps.createDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ auth }),
    );
    expect(deps.getDashboard).toHaveBeenCalledWith("dash-1", auth);
    expect(deps.publishDashboard).toHaveBeenCalledWith("dash-1", "warehouse-1", false, auth);
    expect(deps.getPublishedDashboard).toHaveBeenCalledWith("dash-1", auth);
  });

  it("retains the created draft when read-back is blocked by the unsupported scope", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.getDashboard).mockRejectedValueOnce(
      Object.assign(new Error("Missing required scope: dashboards"), {
        name: "DashboardScopeUnsupportedError",
        code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
        status: 403,
        requiredScope: "dashboards",
        operation: "get dashboard",
      }),
    );

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardScopeUnsupportedError",
      code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
      requiredScope: "dashboards",
      dashboardId: "dash-1",
      displayName: "Sales",
      draftCreated: true,
      publicationStatus: "draft",
      evidence: [
        expect.objectContaining({
          code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
          status: "failed",
        }),
      ],
    });
    expect(deps.createDashboard).toHaveBeenCalledOnce();
    expect(deps.publishDashboard).not.toHaveBeenCalled();
  });

  it("never falls back to create when update fails", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.updateDashboard).mockRejectedValueOnce(new Error("missing draft"));

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "update",
          dashboardId: "dash-1",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toThrow("missing draft");

    expect(deps.updateDashboard).toHaveBeenCalledWith(
      "dash-1",
      expect.objectContaining({
        auth: { mode: "user", oboToken: OBO_TOKEN },
      }),
    );
    expect(deps.createDashboard).not.toHaveBeenCalled();
    expect(deps.getDashboard).not.toHaveBeenCalled();
  });

  it("uses the create mutation's suffixed display name as strict read-back identity", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.createDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-2",
      display_name: "Sales (2)",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    });
    vi.mocked(deps.getDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-2",
      display_name: "Sales (2)",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: serializedDashboard(),
    });

    const result = await deployDashboardDraftAndVerify(
      {
        mode: "create",
        displayName: "Sales",
        serializedDashboard: serializedDashboard(),
        warehouseId: "warehouse-1",
        publish: false,
        auth: { mode: "user", oboToken: OBO_TOKEN },
      },
      deps,
    );

    expect(result).toMatchObject({
      dashboardId: "dash-2",
      displayName: "Sales (2)",
      action: "created",
      publicationStatus: "draft",
    });
  });

  it("rejects a create read-back that differs from the mutation-selected suffix", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.createDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-2",
      display_name: "Sales (2)",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    });
    vi.mocked(deps.getDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-2",
      display_name: "Sales (3)",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: serializedDashboard(),
    });

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DashboardReadBackValidationError);
  });

  it("rejects an update mutation that changes the requested display name", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.updateDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-1",
      display_name: "Sales (2)",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    });

    const deployment = deployDashboardDraftAndVerify(
        {
          mode: "update",
          dashboardId: "dash-1",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      );
    await expect(deployment).rejects.toBeInstanceOf(DashboardReadBackValidationError);
    await expect(deployment).rejects.toMatchObject({
      dashboardId: "dash-1",
      displayName: "Sales (2)",
      message: expect.stringContaining("does not match requested"),
    });
    expect(deps.createDashboard).not.toHaveBeenCalled();
    expect(deps.getDashboard).not.toHaveBeenCalled();
  });

  it("anchors an update response ID mismatch to the expected live target", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.updateDashboard).mockResolvedValueOnce({
      dashboard_id: "unexpected-response-id",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    });

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "update",
          dashboardId: "expected-live-id",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardReadBackValidationError",
      dashboardId: "expected-live-id",
      expectedDashboardId: "expected-live-id",
      observedDashboardId: "unexpected-response-id",
    });
    expect(deps.getDashboard).not.toHaveBeenCalled();
  });

  it("tracks an update with missing response ID using the known expected target", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.updateDashboard).mockResolvedValueOnce({
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    } as never);

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "update",
          dashboardId: "expected-live-id",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardReadBackValidationError",
      dashboardId: "expected-live-id",
      expectedDashboardId: "expected-live-id",
      observedDashboardId: undefined,
    });
    expect(deps.getDashboard).not.toHaveBeenCalled();
  });

  it("retains create draft identity when the mutation response omits display_name", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.createDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-created",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    } as never);

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardReadBackValidationError",
      dashboardId: "dash-created",
      displayName: "Sales",
    });
    expect(deps.getDashboard).not.toHaveBeenCalled();
  });

  it("reports a mutation-observed untrackable failure when response identity is absent", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.createDashboard).mockResolvedValueOnce({
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
    } as never);

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: false,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardMutationUntrackableError",
      code: "DASHBOARD_MUTATION_OBSERVED_UNTRACKABLE",
      mutationObserved: true,
      trackable: false,
    } satisfies Partial<DashboardMutationUntrackableError>);
  });

  it("blocks publication when the read-back contract is invalid", async () => {
    const { deps } = dependencies(JSON.stringify({ datasets: [], pages: [{}] }));

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: true,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardReadBackValidationError",
      dashboardId: "dash-1",
    } satisfies Partial<DashboardReadBackValidationError>);

    expect(deps.publishDashboard).not.toHaveBeenCalled();
  });

  it("rejects a read-back whose dashboard identity changed", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.getDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-other",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: serializedDashboard(),
    });

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: true,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DashboardReadBackValidationError);
    expect(deps.publishDashboard).not.toHaveBeenCalled();
  });

  it("rejects a read-back bound to a different warehouse", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.getDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-1",
      display_name: "Sales",
      warehouse_id: "warehouse-other",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: serializedDashboard(),
    });

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          publish: true,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DashboardReadBackValidationError);
    expect(deps.publishDashboard).not.toHaveBeenCalled();
  });

  it.each(["dashboard_id", "display_name", "warehouse_id", "destination"] as const)(
    "rejects draft read-back missing required %s identity",
    async (missingField) => {
      const { deps } = dependencies();
      const response: Record<string, unknown> = {
        dashboard_id: "dash-1",
        display_name: "Sales",
        warehouse_id: "warehouse-1",
        parent_path: "/Shared/Forge Dashboards/",
        serialized_dashboard: serializedDashboard(),
      };
      if (missingField === "destination") {
        delete response.parent_path;
      } else {
        delete response[missingField];
      }
      vi.mocked(deps.getDashboard).mockResolvedValueOnce(response as never);

      await expect(
        deployDashboardDraftAndVerify(
          {
            mode: "create",
            displayName: "Sales",
            serializedDashboard: serializedDashboard(),
            warehouseId: "warehouse-1",
            publish: true,
            auth: { mode: "user", oboToken: OBO_TOKEN },
          },
          deps,
        ),
      ).rejects.toBeInstanceOf(DashboardReadBackValidationError);
      expect(deps.publishDashboard).not.toHaveBeenCalled();
    },
  );

  it("rejects a normalized destination path outside the server-controlled parent", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.getDashboard).mockResolvedValueOnce({
      dashboard_id: "dash-1",
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      path: "/Workspace/Users/attacker/Sales.lvdash.json",
      serialized_dashboard: serializedDashboard(),
    });

    await expect(
      deployDashboardDraftAndVerify(
        {
          mode: "create",
          displayName: "Sales",
          serializedDashboard: serializedDashboard(),
          warehouseId: "warehouse-1",
          parentPath: "/Shared/Forge Dashboards/",
          publish: true,
          auth: { mode: "user", oboToken: OBO_TOKEN },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DashboardReadBackValidationError);
    expect(deps.publishDashboard).not.toHaveBeenCalled();
  });
});
