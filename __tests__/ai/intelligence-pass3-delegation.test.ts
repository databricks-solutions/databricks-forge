import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LineageGraph, ForeignKey } from "@/lib/domain/types";
import type { IntelligenceTableInput } from "@/lib/metadata/context-builder";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/metadata/context-builder", () => ({
  buildSchemaContextFromIntelligence: vi.fn(() => ({
    tables: [
      {
        fqn: "cat.schema.orders",
        catalog: "cat",
        schema: "schema",
        tableName: "orders",
        columns: [
          {
            name: "id",
            dataType: "BIGINT",
            ordinalPosition: 1,
            isNullable: true,
            comment: null,
            inferredRole: "pk",
            inferredFkTarget: null,
          },
        ],
        comment: null,
        tableType: "TABLE",
        format: null,
        tags: [],
        owner: null,
        sizeInBytes: null,
        writeFrequency: null,
        lastModified: null,
        domain: null,
        role: null,
        tier: null,
        dataAssetId: null,
        dataAssetName: null,
        relatedTableFqns: [],
        namingSignals: { prefixTier: null, prefixRole: null, convention: "snake_case" },
      },
    ],
    relationships: [],
    lineageEdges: [],
    foreignKeys: [],
    namingConventions: {
      dominantConvention: "snake_case",
      commonPrefixes: [],
      commonSuffixes: [],
      hasMedallionPattern: false,
    },
    schemaSummary: "### SCHEMA OVERVIEW\n1 tables across 1 schema(s)",
  })),
}));

vi.mock("@/lib/ai/comment-engine/table-pass", () => ({
  runTableCommentPass: vi.fn(() =>
    Promise.resolve(new Map([["cat.schema.orders", "Tracks sales orders with lifecycle state"]])),
  ),
  buildLineageContextBlock: vi.fn(() => "No lineage data available."),
}));

vi.mock("@/lib/dbx/model-serving", () => ({
  chatCompletion: vi.fn(() =>
    Promise.resolve({
      content: "[]",
      model: "test",
      finishReason: "stop",
    }),
  ),
}));

vi.mock("@/lib/toolkit/parse-llm-json", () => ({
  parseLLMJson: vi.fn(() => []),
}));

vi.mock("@/lib/ai/templates", () => ({
  formatPrompt: vi.fn((_key: string, _vars: Record<string, string>) => "mock prompt"),
}));

vi.mock("@/lib/toolkit/token-budget", () => ({
  buildTokenAwareBatches: vi.fn((items: unknown[]) => [items]),
  estimateTokens: vi.fn(() => 100),
  truncateColumns: vi.fn((cols: unknown[], max: number) => ({
    truncated: (cols as unknown[]).slice(0, max),
    omitted: Math.max(0, (cols as unknown[]).length - max),
  })),
}));

vi.mock("@/lib/domain/pii-rules", () => ({
  detectPIIDeterministic: vi.fn(() => []),
}));

const _mockIntelligenceLog = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
  timed: vi.fn(),
  context: {},
};
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createScopedLogger: () => _mockIntelligenceLog,
  apiLogger: () => _mockIntelligenceLog,
}));

vi.mock("@/lib/embeddings/retriever", () => ({
  retrieveContext: vi.fn(() => Promise.resolve([])),
  formatRetrievedContext: vi.fn(() => ""),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("intelligence layer Pass 3 delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runTableCommentPass instead of the old prompt-based passAutoDescriptions", async () => {
    const { runIntelligenceLayer } = await import("@/lib/ai/environment-intelligence");
    const { runTableCommentPass } = await import("@/lib/ai/comment-engine/table-pass");
    const { buildSchemaContextFromIntelligence } = await import("@/lib/metadata/context-builder");

    const tables: IntelligenceTableInput[] = [
      {
        fqn: "cat.schema.orders",
        columns: [{ name: "id", type: "BIGINT", comment: null }],
        comment: null,
        tags: [],
        detail: null,
        history: null,
      },
    ];

    const lineageGraph: LineageGraph = {
      edges: [],
      seedTables: [],
      discoveredTables: [],
      upstreamDepth: 0,
      downstreamDepth: 0,
    };

    const result = await runIntelligenceLayer(tables, lineageGraph, {
      endpoint: "test-endpoint",
    });

    expect(buildSchemaContextFromIntelligence).toHaveBeenCalledTimes(1);
    expect(runTableCommentPass).toHaveBeenCalledTimes(1);
    expect(result.generatedDescriptions.get("cat.schema.orders")).toBe(
      "Tracks sales orders with lifecycle state",
    );
  });

  it("passes industry context when industryId is set", async () => {
    vi.doMock("@/lib/domain/industry-outcomes-server", () => ({
      buildIndustryContextPrompt: vi.fn(() => Promise.resolve("Banking context...")),
      buildDataAssetContext: vi.fn(() =>
        Promise.resolve({
          text: "Data asset context...",
          assets: [
            {
              id: "asset-1",
              name: "Customer Accounts",
              description: "Account data",
              assetFamily: "CRM",
            },
          ],
        }),
      ),
      buildUseCaseLinkageContext: vi.fn(() => Promise.resolve("Use case linkages...")),
    }));

    const { runIntelligenceLayer } = await import("@/lib/ai/environment-intelligence");
    const { runTableCommentPass } = await import("@/lib/ai/comment-engine/table-pass");

    const tables: IntelligenceTableInput[] = [
      {
        fqn: "cat.schema.accounts",
        columns: [{ name: "account_id", type: "BIGINT", comment: null }],
        comment: null,
        tags: [],
        detail: null,
        history: null,
      },
    ];

    const lineageGraph: LineageGraph = {
      edges: [],
      seedTables: [],
      discoveredTables: [],
      upstreamDepth: 0,
      downstreamDepth: 0,
    };

    await runIntelligenceLayer(tables, lineageGraph, {
      endpoint: "test-endpoint",
      industryId: "banking",
    });

    expect(runTableCommentPass).toHaveBeenCalledTimes(1);
    const passCallArgs = (runTableCommentPass as ReturnType<typeof vi.fn>).mock.calls[0];
    const context = passCallArgs[1];
    expect(context.industryContext).toBe("Banking context...");
    expect(context.dataAssetContext).toBe("Data asset context...");
    expect(context.useCaseLinkage).toBe("Use case linkages...");
  });

  it("grounds intelligence prompts and descriptions in concise estate context", async () => {
    const { runIntelligenceLayer } = await import("@/lib/ai/environment-intelligence");
    const { runTableCommentPass } = await import("@/lib/ai/comment-engine/table-pass");
    const { formatPrompt } = await import("@/lib/ai/templates");

    const tables: IntelligenceTableInput[] = [
      {
        fqn: "energy.upstream.wells",
        columns: [{ name: "well_id", type: "BIGINT", comment: null }],
        comment: null,
        tags: [],
        detail: null,
        history: null,
      },
    ];

    await runIntelligenceLayer(
      tables,
      { edges: [], seedTables: [], discoveredTables: [], upstreamDepth: 0, downstreamDepth: 0 },
      {
        endpoint: "test-endpoint",
        industryId: "oil-gas-noc",
        subVertical: "National Oil Company",
        orgContext: "State-owned integrated energy operator",
      },
    );

    const domainCall = (formatPrompt as ReturnType<typeof vi.fn>).mock.calls.find(
      ([key]) => key === "ENV_DOMAIN_CATEGORISATION_PROMPT",
    );
    expect(domainCall?.[1].estate_context).toContain("Industry: oil-gas-noc");
    expect(domainCall?.[1].estate_context).toContain("Sub-vertical: National Oil Company");
    expect(domainCall?.[1].estate_context).toContain(
      "Organisation context: State-owned integrated energy operator",
    );

    const descriptionContext = (runTableCommentPass as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(descriptionContext.businessContext).toContain("National Oil Company");
    expect(descriptionContext.businessContext).toContain("State-owned integrated energy operator");
  });

  it("passes foreign keys to the adapter when provided", async () => {
    const { runIntelligenceLayer } = await import("@/lib/ai/environment-intelligence");
    const { buildSchemaContextFromIntelligence } = await import("@/lib/metadata/context-builder");

    const tables: IntelligenceTableInput[] = [
      {
        fqn: "cat.schema.orders",
        columns: [{ name: "id", type: "BIGINT", comment: null }],
        comment: null,
        tags: [],
        detail: null,
        history: null,
      },
    ];

    const fks: ForeignKey[] = [
      {
        constraintName: "fk_test",
        tableFqn: "cat.schema.orders",
        columnName: "customer_id",
        referencedTableFqn: "cat.schema.customers",
        referencedColumnName: "id",
      },
    ];

    await runIntelligenceLayer(
      tables,
      {
        edges: [],
        seedTables: [],
        discoveredTables: [],
        upstreamDepth: 0,
        downstreamDepth: 0,
      },
      {
        endpoint: "test-endpoint",
        foreignKeys: fks,
      },
    );

    const adapterCall = (buildSchemaContextFromIntelligence as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(adapterCall[3]).toEqual(fks);
  });

  it("skips description generation when all tables have unique comments", async () => {
    const { runIntelligenceLayer } = await import("@/lib/ai/environment-intelligence");
    const { runTableCommentPass } = await import("@/lib/ai/comment-engine/table-pass");

    const tables: IntelligenceTableInput[] = [
      {
        fqn: "cat.schema.orders",
        columns: [{ name: "id", type: "BIGINT", comment: null }],
        comment: "Unique order comment",
        tags: [],
        detail: null,
        history: null,
      },
      {
        fqn: "cat.schema.customers",
        columns: [{ name: "id", type: "BIGINT", comment: null }],
        comment: "Unique customer comment",
        tags: [],
        detail: null,
        history: null,
      },
    ];

    const result = await runIntelligenceLayer(
      tables,
      { edges: [], seedTables: [], discoveredTables: [], upstreamDepth: 0, downstreamDepth: 0 },
      { endpoint: "test-endpoint" },
    );

    expect(runTableCommentPass).not.toHaveBeenCalled();
    expect(result.generatedDescriptions.size).toBe(0);
  });
});
