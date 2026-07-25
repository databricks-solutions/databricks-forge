import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listAccessibleIds: vi.fn(),
  checkDependencies: vi.fn(),
  loadRunOrRespond: vi.fn(),
  getByRunDomain: vi.fn(),
}));

vi.mock("@/lib/auth/route-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/lakebase/acl", () => ({ listAccessibleIds: mocks.listAccessibleIds }));
vi.mock("@/lib/auth/route-guards", () => ({ loadRunOrRespond: mocks.loadRunOrRespond }));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  getMetricViewProposalsByRunDomain: mocks.getByRunDomain,
}));
vi.mock("@/lib/genie/metric-view-dependencies", () => ({
  checkMetricViewDependencies: mocks.checkDependencies,
}));

import { POST } from "@/app/api/metric-views/check-dependencies/route";

const access = { ownerEmail: "caller@example.com", sharedIds: ["shared-mv"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ email: access.ownerEmail, oboToken: "obo-token" });
  mocks.listAccessibleIds.mockResolvedValue(access.sharedIds);
  mocks.checkDependencies.mockResolvedValue({ allDeployed: false, missing: [], deployed: [] });
});

function request(fqns: string[]) {
  return new Request("http://localhost/api/metric-views/check-dependencies", {
    method: "POST",
    body: JSON.stringify({ fqns }),
  }) as never;
}

describe("explicit-FQN request validation", () => {
  it.each([
    "main.sales.revenue_metrics; DROP VIEW main.sales.secret",
    "main.sales.revenue_metrics -- comment",
    "main.sales.'revenue_metrics'",
    "main.sales.revenue metrics",
  ])("rejects unsafe FQN before dependency lookup: %s", async (fqn) => {
    const response = await POST(request([fqn]));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(mocks.checkDependencies).not.toHaveBeenCalled();
  });

  it("accepts quoted hyphenated FQNs and passes only the validated form", async () => {
    const response = await POST(
      request(["`sales-catalog`.`analytics-schema`.`revenue-metrics`"]),
    );

    expect(response.status).toBe(200);
    expect(mocks.checkDependencies).toHaveBeenCalledWith(
      ["sales-catalog.analytics-schema.revenue-metrics"],
      access,
    );
  });
});
