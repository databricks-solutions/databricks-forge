import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationEvidence } from "@/lib/validation/evidence";

const mocks = vi.hoisted(() => ({
  runDashboardEngine: vi.fn(),
  runAdHocDashboardEngine: vi.fn(),
  saveRecommendations: vi.fn(),
  startJob: vi.fn(),
  updateJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  getJob: vi.fn(),
  logActivity: vi.fn(),
  getGenieRecommendations: vi.fn(),
  getUseCases: vi.fn(),
  getDiscovery: vi.fn(),
  enrichExisting: vi.fn(),
}));

vi.mock("@/lib/dashboard/engine", () => ({
  runDashboardEngine: mocks.runDashboardEngine,
}));

vi.mock("@/lib/dashboard/adhoc-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/adhoc-engine")>();
  return { ...actual, runAdHocDashboardEngine: mocks.runAdHocDashboardEngine };
});

vi.mock("@/lib/dashboard/engine-status", () => ({
  startDashboardJob: mocks.startJob,
  updateDashboardJob: mocks.updateJob,
  completeDashboardJob: mocks.completeJob,
  failDashboardJob: mocks.failJob,
  getDashboardJobStatus: mocks.getJob,
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadRunOrRespond: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      run: { runId: "run-1", status: "completed", ownerEmail: "owner@example.com" },
    },
    user: { email: "caller@example.com", oboToken: "obo-token" },
    permission: "owner",
  }),
}));
vi.mock("@/lib/auth/route-user", () => ({
  requireUser: vi.fn().mockResolvedValue({
    email: "caller@example.com",
    oboToken: "obo-token",
  }),
  ForgeAuthError: class ForgeAuthError extends Error {},
}));

vi.mock("@/lib/lakebase/usecases", () => ({
  getUseCasesByRunId: mocks.getUseCases,
}));

vi.mock("@/lib/lakebase/metadata-cache", () => ({
  loadMetadataForRun: vi.fn().mockResolvedValue({ tables: [], columns: [] }),
}));

vi.mock("@/lib/lakebase/genie-recommendations", () => ({
  getGenieRecommendationsByRunId: mocks.getGenieRecommendations,
}));

vi.mock("@/lib/lakebase/dashboard-recommendations", () => ({
  saveDashboardRecommendations: mocks.saveRecommendations,
}));

vi.mock("@/lib/lakebase/activity-log", () => ({
  logActivity: mocks.logActivity,
}));

vi.mock("@/lib/lakebase/discovered-assets", () => ({
  getDiscoveryResultsByRunId: mocks.getDiscovery,
}));
vi.mock("@/lib/dashboard/existing-designs", () => ({
  enrichDiscoveredDashboardsWithDesigns: mocks.enrichExisting,
}));

vi.mock("@/lib/validation", () => ({
  isValidUUID: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import { DashboardValidationError } from "@/lib/dashboard/adhoc-engine";
import { POST as postAdHoc } from "@/app/api/dashboard/generate/route";
import { POST as postRunGeneration } from "@/app/api/runs/[runId]/dashboard-engine/generate/route";
import { GET as getRunGenerationStatus } from "@/app/api/runs/[runId]/dashboard-engine/generate/status/route";

const failedEvidence: ValidationEvidence[] = [
  {
    stage: "dataset_result",
    status: "failed",
    code: "ALIAS_MISSING",
    message: 'Dataset "sales" did not return alias "revenue".',
  },
];

describe("dashboard validation route surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJob.mockResolvedValue(null);
    mocks.getDiscovery.mockResolvedValue(null);
    mocks.enrichExisting.mockImplementation(async (dashboards) => dashboards);
    mocks.getUseCases.mockResolvedValue([
      { id: "uc-1", domain: "Sales", subdomain: "Revenue", tablesInvolved: [] },
    ]);
    mocks.getGenieRecommendations.mockResolvedValue([
      {
        domain: "Sales",
        semanticAssetManifest: JSON.stringify({
          version: "1",
          domain: "Sales",
          metricViews: [],
          measures: [],
          dimensions: [],
          filters: [],
        }),
      },
    ]);
  });

  it("loads owner-scoped persisted semantic manifests for manual regeneration", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [],
      validationFailures: [],
    });

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({ domains: ["Sales"] }),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getGenieRecommendations).toHaveBeenCalledWith("run-1", "owner@example.com");
    expect(mocks.runDashboardEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        genieRecommendations: expect.arrayContaining([
          expect.objectContaining({ domain: "Sales" }),
        ]),
        semanticManifests: {
          Sales: expect.objectContaining({ version: "1", domain: "Sales" }),
        },
      }),
    );
  });

  it("threads trusted tracked designs bound to exact discovered IDs into production generation", async () => {
    const trackedDesign = {
      version: "2",
      title: "Tracked",
      description: "",
      datasets: [],
      pages: [],
      globalFilters: [],
    };
    mocks.getDiscovery.mockResolvedValue({
      dashboards: [
        {
          dashboardId: "tracked-dashboard",
          displayName: "Tracked",
          tables: ["main.sales.orders"],
          isPublished: true,
          datasetCount: 0,
          widgetCount: 0,
        },
      ],
    });
    mocks.enrichExisting.mockResolvedValue([
      {
        dashboardId: "tracked-dashboard",
        displayName: "Tracked",
        tables: ["main.sales.orders"],
        isPublished: true,
        datasetCount: 0,
        widgetCount: 0,
        dashboardDesign: trackedDesign,
      },
    ]);
    mocks.runDashboardEngine.mockResolvedValue({ recommendations: [], validationFailures: [] });

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: "{}",
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.enrichExisting).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ dashboardId: "tracked-dashboard" })]),
      "owner@example.com",
      "obo-token",
    );
    expect(mocks.runDashboardEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        existingDashboards: [
          expect.objectContaining({
            dashboardId: "tracked-dashboard",
            dashboardDesign: trackedDesign,
          }),
        ],
      }),
    );
  });

  it("fails closed before starting manual regeneration when manifests are missing", async () => {
    mocks.getGenieRecommendations.mockResolvedValue([]);

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("persisted Genie semantic manifests"),
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
    expect(mocks.runDashboardEngine).not.toHaveBeenCalled();
  });

  it("validates manual manifest coverage against normalized filtered domains", async () => {
    mocks.getUseCases.mockResolvedValue([
      { id: "uc-2", domain: "Finance", subdomain: "Planning", tablesInvolved: [] },
    ]);

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({ domains: [" finance "] }),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Finance"),
    });
    expect(mocks.runDashboardEngine).not.toHaveBeenCalled();
  });

  it("returns structured ad-hoc validation evidence with a non-500 status", async () => {
    mocks.runAdHocDashboardEngine.mockRejectedValue(
      new DashboardValidationError("Dashboard recommendation validation failed", [
        { domain: "Sales", evidence: failedEvidence },
      ]),
    );

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: true }),
      }) as never,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      validationStatus: "invalid",
      validationEvidence: failedEvidence,
    });
  });

  it("persists valid siblings and completes with retained failures for mixed domains", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [{ domain: "Finance", title: "Valid dashboard" }],
      validationFailures: [{ domain: "Sales", evidence: failedEvidence }],
    });

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(mocks.completeJob).toHaveBeenCalledWith("run-1", 1, [
        { domain: "Sales", evidence: failedEvidence },
      ]),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
    expect(mocks.saveRecommendations).toHaveBeenCalledWith(
      "run-1",
      [{ domain: "Finance", title: "Valid dashboard" }],
      undefined,
      "owner@example.com",
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "dashboard_validation_failed",
      expect.objectContaining({ resourceId: "run-1" }),
    );
  });

  it("fails an all-invalid manual run without persisting recommendations", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [],
      validationFailures: [{ domain: "Sales", evidence: failedEvidence }],
    });

    await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    await vi.waitFor(() =>
      expect(mocks.failJob).toHaveBeenCalledWith(
        "run-1",
        "Dashboard validation failed for 1 domain",
        [{ domain: "Sales", evidence: failedEvidence }],
      ),
    );
    expect(mocks.saveRecommendations).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("persists and completes an all-valid manual run normally", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [{ domain: "Finance", title: "Valid dashboard" }],
      validationFailures: [],
    });

    await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    await vi.waitFor(() => expect(mocks.completeJob).toHaveBeenCalledWith("run-1", 1, []));
    expect(mocks.saveRecommendations).toHaveBeenCalledOnce();
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("returns validation failures from the run status endpoint", async () => {
    mocks.getJob.mockResolvedValue({
      runId: "run-1",
      status: "failed",
      message: "Dashboard generation failed validation",
      percent: 100,
      startedAt: 100,
      completedAt: 200,
      error: "Dashboard validation failed for 1 domain",
      domainCount: 0,
      validationFailures: [{ domain: "Sales", evidence: failedEvidence }],
    });

    const response = await getRunGenerationStatus(new Request("http://localhost/status") as never, {
      params: Promise.resolve({ runId: "run-1" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      validationFailures: [{ domain: "Sales", evidence: failedEvidence }],
    });
  });
});
