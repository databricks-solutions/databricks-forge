import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  executeSp: vi.fn(),
  executeObo: vi.fn(),
  getProposals: vi.fn(),
  promote: vi.fn(),
  updateStatus: vi.fn(),
  findRecommendation: vi.fn(),
  updateRecommendation: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({ loadRunOrRespond: mocks.guard }));
vi.mock("@/lib/dbx/sql", () => ({
  executeSQL: mocks.executeSp,
  executeSQLWithToken: mocks.executeObo,
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  getMetricViewProposalsByRunDomain: mocks.getProposals,
  promoteMetricViewDeployment: mocks.promote,
  updateDeploymentStatus: mocks.updateStatus,
}));
vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(
    callback: (prisma: {
      forgeGenieRecommendation: {
        findFirst: typeof mocks.findRecommendation;
        update: typeof mocks.updateRecommendation;
      };
    }) => Promise<T>,
  ) =>
    callback({
      forgeGenieRecommendation: {
        findFirst: mocks.findRecommendation,
        update: mocks.updateRecommendation,
      },
    }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/runs/[runId]/genie-engine/[domain]/metric-views/route";

const runId = "run-1";

function post() {
  return POST(
    new Request(
      `http://localhost/api/runs/${runId}/genie-engine/Sales/metric-views`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "sales_metrics",
          ddl: "CREATE VIEW `main`.`sales`.`sales_metrics` AS SELECT 1",
        }),
      },
    ) as never,
    { params: Promise.resolve({ runId, domain: "Sales" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    ok: true,
    value: { run: { runId, ownerEmail: "owner@example.com" } },
    user: { email: "editor@example.com", oboToken: "request-obo-token" },
  });
  mocks.getProposals.mockResolvedValue([{ id: "proposal-1", name: "sales_metrics" }]);
  mocks.promote.mockResolvedValue(undefined);
  mocks.findRecommendation.mockResolvedValue({
    id: "rec-1",
    serializedSpace: JSON.stringify({ data_sources: { metric_views: [] } }),
    metricViews: "[]",
  });
});

describe("Genie engine metric view deployment", () => {
  it("executes as the user and promotes the matching proposal after SQL success", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(mocks.executeObo).toHaveBeenCalledWith(
      "CREATE VIEW `main`.`sales`.`sales_metrics` AS SELECT 1",
      "request-obo-token",
    );
    expect(mocks.executeSp).not.toHaveBeenCalled();
    expect(mocks.promote).toHaveBeenCalledWith(
      "proposal-1",
      "main.sales.sales_metrics",
    );
    expect(mocks.updateStatus).not.toHaveBeenCalledWith(
      "proposal-1",
      "deployed",
      expect.anything(),
    );
  });

  it("returns a partial outcome when SQL succeeds but manifest promotion fails", async () => {
    mocks.promote.mockRejectedValueOnce(new Error("manifest promotion failed"));

    const response = await post();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      deployed: true,
      manifestPromoted: false,
      metricViewFqn: "main.sales.sales_metrics",
    });
    expect(mocks.updateRecommendation).not.toHaveBeenCalled();
  });
});
