import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeSQL: vi.fn(),
  findProposals: vi.fn(),
}));

vi.mock("@/lib/dbx/sql", () => ({ executeSQL: mocks.executeSQL }));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  findMetricViewProposalsByFqn: mocks.findProposals,
  updateDeploymentStatus: vi.fn(),
}));
vi.mock("@/lib/genie/deploy", () => ({ deployAsset: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkMetricViewDependencies } from "@/lib/genie/metric-view-dependencies";

const fqn = "main.sales.revenue_metrics";
const ownedProposal = {
  id: "owned-mv",
  ownerEmail: "owner@example.com",
  name: "revenue_metrics",
  ddl: "CREATE VIEW main.sales.revenue_metrics",
  deployedFqn: null,
};
const sharedProposal = {
  ...ownedProposal,
  id: "shared-mv",
  ownerEmail: "other-owner@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeSQL.mockImplementation(async (sql: string) => {
    if (sql.startsWith("DESCRIBE TABLE")) throw new Error("not found");
    return { columns: [], rows: [], totalRowCount: 0 };
  });
  mocks.findProposals.mockImplementation(
    async (
      _fqns: string[],
      access: { ownerEmail: string; sharedIds: string[] },
    ) => {
      if (access.ownerEmail === ownedProposal.ownerEmail) return [ownedProposal];
      if (access.sharedIds.includes(sharedProposal.id)) return [sharedProposal];
      return [];
    },
  );
});

describe("explicit-FQN metric-view dependency authorization", () => {
  it("rejects an unsafe FQN before DESCRIBE or proposal lookup", async () => {
    await expect(
      checkMetricViewDependencies(
        ["main.sales.revenue_metrics; DROP VIEW main.sales.secret"],
        { ownerEmail: "owner@example.com", sharedIds: [] },
      ),
    ).rejects.toMatchObject({ name: "IdentifierValidationError" });

    expect(mocks.executeSQL).not.toHaveBeenCalled();
    expect(mocks.findProposals).not.toHaveBeenCalled();
  });

  it("normalizes a quoted hyphenated FQN before SQL and proposal lookup", async () => {
    const quoted = "`sales-catalog`.`analytics-schema`.`revenue-metrics`";
    await checkMetricViewDependencies([quoted], {
      ownerEmail: "owner@example.com",
      sharedIds: [],
    });

    expect(mocks.executeSQL).toHaveBeenCalledWith(
      "DESCRIBE TABLE `sales-catalog`.`analytics-schema`.`revenue-metrics`",
    );
    expect(mocks.findProposals).toHaveBeenCalledWith(
      ["sales-catalog.analytics-schema.revenue-metrics"],
      { ownerEmail: "owner@example.com", sharedIds: [] },
    );
  });

  it("returns proposal metadata to its owner", async () => {
    const result = await checkMetricViewDependencies([fqn], {
      ownerEmail: "owner@example.com",
      sharedIds: [],
    });

    expect(result.missing[0]).toMatchObject({
      proposalId: "owned-mv",
      ddl: ownedProposal.ddl,
    });
  });

  it("returns proposal metadata to an ACL-shared viewer", async () => {
    const result = await checkMetricViewDependencies([fqn], {
      ownerEmail: "viewer@example.com",
      sharedIds: ["shared-mv"],
    });

    expect(result.missing[0]).toMatchObject({
      proposalId: "shared-mv",
      ddl: sharedProposal.ddl,
    });
  });

  it("does not reveal another owner's proposal metadata", async () => {
    const access = { ownerEmail: "unrelated@example.com", sharedIds: [] };
    const result = await checkMetricViewDependencies([fqn], access);

    expect(mocks.findProposals).toHaveBeenCalledWith([fqn], access);
    expect(result.missing[0]).toEqual({
      name: "revenue_metrics",
      fqn,
      proposalId: undefined,
      ddl: undefined,
      existingFqn: undefined,
    });
    expect(JSON.stringify(result)).not.toContain("owned-mv");
    expect(JSON.stringify(result)).not.toContain("other-owner@example.com");
    expect(JSON.stringify(result)).not.toContain("CREATE VIEW");
  });
});
