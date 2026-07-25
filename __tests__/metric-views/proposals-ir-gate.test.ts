import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataSnapshot } from "@/lib/domain/types";
import type { SchemaAllowlist } from "@/lib/genie/schema-allowlist";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  probes: vi.fn(),
  review: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/toolkit/llm-cache", () => ({
  cachedChatCompletion: mocks.chat,
}));

vi.mock("@/lib/metric-views/probes", () => ({
  createTempMetricView: vi.fn(),
  dropTempMetricView: vi.fn(),
  extractMetricViewProbeInputs: vi.fn(() => ({
    measureNames: ["total_revenue"],
    dimensionNames: ["order_month"],
  })),
  dryRunMetricViewDdlWithProbes: mocks.probes,
}));

vi.mock("@/lib/dbx/client", () => ({
  isReviewEnabled: vi.fn(() => false),
}));

vi.mock("@/lib/ai/sql-reviewer", () => ({
  reviewAndFixSql: mocks.review,
}));

vi.mock("@/lib/skills", () => ({
  resolveForGeniePass: vi.fn(() => ({ systemOverlay: "" })),
  formatSystemOverlay: vi.fn(() => ""),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { repairProposal, runMetricViewProposals } from "@/lib/genie/passes/metric-view-proposals";

const metadata: MetadataSnapshot = {
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
      columnName: "order_date",
      dataType: "date",
      ordinalPosition: 1,
      isNullable: false,
      comment: null,
    },
    {
      tableFqn: "main.sales.orders",
      columnName: "amount",
      dataType: "decimal(18,2)",
      ordinalPosition: 2,
      isNullable: false,
      comment: null,
    },
  ],
  foreignKeys: [],
  metricViews: [],
  tableCount: 1,
  columnCount: 2,
  cachedAt: "2026-07-24T00:00:00.000Z",
  lineageDiscoveredFqns: [],
};

const allowlist: SchemaAllowlist = {
  tables: new Set(["main.sales.orders"]),
  columns: new Map([["main.sales.orders", new Set(["order_date", "amount"])]]),
  columnTypes: new Map([
    ["main.sales.orders.order_date", "date"],
    ["main.sales.orders.amount", "decimal(18,2)"],
  ]),
  metricViews: new Set(),
};

function input(deploymentTarget?: { catalog: string; schema: string }) {
  return {
    domain: "Sales",
    ...(deploymentTarget ? { deploymentTarget } : {}),
    tableFqns: ["main.sales.orders"],
    metadata,
    allowlist,
    useCases: [],
    measures: [
      {
        name: "Total Revenue",
        sql: "SUM(main.sales.orders.amount)",
        synonyms: [],
        instructions: "",
      },
    ],
    dimensions: [
      {
        name: "Order Month",
        sql: "DATE_TRUNC('MONTH', main.sales.orders.order_date)",
        synonyms: [],
        instructions: "",
        isTimePeriod: true,
      },
    ],
    joinSpecs: [],
    columnEnrichments: [],
    endpoint: "test-endpoint",
  };
}

function generatedProposal(yaml: string, ddl?: string) {
  return JSON.stringify({
    proposals: [
      {
        name: "sales_metrics",
        description: "Sales metrics",
        yaml,
        ...(ddl !== undefined
          ? { ddl }
          : {
              ddl:
                "CREATE OR REPLACE VIEW `custom`.`semantic`.`preserved_target`\n" +
                "WITH METRICS\nLANGUAGE YAML\nAS $$\nlegacy: body\n$$",
            }),
        sourceTables: ["main.sales.orders"],
      },
    ],
  });
}

describe("metric view proposal typed generation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probes.mockResolvedValue({
      ok: true,
      unverified: false,
      evidence: [
        {
          stage: "metric_view_create",
          status: "passed",
          code: "METRIC_VIEW_CREATE_PASSED",
          message: "created",
        },
      ],
    });
  });

  it("parses repaired YAML and emits canonical YAML from the typed definition", async () => {
    mocks.chat.mockResolvedValue({
      content: generatedProposal(`version: 1.1
source: main.sales.orders
dimensions:
  - name: order_month
    expr: DATE_TRUNC('MONTH', \`order_date\`)
measures:
  - name: total_revenue
    expr: SUM(\`amount\`)
`),
    });

    const result = await runMetricViewProposals(input());
    const proposal = result.proposals[0];

    expect(proposal.definition).toEqual(
      expect.objectContaining({ name: "sales_metrics", version: "1.1" }),
    );
    expect(proposal.yaml).toContain('version: "1.1"');
    expect(proposal.yaml).not.toContain("`");
    expect(proposal.ddl).toContain("CREATE OR REPLACE VIEW `custom`.`semantic`.`preserved_target`");
    expect(proposal.ddl).toContain(`AS $$\n${proposal.yaml}$$`);
    expect(mocks.probes).toHaveBeenCalledOnce();
    expect(proposal.validationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "METRIC_VIEW_STATIC_VALIDATION_PASSED" }),
        expect.objectContaining({ code: "METRIC_VIEW_CREATE_PASSED" }),
      ]),
    );
  });

  it.each([
    ["COUNT", "COUNT(DISTINCT order_date)"],
    ["SUM", "SUM(amount)"],
    ["AVG", "AVG(amount)"],
    ["PERCENTILE", "PERCENTILE_APPROX(amount, 0.5)"],
  ])(
    "drops a redundant %s aggregate dimension before canonical DDL and probes",
    async (_label, aggregateExpression) => {
      mocks.chat.mockResolvedValue({
        content: generatedProposal(`version: "1.1"
source: main.sales.orders
dimensions:
  - name: invalid_aggregate_dimension
    expr: ${aggregateExpression}
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
  - name: amount_band
    expr: CASE WHEN amount > 100 THEN 'high' ELSE 'low' END
measures:
  - name: unique_order_dates
    expr: COUNT(DISTINCT order_date)
  - name: total_revenue
    expr: SUM(amount)
`),
      });

      const result = await runMetricViewProposals(input());
      const proposal = result.proposals[0];

      expect(proposal.validationStatus).toBe("valid");
      expect(proposal.definition?.dimensions.map((dimension) => dimension.name)).toEqual([
        "order_month",
        "amount_band",
      ]);
      expect(proposal.yaml).not.toContain("invalid_aggregate_dimension");
      expect(proposal.ddl).not.toContain("invalid_aggregate_dimension");
      expect(proposal.validationEvidence).toContainEqual(
        expect.objectContaining({
          stage: "metric_view_normalization",
          status: "passed",
          code: "AGGREGATE_DIMENSION_REMOVED",
        }),
      );
      expect(mocks.probes).toHaveBeenCalledOnce();
    },
  );

  it("rejects aggregate dimensions before DDL when safe normalization would remove all dimensions", async () => {
    mocks.chat.mockResolvedValue({
      content: generatedProposal(`version: "1.1"
source: main.sales.orders
dimensions:
  - name: invalid_count
    expr: COUNT(DISTINCT order_date)
  - name: invalid_total
    expr: SUM(amount)
measures:
  - name: unique_order_dates
    expr: COUNT(DISTINCT order_date)
  - name: total_revenue
    expr: SUM(amount)
`),
    });

    const result = await runMetricViewProposals(input());
    const proposal = result.proposals[0];

    expect(proposal.definition).toBeUndefined();
    expect(proposal.validationStatus).toBe("error");
    expect(proposal.validationEvidence).toEqual([
      expect.objectContaining({
        stage: "metric_view_normalization",
        status: "failed",
        code: "AGGREGATE_DIMENSION_REPAIR_UNSAFE",
      }),
    ]);
    expect(mocks.probes).not.toHaveBeenCalled();
  });

  it("fails terminally with structured evidence and skips DDL probes when parsing fails", async () => {
    mocks.chat.mockResolvedValue({
      content: generatedProposal(`version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
  - name: order_month
    expr: order_date
measures:
  - name: total_revenue
    expr: SUM(amount)
`),
    });

    const result = await runMetricViewProposals(input());
    const proposal = result.proposals[0];

    expect(proposal.definition).toBeUndefined();
    expect(proposal.validationStatus).toBe("error");
    expect(proposal.validationIssues).toEqual(
      expect.arrayContaining([expect.stringContaining("Duplicate semantic name")]),
    );
    expect(proposal.validationEvidence).toEqual([
      expect.objectContaining({
        stage: "metric_view_parse",
        status: "failed",
        code: "METRIC_VIEW_PARSE_FAILED",
      }),
    ]);
    expect(mocks.probes).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
    expect(proposal.validatorVersion).toBeUndefined();
    expect(proposal.validatedAt).toBeUndefined();
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "Metric view proposals generated",
      expect.objectContaining({
        features: [
          expect.objectContaining({
            name: "sales_metrics",
            validation: "error",
            validationCodes: ["METRIC_VIEW_PARSE_FAILED"],
          }),
        ],
      }),
    );
  });

  it("preserves each proposal target for broad multi-scope generation", async () => {
    const yaml = `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: order_date
measures:
  - name: total_revenue
    expr: SUM(amount)
`;
    const firstDdl =
      "CREATE VIEW `catalog-one`.`sales-metrics`.`first-view`\n" +
      "WITH METRICS\nLANGUAGE YAML\nAS $$\nstale: first\n$$";
    const secondDdl =
      "CREATE OR REPLACE VIEW `catalog-two`.`finance-metrics`.`second-view`\n" +
      "WITH METRICS\nLANGUAGE YAML\nAS $$\nstale: second\n$$";
    mocks.chat.mockResolvedValue({
      content: JSON.stringify({
        proposals: [
          {
            name: "first_view",
            description: "First",
            yaml,
            ddl: firstDdl,
            sourceTables: ["main.sales.orders"],
          },
          {
            name: "second_view",
            description: "Second",
            yaml,
            ddl: secondDdl,
            sourceTables: ["main.sales.orders"],
          },
        ],
      }),
    });

    const result = await runMetricViewProposals({
      ...input(),
      domain: "catalog-wide: main,other",
      metadata: { ...metadata, ucPath: "main.sales,other.finance" },
    });

    expect(result.proposals.map((proposal) => proposal.ddl.split("\n")[0])).toEqual([
      "CREATE VIEW `catalog-one`.`sales-metrics`.`first-view`",
      "CREATE OR REPLACE VIEW `catalog-two`.`finance-metrics`.`second-view`",
    ]);
    expect(mocks.probes).toHaveBeenCalledTimes(2);
  });

  it("fails only the proposal missing both an envelope and exact target", async () => {
    const yaml = `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: order_date
measures:
  - name: total_revenue
    expr: SUM(amount)
`;
    mocks.chat.mockResolvedValue({
      content: JSON.stringify({
        proposals: [
          {
            name: "missing_target",
            description: "Missing target",
            yaml,
            sourceTables: ["main.sales.orders"],
          },
          {
            name: "preserved_target",
            description: "Preserved target",
            yaml,
            ddl:
              "CREATE VIEW `safe-cat`.`safe-schema`.`safe-view`\n" +
              "WITH METRICS\nLANGUAGE YAML\nAS $$\nstale: body\n$$",
            sourceTables: ["main.sales.orders"],
          },
        ],
      }),
    });

    const result = await runMetricViewProposals(input());

    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]).toEqual(
      expect.objectContaining({
        name: "missing_target",
        validationStatus: "error",
      }),
    );
    expect(result.proposals[0].validatorVersion).toBeUndefined();
    expect(result.proposals[0].validatedAt).toBeUndefined();
    expect(result.proposals[0].validationEvidence).toEqual([
      expect.objectContaining({
        stage: "metric_view_target",
        code: "METRIC_VIEW_TARGET_REQUIRED",
        status: "failed",
      }),
    ]);
    expect(result.proposals[1].validationStatus).toBe("valid");
    expect(mocks.probes).toHaveBeenCalledOnce();
  });

  it("preserves the original validated target across LLM text repair", async () => {
    const originalDdl =
      "CREATE VIEW `published-cat`.`semantic-schema`.`stable-view`\n" +
      "WITH METRICS\nLANGUAGE YAML\nAS $$\nstale: body\n$$";
    mocks.chat.mockResolvedValue({
      content: JSON.stringify({
        yaml: `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: order_date
measures:
  - name: total_revenue
    expr: SUM(amount)
`,
        ddl:
          "CREATE OR REPLACE VIEW `invented`.`wrong`.`target`\n" +
          "WITH METRICS\nLANGUAGE YAML\nAS $$\nstale: invented\n$$",
      }),
    });

    const repaired = await repairProposal(
      {
        name: "sales_metrics",
        description: "Sales",
        yaml: "invalid: column",
        ddl: originalDdl,
        sourceTables: ["main.sales.orders"],
        hasJoins: false,
        hasFilteredMeasures: false,
        hasWindowMeasures: false,
        hasMaterialization: false,
        validationStatus: "error",
        validationIssues: ["Column missing"],
      },
      "schema",
      "columns",
      "endpoint",
    );

    expect(repaired?.ddl.split("\n")[0]).toBe(
      "CREATE VIEW `published-cat`.`semantic-schema`.`stable-view`",
    );
  });
});
