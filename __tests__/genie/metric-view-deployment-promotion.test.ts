import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeSQL: vi.fn(),
  findProposals: vi.fn(),
  promote: vi.fn(),
  updateStatus: vi.fn(),
  deployAsset: vi.fn(),
}));

vi.mock("@/lib/dbx/sql", () => ({ executeSQL: mocks.executeSQL }));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  findMetricViewProposalsByFqn: mocks.findProposals,
  promoteMetricViewDeployment: mocks.promote,
  updateDeploymentStatus: mocks.updateStatus,
}));
vi.mock("@/lib/genie/deploy", () => ({ deployAsset: mocks.deployAsset }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ensureMetricViewsDeployed } from "@/lib/genie/metric-view-dependencies";

const access = { ownerEmail: "owner@example.com", sharedIds: [] };
const deploySql = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeSQL
    .mockRejectedValueOnce(new Error("missing"))
    .mockResolvedValue({ rows: [], columns: [], totalRowCount: 0 });
  mocks.findProposals.mockResolvedValue([
    {
      id: "proposal-1",
      name: "sales_metrics",
      ddl: "CREATE VIEW main.sales.sales_metrics AS SELECT 1",
    },
  ]);
  mocks.deployAsset.mockResolvedValue({
    deployed: true,
    success: true,
    fqn: "prod.metrics.sales_metrics",
  });
  mocks.promote.mockResolvedValue(undefined);
});

describe("metric view dependency deployment promotion", () => {
  it("uses the supplied user executor and promotes SQL success", async () => {
    const result = await ensureMetricViewsDeployed(
      ["main.sales.sales_metrics"],
      access,
      "prod.metrics",
      deploySql,
    );

    expect(mocks.deployAsset).toHaveBeenCalledWith(
      expect.any(Object),
      "prod.metrics",
      undefined,
      deploySql,
    );
    expect(mocks.promote).toHaveBeenCalledWith(
      "proposal-1",
      "prod.metrics.sales_metrics",
    );
    expect(mocks.updateStatus).not.toHaveBeenCalledWith(
      "proposal-1",
      "deployed",
      expect.anything(),
    );
    expect(result).toEqual({
      deployed: ["prod.metrics.sales_metrics"],
      failed: [],
    });
  });

  it("surfaces post-SQL promotion failure as a partial dependency outcome", async () => {
    mocks.promote.mockRejectedValueOnce(new Error("manifest promotion failed"));

    const result = await ensureMetricViewsDeployed(
      ["main.sales.sales_metrics"],
      access,
      "prod.metrics",
      deploySql,
    );

    expect(result.deployed).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        fqn: "main.sales.sales_metrics",
        deployed: true,
        manifestPromoted: false,
        error: expect.stringContaining("manifest promotion failed"),
      }),
    ]);
  });
});
