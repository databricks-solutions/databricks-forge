import { beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_VALIDATOR_VERSION } from "@/lib/validation/evidence";

const mocks = vi.hoisted(() => ({
  loadRunOrRespond: vi.fn(),
  getRecommendations: vi.fn(),
  deployLifecycle: vi.fn(),
  createDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  listTrackedDashboards: vi.fn(),
  trackCreated: vi.fn(),
  trackUpdated: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadRunOrRespond: mocks.loadRunOrRespond,
}));
vi.mock("@/lib/lakebase/dashboard-recommendations", () => ({
  getDashboardRecommendationsByRunId: mocks.getRecommendations,
  updateDashboardRecommendationPublication: vi.fn(),
}));
vi.mock("@/lib/dashboard/deploy-lifecycle", () => ({
  deployDashboardDraftAndVerify: mocks.deployLifecycle,
  dashboardDeployDependencies: {},
  DashboardReadBackValidationError: class DashboardReadBackValidationError extends Error {},
}));
vi.mock("@/lib/dbx/dashboards", () => ({
  createDashboard: mocks.createDashboard,
  updateDashboard: mocks.updateDashboard,
  publishDashboard: vi.fn(),
  DEFAULT_DASHBOARD_PARENT_PATH: "/Shared/Forge Dashboards",
}));
vi.mock("@/lib/lakebase/dashboards", () => ({
  listTrackedDashboards: mocks.listTrackedDashboards,
  trackDashboardCreated: mocks.trackCreated,
  trackDashboardUpdated: mocks.trackUpdated,
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
const caller = { email: "editor@example.com", oboToken: "obo-token" };

function recommendation(validationStatus: "pending" | "valid" | "invalid") {
  return {
    domain: "Sales",
    title: "Sales dashboard",
    serializedDashboard: "{}",
    validationStatus,
    validatorVersion: DASHBOARD_VALIDATOR_VERSION,
    validatedAt: "2026-07-24T00:00:00.000Z",
    validationEvidence:
      validationStatus === "valid"
        ? [
            {
              stage: "dataset_static",
              status: "passed",
              code: "SCHEMA_ALLOWLIST_VALID",
              message: "ok",
              artifactRef: "dataset:sales",
            },
            {
              stage: "dataset_static",
              status: "passed",
              code: "STATIC_LINT_PASSED",
              message: "ok",
              artifactRef: "dataset:sales",
            },
            {
              stage: "dataset_review",
              status: "skipped",
              code: "LLM_REVIEW_DISABLED",
              message: "optional review disabled",
              artifactRef: "dataset:sales",
            },
            {
              stage: "dataset_explain",
              status: "passed",
              code: "EXPLAIN_PASSED",
              message: "ok",
              artifactRef: "dataset:sales",
            },
            {
              stage: "dataset_execution",
              status: "passed",
              code: "SQL_EXECUTION_SUCCEEDED",
              message: "ok",
              artifactRef: "dataset:sales",
            },
            {
              stage: "dataset_result",
              status: "passed",
              code: "RESULT_CONTRACT_VALID",
              message: "ok",
              artifactRef: "dataset:sales",
            },
            {
              stage: "dashboard_design",
              status: "passed",
              code: "WIDGET_DATASET_REFERENCES_VALID",
              message: "ok",
            },
            {
              stage: "dashboard_contract",
              status: "passed",
              code: DASHBOARD_VALIDATOR_VERSION,
              message: "ok",
            },
          ]
        : [{ stage: "dataset-probe", status: "failed", code: "dataset.invalid", message: "bad" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadRunOrRespond.mockResolvedValue({
    ok: true,
    value: { run: { runId, ownerEmail: "owner@example.com" } },
    user: caller,
    permission: "edit",
  });
  mocks.listTrackedDashboards.mockResolvedValue([]);
  mocks.createDashboard.mockResolvedValue({ dashboard_id: "dash-1" });
  mocks.deployLifecycle.mockResolvedValue({
    dashboardId: "dash-1",
    displayName: "Sales dashboard",
    action: "created",
    publicationStatus: "draft",
    readBack: { datasetCount: 0, widgetCount: 0, contractOk: true },
    evidence: [],
  });
});

describe("dashboard deployment validation gate", () => {
  it.each(["pending", "invalid"] as const)(
    "rejects a %s recommendation before any Databricks mutation",
    async (validationStatus) => {
      mocks.getRecommendations.mockResolvedValue([recommendation(validationStatus)]);

      const response = await POST(
        new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
          method: "POST",
          body: JSON.stringify({}),
        }) as never,
        { params: Promise.resolve({ runId, domain: "Sales" }) },
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        validationStatus,
      });
      expect(mocks.createDashboard).not.toHaveBeenCalled();
      expect(mocks.updateDashboard).not.toHaveBeenCalled();
      expect(mocks.deployLifecycle).not.toHaveBeenCalled();
      expect(mocks.trackCreated).not.toHaveBeenCalled();
    },
  );

  it("logs deployment only after the dashboard and tracking row succeed", async () => {
    mocks.getRecommendations.mockResolvedValue([recommendation("valid")]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.trackCreated).toHaveBeenCalled();
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_draft_deployed",
      expect.objectContaining({
        userId: caller.email,
        resourceId: runId,
      }),
    );
    expect(mocks.logActivity.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.trackCreated.mock.invocationCallOrder[0],
    );
  });

  it("deploys current valid provenance when optional SQL review was skipped", async () => {
    mocks.getRecommendations.mockResolvedValue([recommendation("valid")]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).toHaveBeenCalledOnce();
  });

  it("allows retry when only prior post-deploy publication evidence failed", async () => {
    const rec = recommendation("valid");
    rec.validationEvidence.push({
      stage: "dashboard_publication",
      status: "failed",
      code: "DASHBOARD_PUBLICATION_FAILED",
      message: "Published state was not observed",
      artifactRef: "dashboard:dash-1",
    });
    mocks.getRecommendations.mockResolvedValue([rec]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({ publish: true }),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deployLifecycle).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "failed evidence",
      mutate: (rec: ReturnType<typeof recommendation>) => {
        rec.validationEvidence.push({
          stage: "dataset_review",
          status: "failed",
          code: "LLM_REVIEW_FAILED",
          message: "bad",
        });
      },
    },
    {
      name: "missing required lifecycle evidence",
      mutate: (rec: ReturnType<typeof recommendation>) => {
        rec.validationEvidence = rec.validationEvidence.filter(
          (entry) => entry.code !== "EXPLAIN_PASSED",
        );
      },
    },
    {
      name: "stale validator version",
      mutate: (rec: ReturnType<typeof recommendation>) => {
        rec.validatorVersion = "dashboard-contract-v0";
      },
    },
    {
      name: "invalid validation timestamp",
      mutate: (rec: ReturnType<typeof recommendation>) => {
        rec.validatedAt = "not-a-date";
      },
    },
  ])("rejects $name before Databricks mutation", async ({ mutate }) => {
    const rec = recommendation("valid");
    mutate(rec);
    mocks.getRecommendations.mockResolvedValue([rec]);

    const response = await POST(
      new Request(`http://localhost/api/runs/${runId}/dashboard-engine/Sales/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId, domain: "Sales" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.createDashboard).not.toHaveBeenCalled();
    expect(mocks.updateDashboard).not.toHaveBeenCalled();
    expect(mocks.deployLifecycle).not.toHaveBeenCalled();
  });
});
