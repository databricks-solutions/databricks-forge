import { beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_VALIDATOR_VERSION } from "@/lib/validation/evidence";
import { buildDashboardImproveDiff } from "@/lib/dashboard/improve-diff";
import { assembleLakeviewDashboard } from "@/lib/dashboard/assembler";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";
import { fingerprintSerializedDashboard } from "@/lib/dashboard/live-artifact";

const mocks = vi.hoisted(() => ({
  loadRunOrRespond: vi.fn(),
  getRecommendations: vi.fn(),
  deployLifecycle: vi.fn(),
  listTrackedDashboards: vi.fn(),
  trackCreated: vi.fn(),
  trackUpdated: vi.fn(),
  trackExactUpdate: vi.fn(),
  updateRecommendationPublication: vi.fn(),
  logActivity: vi.fn(),
  getLiveDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadRunOrRespond: mocks.loadRunOrRespond,
}));
vi.mock("@/lib/lakebase/dashboard-recommendations", () => ({
  getDashboardRecommendationsByRunId: mocks.getRecommendations,
  updateDashboardRecommendationPublication: mocks.updateRecommendationPublication,
}));
vi.mock("@/lib/dashboard/deploy-lifecycle", () => {
  class DashboardReadBackValidationError extends Error {
    constructor(
      readonly dashboardId: string,
      readonly displayName: string,
      message: string,
      readonly evidence: unknown[],
      identity?: {
        expectedDashboardId?: string;
        observedDashboardId?: string;
      },
    ) {
      super(message);
      this.expectedDashboardId = identity?.expectedDashboardId;
      this.observedDashboardId = identity?.observedDashboardId;
    }
    readonly expectedDashboardId?: string;
    readonly observedDashboardId?: string;
  }
  class DashboardScopeUnsupportedError extends DashboardReadBackValidationError {
    readonly code = "DASHBOARD_OBO_SCOPE_UNSUPPORTED";
    readonly requiredScope = "dashboards";
    readonly draftCreated = true;
    readonly publicationStatus = "draft";
    constructor(dashboardId: string, displayName: string, evidence: unknown[]) {
      super(dashboardId, displayName, "Lakeview Apps OBO scope unsupported", evidence);
      this.name = "DashboardScopeUnsupportedError";
    }
  }
  return {
    deployDashboardDraftAndVerify: mocks.deployLifecycle,
    dashboardDeployDependencies: {},
    DashboardReadBackValidationError,
    DashboardScopeUnsupportedError,
    DashboardDraftReadBackDisabledError: class DashboardDraftReadBackDisabledError extends Error {
      readonly code = "DASHBOARD_DRAFT_READBACK_DISABLED";
    },
    DashboardMutationUntrackableError: class DashboardMutationUntrackableError extends Error {
      readonly code = "DASHBOARD_MUTATION_OBSERVED_UNTRACKABLE";
      readonly mutationObserved = true;
      readonly trackable = false;
    },
  };
});
vi.mock("@/lib/dbx/dashboards", () => ({
  DEFAULT_DASHBOARD_PARENT_PATH: "/Shared/Forge Dashboards/",
  getDashboard: mocks.getLiveDashboard,
}));
vi.mock("@/lib/lakebase/dashboards", () => ({
  listTrackedDashboards: mocks.listTrackedDashboards,
  trackDashboardCreated: mocks.trackCreated,
  trackDashboardUpdated: mocks.trackUpdated,
  trackExactDashboardUpdate: mocks.trackExactUpdate,
}));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/dbx/client", () => ({
  getConfig: vi.fn(() => ({
    host: "https://example.cloud.databricks.com",
    warehouseId: "warehouse-1",
  })),
}));
vi.mock("@/lib/validation", () => ({ isValidUUID: vi.fn(() => true) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/runs/[runId]/dashboard-engine/[domain]/deploy/route";

const runId = "00000000-0000-4000-8000-000000000001";
const validationEvidence = [
  ["dataset_static", "SCHEMA_ALLOWLIST_VALID"],
  ["dataset_static", "STATIC_LINT_PASSED"],
  ["dataset_review", "LLM_REVIEW_DISABLED", "skipped"],
  ["dataset_explain", "EXPLAIN_PASSED"],
  ["dataset_execution", "SQL_EXECUTION_SUCCEEDED"],
  ["dataset_result", "RESULT_CONTRACT_VALID"],
  ["dashboard_design", "WIDGET_DATASET_REFERENCES_VALID"],
  ["dashboard_contract", DASHBOARD_VALIDATOR_VERSION],
].map(([stage, code, status = "passed"]) => ({
  stage,
  code,
  status,
  message: "ok",
  ...(stage.startsWith("dataset_") && { artifactRef: "dataset:sales" }),
}));
const existingDesign: DashboardDesignV2 = {
  version: "2",
  title: "Sales dashboard",
  description: "Sales",
  datasets: [],
  pages: [{ name: "overview", displayName: "Overview", widgets: [], filters: [] }],
  globalFilters: [],
};
const improvedDesign: DashboardDesignV2 = {
  ...existingDesign,
  datasets: [
    {
      name: "sales",
      displayName: "Sales",
      purpose: "kpi",
      sourceKind: "table",
      metricIds: [],
      dimensionIds: [],
      sql: "SELECT 1 AS value",
      expectedFields: [{ name: "value", roles: ["value"], compatibleTypes: ["numeric"] }],
    },
  ],
};
const improveDiff = buildDashboardImproveDiff(
  "discovered-dashboard",
  existingDesign,
  improvedDesign,
  fingerprintSerializedDashboard(assembleLakeviewDashboard(existingDesign)),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadRunOrRespond.mockResolvedValue({
    ok: true,
    value: { run: { runId, ownerEmail: "run-owner@example.com" } },
    user: { email: "editor@example.com", oboToken: "captured-request-token" },
    permission: "edit",
  });
  mocks.getRecommendations.mockResolvedValue([
    {
      domain: "Sales",
      title: "Sales dashboard",
      datasetCount: 1,
      widgetCount: 1,
      datasetSourceKind: "governed",
      serializedDashboard: JSON.stringify({ datasets: [], pages: [] }),
      validationStatus: "valid",
      validatorVersion: DASHBOARD_VALIDATOR_VERSION,
      validatedAt: "2026-07-24T00:00:00.000Z",
      validationEvidence,
    },
  ]);
  mocks.listTrackedDashboards.mockResolvedValue([]);
  mocks.getLiveDashboard.mockResolvedValue({
    dashboard_id: "discovered-dashboard",
    display_name: "Sales dashboard",
    serialized_dashboard: JSON.stringify(assembleLakeviewDashboard(existingDesign)),
  });
  mocks.deployLifecycle.mockResolvedValue({
    dashboardId: "dash-1",
    displayName: "Sales dashboard",
    action: "created",
    publicationStatus: "published",
    publishedAt: "2026-07-24T08:00:00.000Z",
    readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
    evidence: [],
  });
});

describe("dashboard deploy route auth and server-owned fields", () => {
  it("uses app ownership for a guarded create without forwarding the user's OBO token", async () => {
    mocks.loadRunOrRespond.mockResolvedValueOnce({
      ok: true,
      value: { run: { runId, ownerEmail: "run-owner@example.com" } },
      user: { email: "editor@example.com" },
      permission: "edit",
    });
    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publish: true,
          parentPath: "/Users/attacker",
          ownerEmail: "attacker@example.com",
        }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "create",
        auth: { mode: "app" },
        publish: true,
        parentPath: "/Shared/Forge Dashboards/",
      }),
      expect.any(Object),
    );
    expect(mocks.deployLifecycle.mock.calls[0][0]).not.toHaveProperty("oboToken");
    expect(mocks.trackCreated).toHaveBeenCalledWith(
      expect.any(String),
      "dash-1",
      runId,
      "Sales",
      "Sales dashboard",
      expect.any(String),
      expect.objectContaining({
        ownerEmail: "editor@example.com",
        publicationStatus: "published",
        publishedAt: new Date("2026-07-24T08:00:00.000Z"),
        embedCredentials: false,
      }),
    );
    expect(mocks.updateRecommendationPublication).toHaveBeenCalledWith(runId, "Sales", {
      publicationStatus: "published",
      publishedAt: new Date("2026-07-24T08:00:00.000Z"),
      readBackEvidence: [],
    });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_draft_deployed",
      expect.objectContaining({ userId: "editor@example.com", resourceId: runId }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_published",
      expect.objectContaining({ userId: "editor@example.com", resourceId: runId }),
    );
    expect(mocks.logActivity.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.updateRecommendationPublication.mock.invocationCallOrder[0],
    );
  });

  it("does not deploy when the run guard denies cross-tenant access", async () => {
    mocks.loadRunOrRespond.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Run not found" }, { status: 404 }),
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
    expect(mocks.trackCreated).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("returns the precise app M2M denial without claiming OBO is categorically unavailable", async () => {
    mocks.deployLifecycle.mockRejectedValueOnce(
      new Error(
        "Lakeview create dashboard failed (403): Service principal cannot create dashboards",
      ),
    );

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publish: false }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Lakeview create dashboard failed (403): Service principal cannot create dashboards",
    });
    expect(mocks.trackCreated).not.toHaveBeenCalled();
    expect(mocks.updateRecommendationPublication).not.toHaveBeenCalled();
  });

  it("chooses update mode and never asks the lifecycle to create a duplicate", async () => {
    mocks.listTrackedDashboards.mockResolvedValue([
      {
        id: "tracking-row-1",
        dashboardId: "existing-dash",
        domain: "Sales",
        status: "created",
        ownerEmail: "owner@example.com",
      },
    ]);
    mocks.deployLifecycle.mockResolvedValueOnce({
      dashboardId: "existing-dash",
      displayName: "Sales dashboard",
      action: "updated",
      publicationStatus: "draft",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
      evidence: [],
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: false }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "update", dashboardId: "existing-dash" }),
      expect.any(Object),
    );
    expect(mocks.trackUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tracking-row-1",
        title: "Sales dashboard",
      }),
    );
    expect(mocks.trackUpdated.mock.calls[0][0]).not.toHaveProperty("ownerEmail");
    expect(mocks.trackUpdated.mock.calls[0][0]).not.toHaveProperty("dashboardId");
  });

  it("updates the exact discovered dashboard target for an enhancement", async () => {
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        recommendationType: "enhancement",
        classification: "improve",
        existingAssetId: "discovered-dashboard",
        dashboardDesign: improvedDesign,
        improveBaseDesign: existingDesign,
        improveDiff,
        serializedDashboard: JSON.stringify(assembleLakeviewDashboard(improvedDesign)),
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);
    mocks.listTrackedDashboards.mockResolvedValue([
      { dashboardId: "run-domain-substitute", domain: "Sales", status: "created" },
    ]);
    mocks.deployLifecycle.mockResolvedValueOnce({
      dashboardId: "discovered-dashboard",
      displayName: "Sales dashboard",
      action: "updated",
      publicationStatus: "draft",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
      evidence: [],
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "update", dashboardId: "discovered-dashboard" }),
      expect.any(Object),
    );
    expect(mocks.trackUpdated).not.toHaveBeenCalled();
    expect(mocks.trackExactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: "discovered-dashboard",
        runId,
        domain: "Sales",
        title: "Sales dashboard",
        ownerEmail: "editor@example.com",
        publicationStatus: "draft",
      }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_improved",
      expect.objectContaining({
        userId: "editor@example.com",
        metadata: expect.objectContaining({ dashboardId: "discovered-dashboard" }),
      }),
    );
  });

  it("returns explicit unsupported scope when the second improvement live-base check fails", async () => {
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        recommendationType: "enhancement",
        classification: "improve",
        existingAssetId: "discovered-dashboard",
        dashboardDesign: improvedDesign,
        improveBaseDesign: existingDesign,
        improveDiff,
        serializedDashboard: JSON.stringify(assembleLakeviewDashboard(improvedDesign)),
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);
    mocks.getLiveDashboard.mockRejectedValueOnce(
      Object.assign(new Error("scope unavailable"), {
        name: "DashboardScopeUnsupportedError",
        code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
        status: 403,
        requiredScope: "dashboards",
        operation: "get dashboard",
      }),
    );

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: false }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
      requiredScope: "dashboards",
      draftCreated: false,
    });
    expect(mocks.getLiveDashboard).toHaveBeenCalledOnce();
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
  });

  it("fails closed when an enhancement has no exact update target", async () => {
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        serializedDashboard: JSON.stringify({ datasets: [], pages: [] }),
        recommendationType: "enhancement",
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
    expect(mocks.trackCreated).not.toHaveBeenCalled();
  });

  it("returns reuse without calling the dashboard lifecycle", async () => {
    const reuseDiff = buildDashboardImproveDiff(
      "discovered-dashboard",
      existingDesign,
      existingDesign,
      fingerprintSerializedDashboard(assembleLakeviewDashboard(existingDesign)),
    );
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        recommendationType: "reuse",
        classification: "reuse",
        existingAssetId: "discovered-dashboard",
        dashboardDesign: existingDesign,
        improveBaseDesign: existingDesign,
        improveDiff: reuseDiff,
        serializedDashboard: JSON.stringify(assembleLakeviewDashboard(existingDesign)),
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: "{}",
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      deployed: false,
      action: "reused",
      dashboardId: "discovered-dashboard",
    });
  });

  it("blocks improvement when serialized output drifts from the bound merged design", async () => {
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        recommendationType: "enhancement",
        classification: "improve",
        existingAssetId: "discovered-dashboard",
        dashboardDesign: improvedDesign,
        improveBaseDesign: existingDesign,
        improveDiff,
        serializedDashboard: JSON.stringify({ datasets: [], pages: [] }),
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: "{}",
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
  });

  it("blocks update when the live dashboard changed after generation", async () => {
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        recommendationType: "enhancement",
        classification: "improve",
        existingAssetId: "discovered-dashboard",
        dashboardDesign: improvedDesign,
        improveBaseDesign: existingDesign,
        improveDiff,
        serializedDashboard: JSON.stringify(assembleLakeviewDashboard(improvedDesign)),
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);
    mocks.getLiveDashboard.mockResolvedValueOnce({
      dashboard_id: "discovered-dashboard",
      display_name: "Sales dashboard",
      serialized_dashboard: JSON.stringify({
        datasets: [{ name: "external", displayName: "External", queryLines: ["SELECT 1 "] }],
        pages: [],
      }),
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: "{}",
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
  });

  it("blocks update when the live dashboard is missing", async () => {
    mocks.getRecommendations.mockResolvedValueOnce([
      {
        domain: "Sales",
        title: "Sales dashboard",
        recommendationType: "enhancement",
        classification: "improve",
        existingAssetId: "discovered-dashboard",
        dashboardDesign: improvedDesign,
        improveBaseDesign: existingDesign,
        improveDiff,
        serializedDashboard: JSON.stringify(assembleLakeviewDashboard(improvedDesign)),
        validationStatus: "valid",
        validatorVersion: DASHBOARD_VALIDATOR_VERSION,
        validatedAt: "2026-07-24T00:00:00.000Z",
        validationEvidence,
      },
    ]);
    mocks.getLiveDashboard.mockRejectedValueOnce(new Error("RESOURCE_DOES_NOT_EXIST"));

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: "{}",
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
  });

  it("persists and returns the actual create-selected display name", async () => {
    mocks.deployLifecycle.mockResolvedValueOnce({
      dashboardId: "dash-2",
      displayName: "Sales dashboard (2)",
      action: "created",
      publicationStatus: "draft",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
      evidence: [],
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: false }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.trackCreated).toHaveBeenCalledWith(
      expect.any(String),
      "dash-2",
      runId,
      "Sales",
      "Sales dashboard (2)",
      expect.any(String),
      expect.any(Object),
    );
    await expect(response.json()).resolves.toMatchObject({
      dashboardId: "dash-2",
      displayName: "Sales dashboard (2)",
    });
  });

  it("returns an explicit failure response while retaining a publish-failed draft", async () => {
    mocks.deployLifecycle.mockResolvedValueOnce({
      dashboardId: "dash-1",
      displayName: "Sales dashboard",
      action: "created",
      publicationStatus: "publish_failed",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
      evidence: [],
      publishError: "publish denied",
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: true }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      dashboardId: "dash-1",
      publicationStatus: "publish_failed",
      error: "publish denied",
    });
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_draft_deployed", expect.any(Object));
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_publish_failed", expect.any(Object));
  });

  it("records read-back failure only after retaining the draft outcome", async () => {
    const { DashboardReadBackValidationError } = await import("@/lib/dashboard/deploy-lifecycle");
    mocks.deployLifecycle.mockRejectedValueOnce(
      new DashboardReadBackValidationError("dash-1", "Sales dashboard", "read-back mismatch", [
        {
          stage: "dashboard_read_back",
          status: "failed",
          code: "DASHBOARD_READ_BACK_FAILED",
          message: "read-back mismatch",
        },
      ]),
    );

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: true }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_draft_deployed",
      expect.objectContaining({
        userId: "editor@example.com",
        metadata: expect.objectContaining({
          dashboardId: "dash-1",
          publicationStatus: "draft",
        }),
      }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_readback_failed",
      expect.objectContaining({
        userId: "editor@example.com",
        metadata: expect.objectContaining({ dashboardId: "dash-1" }),
      }),
    );
    expect(mocks.logActivity.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.updateRecommendationPublication.mock.invocationCallOrder[0],
    );
    expect(
      mocks.logActivity.mock.calls.filter(([action]) => action === "dashboard_draft_deployed"),
    ).toHaveLength(1);
    expect(
      mocks.logActivity.mock.calls.filter(([action]) => action === "dashboard_readback_failed"),
    ).toHaveLength(1);
  });

  it.each([["unexpected-response-id"], [undefined]])(
    "anchors partial update tracking to expected ID when observed ID is %s",
    async (observedDashboardId) => {
      const { DashboardReadBackValidationError } = await import("@/lib/dashboard/deploy-lifecycle");
      mocks.listTrackedDashboards.mockResolvedValueOnce([
        {
          id: "tracking-row-1",
          dashboardId: "expected-live-id",
          domain: "Sales",
          status: "created",
          ownerEmail: null,
        },
      ]);
      mocks.deployLifecycle.mockRejectedValueOnce(
        new DashboardReadBackValidationError(
          "expected-live-id",
          "Sales dashboard",
          "mutation response identity mismatch",
          [],
          {
            expectedDashboardId: "expected-live-id",
            observedDashboardId,
          },
        ),
      );

      const response = await POST(
        new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
          method: "POST",
          body: JSON.stringify({ publish: false }),
        }) as never,
        { params: Promise.resolve({ runId, domain: "Sales" }) },
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        dashboardId: "expected-live-id",
        expectedDashboardId: "expected-live-id",
        ...(observedDashboardId ? { observedDashboardId } : {}),
      });
      expect(mocks.trackUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tracking-row-1" }),
      );
      expect(mocks.trackUpdated.mock.calls[0][0]).not.toHaveProperty("dashboardId");
      expect(JSON.stringify(mocks.trackUpdated.mock.calls)).not.toContain("unexpected-response-id");
    },
  );

  it("retains a created draft when a post-mutation published result lacks observed time", async () => {
    mocks.deployLifecycle.mockResolvedValueOnce({
      dashboardId: "dash-created",
      displayName: "Sales dashboard",
      action: "created",
      publicationStatus: "published",
      readBack: { datasetCount: 1, widgetCount: 1, contractOk: true },
      evidence: [],
    });

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: true }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      dashboardId: "dash-created",
      publicationStatus: "draft",
      dashboardUrl: "https://example.cloud.databricks.com/sql/dashboardsv3/dash-created",
    });
    expect(mocks.trackCreated).toHaveBeenCalledWith(
      expect.any(String),
      "dash-created",
      runId,
      "Sales",
      "Sales dashboard",
      expect.any(String),
      expect.objectContaining({ publicationStatus: "draft" }),
    );
  });

  it("returns an explicit feature-disabled response without persisted outcomes", async () => {
    const { DashboardDraftReadBackDisabledError } =
      await import("@/lib/dashboard/deploy-lifecycle");
    mocks.deployLifecycle.mockRejectedValueOnce(
      new DashboardDraftReadBackDisabledError("Dashboard publication requires draft read-back."),
    );

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: true }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "DASHBOARD_DRAFT_READBACK_DISABLED",
    });
    expect(mocks.trackCreated).not.toHaveBeenCalled();
    expect(mocks.trackUpdated).not.toHaveBeenCalled();
    expect(mocks.trackExactUpdate).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("reports mutation-observed untrackable failures without claiming no mutation", async () => {
    const { DashboardMutationUntrackableError } = await import("@/lib/dashboard/deploy-lifecycle");
    mocks.deployLifecycle.mockRejectedValueOnce(
      new DashboardMutationUntrackableError(
        "Dashboard mutation was observed, but its response did not contain dashboard_id.",
      ),
    );

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: false }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "DASHBOARD_MUTATION_OBSERVED_UNTRACKABLE",
      mutationObserved: true,
      trackable: false,
    });
    expect(mocks.trackCreated).not.toHaveBeenCalled();
    expect(mocks.trackUpdated).not.toHaveBeenCalled();
    expect(mocks.trackExactUpdate).not.toHaveBeenCalled();
  });
});
