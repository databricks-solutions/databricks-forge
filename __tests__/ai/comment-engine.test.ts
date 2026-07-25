import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("@/lib/metadata/context-builder", () => ({
  buildSchemaContext: vi.fn(),
}));

vi.mock("@/lib/domain/industry-outcomes-server", () => ({
  buildIndustryContextPrompt: vi.fn().mockResolvedValue(""),
  buildDataAssetContext: vi.fn().mockResolvedValue({ text: "", assets: [] }),
  buildUseCaseLinkageContext: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/lib/ai/comment-engine/table-pass", () => ({
  runTableCommentPass: vi.fn(),
  buildLineageContextBlock: vi.fn().mockReturnValue("No lineage data available."),
}));

vi.mock("@/lib/ai/comment-engine/column-pass", () => ({
  runColumnCommentPass: vi.fn(),
}));

vi.mock("@/lib/ai/comment-engine/consistency-pass", () => ({
  runConsistencyReview: vi.fn().mockResolvedValue([]),
  applyConsistencyFixes: vi.fn().mockReturnValue(0),
}));

const _mockEngineLog = {
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
  createScopedLogger: () => _mockEngineLog,
  apiLogger: () => _mockEngineLog,
}));

import { runCommentEngine } from "@/lib/ai/comment-engine/engine";
import { buildSchemaContext } from "@/lib/metadata/context-builder";
import {
  buildIndustryContextPrompt,
  buildDataAssetContext,
  buildUseCaseLinkageContext,
} from "@/lib/domain/industry-outcomes-server";
import { runTableCommentPass } from "@/lib/ai/comment-engine/table-pass";
import { runColumnCommentPass } from "@/lib/ai/comment-engine/column-pass";
import { runConsistencyReview } from "@/lib/ai/comment-engine/consistency-pass";
import type { SchemaContext } from "@/lib/metadata/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSchemaContext(overrides: Partial<SchemaContext> = {}): SchemaContext {
  return {
    tables: [
      {
        fqn: "cat.sch.customers",
        catalog: "cat",
        schema: "sch",
        tableName: "customers",
        columns: [
          {
            name: "id",
            dataType: "BIGINT",
            ordinalPosition: 1,
            isNullable: false,
            comment: null,
            inferredRole: "pk",
            inferredFkTarget: null,
          },
          {
            name: "name",
            dataType: "STRING",
            ordinalPosition: 2,
            isNullable: true,
            comment: null,
            inferredRole: null,
            inferredFkTarget: null,
          },
        ],
        comment: null,
        tableType: "TABLE",
        format: "delta",
        tags: [],
        owner: "admin",
        sizeInBytes: 1024,
        writeFrequency: "daily",
        lastModified: "2026-01-01T00:00:00Z",
        domain: "Customer",
        role: "dimension",
        tier: "gold",
        dataAssetId: "A01",
        dataAssetName: "Customer Master",
        relatedTableFqns: ["cat.sch.orders"],
        namingSignals: { prefixTier: null, prefixRole: null, convention: "snake_case" },
      },
      {
        fqn: "cat.sch.orders",
        catalog: "cat",
        schema: "sch",
        tableName: "orders",
        columns: [
          {
            name: "id",
            dataType: "BIGINT",
            ordinalPosition: 1,
            isNullable: false,
            comment: null,
            inferredRole: "pk",
            inferredFkTarget: null,
          },
          {
            name: "customer_id",
            dataType: "BIGINT",
            ordinalPosition: 2,
            isNullable: false,
            comment: null,
            inferredRole: "fk",
            inferredFkTarget: "cat.sch.customers",
          },
          {
            name: "total_amount",
            dataType: "DECIMAL",
            ordinalPosition: 3,
            isNullable: true,
            comment: null,
            inferredRole: "measure",
            inferredFkTarget: null,
          },
        ],
        comment: "Order records",
        tableType: "TABLE",
        format: "delta",
        tags: [],
        owner: "admin",
        sizeInBytes: 2048,
        writeFrequency: "hourly",
        lastModified: "2026-03-10T00:00:00Z",
        domain: "Transaction",
        role: "fact",
        tier: "silver",
        dataAssetId: "A06",
        dataAssetName: "Transaction Ledger",
        relatedTableFqns: ["cat.sch.customers"],
        namingSignals: { prefixTier: null, prefixRole: null, convention: "snake_case" },
      },
    ],
    relationships: [],
    lineageEdges: [],
    foreignKeys: [],
    namingConventions: {
      dominantConvention: "snake_case",
      commonPrefixes: [],
      commonSuffixes: ["_id"],
      hasMedallionPattern: false,
    },
    schemaSummary: "### SCHEMA OVERVIEW\n2 tables",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCommentEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result when no tables found", async () => {
    vi.mocked(buildSchemaContext).mockResolvedValue(makeSchemaContext({ tables: [] }));

    const result = await runCommentEngine({ catalogs: ["cat"] });

    expect(result.tableComments.size).toBe(0);
    expect(result.columnComments.size).toBe(0);
    expect(result.stats.tables).toBe(0);
  });

  it("orchestrates all phases in sequence", async () => {
    vi.mocked(buildSchemaContext).mockResolvedValue(makeSchemaContext());
    vi.mocked(runTableCommentPass).mockResolvedValue(
      new Map([
        ["cat.sch.customers", "Golden customer dimension with demographics and segments"],
        ["cat.sch.orders", "Fact table recording customer order transactions"],
      ]),
    );
    vi.mocked(runColumnCommentPass).mockResolvedValue(
      new Map([
        [
          "cat.sch.customers",
          new Map([
            ["id", "Unique customer identifier"],
            ["name", "Full legal name of the customer"],
          ]),
        ],
        [
          "cat.sch.orders",
          new Map([
            ["customer_id", "FK to dim_customers. Identifies the ordering customer."],
            ["total_amount", "Order total in local currency before tax"],
          ]),
        ],
      ]),
    );

    const result = await runCommentEngine({ catalogs: ["cat"] });

    expect(buildSchemaContext).toHaveBeenCalledOnce();
    expect(runTableCommentPass).toHaveBeenCalledOnce();
    expect(runColumnCommentPass).toHaveBeenCalledOnce();
    expect(runConsistencyReview).toHaveBeenCalledOnce();

    expect(result.stats.tables).toBe(2);
    expect(result.stats.columns).toBe(4);
    expect(result.tableComments.get("cat.sch.customers")).toContain("customer");
    expect(result.columnComments.get("cat.sch.orders")?.get("total_amount")).toContain("currency");
  });

  it("loads industry context when industryId provided", async () => {
    vi.mocked(buildSchemaContext).mockResolvedValue(makeSchemaContext());
    vi.mocked(buildIndustryContextPrompt).mockResolvedValue("### INDUSTRY CONTEXT (Banking)");
    vi.mocked(buildDataAssetContext).mockResolvedValue({
      text: "### INDUSTRY DATA ASSETS",
      assets: [
        {
          id: "A01",
          name: "Customer Master",
          description: "Golden record",
          assetFamily: "Customer",
        },
      ],
    });
    vi.mocked(buildUseCaseLinkageContext).mockResolvedValue("### DATA ASSET BUSINESS CONTEXT");
    vi.mocked(runTableCommentPass).mockResolvedValue(new Map());
    vi.mocked(runColumnCommentPass).mockResolvedValue(new Map());

    await runCommentEngine({ catalogs: ["cat"] }, { industryId: "banking" });

    expect(buildIndustryContextPrompt).toHaveBeenCalledWith("banking");
    expect(buildDataAssetContext).toHaveBeenCalledWith("banking");
    expect(buildUseCaseLinkageContext).toHaveBeenCalled();
  });

  it("skips consistency review when disabled", async () => {
    vi.mocked(buildSchemaContext).mockResolvedValue(makeSchemaContext());
    vi.mocked(runTableCommentPass).mockResolvedValue(new Map([["cat.sch.customers", "desc"]]));
    vi.mocked(runColumnCommentPass).mockResolvedValue(new Map());

    await runCommentEngine({ catalogs: ["cat"] }, { enableConsistencyReview: false });

    expect(runConsistencyReview).not.toHaveBeenCalled();
  });

  it("exposes schemaContext in the result for downstream reuse", async () => {
    const ctx = makeSchemaContext();
    vi.mocked(buildSchemaContext).mockResolvedValue(ctx);
    vi.mocked(runTableCommentPass).mockResolvedValue(new Map());
    vi.mocked(runColumnCommentPass).mockResolvedValue(new Map());

    const result = await runCommentEngine({ catalogs: ["cat"] });

    expect(result.schemaContext.tables.length).toBe(2);
    expect(result.schemaContext.schemaSummary).toBeTruthy();
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    vi.mocked(buildSchemaContext).mockRejectedValue(new Error("Cancelled"));

    await expect(
      runCommentEngine({ catalogs: ["cat"] }, { signal: controller.signal }),
    ).rejects.toThrow("Cancelled");
  });

  it("includes related tables from same domain in column pass input", async () => {
    vi.mocked(buildSchemaContext).mockResolvedValue(makeSchemaContext());
    vi.mocked(runTableCommentPass).mockResolvedValue(
      new Map([
        ["cat.sch.customers", "Customer dimension"],
        ["cat.sch.orders", "Order fact table"],
      ]),
    );
    vi.mocked(runColumnCommentPass).mockResolvedValue(new Map());

    await runCommentEngine({ catalogs: ["cat"] });

    const columnPassCall = vi.mocked(runColumnCommentPass).mock.calls[0];
    const columnInputs = columnPassCall[0];

    // The "customers" table should have "orders" as a related table (from relatedTableFqns)
    const customersInput = columnInputs.find((i) => i.tableFqn === "cat.sch.customers");
    expect(customersInput?.relatedTables.length).toBeGreaterThan(0);
    expect(customersInput?.relatedTables.some((r) => r.fqn === "cat.sch.orders")).toBe(true);
  });

  it("passes data asset descriptions to column pass", async () => {
    vi.mocked(buildSchemaContext).mockResolvedValue(makeSchemaContext());
    vi.mocked(buildDataAssetContext).mockResolvedValue({
      text: "### INDUSTRY DATA ASSETS",
      assets: [
        {
          id: "A01",
          name: "Customer Master",
          description: "Golden customer record",
          assetFamily: "Customer",
        },
        {
          id: "A06",
          name: "Transaction Ledger",
          description: "Core transaction records",
          assetFamily: "Transaction",
        },
      ],
    });
    vi.mocked(runTableCommentPass).mockResolvedValue(new Map());
    vi.mocked(runColumnCommentPass).mockResolvedValue(new Map());

    await runCommentEngine({ catalogs: ["cat"] }, { industryId: "banking" });

    const columnPassCall = vi.mocked(runColumnCommentPass).mock.calls[0];
    const columnInputs = columnPassCall[0];

    const customersInput = columnInputs.find((i) => i.tableFqn === "cat.sch.customers");
    expect(customersInput?.dataAssetId).toBe("A01");
    expect(customersInput?.dataAssetDescription).toBe("Golden customer record");
  });
});
