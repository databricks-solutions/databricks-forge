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
  requireUser: vi.fn(),
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
  requireUser: mocks.requireUser,
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
import {
  DashboardMutationUntrackableError,
  DashboardReadBackValidationError,
} from "@/lib/dashboard/deploy-lifecycle";
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
    mocks.requireUser.mockResolvedValue({
      email: "caller@example.com",
      oboToken: "obo-token",
    });
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

  it("filters manual generation using normalized Genie domain names", async () => {
    mocks.getUseCases.mockResolvedValue([
      { id: "uc-1", domain: "Procurement", subdomain: "Sourcing", tablesInvolved: [] },
      { id: "uc-2", domain: "Inventory", subdomain: "Stock", tablesInvolved: [] },
      { id: "uc-3", domain: "Sales", subdomain: "Revenue", tablesInvolved: [] },
      { id: "uc-4", domain: "Customer", subdomain: "Retention", tablesInvolved: [] },
    ]);
    mocks.getGenieRecommendations.mockResolvedValue([
      {
        domain: "Procurement",
        semanticAssetManifest: JSON.stringify({
          version: "1",
          domain: "Supply Chain",
          metricViews: [],
          measures: [],
          dimensions: [],
          filters: [],
        }),
      },
    ]);
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [],
      validationFailures: [],
    });

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({ domains: [" supply chain "] }),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.startJob).toHaveBeenCalledWith("run-1");
    expect(mocks.runDashboardEngine).toHaveBeenCalledWith(
      expect.objectContaining({ domainFilter: [" supply chain "] }),
    );
  });

  it("replaces both legacy raw alias rows and the canonical domain they collapse into", async () => {
    mocks.getUseCases.mockResolvedValue([
      { id: "uc-1", domain: "Procurement", subdomain: "Sourcing", tablesInvolved: [] },
      { id: "uc-2", domain: "Inventory", subdomain: "Stock", tablesInvolved: [] },
      { id: "uc-3", domain: "Sales", subdomain: "Revenue", tablesInvolved: [] },
    ]);
    mocks.getGenieRecommendations.mockResolvedValue([
      {
        domain: "Procurement",
        semanticAssetManifest: JSON.stringify({
          version: "1",
          domain: "Supply Chain",
          metricViews: [],
          measures: [],
          dimensions: [],
          filters: [],
        }),
      },
    ]);
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [{ domain: "Supply Chain", title: "Supply Chain dashboard" }],
      validationFailures: [],
    });

    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({ domains: ["Procurement", " Inventory "] }),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.saveRecommendations).toHaveBeenCalledOnce());
    // The delete-then-insert transaction matches on the persisted `domain`
    // column literally. Rows persisted before domain canonicalization still
    // carry the raw alias, so the replace set must cover the trimmed raw
    // labels *and* the canonical bucket they collapse into: the aliases clear
    // stale upgrade rows, and the canonical label keeps the re-insert from
    // colliding on the run+domain unique constraint.
    expect(mocks.saveRecommendations).toHaveBeenCalledWith(
      "run-1",
      [{ domain: "Supply Chain", title: "Supply Chain dashboard" }],
      ["Procurement", "Inventory", "Supply Chain"],
      "owner@example.com",
    );
  });

  it("passes undefined replace domains for an unfiltered regeneration", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [{ domain: "Sales Analytics", title: "Sales dashboard" }],
      validationFailures: [],
    });

    await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: "{}",
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    await vi.waitFor(() => expect(mocks.saveRecommendations).toHaveBeenCalledOnce());
    expect(mocks.saveRecommendations.mock.calls[0][2]).toBeUndefined();
  });

  it("returns a structured failure when an explicit normalized filter selects no groups", async () => {
    const response = await postRunGeneration(
      new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
        method: "POST",
        body: JSON.stringify({ domains: ["Procurement"] }),
      }) as never,
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Procurement"),
      code: "NO_MATCHING_DASHBOARD_DOMAINS",
      domains: ["Procurement"],
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
    expect(mocks.runDashboardEngine).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", []],
    ["whitespace-only", ["   "]],
  ])(
    "returns a structured failure when an explicit %s domains array has no normalized entries",
    async (_label, domains) => {
      const response = await postRunGeneration(
        new Request("http://localhost/api/runs/run-1/dashboard-engine/generate", {
          method: "POST",
          body: JSON.stringify({ domains }),
        }) as never,
        { params: Promise.resolve({ runId: "run-1" }) },
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "NO_MATCHING_DASHBOARD_DOMAINS",
        domains: [],
      });
      expect(mocks.startJob).not.toHaveBeenCalled();
      expect(mocks.runDashboardEngine).not.toHaveBeenCalled();
    },
  );

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

  it("records the verified draft and read-back failure when ad-hoc read-back fails", async () => {
    const readBackEvidence: ValidationEvidence[] = [
      {
        stage: "dashboard_read_back",
        status: "failed",
        code: "DASHBOARD_READ_BACK_FAILED",
        message: "Read-back counts 1/2 do not match expected 1/3",
        artifactRef: "dashboard:dash-readback",
      },
    ];
    mocks.runAdHocDashboardEngine.mockRejectedValue(
      new DashboardReadBackValidationError(
        "dash-readback",
        "Sales",
        "Dashboard draft read-back validation failed: counts do not match",
        readBackEvidence,
        { expectedDashboardId: "dash-readback", observedDashboardId: "dash-other" },
      ),
    );

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: true }),
      }) as never,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      dashboardId: "dash-readback",
      expectedDashboardId: "dash-readback",
      observedDashboardId: "dash-other",
      displayName: "Sales",
      publicationStatus: "draft",
      validationEvidence: readBackEvidence,
    });
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_draft_deployed", {
      userId: "caller@example.com",
      resourceId: "dash-readback",
      metadata: {
        displayName: "Sales",
        path: "/Shared/Forge Dashboards/",
        publicationStatus: "draft",
        dashboardId: "dash-readback",
        expectedDashboardId: "dash-readback",
        observedDashboardId: "dash-other",
      },
    });
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_readback_failed", {
      userId: "caller@example.com",
      resourceId: "dash-readback",
      metadata: {
        dashboardId: "dash-readback",
        expectedDashboardId: "dash-readback",
        observedDashboardId: "dash-other",
        stage: "dashboard_read_back",
        evidenceCodes: ["DASHBOARD_READ_BACK_FAILED"],
      },
    });
    expect(mocks.logActivity).toHaveBeenCalledTimes(2);
  });

  it("returns an untrackable ad-hoc mutation failure without inventing an audit trail", async () => {
    mocks.runAdHocDashboardEngine.mockRejectedValue(
      new DashboardMutationUntrackableError(
        "Dashboard mutation was observed, but its response did not contain dashboard_id.",
      ),
    );

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: true }),
      }) as never,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "DASHBOARD_MUTATION_OBSERVED_UNTRACKABLE",
      mutationObserved: true,
      trackable: false,
    });
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("allows Forge-owned deployment without an OBO token", async () => {
    mocks.requireUser.mockResolvedValue({
      email: "caller@example.com",
      oboToken: null,
    });
    mocks.runAdHocDashboardEngine.mockResolvedValue({
      recommendation: {
        title: "Sales",
        description: "Sales overview",
        domain: "Sales",
        datasetCount: 1,
        widgetCount: 1,
      },
      dashboardId: "dash-1",
      displayName: "Sales",
      dashboardUrl: "https://example.cloud.databricks.com/sql/dashboardsv3/dash-1",
      publicationStatus: "draft",
    });

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: true }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.runAdHocDashboardEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        deploy: true,
      }),
    );
    expect(mocks.runAdHocDashboardEngine.mock.calls[0][0]).not.toHaveProperty("oboToken");
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_draft_deployed", {
      userId: "caller@example.com",
      resourceId: "dash-1",
      metadata: {
        displayName: "Sales",
        path: "/Shared/Forge Dashboards/",
        publicationStatus: "draft",
      },
    });
    // A verified draft is audited exactly once; the read-back failure trail
    // belongs only to the typed failure branch.
    expect(mocks.logActivity).toHaveBeenCalledOnce();
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "dashboard_readback_failed",
      expect.anything(),
    );
  });

  it("does not log a dashboard deployment for generation-only requests", async () => {
    mocks.runAdHocDashboardEngine.mockResolvedValue({
      recommendation: {
        title: "Sales",
        description: "Sales overview",
        domain: "Sales",
        datasetCount: 1,
        widgetCount: 1,
      },
    });

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: false }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "dashboard_draft_deployed",
      expect.anything(),
    );
    expect(mocks.logActivity).not.toHaveBeenCalledWith("dashboard_published", expect.anything());
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "dashboard_publish_failed",
      expect.anything(),
    );
  });

  it("logs the persisted ad-hoc publication outcome with caller identity", async () => {
    mocks.runAdHocDashboardEngine.mockResolvedValue({
      recommendation: {
        title: "Sales",
        description: "Sales overview",
        domain: "Sales",
        datasetCount: 1,
        widgetCount: 1,
      },
      dashboardId: "dash-published",
      displayName: "Sales",
      dashboardUrl: "https://example.cloud.databricks.com/sql/dashboardsv3/dash-published",
      publicationStatus: "published",
    });

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: true, publish: true }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_draft_deployed", {
      userId: "caller@example.com",
      resourceId: "dash-published",
      metadata: {
        displayName: "Sales",
        path: "/Shared/Forge Dashboards/",
        publicationStatus: "published",
      },
    });
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_published", {
      userId: "caller@example.com",
      resourceId: "dash-published",
      metadata: { domain: "Sales", dashboardId: "dash-published" },
    });
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "dashboard_publish_failed",
      expect.anything(),
    );
  });

  it("logs the persisted ad-hoc publish failure outcome with caller identity", async () => {
    mocks.runAdHocDashboardEngine.mockResolvedValue({
      recommendation: {
        title: "Sales",
        description: "Sales overview",
        domain: "Sales",
        datasetCount: 1,
        widgetCount: 1,
      },
      dashboardId: "dash-failed",
      displayName: "Sales",
      dashboardUrl: "https://example.cloud.databricks.com/sql/dashboardsv3/dash-failed",
      publicationStatus: "publish_failed",
      publishError: "Publication verification failed",
    });

    const response = await postAdHoc(
      new Request("http://localhost/api/dashboard/generate", {
        method: "POST",
        body: JSON.stringify({ tables: ["main.sales.orders"], deploy: true, publish: true }),
      }) as never,
    );

    expect(response.status).toBe(502);
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_draft_deployed", {
      userId: "caller@example.com",
      resourceId: "dash-failed",
      metadata: {
        displayName: "Sales",
        path: "/Shared/Forge Dashboards/",
        publicationStatus: "publish_failed",
      },
    });
    expect(mocks.logActivity).toHaveBeenCalledWith("dashboard_publish_failed", {
      userId: "caller@example.com",
      resourceId: "dash-failed",
      metadata: { domain: "Sales", dashboardId: "dash-failed" },
    });
    expect(mocks.logActivity).not.toHaveBeenCalledWith("dashboard_published", expect.anything());
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
