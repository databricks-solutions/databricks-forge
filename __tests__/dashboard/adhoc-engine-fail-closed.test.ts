import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardValidationError, runAdHocDashboardEngine } from "@/lib/dashboard/adhoc-engine";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";
import type { DashboardDesign, DashboardEngineDeps } from "@/lib/dashboard/types";
import type { SqlExecutor, SqlResult } from "@/lib/ports/sql-executor";

const mocks = vi.hoisted(() => ({
  createDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  getDashboard: vi.fn(),
  publishDashboard: vi.fn(),
  getPublishedDashboard: vi.fn(),
  serializedDashboard: "",
  displayName: "",
}));

vi.mock("@/lib/queries/metadata", () => ({
  fetchTableInfoBatch: vi.fn().mockResolvedValue([
    {
      catalog: "main",
      schema: "sales",
      tableName: "orders",
      fqn: "main.sales.orders",
      tableType: "MANAGED",
      comment: null,
    },
  ]),
  fetchColumnsBatch: vi.fn().mockResolvedValue([
    {
      tableFqn: "main.sales.orders",
      columnName: "amount",
      dataType: "DECIMAL(18,2)",
      ordinalPosition: 1,
      isNullable: true,
      comment: null,
    },
    {
      tableFqn: "main.sales.orders",
      columnName: "event_date",
      dataType: "DATE",
      ordinalPosition: 2,
      isNullable: true,
      comment: null,
    },
  ]),
}));

vi.mock("@/lib/dbx/dashboards", () => ({
  createDashboard: mocks.createDashboard,
  updateDashboard: mocks.updateDashboard,
  getDashboard: mocks.getDashboard,
  publishDashboard: mocks.publishDashboard,
  getPublishedDashboard: mocks.getPublishedDashboard,
  DEFAULT_DASHBOARD_PARENT_PATH: "/Shared/Forge Dashboards/",
}));

vi.mock("@/lib/dbx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dbx/client")>();
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      host: "https://example.cloud.databricks.com",
      warehouseId: "warehouse-1",
    })),
  };
});

const validDesign: DashboardDesign = {
  title: "Sales",
  description: "Sales overview",
  datasets: [
    {
      name: "sales_kpi",
      displayName: "Sales KPI",
      sql: "SELECT amount AS total FROM main.sales.orders",
      purpose: "kpi",
    },
  ],
  widgets: [
    {
      type: "counter",
      title: "Total Sales",
      datasetName: "sales_kpi",
      fields: [{ name: "total", expression: "`total`", role: "value" }],
    },
  ],
};

function sqlExecutorWith(result: SqlResult): SqlExecutor {
  return {
    execute: vi.fn().mockResolvedValue(result),
    executeMapped: vi.fn(),
    executeScalar: vi.fn(),
  };
}

function depsFor(
  design: DashboardDesign | DashboardDesignV2,
  sql: SqlExecutor,
): DashboardEngineDeps {
  return {
    sql,
    llm: {
      chat: vi.fn().mockResolvedValue({ content: JSON.stringify(design) }),
    },
    reviewAndFixSql: vi.fn(),
    isReviewEnabled: () => false,
  };
}

describe("runAdHocDashboardEngine fail-closed validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serializedDashboard = "";
    mocks.displayName = "";
    mocks.createDashboard.mockImplementation(async (options) => {
      mocks.serializedDashboard = options.serializedDashboard;
      mocks.displayName = options.displayName;
      return {
        dashboard_id: "dash-1",
        display_name: options.displayName,
        warehouse_id: "warehouse-1",
        parent_path: "/Shared/Forge Dashboards/",
      };
    });
    mocks.getDashboard.mockImplementation(async () => ({
      dashboard_id: "dash-1",
      display_name: mocks.displayName,
      warehouse_id: "warehouse-1",
      parent_path: "/Shared/Forge Dashboards/",
      serialized_dashboard: mocks.serializedDashboard,
    }));
  });

  it("does not deploy when the recommendation has a missing dataset reference", async () => {
    const invalidDesign: DashboardDesign = {
      ...validDesign,
      widgets: [{ ...validDesign.widgets[0], datasetName: "missing_dataset" }],
    };
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });

    const promise = runAdHocDashboardEngine({
      tables: ["main.sales.orders"],
      deploy: true,
      deps: depsFor(invalidDesign, sql),
    });

    await expect(promise).rejects.toBeInstanceOf(DashboardValidationError);
    await expect(promise).rejects.toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({ status: "failed", code: "WIDGET_DATASET_MISSING" }),
      ]),
    });

    expect(mocks.createDashboard).not.toHaveBeenCalled();
  });

  it("does not deploy when required dataset execution fails", async () => {
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });
    vi.mocked(sql.execute)
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockRejectedValueOnce(new Error("warehouse failed"));

    const promise = runAdHocDashboardEngine({
      tables: ["main.sales.orders"],
      deploy: true,
      deps: depsFor(validDesign, sql),
    });

    await expect(promise).rejects.toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({ status: "failed", code: "SQL_EXECUTION_FAILED" }),
      ]),
    });

    expect(mocks.createDashboard).not.toHaveBeenCalled();
    expect(vi.mocked(sql.execute).mock.calls.map(([statement]) => statement)).toEqual([
      expect.stringMatching(/^EXPLAIN /),
      validDesign.datasets[0].sql,
    ]);
  });

  it("generates and deploys valid provenance when optional SQL review is disabled", async () => {
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });

    const output = await runAdHocDashboardEngine({
      tables: ["main.sales.orders"],
      deploy: true,
      oboToken: "obo-token",
      deps: depsFor(validDesign, sql),
    });

    expect(output.recommendation.validationEvidence).toContainEqual(
      expect.objectContaining({
        status: "skipped",
        code: "LLM_REVIEW_DISABLED",
      }),
    );
    expect(mocks.createDashboard).toHaveBeenCalledOnce();
    expect(output.dashboardId).toBe("dash-1");
  });

  it("normalizes fabricated V2 semantic source metadata to table provenance", async () => {
    const fabricatedDesign: DashboardDesignV2 = {
      version: "2",
      title: "Fabricated semantics",
      description: "Untrusted ad-hoc output",
      datasets: [
        {
          name: "sales_kpi",
          displayName: "Sales KPI",
          purpose: "kpi",
          sourceKind: "metric_view",
          metricViewFqn: "attacker.fabricated.metric_view",
          metricIds: ["fabricated:measure"],
          dimensionIds: ["fabricated:dimension"],
          sql: "SELECT amount AS total FROM main.sales.orders",
          expectedFields: [{ name: "total", roles: ["value"], compatibleTypes: ["numeric"] }],
        },
      ],
      pages: [
        {
          name: "overview",
          displayName: "Overview",
          filters: [],
          widgets: [
            {
              type: "counter",
              title: "Total",
              datasetName: "sales_kpi",
              fields: [{ name: "total", expression: "`total`", role: "value" }],
            },
          ],
        },
      ],
      globalFilters: [],
    };
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });

    const output = await runAdHocDashboardEngine({
      tables: ["main.sales.orders"],
      deps: depsFor(fabricatedDesign, sql),
    });

    expect(output.recommendation).toMatchObject({
      datasetSourceKind: "table",
      dashboardDesign: {
        datasets: [
          {
            sourceKind: "table",
            metricIds: [],
            dimensionIds: [],
          },
        ],
      },
    });
    expect(output.recommendation.dashboardDesign.datasets[0].metricViewFqn).toBeUndefined();
    expect(JSON.stringify(output.recommendation)).not.toContain("attacker.fabricated.metric_view");
  });

  it("rejects malformed claimed-V2 output before dataset execution", async () => {
    const malformed = {
      version: "2",
      title: "Malformed",
      description: "Missing nested contracts",
      datasets: [
        {
          name: "sales_kpi",
          displayName: "Sales KPI",
          purpose: "kpi",
          sourceKind: "table",
          metricIds: [],
          dimensionIds: [],
          sql: "SELECT amount AS total FROM main.sales.orders",
        },
      ],
      pages: [{ name: "overview", displayName: "Overview", widgets: [], filters: [] }],
      globalFilters: [],
    } as unknown as DashboardDesignV2;
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });

    await expect(
      runAdHocDashboardEngine({
        tables: ["main.sales.orders"],
        deps: depsFor(malformed, sql),
      }),
    ).rejects.toMatchObject({
      name: "DashboardDesignV2ValidationError",
      issues: [
        expect.objectContaining({
          code: "V2_EXPECTED_FIELDS_INVALID",
          path: "datasets[0].expectedFields",
        }),
      ],
    });
    expect(sql.execute).not.toHaveBeenCalled();
  });

  it("rejects a missing expression column even when the display name exists", async () => {
    const invalidDesign: DashboardDesign = {
      ...validDesign,
      widgets: [
        {
          ...validDesign.widgets[0],
          fields: [{ name: "total", expression: "SUM(`revenue`)", role: "value" }],
        },
      ],
    };
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });

    await expect(
      runAdHocDashboardEngine({
        tables: ["main.sales.orders"],
        deps: depsFor(invalidDesign, sql),
      }),
    ).rejects.toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({ status: "failed", code: "ALIAS_MISSING" }),
      ]),
    });
  });

  it("accepts the prompt-style double-quoted DATE_TRUNC unit", async () => {
    const trendDesign: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          name: "sales_trend",
          displayName: "Sales Trend",
          sql: "SELECT event_date, amount FROM main.sales.orders",
          purpose: "trend",
        },
      ],
      widgets: [
        {
          type: "line",
          title: "Sales Trend",
          datasetName: "sales_trend",
          fields: [
            {
              name: "month",
              expression: 'DaTe_TrUnC("MONTH", `event_date`)',
              role: "x",
            },
            { name: "amount", expression: "`amount`", role: "y" },
          ],
        },
      ],
    };
    const sql = sqlExecutorWith({
      columns: [
        { name: "event_date", typeName: "DATE", position: 0 },
        { name: "amount", typeName: "DECIMAL(18,2)", position: 1 },
      ],
      rows: [["2026-07-01", "1"]],
      totalRowCount: 1,
    });

    const output = await runAdHocDashboardEngine({
      tables: ["main.sales.orders"],
      deps: depsFor(trendDesign, sql),
    });

    expect(output.recommendation.validationStatus).toBe("valid");
    const serialized = JSON.parse(output.recommendation.serializedDashboard);
    const line = serialized.pages[0].layout.find(
      (item: { widget: { spec?: { widgetType?: string } } }) =>
        item.widget.spec?.widgetType === "line",
    );
    expect(line.widget.spec.encodings.x.scale.type).toBe("temporal");
  });

  it("blocks ad-hoc deployment for a DATE_TRUNC unit outside the allowlist", async () => {
    const invalidDesign: DashboardDesign = {
      ...validDesign,
      widgets: [
        {
          ...validDesign.widgets[0],
          fields: [
            {
              name: "invalid_date",
              expression: "DATE_TRUNC('INVALID', `event_date`)",
              role: "value",
            },
          ],
        },
      ],
    };
    const sql = sqlExecutorWith({
      columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["1"]],
      totalRowCount: 1,
    });

    await expect(
      runAdHocDashboardEngine({
        tables: ["main.sales.orders"],
        deploy: true,
        deps: depsFor(invalidDesign, sql),
      }),
    ).rejects.toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          code: "WIDGET_EXPRESSION_UNSUPPORTED",
        }),
      ]),
    });
    expect(mocks.createDashboard).not.toHaveBeenCalled();
  });
});
