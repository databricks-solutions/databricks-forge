import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logger: log,
}));

import { runTypedMetricViewEngineV2BySchema } from "@/lib/metric-views/typed-generation";

const runnerOutput = {
  proposals: [],
  subdomainGroups: [],
  planSummary: "grounded",
};

function expression(name: string, sql: string, dimension = false) {
  return {
    name,
    sql,
    synonyms: [],
    instructions: "",
    ...(dimension ? { isTimePeriod: false } : {}),
  };
}

function inputFor(
  tables: Array<{ fqn: string; columns: string[] }>,
  measures: Array<ReturnType<typeof expression>>,
  dimensions: Array<ReturnType<typeof expression>> = [],
) {
  return {
    domain: "Operations",
    tableFqns: tables.map((table) => table.fqn),
    useCases: tables.map((table, index) => ({
      id: `uc-${index}`,
      domain: "Operations",
      subdomain: table.fqn.split(".")[1],
      tablesInvolved: [table.fqn],
      statement: "Inspect operations",
    })),
    metadata: {
      cacheKey: "grounding",
      ucPath: "multi",
      tables: tables.map((table) => ({ fqn: table.fqn })),
      columns: tables.flatMap((table) =>
        table.columns.map((columnName, ordinalPosition) => ({
          tableFqn: table.fqn,
          columnName,
          dataType: "DECIMAL",
          ordinalPosition,
          isNullable: true,
          comment: null,
        })),
      ),
      foreignKeys: [],
      metricViews: [],
      tableCount: tables.length,
      columnCount: tables.reduce((total, table) => total + table.columns.length, 0),
      cachedAt: "2026-07-25T00:00:00.000Z",
      lineageDiscoveredFqns: [],
    },
    allowlist: {},
    existingMetricViews: [],
    measures,
    dimensions,
    joinSpecs: [],
    columnEnrichments: [],
    endpoint: "endpoint",
  } as never;
}

describe("typed metric-view schema grounding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes realistic unqualified and source-qualified expressions to the production runner", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);
    const measures = [
      expression("Oil Volume", "SUM(oil_bbl)"),
      expression("Net Revenue", "COALESCE(SUM(source.net_revenue), 0)"),
    ];
    const dimensions = [expression("Event Date", "source.event_date", true)];

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [
          {
            fqn: "serverless_stable_x7i65r_catalog.forge_pr270.production",
            columns: ["oil_bbl", "net_revenue", "event_date"],
          },
        ],
        measures,
        dimensions,
      ),
      runner,
    );

    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][0].measures).toEqual(measures);
    expect(runner.mock.calls[0][0].dimensions).toEqual(dimensions);
  });

  it("keeps explicit FQN expressions only in their exact schema partition", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [
          { fqn: "main.finance.invoices", columns: ["amount"] },
          { fqn: "main.sales.orders", columns: ["amount"] },
        ],
        [
          expression("Finance Amount", "SUM(main.finance.invoices.amount)"),
          expression("Sales Amount", "SUM(main.sales.orders.amount)"),
        ],
      ),
      runner,
    );

    expect(
      runner.mock.calls.map(([partition]) => ({
        schema: partition.deploymentTarget.schema,
        measures: partition.measures.map((measure: { name: string }) => measure.name),
      })),
    ).toEqual([
      { schema: "finance", measures: ["Finance Amount"] },
      { schema: "sales", measures: ["Sales Amount"] },
    ]);
  });

  it("resolves quoted one-, two-, and three-part table qualifications with terminal columns", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [
          { fqn: "main.finance.invoices", columns: ["balance"] },
          { fqn: "main.sales.orders", columns: ["revenue"] },
        ],
        [
          expression("One Part", "SUM(`orders`.`revenue`)"),
          expression("Two Part", "SUM(`sales`.`orders`.`revenue`)"),
          expression("Three Part", "SUM(`main`.`sales`.`orders`.`revenue`)"),
          expression("Source Alias", "SUM(`source`.`revenue`)"),
        ],
      ),
      runner,
    );

    expect(
      runner.mock.calls.map(([partition]) => ({
        schema: partition.deploymentTarget.schema,
        measures: partition.measures.map((measure: { name: string }) => measure.name),
      })),
    ).toEqual([
      { schema: "finance", measures: [] },
      {
        schema: "sales",
        measures: ["One Part", "Two Part", "Three Part", "Source Alias"],
      },
    ]);
  });

  it("rejects unknown aliases, nonexistent terminal columns, and malformed chains", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [
          { fqn: "main.finance.invoices", columns: ["balance"] },
          { fqn: "main.sales.orders", columns: ["revenue"] },
        ],
        [
          expression("Missing FQN Column", "SUM(main.sales.orders.missing)"),
          expression("Missing Table Column", "SUM(orders.missing)"),
          expression("Unknown Alias", "SUM(unknown_alias.revenue)"),
          expression("Malformed Long Chain", "SUM(main.sales.orders.revenue.extra)"),
          expression("Malformed Empty Segment", "SUM(main..orders.revenue)"),
        ],
      ),
      runner,
    );

    expect(
      runner.mock.calls.map(([partition]) => ({
        schema: partition.deploymentTarget.schema,
        measures: partition.measures,
      })),
    ).toEqual([
      { schema: "finance", measures: [] },
      { schema: "sales", measures: [] },
    ]);
  });

  it("retains unqualified expressions only when every column grounds uniquely to one partition", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [
          { fqn: "main.finance.invoices", columns: ["balance", "shared_amount"] },
          { fqn: "main.sales.orders", columns: ["revenue", "shared_amount"] },
        ],
        [
          expression("Balance", "SUM(balance)"),
          expression("Revenue", "SUM(source.revenue)"),
          expression("Ambiguous", "SUM(source.shared_amount)"),
        ],
        [
          expression("Unique Sales Dimension", "source.revenue", true),
          expression("Ambiguous Dimension", "source.shared_amount", true),
        ],
      ),
      runner,
    );

    expect(
      runner.mock.calls.map(([partition]) => ({
        schema: partition.deploymentTarget.schema,
        measures: partition.measures.map((measure: { name: string }) => measure.name),
        dimensions: partition.dimensions.map((dimension: { name: string }) => dimension.name),
      })),
    ).toEqual([
      { schema: "finance", measures: ["Balance"], dimensions: [] },
      {
        schema: "sales",
        measures: ["Revenue"],
        dimensions: ["Unique Sales Dimension"],
      },
    ]);
  });

  it("ignores SQL functions, keywords, and string literals while grounding columns", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);
    const measure = expression(
      "Conditional Revenue",
      "CASE WHEN source.status = 'SELECT secret FROM foreign.table' " +
        "THEN COALESCE(SUM(source.revenue), 0) ELSE 0 END",
    );

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [{ fqn: "main.sales.orders", columns: ["status", "revenue"] }],
        [measure],
      ),
      runner,
    );

    expect(runner.mock.calls[0][0].measures).toEqual([measure]);
  });

  it("logs compact partition counts and a warning code when no measures are grounded", async () => {
    const runner = vi.fn().mockResolvedValue(runnerOutput);

    await runTypedMetricViewEngineV2BySchema(
      inputFor(
        [{ fqn: "main.sales.orders", columns: ["revenue"] }],
        [expression("Unknown", "SUM(missing_column)")],
      ),
      runner,
    );

    expect(log.info).toHaveBeenCalledWith("Typed metric-view partition grounding", {
      partition: "main.sales",
      tableCount: 1,
      measureCount: 0,
      dimensionCount: 0,
    });
    expect(log.warn).toHaveBeenCalledWith("Typed metric-view partition has no grounded measures", {
      code: "METRIC_VIEW_NO_GROUNDED_MEASURES",
      partition: "main.sales",
      tableCount: 1,
      measureCount: 0,
      dimensionCount: 0,
    });
    const loggedArguments = JSON.stringify([
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
      ...log.debug.mock.calls,
    ]);
    expect(loggedArguments).not.toContain("missing_column");
  });
});
