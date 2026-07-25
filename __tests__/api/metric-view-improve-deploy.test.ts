import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMetricViewImproveDiff } from "@/lib/metric-views/improve-diff";
import type { MetricViewDefinition } from "@/lib/metric-views/definition";
import { serializeMetricViewYaml } from "@/lib/metric-views/serializer";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  deployAsset: vi.fn(),
  executeAsUser: vi.fn(),
  updateStatus: vi.fn(),
  promoteDeployment: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadMetricViewProposalOrRespond: mocks.guard,
}));
vi.mock("@/lib/genie/deploy", () => ({
  deployAsset: mocks.deployAsset,
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  updateDeploymentStatus: mocks.updateStatus,
  promoteMetricViewDeployment: mocks.promoteDeployment,
}));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/dbx/sql", () => ({ executeSQLWithToken: mocks.executeAsUser }));
vi.mock("@/lib/metric-views/deployability", () => ({
  isMetricViewValidationDeployable: () => true,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/metric-views/[id]/deploy/route";

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    name: "sales_metrics",
    schemaScope: "target.schema",
    ddl: "CREATE OR REPLACE VIEW `target`.`schema`.`sales_metrics` WITH METRICS LANGUAGE YAML AS $$x$$",
    classification: "new",
    validationStatus: "valid",
    validationIssues: [],
    ...overrides,
  };
}

const improveBase: MetricViewDefinition = {
  version: "1.1",
  name: "sales_metrics",
  source: { kind: "table", table: "existing.analytics.sales" },
  joins: [],
  dimensions: [{ kind: "local", name: "region", expr: "region" }],
  measures: [{ kind: "expression", name: "revenue", expr: "SUM(revenue)" }],
  requiredFeatures: [],
};
const improveMerged: MetricViewDefinition = {
  ...improveBase,
  measures: [
    ...improveBase.measures,
    { kind: "expression", name: "orders", expr: "COUNT(*)" },
  ],
};
const boundImprove = {
  classification: "improve",
  existingFqn: "existing.analytics.sales_metrics",
  definition: improveMerged,
  improveBaseDefinition: improveBase,
  improveDiff: {
    ...buildMetricViewImproveDiff(improveBase, improveMerged),
    existingFqn: "existing.analytics.sales_metrics",
  },
};

function showCreate(definition: MetricViewDefinition = improveBase) {
  return {
    columns: [{ name: "createtab_stmt", typeName: "STRING", position: 0 }],
    rows: [
      [
        `CREATE VIEW \`existing\`.\`analytics\`.\`sales_metrics\`\nWITH METRICS\nLANGUAGE YAML\nAS $$\n${serializeMetricViewYaml(
          definition,
        )}$$`,
      ],
    ],
    totalRowCount: 1,
  };
}

async function post(body: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/metric-views/proposal-1/deploy", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "proposal-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    ok: true,
    value: { proposal: proposal() },
    user: { email: "editor@example.com", oboToken: "obo-token" },
  });
  mocks.deployAsset.mockResolvedValue({
    deployed: true,
    fqn: "target.schema.sales_metrics",
  });
  mocks.promoteDeployment.mockResolvedValue(undefined);
  mocks.executeAsUser.mockImplementation(async (sql: string) =>
    sql.startsWith("SHOW CREATE") ? showCreate() : { columns: [], rows: [], totalRowCount: 0 },
  );
});

describe("metric view typed improvement deployment", () => {
  it.each([
    [{ targetSchema: "target.schema; DROP SCHEMA target CASCADE" }, "targetSchema"],
    [{ resourcePrefix: "safe_`; DROP TABLE users; --" }, "resourcePrefix"],
    [{ targetSchema: "catalog" }, "targetSchema"],
    [{ targetSchema: "catalog.schema.extra" }, "targetSchema"],
  ])("rejects unsafe deploy identifiers before any SQL or deploy call", async (body, _field) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(mocks.executeAsUser).not.toHaveBeenCalled();
    expect(mocks.deployAsset).not.toHaveBeenCalled();
  });

  it("binds new metric view deployment to the request OBO executor", async () => {
    const response = await post({ targetSchema: "target.schema", resourcePrefix: "safe_" });

    expect(response.status).toBe(200);
    expect(mocks.deployAsset).toHaveBeenCalledWith(
      expect.any(Object),
      "target.schema",
      "safe_",
      expect.any(Function),
    );
    const deploySql = mocks.deployAsset.mock.calls[0][3] as (sql: string) => Promise<unknown>;
    await deploySql("CREATE VIEW target.schema.safe_sales_metrics AS SELECT 1");
    expect(mocks.executeAsUser).toHaveBeenCalledWith(
      "CREATE VIEW target.schema.safe_sales_metrics AS SELECT 1",
      "obo-token",
    );
    expect(mocks.promoteDeployment).toHaveBeenCalledWith(
      "proposal-1",
      "target.schema.sales_metrics",
    );
    expect(mocks.promoteDeployment.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.deployAsset.mock.invocationCallOrder[0],
    );
  });

  it("reports SQL success with stale manifest when atomic promotion fails", async () => {
    mocks.promoteDeployment.mockRejectedValueOnce(new Error("manifest row missing"));

    const response = await post();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      deployed: true,
      manifestPromoted: false,
      fqn: "target.schema.sales_metrics",
      error: expect.stringContaining("manifest"),
    });
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("rejects new deployment without OBO before invoking deployAsset", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: { proposal: proposal() },
      user: { email: "editor@example.com", oboToken: null },
    });

    const response = await post();

    expect(response.status).toBe(401);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
    expect(mocks.executeAsUser).not.toHaveBeenCalled();
  });

  it("validates reuse without mutating Unity Catalog", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: {
        proposal: proposal({
          classification: "reuse",
          existingFqn: "existing.analytics.sales_metrics",
        }),
      },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });

    const response = await post();

    expect(response.status).toBe(200);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      deployed: false,
      reused: true,
      fqn: "existing.analytics.sales_metrics",
    });
  });

  it("updates only the exact existing FQN for improve", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: {
        proposal: proposal({
          ...boundImprove,
        }),
      },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });
    mocks.deployAsset.mockResolvedValueOnce({
      deployed: true,
      fqn: "existing.analytics.sales_metrics",
    });

    const response = await post({ targetSchema: "attacker.schema", resourcePrefix: "copy_" });

    expect(response.status).toBe(200);
    expect(mocks.executeAsUser.mock.calls[0]).toEqual([
      "SHOW CREATE TABLE `existing`.`analytics`.`sales_metrics`",
      "obo-token",
    ]);
    expect(mocks.executeAsUser.mock.calls[1][0]).toMatch(
      /^ALTER VIEW `existing`\.`analytics`\.`sales_metrics` AS \$\$/,
    );
    expect(mocks.executeAsUser.mock.calls[1][0]).not.toMatch(/CREATE/i);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
    expect(mocks.promoteDeployment).toHaveBeenCalledWith(
      "proposal-1",
      "existing.analytics.sales_metrics",
    );
    expect(mocks.updateStatus).not.toHaveBeenCalledWith(
      "proposal-1",
      "deployed",
      expect.anything(),
    );
  });

  it("never creates when an improve target or matching diff is missing", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: { proposal: proposal({ classification: "improve", existingFqn: null }) },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });

    const response = await post();

    expect(response.status).toBe(422);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
  });

  it("fails before deploy when the exact stored target is missing or inaccessible", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: {
        proposal: proposal({
          ...boundImprove,
        }),
      },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });
    mocks.executeAsUser.mockRejectedValueOnce(new Error("TABLE_OR_VIEW_NOT_FOUND"));

    const response = await post();

    expect(response.status).toBe(409);
    expect(mocks.executeAsUser).toHaveBeenCalledWith(
      "SHOW CREATE TABLE `existing`.`analytics`.`sales_metrics`",
      "obo-token",
    );
    expect(mocks.deployAsset).not.toHaveBeenCalled();
  });

  it("fails closed when the live metric view changed after generation", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: { proposal: proposal({ ...boundImprove }) },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });
    mocks.executeAsUser.mockResolvedValueOnce(
      showCreate({ ...improveBase, comment: "concurrent edit" }),
    );

    const response = await post();

    expect(response.status).toBe(409);
    expect(mocks.executeAsUser).toHaveBeenCalledTimes(1);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
  });

  it("uses update-only ALTER when the target disappears after the live read", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: { proposal: proposal({ ...boundImprove }) },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });
    mocks.executeAsUser
      .mockResolvedValueOnce(showCreate())
      .mockRejectedValueOnce(new Error("TABLE_OR_VIEW_NOT_FOUND"));

    const response = await post();

    expect(response.status).toBe(409);
    expect(mocks.executeAsUser.mock.calls[1][0]).toMatch(/^ALTER VIEW /);
    expect(mocks.executeAsUser.mock.calls.flat().join("\n")).not.toMatch(/CREATE OR REPLACE/i);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
  });

  it("blocks mutation when the merged typed artifact drifts from its bound diff", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: true,
      value: {
        proposal: proposal({
          ...boundImprove,
          definition: { ...improveMerged, comment: "corrupt drift" },
        }),
      },
      user: { email: "editor@example.com", oboToken: "obo-token" },
    });

    const response = await post();

    expect(response.status).toBe(422);
    expect(mocks.executeAsUser).not.toHaveBeenCalled();
    expect(mocks.deployAsset).not.toHaveBeenCalled();
  });
});
