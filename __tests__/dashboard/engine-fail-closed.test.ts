import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runDashboardEngine } from "@/lib/dashboard/engine";
import { isDashboardValidationDeployable } from "@/lib/dashboard/deployability";
import { DASHBOARD_VALIDATOR_VERSION } from "@/lib/validation/evidence";
import type {
  DashboardDesign,
  DashboardEngineInput,
  DashboardEngineDeps,
} from "@/lib/dashboard/types";
import type { Logger } from "@/lib/ports/logger";
import type { SqlExecutor, SqlResult } from "@/lib/ports/sql-executor";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import { adaptLegacyDashboardDesign } from "@/lib/dashboard/legacy-design-adapter";
import { assembleLakeviewDashboard } from "@/lib/dashboard/assembler";
import { fingerprintSerializedDashboard } from "@/lib/dashboard/live-artifact";

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

const result: SqlResult = {
  columns: [{ name: "total", typeName: "DECIMAL(18,2)", position: 0 }],
  rows: [["private-value-never-evidence"]],
  totalRowCount: 1,
};

const metricSqlResult: SqlResult = {
  columns: [{ name: "total_revenue", typeName: "DECIMAL(18,2)", position: 0 }],
  rows: [["10"]],
  totalRowCount: 1,
};

function loggerWithEvidence(): { logger: Logger; evidence: unknown[] } {
  const evidence: unknown[] = [];
  const capture = (_message: string, meta?: Record<string, unknown>) => {
    if (Array.isArray(meta?.validationEvidence)) evidence.push(...meta.validationEvidence);
  };
  return {
    evidence,
    logger: {
      debug: vi.fn(),
      info: vi.fn(capture),
      warn: vi.fn(capture),
      error: vi.fn(capture),
    },
  };
}

function sqlExecutorWith(execute: SqlExecutor["execute"]): SqlExecutor {
  return {
    execute,
    executeMapped: vi.fn(),
    executeScalar: vi.fn(),
  };
}

function makeInput(
  design: DashboardDesign,
  sqlExecutor: SqlExecutor,
  logger: Logger,
): DashboardEngineInput {
  const deps: DashboardEngineDeps = {
    logger,
    sql: sqlExecutor,
    llm: {
      chat: vi.fn().mockResolvedValue({ content: JSON.stringify(design) }),
    },
    reviewAndFixSql: vi.fn(),
    isReviewEnabled: () => false,
  };

  return {
    run: {
      runId: "run-1",
      config: { businessName: "Acme" },
      businessContext: null,
    } as DashboardEngineInput["run"],
    useCases: [
      {
        id: "uc-1",
        domain: "Sales",
        subdomain: "Orders",
        tablesInvolved: ["main.sales.orders"],
        name: "Sales overview",
        statement: "Understand total sales",
        businessValue: "Improve decisions",
        overallScore: 0.9,
        priorityScore: 0.9,
        feasibilityScore: 0.9,
        impactScore: 0.9,
        sqlCode: null,
      },
    ] as DashboardEngineInput["useCases"],
    metadata: {
      cacheKey: "test",
      ucPath: "main.sales",
      tables: [
        {
          catalog: "main",
          schema: "sales",
          tableName: "orders",
          fqn: "main.sales.orders",
          tableType: "MANAGED",
          comment: null,
        },
      ],
      columns: [
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
        {
          tableFqn: "main.sales.orders",
          columnName: "category",
          dataType: "STRING",
          ordinalPosition: 3,
          isNullable: true,
          comment: null,
        },
      ],
      foreignKeys: [],
      metricViews: [],
      tableCount: 1,
      columnCount: 3,
      cachedAt: "2026-07-24T00:00:00.000Z",
      lineageDiscoveredFqns: [],
    },
    deps,
  };
}

function metricManifest(options?: {
  dimensionId?: string;
  dimensionName?: string;
}): SemanticAssetManifest {
  const dimensions = options?.dimensionId
    ? [
        {
          id: options.dimensionId,
          name: options.dimensionName ?? "order_date",
          source: "metric_view" as const,
          metricViewId: "metric_view:sales",
          definition: {
            kind: "local" as const,
            name: options.dimensionName ?? "order_date",
            expr: "source.order_date",
          },
          synonyms: [],
          fallback: false as const,
        },
      ]
    : [];
  return {
    version: "1",
    domain: "Sales",
    subdomains: [],
    metricViews: [
      {
        id: "metric_view:sales",
        intendedFqn: "main.sales.sales_metrics",
        deployedFqn: "main.sales.sales_metrics",
        validationState: "valid",
        measures: [
          {
            id: "measure:mv:sales:total_revenue",
            name: "total_revenue",
            source: "metric_view",
            metricViewId: "metric_view:sales",
            definition: {
              kind: "expression",
              name: "total_revenue",
              expr: "SUM(source.amount)",
            },
            synonyms: [],
            fallback: false,
          },
        ],
        dimensions,
        representativeQueries: [],
        deploymentState: "deployed",
        sourceTables: ["main.sales.orders"],
      },
    ],
    measures: [],
    dimensions: [],
    filters: [],
    generatedAt: "2026-07-24T00:00:00.000Z",
  };
}

function metricDesign(options?: {
  measureIds?: string[];
  dimensionIds?: string[];
  purpose?: DashboardDesign["datasets"][number]["purpose"];
}): DashboardDesign {
  return {
    title: "Governed Sales",
    description: "Governed KPI",
    datasets: [
      {
        name: "sales_kpi",
        displayName: "Sales KPI",
        sql: "SELECT SUM(amount) AS total_revenue FROM main.sales.orders",
        purpose: options?.purpose ?? "kpi",
        measureIds: options?.measureIds ?? ["measure:mv:sales:total_revenue"],
        dimensionIds: options?.dimensionIds ?? [],
      },
    ],
    widgets: [
      {
        type: "counter",
        title: "Total Revenue",
        datasetName: "sales_kpi",
        fields: [
          {
            name: "total_revenue",
            expression: "`total_revenue`",
            role: "value",
          },
        ],
      },
    ],
  };
}

describe("runDashboardEngine fail-closed validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FORGE_METRIC_FIRST_DASHBOARD_SOURCES", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails a filtered dashboard domain when its persisted manifest is missing", async () => {
    const { logger } = loggerWithEvidence();
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockResolvedValue(result)),
      logger,
    );
    input.useCases = [
      input.useCases[0],
      { ...input.useCases[0], id: "uc-finance", domain: "Finance" },
    ];
    input.domainFilter = [" finance "];
    input.semanticManifests = { Sales: metricManifest() };

    const output = await runDashboardEngine(input);

    expect(output.recommendations).toEqual([]);
    expect(output.validationFailures).toEqual([
      {
        domain: "Finance",
        evidence: [
          expect.objectContaining({
            stage: "semantic_manifest",
            status: "failed",
            code: "SEMANTIC_MANIFEST_MISSING",
          }),
        ],
      },
    ]);
    expect(input.deps?.llm?.chat).not.toHaveBeenCalled();
  });

  it("does not count a manifest whose declared domain mismatches its map key", async () => {
    const { logger } = loggerWithEvidence();
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockResolvedValue(result)),
      logger,
    );
    input.useCases = [{ ...input.useCases[0], domain: "Finance" }];
    input.semanticManifests = { Finance: metricManifest() };

    const output = await runDashboardEngine(input);

    expect(output.validationFailures[0]).toMatchObject({
      domain: "Finance",
      evidence: [
        expect.objectContaining({
          code: "SEMANTIC_MANIFEST_MISSING",
        }),
      ],
    });
    expect(input.deps?.llm?.chat).not.toHaveBeenCalled();
  });

  it("blocks a recommendation when required dataset execution fails", async () => {
    const { logger } = loggerWithEvidence();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockRejectedValueOnce(new Error("query failed"));
    const input = makeInput(validDesign, sqlExecutorWith(execute), logger);

    const output = await runDashboardEngine(input);

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures).toContainEqual(
      expect.objectContaining({
        domain: "Sales Analytics",
        evidence: expect.arrayContaining([
          expect.objectContaining({ status: "failed", code: "SQL_EXECUTION_FAILED" }),
        ]),
      }),
    );
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringMatching(/^EXPLAIN /),
      validDesign.datasets[0].sql,
    ]);
  });

  it("treats an unprovable missing-GROUP-BY KPI lint as advisory and validates execution", async () => {
    const { logger } = loggerWithEvidence();
    const validAggregateKpi: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          ...validDesign.datasets[0],
          sql: [
            "SELECT 'USD' AS currency,",
            "  COALESCE(SUM(amount), 0) AS total",
            "FROM main.sales.orders",
          ].join("\n"),
        },
      ],
    };
    const aggregateResult: SqlResult = {
      columns: [
        { name: "currency", typeName: "STRING", position: 0 },
        { name: "total", typeName: "DECIMAL(18,2)", position: 1 },
      ],
      rows: [["USD", "10"]],
      totalRowCount: 1,
    };
    const execute = vi.fn().mockResolvedValue(aggregateResult);

    const output = await runDashboardEngine(
      makeInput(validAggregateKpi, sqlExecutorWith(execute), logger),
    );

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `EXPLAIN ${validAggregateKpi.datasets[0].sql}`,
      validAggregateKpi.datasets[0].sql,
    ]);
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations).toHaveLength(1);
    expect(output.recommendations[0].validationEvidence).toContainEqual(
      expect.objectContaining({
        stage: "dataset_static",
        status: "skipped",
        code: "MISSING_GROUP_BY_LINT_ADVISORY",
      }),
    );
    expect(output.recommendations[0].validationEvidence).toContainEqual(
      expect.objectContaining({
        stage: "dataset_static",
        status: "passed",
        code: "STATIC_LINT_PASSED",
        artifactRef: "dataset:sales_kpi",
      }),
    );
    expect(isDashboardValidationDeployable(output.recommendations[0])).toBe(true);
  });

  it("fails genuinely invalid mixed aggregate SQL through the executor with advisory evidence", async () => {
    const { logger } = loggerWithEvidence();
    const invalidMixedAggregate: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          ...validDesign.datasets[0],
          sql: "SELECT category, SUM(amount) AS total FROM main.sales.orders",
        },
      ],
    };
    const execute = vi.fn().mockRejectedValue(new Error("MISSING_AGGREGATION: category"));

    const output = await runDashboardEngine(
      makeInput(invalidMixedAggregate, sqlExecutorWith(execute), logger),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(`EXPLAIN ${invalidMixedAggregate.datasets[0].sql}`);
    expect(output.recommendations).toEqual([]);
    expect(output.validationFailures[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          code: "MISSING_GROUP_BY_LINT_ADVISORY",
        }),
        expect.objectContaining({
          stage: "dataset_explain",
          status: "failed",
          code: "EXPLAIN_FAILED",
        }),
      ]),
    );
    expect(output.validationFailures[0].evidence).not.toContainEqual(
      expect.objectContaining({ code: "STATIC_LINT_FAILED" }),
    );
  });

  it("redacts adversarial Databricks EXPLAIN errors from evidence and logger calls", async () => {
    const { logger } = loggerWithEvidence();
    const failure = new Error(
      "MISSING_AGGREGATION: SELECT 'private-literal' FROM main.sales.orders; " +
        "Authorization: Basic basic-secret; access_token=access-secret; prompt=private plan",
    ) as Error & { code: string };
    failure.code = "ETIMEDOUT";
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockRejectedValue(failure)),
      logger,
    );

    const output = await runDashboardEngine(input);

    expect(output.recommendations).toEqual([]);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({
        code: "EXPLAIN_FAILED",
        message: expect.stringMatching(/runtime\/ETIMEDOUT/),
      }),
    );
    const diagnostics = JSON.stringify({
      evidence: output.validationFailures[0].evidence,
      loggerCalls: [
        ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
      ],
    });
    for (const secret of [
      "private-literal",
      "main.sales.orders",
      "Basic",
      "basic-secret",
      "access-secret",
      "private plan",
    ]) {
      expect(diagnostics).not.toContain(secret);
    }
  });

  it("redacts adversarial bounded-execution errors from evidence and logger calls", async () => {
    const { logger } = loggerWithEvidence();
    const failure = new Error(
      "EXECUTION_ERROR: SELECT 'execution-secret'; Authorization: Bearer bearer-secret; " +
        "client_secret=client-secret; prompt=private execution prompt",
    ) as Error & { code: string };
    failure.code = "ETIMEDOUT";
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockRejectedValueOnce(failure);
    const input = makeInput(validDesign, sqlExecutorWith(execute), logger);

    const output = await runDashboardEngine(input);

    expect(output.recommendations).toEqual([]);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({
        code: "SQL_EXECUTION_FAILED",
        message: expect.stringMatching(/runtime\/ETIMEDOUT/),
      }),
    );
    const diagnostics = JSON.stringify({
      evidence: output.validationFailures[0].evidence,
      loggerCalls: [
        ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
      ],
    });
    for (const secret of [
      "execution-secret",
      "Bearer",
      "bearer-secret",
      "client-secret",
      "private execution prompt",
    ]) {
      expect(diagnostics).not.toContain(secret);
    }
  });

  it("repairs one ambiguous-column execution failure and reruns every dataset gate", async () => {
    const { logger } = loggerWithEvidence();
    const repairedSql =
      "SELECT p.amount AS total FROM main.sales.orders p JOIN main.sales.orders w ON p.category = w.category";
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockRejectedValueOnce(
        new Error(
          "[AMBIGUOUS_REFERENCE] Reference `amount` is ambiguous, could be: p.amount, w.amount",
        ),
      )
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockResolvedValueOnce(result);
    const input = makeInput(validDesign, sqlExecutorWith(execute), logger);
    input.deps!.isReviewEnabled = () => true;
    input.deps!.reviewAndFixSql = vi
      .fn()
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null })
      .mockResolvedValueOnce({ verdict: "fail", issues: [], fixedSql: repairedSql })
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null });

    const output = await runDashboardEngine(input);

    expect(input.deps!.reviewAndFixSql).toHaveBeenCalledTimes(3);
    expect(input.deps!.reviewAndFixSql).toHaveBeenNthCalledWith(
      2,
      validDesign.datasets[0].sql,
      expect.objectContaining({
        requestFix: true,
        runtimeError: expect.stringContaining("AMBIGUOUS_REFERENCE"),
      }),
    );
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `EXPLAIN ${validDesign.datasets[0].sql}`,
      validDesign.datasets[0].sql,
      `EXPLAIN ${repairedSql}`,
      repairedSql,
    ]);
    expect(output.validationFailures).toEqual([]);
    expect(output.recommendations[0].dashboardDesign?.datasets[0].sql).toBe(repairedSql);
    expect(output.recommendations[0].validationEvidence).toContainEqual(
      expect.objectContaining({
        stage: "dataset_repair",
        status: "passed",
        code: "EXECUTION_REPAIR_SUCCEEDED",
      }),
    );
    expect(isDashboardValidationDeployable(output.recommendations[0])).toBe(true);
  });

  it("fails closed after one unsuccessful execution repair attempt", async () => {
    const { logger } = loggerWithEvidence();
    const stillInvalidSql =
      "SELECT amount AS total FROM main.sales.orders p JOIN main.sales.orders w";
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockRejectedValueOnce(new Error("[UNRESOLVED_COLUMN] Column `amount` cannot be resolved"))
      .mockRejectedValueOnce(new Error("[UNRESOLVED_COLUMN] Fixed SQL is still unresolved"));
    const input = makeInput(validDesign, sqlExecutorWith(execute), logger);
    input.deps!.isReviewEnabled = () => true;
    input.deps!.reviewAndFixSql = vi
      .fn()
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null })
      .mockResolvedValueOnce({ verdict: "fail", issues: [], fixedSql: stillInvalidSql })
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null });

    const output = await runDashboardEngine(input);

    expect(input.deps!.reviewAndFixSql).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(output.recommendations).toEqual([]);
    expect(output.validationFailures[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SQL_EXECUTION_FAILED", status: "failed" }),
        expect.objectContaining({ code: "EXPLAIN_FAILED", status: "failed" }),
        expect.objectContaining({
          stage: "dataset_repair",
          code: "EXECUTION_REPAIR_FAILED",
          status: "failed",
        }),
      ]),
    );
  });

  it("blocks a recommendation rather than orphaning a widget", async () => {
    const { logger } = loggerWithEvidence();
    const orphanedDesign: DashboardDesign = {
      ...validDesign,
      widgets: [{ ...validDesign.widgets[0], datasetName: "missing_dataset" }],
    };

    const output = await runDashboardEngine(
      makeInput(orphanedDesign, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({ status: "failed", code: "WIDGET_DATASET_MISSING" }),
    );
  });

  it("blocks a recommendation when the assembled dashboard contract is invalid", async () => {
    const { logger } = loggerWithEvidence();
    const duplicateWidgetDesign: DashboardDesign = {
      ...validDesign,
      widgets: [validDesign.widgets[0], { ...validDesign.widgets[0] }],
    };

    const output = await runDashboardEngine(
      makeInput(duplicateWidgetDesign, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({
        stage: "dashboard_contract",
        status: "failed",
        code: "WIDGET_ID_DUPLICATE",
        message: expect.stringContaining("duplicated"),
      }),
    );
  });

  it("validates expression identifiers rather than display field names", async () => {
    const { logger } = loggerWithEvidence();
    const mismatchedExpression: DashboardDesign = {
      ...validDesign,
      widgets: [
        {
          ...validDesign.widgets[0],
          fields: [{ name: "total", expression: "`revenue`", role: "value" }],
        },
      ],
    };

    const output = await runDashboardEngine(
      makeInput(mismatchedExpression, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({ status: "failed", code: "ALIAS_MISSING" }),
    );
  });

  it("fails closed on unsupported widget expressions", async () => {
    const { logger } = loggerWithEvidence();
    const unsupportedExpression: DashboardDesign = {
      ...validDesign,
      widgets: [
        {
          ...validDesign.widgets[0],
          fields: [{ name: "total", expression: "SUM(`revenue`) / 100", role: "value" }],
        },
      ],
    };

    const output = await runDashboardEngine(
      makeInput(unsupportedExpression, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({
        status: "failed",
        code: "WIDGET_EXPRESSION_UNSUPPORTED",
      }),
    );
  });

  it("allows a multi-row direct-field KPI source when a shared filter makes it non-disaggregated", async () => {
    const { logger } = loggerWithEvidence();
    const filteredKpiDesign: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          ...validDesign.datasets[0],
          sql: "SELECT amount AS total, event_date FROM main.sales.orders",
        },
      ],
      widgets: [
        validDesign.widgets[0],
        {
          type: "filter-date-range-picker",
          title: "Date",
          datasetName: "sales_kpi",
          fields: [{ name: "event_date", expression: "`event_date`", role: "filter" }],
        },
      ],
    };
    const multiRowResult: SqlResult = {
      columns: [
        { name: "total", typeName: "DECIMAL(18,2)", position: 0 },
        { name: "event_date", typeName: "DATE", position: 1 },
      ],
      rows: [
        ["1", "2026-07-01"],
        ["2", "2026-07-02"],
      ],
      totalRowCount: 2,
    };

    const output = await runDashboardEngine(
      makeInput(
        filteredKpiDesign,
        sqlExecutorWith(vi.fn().mockResolvedValue(multiRowResult)),
        logger,
      ),
    );

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations).toHaveLength(1);
  });

  it("accepts DATE_TRUNC with a quoted source identifier for trend axes", async () => {
    const { logger } = loggerWithEvidence();
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
              expression: 'DATE_TRUNC("MONTH", `event_date`)',
              role: "x",
            },
            { name: "amount", expression: "`amount`", role: "y" },
          ],
        },
      ],
    };
    const trendResult: SqlResult = {
      columns: [
        { name: "event_date", typeName: "DATE", position: 0 },
        { name: "amount", typeName: "DECIMAL(18,2)", position: 1 },
      ],
      rows: [["2026-07-01", "10"]],
      totalRowCount: 1,
    };

    const output = await runDashboardEngine(
      makeInput(trendDesign, sqlExecutorWith(vi.fn().mockResolvedValue(trendResult)), logger),
    );

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations).toHaveLength(1);
  });

  it("normalizes and accepts lowercase DATE_TRUNC units", async () => {
    const { logger } = loggerWithEvidence();
    const trendDesign: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          name: "weekly_sales",
          displayName: "Weekly Sales",
          sql: "SELECT event_date, amount FROM main.sales.orders",
          purpose: "trend",
        },
      ],
      widgets: [
        {
          type: "line",
          title: "Weekly Sales",
          datasetName: "weekly_sales",
          fields: [
            { name: "week", expression: "date_trunc('week', event_date)", role: "x" },
            { name: "amount", expression: "`amount`", role: "y" },
          ],
        },
      ],
    };
    const trendResult: SqlResult = {
      columns: [
        { name: "event_date", typeName: "TIMESTAMP", position: 0 },
        { name: "amount", typeName: "DECIMAL(18,2)", position: 1 },
      ],
      rows: [["2026-07-20T00:00:00Z", "10"]],
      totalRowCount: 1,
    };

    const output = await runDashboardEngine(
      makeInput(trendDesign, sqlExecutorWith(vi.fn().mockResolvedValue(trendResult)), logger),
    );

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations).toHaveLength(1);
    const serialized = JSON.parse(output.recommendations[0].serializedDashboard);
    const line = serialized.pages[0].layout.find(
      (item: { widget: { spec?: { widgetType?: string } } }) =>
        item.widget.spec?.widgetType === "line",
    );
    expect(line.widget.spec.encodings.x.scale.type).toBe("temporal");
  });

  it("rejects DATE_TRUNC units outside the Forge allowlist", async () => {
    const { logger } = loggerWithEvidence();
    const invalidUnitDesign: DashboardDesign = {
      ...validDesign,
      widgets: [
        {
          ...validDesign.widgets[0],
          fields: [
            {
              name: "invalid_date",
              expression: 'DATE_TRUNC("INVALID", `event_date`)',
              role: "value",
            },
          ],
        },
      ],
    };

    const output = await runDashboardEngine(
      makeInput(invalidUnitDesign, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({ code: "WIDGET_EXPRESSION_UNSUPPORTED", status: "failed" }),
    );
  });

  it("rejects malformed DATE_TRUNC expressions", async () => {
    const { logger } = loggerWithEvidence();
    const malformedTrend: DashboardDesign = {
      ...validDesign,
      widgets: [
        {
          ...validDesign.widgets[0],
          fields: [
            {
              name: "month",
              expression: "DATE_TRUNC('MONTH', COALESCE(`event_date`, CURRENT_DATE()))",
              role: "value",
            },
          ],
        },
      ],
    };

    const output = await runDashboardEngine(
      makeInput(malformedTrend, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({ code: "WIDGET_EXPRESSION_UNSUPPORTED", status: "failed" }),
    );
  });

  it("rejects STRING results for date-range filter fields", async () => {
    const { logger } = loggerWithEvidence();
    const dateFilterDesign: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          ...validDesign.datasets[0],
          sql: "SELECT amount AS total, event_date FROM main.sales.orders",
        },
      ],
      widgets: [
        validDesign.widgets[0],
        {
          type: "filter-date-range-picker",
          title: "Date",
          datasetName: "sales_kpi",
          fields: [{ name: "event_date", expression: "`event_date`", role: "filter" }],
        },
      ],
    };
    const stringDateResult: SqlResult = {
      columns: [
        { name: "total", typeName: "DECIMAL(18,2)", position: 0 },
        { name: "event_date", typeName: "STRING", position: 1 },
      ],
      rows: [["1", "2026-07-01"]],
      totalRowCount: 1,
    };

    const output = await runDashboardEngine(
      makeInput(
        dateFilterDesign,
        sqlExecutorWith(vi.fn().mockResolvedValue(stringDateResult)),
        logger,
      ),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({ code: "TYPE_INCOMPATIBLE", status: "failed" }),
    );
  });

  it("accepts categorical columns for multi-select filters", async () => {
    const { logger } = loggerWithEvidence();
    const categoricalFilterDesign: DashboardDesign = {
      ...validDesign,
      datasets: [
        {
          ...validDesign.datasets[0],
          sql: "SELECT amount AS total, category FROM main.sales.orders",
        },
      ],
      widgets: [
        validDesign.widgets[0],
        {
          type: "filter-multi-select",
          title: "Category",
          datasetName: "sales_kpi",
          fields: [{ name: "category", expression: "`category`", role: "filter" }],
        },
      ],
    };
    const categoricalResult: SqlResult = {
      columns: [
        { name: "total", typeName: "DECIMAL(18,2)", position: 0 },
        { name: "category", typeName: "STRING", position: 1 },
      ],
      rows: [["1", "Retail"]],
      totalRowCount: 1,
    };

    const output = await runDashboardEngine(
      makeInput(
        categoricalFilterDesign,
        sqlExecutorWith(vi.fn().mockResolvedValue(categoricalResult)),
        logger,
      ),
    );

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations).toHaveLength(1);
  });

  it("requires one row for a direct-field KPI dataset contract", async () => {
    const { logger } = loggerWithEvidence();
    const multiRowResult: SqlResult = {
      ...result,
      rows: [["1"], ["2"]],
      totalRowCount: 2,
    };

    const output = await runDashboardEngine(
      makeInput(validDesign, sqlExecutorWith(vi.fn().mockResolvedValue(multiRowResult)), logger),
    );

    expect(output.recommendations).toHaveLength(0);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({ status: "failed", code: "ROW_COUNT_INVALID" }),
    );
  });

  it("returns validation status and row-free evidence for a fully valid recommendation", async () => {
    const { logger } = loggerWithEvidence();

    const output = await runDashboardEngine(
      makeInput(validDesign, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations).toHaveLength(1);
    expect(output.recommendations[0]).toMatchObject({
      validationStatus: "valid",
      validatorVersion: DASHBOARD_VALIDATOR_VERSION,
      validatedAt: expect.any(String),
      validationEvidence: expect.arrayContaining([
        expect.objectContaining({ code: "SQL_EXECUTION_SUCCEEDED", status: "passed" }),
        expect.objectContaining({
          code: DASHBOARD_VALIDATOR_VERSION,
          status: "passed",
        }),
      ]),
    });
    expect(output.recommendations[0].validationEvidence).toContainEqual(
      expect.objectContaining({
        code: "LLM_REVIEW_DISABLED",
        status: "skipped",
      }),
    );
    expect(isDashboardValidationDeployable(output.recommendations[0])).toBe(true);
    expect(JSON.stringify(output.recommendations[0].validationEvidence)).not.toContain(
      "private-value-never-evidence",
    );
  });

  it("returns a structured failure instead of valid status for incomplete provenance", async () => {
    const { logger } = loggerWithEvidence();
    const toISOString = vi.spyOn(Date.prototype, "toISOString").mockReturnValue("not-a-date");

    try {
      const output = await runDashboardEngine(
        makeInput(validDesign, sqlExecutorWith(vi.fn().mockResolvedValue(result)), logger),
      );

      expect(output.recommendations).toEqual([]);
      expect(output.validationFailures).toEqual([
        {
          domain: "Sales Analytics",
          evidence: expect.arrayContaining([
            expect.objectContaining({
              stage: "dashboard_provenance",
              status: "failed",
              code: "VALIDATION_PROVENANCE_INCOMPLETE",
            }),
          ]),
        },
      ]);
    } finally {
      toISOString.mockRestore();
    }
  });

  it.each(["Sales", "Sales Analytics"])(
    "lets raw Sales use cases consume %s Genie recommendation snippets",
    async (recommendationDomain) => {
      const { logger } = loggerWithEvidence();
      const input = makeInput(
        validDesign,
        sqlExecutorWith(vi.fn().mockResolvedValue(result)),
        logger,
      );
      const serializedSpace = readFileSync(
        join(process.cwd(), "__tests__/fixtures/genie-serialized-space-current.json"),
        "utf8",
      );
      input.genieRecommendations = [
        {
          domain: recommendationDomain,
          serializedSpace,
        } as never,
      ];
      const chat = input.deps?.llm?.chat as ReturnType<typeof vi.fn>;

      const output = await runDashboardEngine(input);

      expect(output.validationFailures).toEqual([]);
      expect(output.recommendations).toHaveLength(1);
      expect(chat).toHaveBeenCalledOnce();
      const prompt = chat.mock.calls[0][0].messages[1].content as string;
      expect(prompt).toContain("- Total Revenue: SUM(main.sales.orders.amount)");
      expect(prompt).toContain("- Order Category: main.sales.orders.category");
      expect(prompt).toContain("- Order Date: main.sales.orders.event_date");
      expect(prompt).toContain("- Order Date (`main.sales.orders.event_date` in , type: STRING)");
      expect(prompt).not.toContain("malformed");
      expect(prompt).not.toContain("undefined");
    },
  );

  it("logs bounded diagnostic metadata without SQL, prompts, tokens, messages, or causes", async () => {
    const { logger } = loggerWithEvidence();
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockResolvedValue(result)),
      logger,
    );
    const failure = new Error(
      "SELECT * FROM main.sales.orders; Authorization: Bearer secret-token; prompt=private strategy",
      {
        cause: new Error("cause includes bearer secondary-token and private prompt text"),
      },
    );
    failure.stack = [
      `Error: ${failure.message}`,
      "    at processDomain (/workspace/lib/dashboard/engine.ts:999:11)",
      "    at async runDashboardEngine (/workspace/lib/dashboard/engine.ts:1120:7)",
    ].join("\n");
    (failure as Error & { code: string }).code =
      "INVALID_TOKEN secret-token SELECT_FROM_main.sales.orders";
    (input.deps?.llm?.chat as ReturnType<typeof vi.fn>).mockRejectedValue(failure);

    const output = await runDashboardEngine(input);

    expect(logger.error).toHaveBeenCalledWith(
      "Dashboard Engine: domain failed",
      expect.objectContaining({
        domain: "Sales Analytics",
        errorName: "Error",
        errorCategory: "runtime",
        safeSummary: "Dashboard domain generation failed.",
        location: "lib/dashboard/engine.ts:999:11",
      }),
    );
    const logged = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    for (const secret of [
      "SELECT",
      "main.sales.orders",
      "Bearer",
      "secret-token",
      "private strategy",
      "secondary-token",
      "prompt text",
    ]) {
      expect(logged).not.toContain(secret);
      expect(JSON.stringify(output)).not.toContain(secret);
    }
    const metadata = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(metadata).not.toHaveProperty("error");
    expect(metadata).not.toHaveProperty("stack");
    expect(metadata).not.toHaveProperty("cause");
    expect(metadata).not.toHaveProperty("code");
  });

  it("classifies an empty typed diff as exact-target reuse", async () => {
    const { logger } = loggerWithEvidence();
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockResolvedValue(result)),
      logger,
    );
    input.existingDashboards = [
      {
        dashboardId: "discovered-dashboard",
        displayName: "Existing Sales",
        tables: ["main.sales.orders"],
        isPublished: true,
        datasetCount: 1,
        widgetCount: 1,
        dashboardDesign: adaptLegacyDashboardDesign(validDesign),
        liveSerializedFingerprint: fingerprintSerializedDashboard(
          assembleLakeviewDashboard(adaptLegacyDashboardDesign(validDesign)),
        ),
      },
    ];

    const output = await runDashboardEngine(input);

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      classification: "reuse",
      recommendationType: "reuse",
      existingAssetId: "discovered-dashboard",
      improveDiff: {
        existingAssetId: "discovered-dashboard",
        addDatasets: [],
        addWidgets: [],
        addFilters: [],
      },
    });
  });

  it("classifies nonempty additions as an exact-target improvement", async () => {
    const { logger } = loggerWithEvidence();
    const generated = adaptLegacyDashboardDesign(validDesign);
    const existing = {
      ...generated,
      datasets: [],
      pages: generated.pages.map((page) => ({ ...page, widgets: [] })),
    };
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockResolvedValue(result)),
      logger,
    );
    input.existingDashboards = [
      {
        dashboardId: "discovered-dashboard",
        displayName: "Existing Sales",
        tables: ["main.sales.orders"],
        isPublished: true,
        datasetCount: 0,
        widgetCount: 0,
        dashboardDesign: existing,
        liveSerializedFingerprint: fingerprintSerializedDashboard(
          assembleLakeviewDashboard(existing),
        ),
      },
    ];

    const output = await runDashboardEngine(input);

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      classification: "improve",
      recommendationType: "enhancement",
      existingAssetId: "discovered-dashboard",
      improveBaseDesign: existing,
      improveDiff: {
        existingAssetId: "discovered-dashboard",
        addDatasets: [expect.objectContaining({ name: "sales_kpi" })],
        addWidgets: [expect.objectContaining({ title: "Total Sales" })],
      },
    });
  });

  it("omits an unverified improvement base and still generates a new recommendation", async () => {
    const { logger } = loggerWithEvidence();
    const input = makeInput(
      validDesign,
      sqlExecutorWith(vi.fn().mockResolvedValue(result)),
      logger,
    );
    input.existingDashboards = [
      {
        dashboardId: "discovered-dashboard",
        displayName: "Existing Sales",
        tables: ["main.sales.orders"],
        isPublished: true,
        datasetCount: 1,
        widgetCount: 1,
      },
    ];

    const output = await runDashboardEngine(input);

    expect(output.validationFailures).toEqual([]);
    expect(output.recommendations).toHaveLength(1);
    expect(output.recommendations[0]).toMatchObject({
      classification: "new",
      recommendationType: "new",
    });
    expect(output.recommendations[0]).not.toHaveProperty("existingAssetId");
  });

  it("resolves stable semantic IDs to metric-view SQL before Release 1 gates", async () => {
    const { logger } = loggerWithEvidence();
    const design: DashboardDesign = {
      title: "Governed Sales",
      description: "Governed KPI",
      datasets: [
        {
          name: "sales_kpi",
          displayName: "Sales KPI",
          sql: "SELECT SUM(amount) AS total_revenue FROM main.sales.orders",
          purpose: "kpi",
          measureIds: ["measure:mv:sales:total_revenue"],
          dimensionIds: [],
        },
      ],
      widgets: [
        {
          type: "counter",
          title: "Total Revenue",
          datasetName: "sales_kpi",
          fields: [
            {
              name: "total_revenue",
              expression: "`total_revenue`",
              role: "value",
            },
          ],
        },
      ],
    };
    const manifest: SemanticAssetManifest = {
      version: "1",
      domain: "Sales",
      subdomains: [],
      metricViews: [
        {
          id: "metric_view:sales",
          intendedFqn: "main.sales.sales_metrics",
          deployedFqn: "main.sales.sales_metrics",
          validationState: "valid",
          measures: [
            {
              id: "measure:mv:sales:total_revenue",
              name: "total_revenue",
              source: "metric_view",
              metricViewId: "metric_view:sales",
              definition: {
                kind: "expression",
                name: "total_revenue",
                expr: "SUM(source.amount)",
              },
              synonyms: [],
              fallback: false,
            },
          ],
          dimensions: [],
          representativeQueries: [],
          deploymentState: "deployed",
          sourceTables: ["main.sales.orders"],
        },
      ],
      measures: [],
      dimensions: [],
      filters: [],
      generatedAt: "2026-07-24T00:00:00.000Z",
    };
    const metricResult: SqlResult = {
      columns: [{ name: "total_revenue", typeName: "DECIMAL(18,2)", position: 0 }],
      rows: [["10"]],
      totalRowCount: 1,
    };
    const execute = vi.fn().mockResolvedValue(metricResult);
    const input = makeInput(design, sqlExecutorWith(execute), logger);
    input.semanticManifests = { sales: manifest };

    const output = await runDashboardEngine(input);

    const renderedSql = [
      "SELECT",
      "  MEASURE(`total_revenue`) AS `total_revenue`",
      "FROM `main`.`sales`.`sales_metrics`",
      "LIMIT 1000",
    ].join("\n");
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([`EXPLAIN ${renderedSql}`, renderedSql]);
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "governed",
      designVersion: "2",
      dashboardDesign: {
        version: "2",
        datasets: [
          expect.objectContaining({
            sql: renderedSql,
            sourceKind: "metric_view",
            metricViewFqn: "main.sales.sales_metrics",
            metricIds: ["measure:mv:sales:total_revenue"],
            expectedFields: [
              expect.objectContaining({
                name: "total_revenue",
                roles: ["value"],
                compatibleTypes: ["numeric"],
              }),
            ],
          }),
        ],
      },
    });
  });

  it("uses table SQL without a domain failure for dimension-only requests", async () => {
    const { logger } = loggerWithEvidence();
    const design = metricDesign({
      measureIds: [],
      dimensionIds: ["dimension:mv:sales:order_date"],
    });
    const input = makeInput(
      design,
      sqlExecutorWith(vi.fn().mockResolvedValue(metricSqlResult)),
      logger,
    );
    input.semanticManifests = {
      sales: metricManifest({
        dimensionId: "dimension:mv:sales:order_date",
        dimensionName: "order_date",
      }),
    };

    const output = await runDashboardEngine(input);

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "table",
      dashboardDesign: {
        datasets: [expect.objectContaining({ sql: design.datasets[0].sql })],
      },
    });
  });

  it("does not expose or execute proposal-only metric assets through table fallback", async () => {
    const { logger } = loggerWithEvidence();
    const proposalOnly = metricManifest();
    proposalOnly.metricViews[0] = {
      ...proposalOnly.metricViews[0],
      deployedFqn: undefined,
      deploymentState: "proposal",
    };
    proposalOnly.measures = [...proposalOnly.metricViews[0].measures];
    const design = metricDesign();
    design.datasets[0].sql =
      "SELECT MEASURE(`total_revenue`) AS total_revenue FROM main.sales.sales_metrics";
    const execute = vi.fn();
    const input = makeInput(design, sqlExecutorWith(execute), logger);
    input.semanticManifests = { sales: proposalOnly };
    const chat = input.deps?.llm?.chat as ReturnType<typeof vi.fn>;

    const output = await runDashboardEngine(input);

    const prompt = chat.mock.calls[0][0].messages[1].content as string;
    expect(prompt).not.toContain("measure:mv:sales:total_revenue");
    expect(prompt).not.toContain("main.sales.sales_metrics");
    expect(execute).not.toHaveBeenCalled();
    expect(output.recommendations).toEqual([]);
    expect(output.validationFailures[0].evidence).toContainEqual(
      expect.objectContaining({
        stage: "dataset_source",
        status: "failed",
        code: "PROPOSED_METRIC_SQL_REJECTED",
      }),
    );
  });

  it("falls back to table SQL with evidence when governed aliases collide", async () => {
    const { logger } = loggerWithEvidence();
    const design = metricDesign({
      dimensionIds: ["dimension:mv:sales:total_revenue"],
    });
    const input = makeInput(
      design,
      sqlExecutorWith(vi.fn().mockResolvedValue(metricSqlResult)),
      logger,
    );
    input.semanticManifests = {
      sales: metricManifest({
        dimensionId: "dimension:mv:sales:total_revenue",
        dimensionName: "TOTAL_REVENUE",
      }),
    };

    const output = await runDashboardEngine(input);

    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "table",
      validationEvidence: expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          code: "METRIC_SOURCE_RENDER_FALLBACK",
          message: expect.stringContaining("Duplicate normalized dataset alias"),
        }),
      ]),
    });
  });

  it("reruns the complete table pipeline when review drifts to a table source", async () => {
    const { logger } = loggerWithEvidence();
    const design = metricDesign();
    const execute = vi.fn().mockResolvedValue(metricSqlResult);
    const input = makeInput(design, sqlExecutorWith(execute), logger);
    input.semanticManifests = { sales: metricManifest() };
    input.deps!.isReviewEnabled = () => true;
    input.deps!.reviewAndFixSql = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "fail",
        issues: ["Changed source"],
        fixedSql: design.datasets[0].sql,
      })
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null });

    const output = await runDashboardEngine(input);

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `EXPLAIN ${design.datasets[0].sql}`,
      design.datasets[0].sql,
    ]);
    expect(input.deps!.reviewAndFixSql).toHaveBeenCalledTimes(2);
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "table",
      validationEvidence: expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          code: "METRIC_SOURCE_REVIEW_DRIFT_FALLBACK",
        }),
      ]),
    });
  });

  it("falls back to table SQL when review removes a requested governed measure", async () => {
    const { logger } = loggerWithEvidence();
    const design = metricDesign();
    const execute = vi.fn().mockResolvedValue(metricSqlResult);
    const input = makeInput(design, sqlExecutorWith(execute), logger);
    input.semanticManifests = { sales: metricManifest() };
    input.deps!.isReviewEnabled = () => true;
    input.deps!.reviewAndFixSql = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "fail",
        issues: ["Removed measure"],
        fixedSql: [
          "SELECT",
          "  1 AS `total_revenue`",
          "FROM `main`.`sales`.`sales_metrics`",
          "LIMIT 1000",
        ].join("\n"),
      })
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null });

    const output = await runDashboardEngine(input);

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `EXPLAIN ${design.datasets[0].sql}`,
      design.datasets[0].sql,
    ]);
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "table",
      validationEvidence: expect.arrayContaining([
        expect.objectContaining({
          code: "METRIC_SOURCE_REVIEW_DRIFT_FALLBACK",
          message: expect.stringContaining("required measure"),
        }),
      ]),
    });
  });

  it("never executes reviewed governed SQL with an extra projection", async () => {
    const { logger } = loggerWithEvidence();
    const design = metricDesign();
    const execute = vi.fn().mockResolvedValue(metricSqlResult);
    const input = makeInput(design, sqlExecutorWith(execute), logger);
    input.semanticManifests = { sales: metricManifest() };
    input.deps!.isReviewEnabled = () => true;
    input.deps!.reviewAndFixSql = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "pass",
        issues: [],
        fixedSql: [
          "SELECT",
          "  MEASURE(`total_revenue`) AS `total_revenue`,",
          "  COUNT(*) AS `row_count`",
          "FROM `main`.`sales`.`sales_metrics`",
          "LIMIT 1000",
        ].join("\n"),
      })
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null });

    const output = await runDashboardEngine(input);

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `EXPLAIN ${design.datasets[0].sql}`,
      design.datasets[0].sql,
    ]);
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "table",
      validationEvidence: expect.arrayContaining([
        expect.objectContaining({
          code: "METRIC_SOURCE_REVIEW_DRIFT_FALLBACK",
          message: expect.stringContaining("unsupported projection"),
        }),
      ]),
    });
  });

  it("never executes reviewed governed SQL with an unbalanced FQN", async () => {
    const { logger } = loggerWithEvidence();
    const design = metricDesign();
    const execute = vi.fn().mockResolvedValue(metricSqlResult);
    const input = makeInput(design, sqlExecutorWith(execute), logger);
    input.semanticManifests = { sales: metricManifest() };
    input.deps!.isReviewEnabled = () => true;
    input.deps!.reviewAndFixSql = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "pass",
        issues: [],
        fixedSql: [
          "SELECT MEASURE(`total_revenue`) AS `total_revenue`",
          "FROM `main.sales.sales_metrics",
          "LIMIT 1000",
        ].join("\n"),
      })
      .mockResolvedValueOnce({ verdict: "pass", issues: [], fixedSql: null });

    const output = await runDashboardEngine(input);

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `EXPLAIN ${design.datasets[0].sql}`,
      design.datasets[0].sql,
    ]);
    expect(output.validationFailures).toHaveLength(0);
    expect(output.recommendations[0]).toMatchObject({
      datasetSourceKind: "table",
      validationEvidence: expect.arrayContaining([
        expect.objectContaining({
          code: "METRIC_SOURCE_REVIEW_DRIFT_FALLBACK",
          message: expect.stringContaining("selected metric view FQN"),
        }),
      ]),
    });
  });
});
