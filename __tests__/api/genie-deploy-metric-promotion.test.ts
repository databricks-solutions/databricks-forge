import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  deployAsset: vi.fn(),
  getProposals: vi.fn(),
  promote: vi.fn(),
  updateStatus: vi.fn(),
  executeObo: vi.fn(),
  createSpace: vi.fn(),
  trackSpace: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({ loadRunOrRespond: mocks.guard }));
vi.mock("@/lib/dbx/client", () => ({
  getConfig: vi.fn(() => ({ warehouseId: "warehouse-1" })),
}));
vi.mock("@/lib/dbx/sql", () => ({ executeSQLWithToken: mocks.executeObo }));
vi.mock("@/lib/dbx/genie", () => ({
  createGenieSpace: mocks.createSpace,
  updateGenieSpace: vi.fn(),
}));
vi.mock("@/lib/lakebase/genie-spaces", () => ({
  trackGenieSpaceCreated: mocks.trackSpace,
  trackGenieSpaceUpdated: vi.fn(),
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  getMetricViewProposalsByRunDomain: mocks.getProposals,
  promoteMetricViewDeployment: mocks.promote,
  updateDeploymentStatus: mocks.updateStatus,
}));
vi.mock("@/lib/genie/metric-views-config", () => ({
  isMetricViewsEnabled: () => true,
}));
vi.mock("@/lib/genie/deploy", () => ({
  deployAsset: mocks.deployAsset,
  validatePreExistingMetricViews: vi.fn(async () => ({
    valid: new Set<string>(),
    stripped: [],
  })),
  prepareSerializedSpace: vi.fn((json: string) => ({ json, strippedRefs: [] })),
  validateFinalSpace: vi.fn(async (json: string) => ({ json, stripped: [] })),
  normalizeIdentifiersToFqn: vi.fn((json: string) => json),
  extractPreExistingMvFqns: vi.fn(() => []),
}));
vi.mock("@/lib/genie/metric-view-dependencies", () => ({
  rewriteDashboardMetricViewFqns: vi.fn((json: string) => json),
}));
vi.mock("@/lib/logger", () => ({
  apiLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { GET, POST } from "@/app/api/runs/[runId]/genie-deploy/route";

const runId = "run-1";

async function startDeploy() {
  const response = await POST(
    new NextRequest(`http://localhost/api/runs/${runId}/genie-deploy`, {
      method: "POST",
      body: JSON.stringify({
        targetSchema: "prod.metrics",
        domains: [
          {
            domain: "Sales",
            title: "Sales",
            description: "Sales",
            serializedSpace: JSON.stringify({
              data_sources: {},
              instructions: {},
            }),
            metricViews: [
              {
                name: "sales_metrics",
                ddl: "CREATE VIEW main.sales.sales_metrics AS SELECT 1",
              },
            ],
          },
        ],
      }),
    }),
    { params: Promise.resolve({ runId }) },
  );
  return response.json() as Promise<{ jobId: string }>;
}

async function job(jobId: string) {
  return GET(new NextRequest(`http://localhost/api/runs/${runId}/genie-deploy?jobId=${jobId}`), {
    params: Promise.resolve({ runId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    ok: true,
    value: { run: { runId, ownerEmail: "owner@example.com" } },
    user: { email: "owner@example.com", oboToken: "request-obo-token" },
  });
  mocks.getProposals.mockResolvedValue([{ id: "proposal-1", name: "sales_metrics" }]);
  mocks.deployAsset.mockResolvedValue({
    name: "sales_metrics",
    type: "metric_view",
    success: true,
    deployed: true,
    fqn: "prod.metrics.sales_metrics",
  });
  mocks.promote.mockResolvedValue(undefined);
  mocks.createSpace.mockResolvedValue({ space_id: "space-1" });
});

describe("pipeline Genie metric view promotion", () => {
  it("uses request OBO and promotes every proposal-backed SQL success", async () => {
    const { jobId } = await startDeploy();
    await vi.waitFor(() => expect(mocks.promote).toHaveBeenCalled());

    expect(mocks.deployAsset).toHaveBeenCalledWith(
      expect.any(Object),
      "prod.metrics",
      undefined,
      expect.any(Function),
    );
    const deploySql = mocks.deployAsset.mock.calls[0][3] as (sql: string) => Promise<unknown>;
    await deploySql("CREATE VIEW prod.metrics.sales_metrics AS SELECT 1");
    expect(mocks.executeObo).toHaveBeenCalledWith(
      "CREATE VIEW prod.metrics.sales_metrics AS SELECT 1",
      "request-obo-token",
    );
    expect(mocks.promote).toHaveBeenCalledWith("proposal-1", "prod.metrics.sales_metrics");
    expect(mocks.updateStatus).not.toHaveBeenCalledWith(
      "proposal-1",
      "deployed",
      expect.anything(),
    );
    await expect(job(jobId).then((response) => response.json())).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("records promotion failure as a partial deployed asset", async () => {
    mocks.promote.mockRejectedValueOnce(new Error("manifest promotion failed"));
    const { jobId } = await startDeploy();

    await vi.waitFor(async () => {
      const response = await job(jobId);
      const payload = await response.json();
      expect(payload.status).toBe("completed");
      expect(payload.results[0].assets[0]).toMatchObject({
        deployed: true,
        success: false,
        manifestPromoted: false,
        error: expect.stringContaining("manifest promotion failed"),
      });
    });
  });
});
