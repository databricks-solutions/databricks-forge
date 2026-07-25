import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardRecommendation } from "@/lib/dashboard/types";
import type { MetricViewProposal } from "@/lib/metric-views/types";
import { buildDashboardImproveDiff } from "@/lib/dashboard/improve-diff";

type StoredRow = Record<string, unknown>;

let metricRows: StoredRow[] = [];
let dashboardRows: StoredRow[] = [];

const metricCreateMany = vi.fn(async ({ data }: { data: StoredRow[] }) => {
  metricRows.push(
    ...data.map((row) => ({
      ...row,
      deployedFqn: null,
      deployedAt: null,
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    })),
  );
  return { count: data.length };
});

const dashboardCreateMany = vi.fn(async ({ data }: { data: StoredRow[] }) => {
  dashboardRows.push(...data);
  return { count: data.length };
});

const metricTable = {
  deleteMany: vi.fn(async () => ({ count: 0 })),
  createMany: metricCreateMany,
  findMany: vi.fn(async () => metricRows),
  update: vi.fn(async () => ({})),
};

const dashboardTable = {
  deleteMany: vi.fn(async () => ({ count: 0 })),
  createMany: dashboardCreateMany,
  findMany: vi.fn(async () => dashboardRows),
  findUnique: vi.fn(async () => dashboardRows[0] ?? null),
  updateMany: vi.fn(async ({ data }: { data: StoredRow }) => {
    if (dashboardRows[0]) dashboardRows[0] = { ...dashboardRows[0], ...data };
    return { count: dashboardRows.length > 0 ? 1 : 0 };
  }),
};

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(
    callback: (prisma: {
      $transaction: (callback: (tx: unknown) => Promise<T>) => Promise<T>;
      forgeMetricViewProposal: typeof metricTable;
      forgeDashboardRecommendation: typeof dashboardTable;
    }) => Promise<T>,
  ) => {
    const prisma = {
      $transaction: async (transaction: (tx: unknown) => Promise<T>) =>
        transaction({
          forgeMetricViewProposal: metricTable,
          forgeDashboardRecommendation: dashboardTable,
        }),
      forgeMetricViewProposal: metricTable,
      forgeDashboardRecommendation: dashboardTable,
    };
    return callback(prisma);
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  findMetricViewProposalsByFqn,
  getMetricViewProposalsByRun,
  saveMetricViewProposals,
  updateMetricViewProposal,
} from "@/lib/lakebase/metric-view-proposals";
import {
  getDashboardRecommendationsByRunId,
  saveDashboardRecommendations,
  updateDashboardRecommendationPublication,
} from "@/lib/lakebase/dashboard-recommendations";

function metricProposal(overrides: Partial<MetricViewProposal> = {}): MetricViewProposal {
  return {
    name: "revenue_metrics",
    description: "Revenue metrics",
    yaml: "version: 1.1",
    ddl: "CREATE VIEW revenue_metrics",
    sourceTables: ["main.sales.orders"],
    hasJoins: false,
    hasFilteredMeasures: false,
    hasWindowMeasures: false,
    hasMaterialization: false,
    validationStatus: "valid",
    validationIssues: [],
    ...overrides,
  };
}

function dashboardRecommendation(
  overrides: Partial<DashboardRecommendation> = {},
): DashboardRecommendation {
  return {
    domain: "Sales",
    subdomains: ["Revenue"],
    title: "Sales overview",
    description: "Validated sales KPIs",
    datasetCount: 1,
    widgetCount: 1,
    useCaseIds: ["uc-1"],
    serializedDashboard: '{"datasets":[],"pages":[]}',
    dashboardDesign: {
      version: "2",
      title: "Sales overview",
      description: "Validated sales KPIs",
      datasets: [],
      pages: [{ name: "overview", displayName: "Sales overview", widgets: [], filters: [] }],
      globalFilters: [],
    },
    designVersion: "2",
    datasetSourceKind: "mixed",
    validationStatus: "valid",
    validatorVersion: "dashboard-contract-v1",
    validatedAt: "2026-07-24T01:02:03.000Z",
    ...overrides,
  };
}

describe("validation evidence persistence", () => {
  beforeEach(() => {
    metricRows = [];
    dashboardRows = [];
    vi.clearAllMocks();
  });

  it("round-trips compact metric evidence and preserves unverified status", async () => {
    const evidenceWithForbiddenRows = {
      stage: "measure-probe",
      status: "skipped" as const,
      code: "probe.permission_denied",
      message: "Probe could not run: permission denied",
      durationMs: 42,
      artifactRef: "main.sales.__forge_probe",
      observedSchema: [{ name: "revenue", dataType: "DECIMAL(18,2)" }],
      observedRowCount: 0,
      rawRows: [{ revenue: "sensitive-value" }],
    };

    await saveMetricViewProposals(
      "run-1",
      "main.sales",
      "Sales",
      [
        metricProposal({
          validationStatus: "unverified",
          validatorVersion: "metric-view-probes-v1",
          validatedAt: "2026-07-24T01:02:03.000Z",
          validationEvidence: [evidenceWithForbiddenRows],
        }),
      ],
      "owner@example.com",
    );

    const persisted = metricCreateMany.mock.calls[0][0].data[0];
    expect(persisted.ownerEmail).toBe("owner@example.com");
    expect(JSON.parse(persisted.validationEvidenceJson as string)).toEqual([
      {
        stage: "measure-probe",
        status: "skipped",
        code: "probe.permission_denied",
        message: "Probe could not run: permission denied",
        durationMs: 42,
        artifactRef: "main.sales.__forge_probe",
        observedSchema: [{ name: "revenue", dataType: "DECIMAL(18,2)" }],
        observedRowCount: 0,
      },
    ]);
    expect(persisted.validationEvidenceJson).not.toContain("sensitive-value");

    const [roundTrip] = await getMetricViewProposalsByRun("run-1");
    expect(roundTrip.validationStatus).toBe("unverified");
    expect(roundTrip.validationEvidence[0].observedRowCount).toBe(0);
    expect(roundTrip.validationEvidence[0].observedSchema).toEqual([
      { name: "revenue", dataType: "DECIMAL(18,2)" },
    ]);
    expect(roundTrip.validatedAt).toBeNull();
    expect(roundTrip.validatorVersion).toBeNull();
  });

  it("maps legacy metric rows with null evidence", async () => {
    metricRows.push({
      id: "legacy-mv",
      runId: "run-1",
      schemaScope: "main.sales",
      domain: null,
      subdomain: null,
      name: "legacy",
      description: null,
      yaml: "version: 1.1",
      ddl: "CREATE VIEW legacy",
      sourceTablesJson: null,
      hasJoins: false,
      classification: null,
      rationale: null,
      existingFqn: null,
      validationStatus: "pending",
      validationIssues: null,
      validatorVersion: null,
      validationEvidenceJson: null,
      validatedAt: null,
      deploymentStatus: "proposed",
      deployedFqn: null,
      deployedAt: null,
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    });

    const [legacy] = await getMetricViewProposalsByRun("run-1");
    expect(legacy.validationStatus).toBe("unverified");
    expect(legacy.validationEvidence).toEqual([
      expect.objectContaining({
        stage: "metric_view_integrity",
        status: "skipped",
        code: "METRIC_VIEW_DEFINITION_UNAVAILABLE",
      }),
    ]);
    expect(legacy.validatorVersion).toBeNull();
    expect(legacy.validatedAt).toBeNull();
  });

  it("atomically clears stale validation metadata with explicit nulls", async () => {
    await updateMetricViewProposal("mv-1", {
      yaml: "version: 1.1\ncomment: changed",
      validationStatus: "unverified",
      validationIssues: ["Definition changed after validation; repair to validate again."],
      validationEvidence: null,
      validatorVersion: null,
      validatedAt: null,
    });

    expect(metricTable.update).toHaveBeenCalledWith({
      where: { id: "mv-1" },
      data: {
        yaml: "version: 1.1\ncomment: changed",
        validationStatus: "unverified",
        validationIssues: JSON.stringify([
          "Definition changed after validation; repair to validate again.",
        ]),
        validationEvidenceJson: null,
        validatorVersion: null,
        validatedAt: null,
      },
    });
  });

  it("scopes FQN proposal lookup to owner and shared IDs in the database query", async () => {
    await findMetricViewProposalsByFqn(["main.sales.revenue_metrics"], {
      ownerEmail: "viewer@example.com",
      sharedIds: ["shared-mv"],
    });

    expect(metricTable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { deployedFqn: { in: ["main.sales.revenue_metrics"] } },
                { name: { in: ["revenue_metrics"] } },
              ],
            },
            {
              OR: [{ ownerEmail: "viewer@example.com" }, { id: { in: ["shared-mv"] } }],
            },
          ],
        },
      }),
    );
  });

  it("persists dashboard owner and validation evidence from the run", async () => {
    await saveDashboardRecommendations(
      "run-1",
      [
        dashboardRecommendation({
          validationEvidence: [
            {
              stage: "dataset-probe",
              status: "passed",
              code: "dataset.schema_valid",
              message: "Dataset schema matched",
              durationMs: 17,
              observedSchema: [{ name: "region", dataType: "STRING" }],
              observedRowCount: 12,
            },
          ],
        }),
      ],
      undefined,
      "run-owner@example.com",
    );

    const persisted = dashboardCreateMany.mock.calls[0][0].data[0];
    expect(persisted.ownerEmail).toBe("run-owner@example.com");
    expect(persisted.validationStatus).toBe("valid");
    expect(persisted.validatorVersion).toBe("dashboard-contract-v1");
    expect(persisted.designVersion).toBe("2");
    expect(JSON.parse(String(persisted.dashboardDesign)).datasetSourceKind).toBe("mixed");

    const [roundTrip] = await getDashboardRecommendationsByRunId("run-1");
    expect(roundTrip.datasetSourceKind).toBe("mixed");
    expect(roundTrip.designVersion).toBe("2");
    expect(roundTrip.dashboardDesign.version).toBe("2");
    expect(roundTrip.validationEvidence?.[0].observedRowCount).toBe(12);
    expect(roundTrip.validatedAt).toBe("2026-07-24T01:02:03.000Z");
  });

  it("round-trips dashboard reuse faithfully with a bound empty typed diff", async () => {
    const base = dashboardRecommendation().dashboardDesign;
    const improveDiff = buildDashboardImproveDiff(
      "dash-existing",
      base,
      base,
      "a".repeat(64),
    );
    await saveDashboardRecommendations("run-1", [
      dashboardRecommendation({
        classification: "reuse",
        recommendationType: "reuse",
        existingAssetId: "dash-existing",
        improveBaseDesign: base,
        improveDiff,
      }),
    ]);

    const persisted = dashboardCreateMany.mock.calls[0][0].data[0];
    expect(persisted.recommendationType).toBe("reuse");
    const [roundTrip] = await getDashboardRecommendationsByRunId("run-1");
    expect(roundTrip).toMatchObject({
      classification: "reuse",
      recommendationType: "reuse",
      existingAssetId: "dash-existing",
      improveDiff: {
        liveBaseFingerprint: "a".repeat(64),
        addDatasets: [],
        addWidgets: [],
        addFilters: [],
      },
    });
  });

  it("fails closed when a persisted dashboard diff is corrupt", async () => {
    const base = dashboardRecommendation().dashboardDesign;
    await saveDashboardRecommendations("run-1", [
      dashboardRecommendation({
        classification: "reuse",
        recommendationType: "reuse",
        existingAssetId: "dash-existing",
        improveBaseDesign: base,
        improveDiff: buildDashboardImproveDiff(
          "dash-existing",
          base,
          base,
          "a".repeat(64),
        ),
      }),
    ]);
    dashboardRows[0].improveDiffJson = '{"existingAssetId":"dash-existing"}';

    const [roundTrip] = await getDashboardRecommendationsByRunId("run-1");

    expect(roundTrip.validationStatus).toBe("invalid");
    expect(roundTrip.improveDiff).toBeUndefined();
    expect(roundTrip.validationEvidence).toContainEqual(
      expect.objectContaining({ code: "DASHBOARD_IMPROVE_BINDING_INVALID" }),
    );
  });

  it("deduplicates retry evidence by stage, code, and artifact while preserving distinct failures", async () => {
    dashboardRows.push({
      validationEvidenceJson: JSON.stringify([
        {
          stage: "dashboard_read_back",
          status: "passed",
          code: "DASHBOARD_READ_BACK_VERIFIED",
          message: "first pass",
          artifactRef: "dashboard:dash-1",
        },
      ]),
    });
    const repeated = {
      stage: "dashboard_read_back",
      status: "passed" as const,
      code: "DASHBOARD_READ_BACK_VERIFIED",
      message: "retry pass",
      artifactRef: "dashboard:dash-1",
    };
    const firstFailure = {
      stage: "dashboard_publication",
      status: "failed" as const,
      code: "DASHBOARD_PUBLICATION_FAILED",
      message: "dash-1 failed",
      artifactRef: "dashboard:dash-1",
    };
    const distinctFailure = {
      ...firstFailure,
      message: "dash-2 failed",
      artifactRef: "dashboard:dash-2",
    };

    await updateDashboardRecommendationPublication("run-1", "Sales", {
      publicationStatus: "publish_failed",
      readBackEvidence: [repeated, repeated, firstFailure, distinctFailure],
    });
    await updateDashboardRecommendationPublication("run-1", "Sales", {
      publicationStatus: "publish_failed",
      readBackEvidence: [repeated, firstFailure],
    });

    const persisted = JSON.parse(String(dashboardRows[0].validationEvidenceJson)) as Array<
      Record<string, unknown>
    >;
    expect(persisted).toHaveLength(3);
    expect(persisted.filter((item) => item.artifactRef === "dashboard:dash-1")).toHaveLength(2);
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "dashboard_read_back",
          code: "DASHBOARD_READ_BACK_VERIFIED",
          message: "retry pass",
        }),
        expect.objectContaining({
          stage: "dashboard_publication",
          code: "DASHBOARD_PUBLICATION_FAILED",
          artifactRef: "dashboard:dash-1",
        }),
        expect.objectContaining({
          stage: "dashboard_publication",
          code: "DASHBOARD_PUBLICATION_FAILED",
          artifactRef: "dashboard:dash-2",
        }),
      ]),
    );
  });

  it("refuses to persist published status without an observed publication timestamp", async () => {
    await expect(
      updateDashboardRecommendationPublication("run-1", "Sales", {
        publicationStatus: "published",
        publishedAt: null,
        readBackEvidence: [],
      }),
    ).rejects.toThrow("observed publishedAt");
    expect(dashboardTable.updateMany).not.toHaveBeenCalled();
  });

  it("maps legacy dashboard rows with null validation fields to pending", async () => {
    dashboardRows.push({
      id: "legacy-dashboard",
      runId: "run-1",
      domain: "Sales",
      subdomains: null,
      title: "Legacy",
      description: "Legacy dashboard",
      datasetCount: 0,
      widgetCount: 0,
      useCaseIds: null,
      serializedDashboard: '{"datasets":[],"pages":[]}',
      dashboardDesign: null,
      designVersion: null,
      recommendationType: "new",
      existingAssetId: null,
      changeSummary: null,
      ownerEmail: null,
      validationStatus: null,
      validatorVersion: null,
      validationEvidenceJson: null,
      validatedAt: null,
    });

    const [legacy] = await getDashboardRecommendationsByRunId("run-1");
    expect(legacy.validationStatus).toBe("pending");
    expect(legacy.validationEvidence).toEqual([]);
    expect(legacy.validatorVersion).toBeUndefined();
    expect(legacy.validatedAt).toBeUndefined();
    expect(legacy.datasetSourceKind).toBe("table");
    expect(legacy.dashboardDesign.version).toBe("2");
  });

  it("adapts persisted legacy dashboard JSON on read without losing intent", async () => {
    dashboardRows.push({
      id: "legacy-dashboard-design",
      runId: "run-1",
      domain: "Sales",
      subdomains: '["Revenue"]',
      title: "Legacy",
      description: "Legacy dashboard",
      datasetCount: 1,
      widgetCount: 1,
      useCaseIds: '["uc-1"]',
      serializedDashboard: '{"datasets":[],"pages":[]}',
      dashboardDesign: JSON.stringify({
        version: "2",
        title: "Legacy",
        description: "Legacy dashboard",
        datasets: [
          {
            name: "sales",
            displayName: "Sales",
            purpose: "kpi",
            sql: "SELECT 1 AS total",
          },
        ],
        widgets: [
          {
            type: "counter",
            title: "Total",
            datasetName: "sales",
            fields: [{ name: "total", expression: "`total`", role: "value" }],
          },
        ],
        datasetSourceKind: "table",
      }),
      designVersion: null,
      recommendationType: "new",
      existingAssetId: null,
      changeSummary: null,
      ownerEmail: null,
      validationStatus: null,
      validatorVersion: null,
      validationEvidenceJson: null,
      validatedAt: null,
    });

    const [legacy] = await getDashboardRecommendationsByRunId("run-1");

    expect(legacy.dashboardDesign).toMatchObject({
      version: "2",
      pages: [
        {
          widgets: [
            {
              type: "counter",
              title: "Total",
              datasetName: "sales",
            },
          ],
        },
      ],
      datasets: [
        {
          sourceKind: "table",
          expectedFields: [expect.objectContaining({ name: "total", roles: ["value"] })],
        },
      ],
    });
  });

  it("rejects a designVersion 2 payload that omits the payload version", async () => {
    dashboardRows.push({
      id: "malformed-v2-dashboard",
      runId: "run-1",
      domain: "Sales",
      subdomains: null,
      title: "Malformed V2",
      description: "Malformed nested contract",
      datasetCount: 1,
      widgetCount: 0,
      useCaseIds: null,
      serializedDashboard: '{"datasets":[],"pages":[]}',
      dashboardDesign: JSON.stringify({
        title: "Malformed V2",
        description: "Malformed nested contract",
        datasets: [
          {
            name: "sales",
            displayName: "Sales",
            purpose: "kpi",
            sql: "SELECT 1 AS total",
          },
        ],
        widgets: [],
      }),
      designVersion: "2",
      recommendationType: "new",
      existingAssetId: null,
      changeSummary: null,
      ownerEmail: null,
      validationStatus: null,
      validatorVersion: null,
      validationEvidenceJson: null,
      validatedAt: null,
    });

    await expect(getDashboardRecommendationsByRunId("run-1")).rejects.toMatchObject({
      name: "DashboardDesignV2ValidationError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "V2_VERSION_INVALID",
          path: "version",
        }),
      ]),
    });
  });

  it("rejects unsupported non-null persisted design versions", async () => {
    dashboardRows.push({
      id: "unsupported-v3-dashboard",
      runId: "run-1",
      domain: "Sales",
      subdomains: null,
      title: "Unsupported",
      description: "Unknown contract",
      datasetCount: 0,
      widgetCount: 0,
      useCaseIds: null,
      serializedDashboard: '{"datasets":[],"pages":[]}',
      dashboardDesign: JSON.stringify({
        version: "2",
        title: "Unsupported",
        description: "Unknown contract",
        datasets: [],
        pages: [{ name: "overview", displayName: "Overview", widgets: [], filters: [] }],
        globalFilters: [],
      }),
      designVersion: "3",
      recommendationType: "new",
      existingAssetId: null,
      changeSummary: null,
      ownerEmail: null,
      validationStatus: null,
      validatorVersion: null,
      validationEvidenceJson: null,
      validatedAt: null,
    });

    await expect(getDashboardRecommendationsByRunId("run-1")).rejects.toMatchObject({
      name: "UnsupportedDashboardDesignVersionError",
      designVersion: "3",
    });
  });
});
