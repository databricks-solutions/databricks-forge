import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import { selectDatasetSource } from "@/lib/dashboard/source-policy";

const metricRow: Record<string, unknown> = {
  id: "proposal-1",
  runId: "run-1",
  schemaScope: "draft.metrics",
  domain: "Sales",
  subdomain: null,
  name: "sales_metrics",
  description: "Improved sales metrics",
  definitionJson: JSON.stringify({
    version: "1.1",
    name: "sales_metrics",
    source: { kind: "table", table: "main.sales.orders" },
    joins: [],
    dimensions: [{ kind: "local", name: "order_date", expr: "order_date" }],
    measures: [
      { kind: "expression", name: "revenue", expr: "SUM(amount)" },
      { kind: "expression", name: "orders", expr: "SUM(quantity)" },
    ],
    requiredFeatures: [],
  }),
  yaml: 'version: "1.1"',
  ddl: "CREATE VIEW `draft`.`metrics`.`sales_metrics` AS SELECT 1",
  sourceTablesJson: JSON.stringify(["main.sales.orders"]),
  hasJoins: false,
  classification: "improve",
  rationale: null,
  existingFqn: "draft.metrics.sales_metrics",
  improveDiffJson: null,
  improveBaseJson: null,
  validationStatus: "valid",
  validationIssues: "[]",
  validatorVersion: "metric-view-probes-v1",
  validationEvidenceJson: JSON.stringify([
    {
      stage: "metric_view_static",
      status: "passed",
      code: "METRIC_VIEW_STATIC_VALIDATION_PASSED",
      message: "ok",
    },
    {
      stage: "metric_view_create",
      status: "passed",
      code: "TEMP_METRIC_VIEW_CREATED",
      message: "ok",
    },
    {
      stage: "metric_view_probe",
      status: "passed",
      code: "ATOMIC_MEASURE_PROBE_PASSED",
      message: "ok",
    },
    {
      stage: "metric_view_cleanup",
      status: "passed",
      code: "TEMP_METRIC_VIEW_DROPPED",
      message: "ok",
    },
  ]),
  validatedAt: new Date("2026-07-24T00:00:00.000Z"),
  deploymentStatus: "proposed",
  deployedFqn: null,
  deployedAt: null,
  ownerEmail: "owner@example.com",
  createdAt: new Date("2026-07-24T00:00:00.000Z"),
  updatedAt: new Date("2026-07-24T00:00:00.000Z"),
};

const manifest: SemanticAssetManifest = {
  version: "1",
  domain: "Sales",
  subdomains: [],
  metricViews: [
    {
      id: "metric_view:draft_metrics_sales_metrics",
      intendedFqn: "draft.metrics.sales_metrics",
      validationState: "valid",
      measures: [
        {
          id: "measure:metric_view_draft_metrics_sales_metrics:revenue",
          name: "revenue",
          source: "metric_view",
          metricViewId: "metric_view:draft_metrics_sales_metrics",
          definition: { kind: "expression", name: "revenue", expr: "SUM(amount)" },
          synonyms: [],
          fallback: false,
        },
      ],
      dimensions: [],
      representativeQueries: ["SELECT MEASURE(revenue) FROM draft.metrics.sales_metrics"],
      deploymentState: "proposal",
      sourceTables: ["main.sales.orders"],
    },
  ],
  measures: [],
  dimensions: [],
  filters: [],
  generatedAt: "2026-07-24T00:00:00.000Z",
};

const recommendationRow: Record<string, unknown> = {
  id: "run-1_genie_sales",
  runId: "run-1",
  domain: "Sales",
  subdomains: "[]",
  title: "Sales",
  description: "Sales",
  tableCount: 1,
  metricViewCount: 1,
  useCaseCount: 1,
  sqlExampleCount: 0,
  joinCount: 0,
  measureCount: 1,
  filterCount: 0,
  dimensionCount: 0,
  tables: JSON.stringify(["main.sales.orders"]),
  metricViews: "[]",
  serializedSpace: JSON.stringify({ data_sources: {}, instructions: {} }),
  benchmarks: null,
  columnEnrichments: null,
  metricViewProposals: null,
  trustedFunctions: JSON.stringify(manifest),
  engineConfigVersion: 1,
  recommendationType: "new",
  existingAssetId: null,
  changeSummary: null,
};

const metricTable = {
  findUnique: vi.fn(async () => ({ ...metricRow })),
  update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    Object.assign(metricRow, data);
    return { ...metricRow };
  }),
};

const recommendationTable = {
  findUnique: vi.fn(async () => ({ ...recommendationRow })),
  update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    Object.assign(recommendationRow, data);
    return { ...recommendationRow };
  }),
  findMany: vi.fn(async () => [{ ...recommendationRow }]),
};

const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    forgeMetricViewProposal: metricTable,
    forgeGenieRecommendation: recommendationTable,
  }),
);

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(
    callback: (prisma: {
      $transaction: typeof transaction;
      forgeMetricViewProposal: typeof metricTable;
      forgeGenieRecommendation: typeof recommendationTable;
    }) => Promise<T>,
  ) =>
    callback({
      $transaction: transaction,
      forgeMetricViewProposal: metricTable,
      forgeGenieRecommendation: recommendationTable,
    }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { promoteMetricViewDeployment } from "@/lib/lakebase/metric-view-proposals";
import { getGenieRecommendationsByRunId } from "@/lib/lakebase/genie-recommendations";

describe("metric view manifest promotion", () => {
  beforeEach(() => {
    metricRow.deploymentStatus = "proposed";
    metricRow.deployedFqn = null;
    metricRow.deployedAt = null;
    recommendationRow.trustedFunctions = JSON.stringify(manifest);
    vi.clearAllMocks();
  });

  it("atomically promotes SQL-success state and makes the reloaded manifest selectable", async () => {
    const before = JSON.parse(
      (await getGenieRecommendationsByRunId("run-1"))[0].semanticAssetManifest!,
    ) as SemanticAssetManifest;
    expect(
      selectDatasetSource({
        purpose: "kpi",
        measureIds: ["measure:metric_view_draft_metrics_sales_metrics:revenue"],
        dimensionIds: [],
        manifest: before,
        metricFirstEnabled: true,
      }),
    ).toEqual({ kind: "table" });

    await promoteMetricViewDeployment("proposal-1", "prod.metrics.sales_metrics");

    const reloaded = JSON.parse(
      (await getGenieRecommendationsByRunId("run-1"))[0].semanticAssetManifest!,
    ) as SemanticAssetManifest;
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(metricRow).toMatchObject({
      deploymentStatus: "deployed",
      deployedFqn: "prod.metrics.sales_metrics",
    });
    expect(
      selectDatasetSource({
        purpose: "kpi",
        measureIds: ["measure:metric_view_draft_metrics_sales_metrics:revenue"],
        dimensionIds: [],
        manifest: reloaded,
        metricFirstEnabled: true,
      }),
    ).toMatchObject({
      kind: "metric_view",
      asset: {
        proposalId: "proposal-1",
        deployedFqn: "prod.metrics.sales_metrics",
        deploymentState: "deployed",
      },
    });
    expect(reloaded.metricViews[0].measures.map((measure) => measure.name)).toEqual([
      "orders",
      "revenue",
    ]);
  });
});
