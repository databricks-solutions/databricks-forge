import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMetricViewEngineV2: vi.fn(),
  saveMetricViewProposals: vi.fn(),
}));

vi.mock("@/lib/genie/passes/table-selection", () => ({
  runTableSelection: (useCases: Array<{ domain: string; subdomain: string; tablesInvolved: string[] }>) => [
    {
      domain: "Commercial",
      subdomains: ["Orders", "Billing"],
      tables: useCases.flatMap((useCase) => useCase.tablesInvolved),
      metricViews: [],
      useCases,
    },
  ],
}));
vi.mock("@/lib/genie/passes/column-intelligence", () => ({
  runColumnIntelligence: vi.fn().mockResolvedValue({ enrichments: [], entityCandidates: [] }),
}));
vi.mock("@/lib/genie/passes/semantic-expressions", () => ({
  runSemanticExpressions: vi.fn().mockResolvedValue({ measures: [], dimensions: [], filters: [] }),
}));
vi.mock("@/lib/genie/passes/trusted-assets", () => ({
  runTrustedAssetAuthoring: vi.fn(),
}));
vi.mock("@/lib/genie/passes/instruction-generation", () => ({
  runInstructionGeneration: vi.fn().mockResolvedValue({ instructions: [] }),
}));
vi.mock("@/lib/genie/passes/benchmark-generation", () => ({
  runBenchmarkGeneration: vi.fn(),
}));
vi.mock("@/lib/genie/passes/benchmark-alignment", () => ({
  runBenchmarkAlignment: vi.fn().mockResolvedValue({ aligned: [] }),
}));
vi.mock("@/lib/genie/passes/example-query-generation", () => ({
  runExampleQueryGeneration: vi.fn().mockResolvedValue({
    queries: [{ question: "What changed?", sql: "SELECT 1", parameters: [] }],
  }),
}));
vi.mock("@/lib/genie/passes/title-generation", () => ({
  runTitleGeneration: vi.fn().mockResolvedValue({ title: "Commercial", source: "fallback" }),
}));
vi.mock("@/lib/genie/metric-views-config", () => ({
  isMetricViewsEnabled: () => true,
}));
vi.mock("@/lib/config/semantic-uplift-flags", () => ({
  isTypedMetricViewModelEnabled: () => true,
}));
vi.mock("@/lib/metric-views/discovery", () => ({
  discoverExistingMetricViews: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/metric-views/engine", () => ({
  runMetricViewEngineV2: mocks.runMetricViewEngineV2,
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  saveMetricViewProposals: mocks.saveMetricViewProposals,
}));
vi.mock("@/lib/genie/join-diagnostics", () => ({
  evaluateJoinCandidates: () => ({ accepted: [], diagnostics: [] }),
}));
vi.mock("@/lib/genie/space-health-check", () => ({
  runHealthCheck: () => ({ overallScore: 100 }),
}));
vi.mock("@/lib/genie/assembler", () => ({
  assembleSerializedSpace: () => ({
    version: 2,
    config: { sample_questions: [] },
    data_sources: { tables: [] },
    instructions: {
      text_instructions: [],
      example_question_sqls: [],
      join_specs: [],
      sql_snippets: { measures: [], filters: [], expressions: [] },
    },
  }),
  buildRecommendation: () => ({
    domain: "Commercial",
    title: "Commercial",
    useCaseCount: 0,
    tables: [],
    metricViews: [],
    measureCount: 0,
    sampleQuestionCount: 0,
  }),
}));
vi.mock("@/lib/semantic-assets/manifest", () => ({
  buildSemanticAssetManifest: () => ({
    version: "1",
    domain: "Commercial",
    subdomains: [],
    metricViews: [],
    measures: [],
    dimensions: [],
    filters: [],
    generatedAt: "2026-07-25T00:00:00.000Z",
  }),
}));
vi.mock("@/lib/dbx/client", () => ({
  resolveEndpoint: () => "endpoint",
}));

import { defaultGenieEngineConfig } from "@/lib/genie/types";
import { runGenieEngine } from "@/lib/genie/engine";
import { runTypedMetricViewEngineV2BySchema } from "@/lib/metric-views/typed-generation";
import { isMetricViewValidationDeployable } from "@/lib/metric-views/deployability";

const useCases = [
  {
    id: "uc-orders",
    domain: "Commercial",
    subdomain: "Orders",
    tablesInvolved: ["main.sales.orders"],
    statement: "Analyze orders",
  },
  {
    id: "uc-billing",
    domain: "Commercial",
    subdomain: "Billing",
    tablesInvolved: ["main.finance.invoices"],
    statement: "Analyze invoices",
  },
];

function metadataFor(...tableFqns: string[]) {
  return {
    cacheKey: "test",
    ucPath: [...new Set(tableFqns.map((table) => table.split(".").slice(0, 2).join(".")))].join(
      ",",
    ),
    tables: tableFqns.map((fqn) => ({ fqn })),
    columns: [],
    foreignKeys: [],
    metricViews: [],
    tableCount: tableFqns.length,
    columnCount: 0,
    cachedAt: "2026-07-25T00:00:00.000Z",
    lineageDiscoveredFqns: [],
  } as never;
}

describe("Genie typed metric-view runtime path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runMetricViewEngineV2.mockImplementation(async (input) => ({
      proposals: [
        {
          name: `${input.deploymentTarget?.schema ?? "missing"}_metrics`,
          description: "Runtime path proposal",
          definition: {
            version: "1.1",
            name: `${input.deploymentTarget?.schema ?? "missing"}_metrics`,
            source: {
              kind: "table",
              table: input.useCases.flatMap(
                (useCase: { tablesInvolved?: string[] }) => useCase.tablesInvolved ?? [],
              )[0],
            },
            joins: [],
            dimensions: [],
            measures: [],
            requiredFeatures: [],
          },
          yaml: 'version: "1.1"',
          ddl: input.deploymentTarget
            ? `CREATE VIEW \`${input.deploymentTarget.catalog}\`.\`${input.deploymentTarget.schema}\`.\`${input.deploymentTarget.schema}_metrics\`\nWITH METRICS\nLANGUAGE YAML\nAS $$\nversion: "1.1"\n$$`
            : "",
          sourceTables: input.useCases.flatMap(
            (useCase: { tablesInvolved?: string[] }) => useCase.tablesInvolved ?? [],
          ),
          hasJoins: false,
          hasFilteredMeasures: false,
          hasWindowMeasures: false,
          hasMaterialization: false,
          classification: "new",
          validationStatus: input.deploymentTarget ? "valid" : "error",
          validationIssues: input.deploymentTarget ? [] : ["METRIC_VIEW_TARGET_REQUIRED"],
        },
      ],
      subdomainGroups: [],
      planSummary: "test",
    }));
  });

  it("partitions typed generation by exact source schema before calling the typed engine", async () => {
    const result = await runGenieEngine({
      run: {
        runId: "run-runtime",
        ownerEmail: "owner@example.com",
        config: { businessName: "Acme" },
        businessContext: null,
      } as never,
      useCases: useCases as never,
      metadata: metadataFor("main.sales.orders", "main.finance.invoices"),
      config: {
        ...defaultGenieEngineConfig(),
        generateMetricViews: true,
        skipMetricViewPlanning: true,
        generateTrustedAssets: false,
        generateBenchmarks: false,
        llmRefinement: false,
      },
    });

    expect(result.failedDomains).toEqual([]);
    expect(mocks.runMetricViewEngineV2).toHaveBeenCalledTimes(2);
    expect(
      mocks.runMetricViewEngineV2.mock.calls.map(([input]) => ({
        target: input.deploymentTarget,
        tables: input.useCases.flatMap(
          (useCase: { tablesInvolved?: string[] }) => useCase.tablesInvolved ?? [],
        ),
      })),
    ).toEqual([
      {
        target: { catalog: "main", schema: "finance" },
        tables: ["main.finance.invoices"],
      },
      {
        target: { catalog: "main", schema: "sales" },
        tables: ["main.sales.orders"],
      },
    ]);
    expect(result.passOutputs[0].metricViewProposals).toEqual([
      expect.objectContaining({ name: "finance_metrics", validationStatus: "valid" }),
      expect.objectContaining({ name: "sales_metrics", validationStatus: "valid" }),
    ]);
  });

  it("redacts sensitive failures from Genie domain logs and returned failure summaries", async () => {
    const sensitive = new Error(
      "SELECT * FROM main.sales.orders; Bearer genie-secret; prompt=private customer plan",
    );
    sensitive.stack = [
      `Error: ${sensitive.message}`,
      "    at runMetricViewEngineV2 (/workspace/lib/metric-views/engine.ts:400:9)",
    ].join("\n");
    mocks.runMetricViewEngineV2.mockRejectedValue(sensitive);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const output = await runGenieEngine({
      run: {
        runId: "run-sensitive",
        ownerEmail: "owner@example.com",
        config: { businessName: "Acme" },
        businessContext: null,
      } as never,
      useCases: useCases as never,
      metadata: metadataFor("main.sales.orders", "main.finance.invoices"),
      config: {
        ...defaultGenieEngineConfig(),
        generateMetricViews: true,
        skipMetricViewPlanning: true,
        generateTrustedAssets: false,
        generateBenchmarks: false,
        llmRefinement: false,
      },
      deps: { logger },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process domain",
      expect.objectContaining({
        domain: "Commercial",
        errorName: "Error",
        errorCategory: "runtime",
        safeSummary: "Genie domain processing failed.",
        location: "lib/metric-views/engine.ts:400:9",
      }),
    );
    const diagnostics = JSON.stringify({ calls: logger, output });
    for (const secret of [
      "SELECT",
      "main.sales.orders",
      "Bearer",
      "genie-secret",
      "private customer plan",
    ]) {
      expect(diagnostics).not.toContain(secret);
    }
  });

  it("assigns one exact target for a single-schema source set", async () => {
    const runner = vi.fn().mockResolvedValue({
      proposals: [],
      subdomainGroups: [],
      planSummary: "single",
    });

    await runTypedMetricViewEngineV2BySchema(
      {
        domain: "Sales",
        tableFqns: ["main.sales.orders", "main.sales.customers"],
        useCases: useCases.slice(0, 1) as never,
        metadata: metadataFor("main.sales.orders", "main.sales.customers"),
        allowlist: {} as never,
        existingMetricViews: [],
        measures: [],
        dimensions: [],
        joinSpecs: [],
        columnEnrichments: [],
        endpoint: "endpoint",
      },
      runner,
    );

    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentTarget: { catalog: "main", schema: "sales" },
        tableFqns: ["main.sales.orders", "main.sales.customers"],
      }),
    );
  });

  it("does not retarget reuse or improve proposals away from their discovered FQN", async () => {
    const runner = vi.fn(async (input: {
      existingMetricViews: Array<{ name: string; fqn: string; sourceTable: string | null }>;
    }) => ({
      proposals: input.existingMetricViews.map((view, index: number) => ({
        name: view.name,
        sourceTables: [view.sourceTable],
        classification: index === 0 ? "reuse" : "improve",
        existingFqn: view.fqn,
        ddl: `ALTER VIEW ${view.fqn}`,
      })),
      subdomainGroups: [],
      planSummary: "existing",
    }));

    const result = await runTypedMetricViewEngineV2BySchema(
      {
        domain: "Sales",
        tableFqns: ["main.sales.orders"],
        useCases: useCases.slice(0, 1) as never,
        metadata: metadataFor("main.sales.orders"),
        allowlist: {} as never,
        existingMetricViews: [
          {
            fqn: "governed.metrics.revenue",
            name: "revenue",
            sourceTable: "main.sales.orders",
          },
          {
            fqn: "governed.metrics.margin",
            name: "margin",
            sourceTable: "main.sales.orders",
          },
        ] as never,
        measures: [],
        dimensions: [],
        joinSpecs: [],
        columnEnrichments: [],
        endpoint: "endpoint",
      },
      runner as never,
    );

    expect(result.proposals.map((proposal) => proposal.existingFqn)).toEqual([
      "governed.metrics.revenue",
      "governed.metrics.margin",
    ]);
    expect(result.proposals.map((proposal) => proposal.ddl)).toEqual([
      "ALTER VIEW governed.metrics.revenue",
      "ALTER VIEW governed.metrics.margin",
    ]);
  });

  it("narrows every schema-bearing grounding input before invoking each runner", async () => {
    const runner = vi.fn().mockResolvedValue({
      proposals: [],
      subdomainGroups: [],
      planSummary: "isolated",
    });

    await runTypedMetricViewEngineV2BySchema(
      {
        domain: "Commercial",
        tableFqns: ["main.sales.orders", "main.finance.invoices"],
        useCases: useCases as never,
        metadata: {
          cacheKey: "global",
          ucPath: "main.sales,main.finance",
          tables: [
            { fqn: "main.sales.orders" },
            { fqn: "main.finance.invoices" },
          ],
          columns: [
            { tableFqn: "main.sales.orders", columnName: "amount", dataType: "decimal" },
            { tableFqn: "main.finance.invoices", columnName: "balance", dataType: "decimal" },
          ],
          foreignKeys: [
            {
              tableFqn: "main.sales.orders",
              referencedTableFqn: "main.finance.invoices",
            },
          ],
          metricViews: [
            { fqn: "main.sales.sales_metrics" },
            { fqn: "main.finance.finance_metrics" },
          ],
          tableCount: 2,
          columnCount: 2,
          cachedAt: "2026-07-25T00:00:00.000Z",
          lineageDiscoveredFqns: ["main.sales.orders", "main.finance.invoices"],
          schemaMarkdown: "GLOBAL SCHEMA CONTENT",
        } as never,
        allowlist: {
          tables: new Set(["main.sales.orders", "main.finance.invoices"]),
          columns: new Map([
            ["main.sales.orders", new Set(["amount"])],
            ["main.finance.invoices", new Set(["balance"])],
          ]),
          columnTypes: new Map([
            ["main.sales.orders.amount", "decimal"],
            ["main.finance.invoices.balance", "decimal"],
          ]),
          metricViews: new Set(["main.sales.sales_metrics", "main.finance.finance_metrics"]),
        },
        existingMetricViews: [],
        measures: [
          {
            name: "Sales",
            sql: "SUM(main.sales.orders.amount)",
            synonyms: [],
            instructions: "",
          },
          {
            name: "Balance",
            sql: "SUM(main.finance.invoices.balance)",
            synonyms: [],
            instructions: "",
          },
        ],
        dimensions: [
          {
            name: "Sales Amount",
            sql: "main.sales.orders.amount",
            synonyms: [],
            instructions: "",
            isTimePeriod: false,
          },
          {
            name: "Finance Balance",
            sql: "main.finance.invoices.balance",
            synonyms: [],
            instructions: "",
            isTimePeriod: false,
          },
        ],
        joinSpecs: [
          {
            leftTable: "main.sales.orders",
            rightTable: "main.finance.invoices",
            sql: "main.sales.orders.invoice_id = main.finance.invoices.id",
          },
        ],
        columnEnrichments: [
          { tableFqn: "main.sales.orders", columnName: "amount" },
          { tableFqn: "main.finance.invoices", columnName: "balance" },
        ] as never,
        endpoint: "endpoint",
      },
      runner,
    );

    expect(runner).toHaveBeenCalledTimes(2);
    for (const [runnerInput] of runner.mock.calls) {
      const target = `${runnerInput.deploymentTarget.catalog}.${runnerInput.deploymentTarget.schema}`;
      expect(runnerInput.metadata.ucPath).toBe(target);
      expect(runnerInput.metadata.schemaMarkdown).toBeUndefined();
      expect(runnerInput.metadata.tables.every((table: { fqn: string }) => table.fqn.startsWith(`${target}.`))).toBe(true);
      expect(
        runnerInput.metadata.columns.every((column: { tableFqn: string }) =>
          column.tableFqn.startsWith(`${target}.`),
        ),
      ).toBe(true);
      expect(runnerInput.metadata.foreignKeys).toEqual([]);
      expect([...runnerInput.allowlist.tables]).toEqual(
        runnerInput.metadata.tables.map((table: { fqn: string }) => table.fqn),
      );
      expect(runnerInput.measures).toHaveLength(1);
      expect(runnerInput.measures[0].sql).toContain(target);
      expect(runnerInput.dimensions).toHaveLength(1);
      expect(runnerInput.dimensions[0].sql).toContain(target);
      expect(runnerInput.joinSpecs).toEqual([]);
    }
  });

  it("quarantines a new proposal whose sources or joins escape its exact target", async () => {
    const runner = vi.fn(async (input) => {
      const target = input.deploymentTarget;
      const localTable = `${target.catalog}.${target.schema}.${target.schema}_facts`;
      return {
        proposals: [
          {
            name: `${target.schema}_legitimate`,
            description: "Local proposal",
            definition: {
              version: "1.1",
              name: `${target.schema}_legitimate`,
              source: { kind: "table", table: localTable },
              joins: [],
              dimensions: [],
              measures: [],
              requiredFeatures: [],
            },
            yaml: 'version: "1.1"',
            ddl:
              `CREATE VIEW \`${target.catalog}\`.\`${target.schema}\`.\`${target.schema}_legitimate\`\n` +
              "WITH METRICS\nLANGUAGE YAML\nAS $$\nversion: \"1.1\"\n$$",
            sourceTables: [localTable],
            hasJoins: false,
            hasFilteredMeasures: false,
            hasWindowMeasures: false,
            hasMaterialization: false,
            classification: "new",
            validationStatus: "valid",
            validationIssues: [],
            validatorVersion: "metric-view-probes-v1",
            validationEvidence: [
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
            ],
            validatedAt: "2026-07-25T00:00:00.000Z",
          },
          {
            name: `${target.schema}_escaped`,
            description: "Escaped proposal",
            definition: {
              version: "1.1",
              name: `${target.schema}_escaped`,
              source: { kind: "table", table: localTable },
              joins: [
                {
                  kind: "on",
                  name: "foreign",
                  source: "main.other.secret_dimension",
                  on: "source.id = foreign.id",
                  joins: [],
                },
              ],
              dimensions: [],
              measures: [],
              requiredFeatures: ["joins"],
            },
            yaml: 'version: "1.1"',
            ddl:
              `CREATE VIEW \`${target.catalog}\`.\`${target.schema}\`.\`${target.schema}_escaped\`\n` +
              "WITH METRICS\nLANGUAGE YAML\nAS $$\nversion: \"1.1\"\n$$",
            sourceTables: [localTable, "main.other.secret_dimension"],
            hasJoins: true,
            hasFilteredMeasures: false,
            hasWindowMeasures: false,
            hasMaterialization: false,
            classification: "new",
            validationStatus: "valid",
            validationIssues: [],
            validatorVersion: "metric-view-probes-v1",
            validationEvidence: [],
            validatedAt: "2026-07-25T00:00:00.000Z",
          },
        ],
        subdomainGroups: [],
        planSummary: "adversarial",
      };
    });

    const result = await runTypedMetricViewEngineV2BySchema(
      {
        domain: "Commercial",
        tableFqns: ["main.sales.sales_facts", "main.finance.finance_facts"],
        useCases: [
          { ...useCases[0], tablesInvolved: ["main.sales.sales_facts"] },
          { ...useCases[1], tablesInvolved: ["main.finance.finance_facts"] },
        ] as never,
        metadata: {
          tables: [
            { fqn: "main.sales.sales_facts" },
            { fqn: "main.finance.finance_facts" },
          ],
          columns: [],
          foreignKeys: [],
          metricViews: [],
          lineageDiscoveredFqns: [],
        } as never,
        allowlist: {} as never,
        existingMetricViews: [],
        measures: [],
        dimensions: [],
        joinSpecs: [],
        columnEnrichments: [],
        endpoint: "endpoint",
      },
      runner as never,
    );

    const legitimate = result.proposals.filter((proposal) => proposal.name.endsWith("legitimate"));
    const escaped = result.proposals.filter((proposal) => proposal.name.endsWith("escaped"));
    expect(legitimate).toHaveLength(2);
    expect(legitimate.every(isMetricViewValidationDeployable)).toBe(true);
    expect(escaped).toHaveLength(2);
    expect(escaped.every((proposal) => proposal.validationStatus === "error")).toBe(true);
    expect(escaped.every((proposal) => !isMetricViewValidationDeployable(proposal))).toBe(true);
    expect(
      escaped.every((proposal) =>
        proposal.validationEvidence?.some(
          (entry) => entry.code === "METRIC_VIEW_SCHEMA_PARTITION_ESCAPE",
        ),
      ),
    ).toBe(true);
  });

  it("quarantines a foreign DDL target while accepting a quoted exact local envelope", async () => {
    const runner = vi.fn(async (input) => {
      const target = input.deploymentTarget;
      const localTable = `${target.catalog}.${target.schema}.orders`;
      const proposal = (name: string, ddlTarget: string) => ({
        name,
        description: name,
        definition: {
          version: "1.1",
          name,
          source: { kind: "table", table: localTable },
          joins: [],
          dimensions: [],
          measures: [],
          requiredFeatures: [],
        },
        yaml: 'version: "1.1"',
        ddl:
          `CREATE OR REPLACE VIEW ${ddlTarget}\n` +
          "WITH METRICS\nLANGUAGE YAML\nAS $$\nversion: \"1.1\"\n$$",
        sourceTables: [localTable],
        hasJoins: false,
        hasFilteredMeasures: false,
        hasWindowMeasures: false,
        hasMaterialization: false,
        classification: "new",
        validationStatus: "valid",
        validationIssues: [],
        validatorVersion: "metric-view-probes-v1",
        validationEvidence: [
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
        ],
        validatedAt: "2026-07-25T00:00:00.000Z",
      });
      return {
        proposals: [
          proposal(
            "sales_metrics",
            `\`${target.catalog}\`.\`${target.schema}\`.\`sales_metrics\``,
          ),
          proposal("foreign_metrics", "`other_catalog`.`other_schema`.`foreign_metrics`"),
        ],
        subdomainGroups: [],
        planSummary: "ddl-targets",
      };
    });

    const result = await runTypedMetricViewEngineV2BySchema(
      {
        domain: "Sales",
        tableFqns: ["main.sales.orders"],
        useCases: useCases.slice(0, 1) as never,
        metadata: metadataFor("main.sales.orders"),
        allowlist: {} as never,
        existingMetricViews: [],
        measures: [],
        dimensions: [],
        joinSpecs: [],
        columnEnrichments: [],
        endpoint: "endpoint",
      },
      runner as never,
    );

    const local = result.proposals.find((proposal) => proposal.name === "sales_metrics");
    const foreign = result.proposals.find((proposal) => proposal.name === "foreign_metrics");
    expect(local && isMetricViewValidationDeployable(local)).toBe(true);
    expect(foreign).toMatchObject({
      validationStatus: "error",
      validatorVersion: undefined,
      validatedAt: undefined,
    });
    expect(foreign?.validationEvidence).toContainEqual(
      expect.objectContaining({
        status: "failed",
        code: "METRIC_VIEW_DDL_TARGET_INVALID",
      }),
    );
    expect(foreign && isMetricViewValidationDeployable(foreign)).toBe(false);
  });
});
