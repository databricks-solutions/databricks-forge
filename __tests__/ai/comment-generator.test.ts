import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/comment-engine/engine", () => ({
  runCommentEngine: vi.fn(),
}));

vi.mock("@/lib/lakebase/comment-proposals", () => ({
  createProposals: vi.fn(),
}));

vi.mock("@/lib/lakebase/comment-jobs", () => ({
  updateCommentJobStatus: vi.fn(),
}));

vi.mock("@/lib/ai/comment-engine/progress", () => ({
  initCommentProgress: vi.fn(),
  updateCommentProgress: vi.fn(),
}));

const _mockGeneratorLog = {
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
  createScopedLogger: () => _mockGeneratorLog,
  apiLogger: () => _mockGeneratorLog,
}));

import { runCommentEngine } from "@/lib/ai/comment-engine/engine";
import { createProposals } from "@/lib/lakebase/comment-proposals";
import { updateCommentJobStatus } from "@/lib/lakebase/comment-jobs";
import { generateComments, importFromScan } from "@/lib/ai/comment-generator";
import type { CommentEngineResult } from "@/lib/ai/comment-engine/types";
import type { SchemaContext } from "@/lib/metadata/types";

const mockEngine = vi.mocked(runCommentEngine);
const mockCreateProposals = vi.mocked(createProposals);
const mockUpdateStatus = vi.mocked(updateCommentJobStatus);

function makeEngineResult(overrides: Partial<CommentEngineResult> = {}): CommentEngineResult {
  return {
    tableComments: new Map(),
    columnComments: new Map(),
    schemaContext: {
      tables: [],
      relationships: [],
      lineageEdges: [],
      foreignKeys: [],
      namingConventions: {
        dominantConvention: "snake_case",
        commonPrefixes: [],
        commonSuffixes: [],
        hasMedallionPattern: false,
      },
      schemaSummary: "",
    } as SchemaContext,
    consistencyFixes: [],
    stats: { tables: 0, columns: 0, skipped: 0, consistencyFixesApplied: 0, durationMs: 100 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateComments", () => {
  it("delegates to Comment Engine and persists proposals", async () => {
    const tableComments = new Map([["cat.sch.customers", "Customer dimension"]]);
    const columnComments = new Map([
      ["cat.sch.customers", new Map([["id", "Unique customer identifier"]])],
    ]);
    const schemaContext = {
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
              comment: "Old ID comment",
              inferredRole: "pk",
              inferredFkTarget: null,
            },
          ],
          comment: "Old table comment",
          tableType: "TABLE",
          format: "delta",
          tags: [],
          owner: null,
          sizeInBytes: null,
          writeFrequency: null,
          lastModified: null,
          domain: "Customer",
          role: "dimension",
          tier: "gold",
          dataAssetId: null,
          dataAssetName: null,
          relatedTableFqns: [],
          namingSignals: { prefixTier: null, prefixRole: null, convention: "snake_case" as const },
        },
      ],
      relationships: [],
      lineageEdges: [],
      foreignKeys: [],
      namingConventions: {
        dominantConvention: "snake_case" as const,
        commonPrefixes: [],
        commonSuffixes: [],
        hasMedallionPattern: false,
      },
      schemaSummary: "",
    } as SchemaContext;

    mockEngine.mockResolvedValue(
      makeEngineResult({
        tableComments,
        columnComments,
        schemaContext,
        stats: { tables: 1, columns: 1, skipped: 0, consistencyFixesApplied: 0, durationMs: 500 },
      }),
    );

    const result = await generateComments({
      jobId: "j1",
      catalogs: ["cat"],
      schemas: ["sch"],
    });

    expect(result.tableCount).toBe(1);
    expect(result.columnCount).toBe(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith("j1", "generating");
    expect(mockUpdateStatus).toHaveBeenCalledWith("j1", "ready", { tableCount: 1, columnCount: 1 });
    expect(mockCreateProposals).toHaveBeenCalledTimes(1);

    // Verify proposals include original comments
    const proposals = mockCreateProposals.mock.calls[0][1];
    const tableProp = proposals.find((p: Record<string, unknown>) => !p.columnName);
    expect(tableProp?.originalComment).toBe("Old table comment");
    expect(tableProp?.proposedComment).toBe("Customer dimension");

    const colProp = proposals.find((p: Record<string, unknown>) => p.columnName === "id");
    expect(colProp?.originalComment).toBe("Old ID comment");
    expect(colProp?.proposedComment).toBe("Unique customer identifier");
  });

  it("returns zero counts when engine returns empty", async () => {
    mockEngine.mockResolvedValue(makeEngineResult());

    const result = await generateComments({
      jobId: "j1",
      catalogs: ["cat"],
    });

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
    expect(mockCreateProposals).not.toHaveBeenCalled();
  });

  it("passes industryId and businessContext to engine", async () => {
    mockEngine.mockResolvedValue(makeEngineResult());

    await generateComments({
      jobId: "j1",
      catalogs: ["cat"],
      industryId: "banking",
      businessContext: "Retail banking focus",
    });

    const engineCall = mockEngine.mock.calls[0];
    expect(engineCall[0]).toEqual({ catalogs: ["cat"], schemas: undefined, tables: undefined });
    expect(engineCall[1]).toMatchObject({
      industryId: "banking",
      businessContext: "Retail banking focus",
    });
  });

  it("marks job as failed when engine throws", async () => {
    mockEngine.mockRejectedValue(new Error("LLM timeout"));

    await expect(generateComments({ jobId: "j1", catalogs: ["cat"] })).rejects.toThrow(
      "LLM timeout",
    );

    expect(mockUpdateStatus).toHaveBeenCalledWith("j1", "failed", {
      errorMessage: "LLM timeout",
    });
  });

  it("passes abort signal to engine", async () => {
    const controller = new AbortController();
    mockEngine.mockResolvedValue(makeEngineResult());

    await generateComments({
      jobId: "j1",
      catalogs: ["cat"],
      signal: controller.signal,
    });

    expect(mockEngine.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

describe("importFromScan", () => {
  it("creates proposals from scan data", async () => {
    const result = await importFromScan("j1", [
      {
        tableFqn: "cat.sch.tbl1",
        comment: "Old comment",
        generatedDescription: "AI-generated description",
        columnsJson: null,
      },
      {
        tableFqn: "cat.sch.tbl2",
        comment: null,
        generatedDescription: null,
        columnsJson: null,
      },
    ]);

    expect(result.tableCount).toBe(1);
    expect(result.columnCount).toBe(0);
    expect(mockCreateProposals).toHaveBeenCalledWith("j1", [
      {
        tableFqn: "cat.sch.tbl1",
        columnName: null,
        originalComment: "Old comment",
        proposedComment: "AI-generated description",
      },
    ]);
  });

  it("handles empty scan data", async () => {
    const result = await importFromScan("j1", []);

    expect(result.tableCount).toBe(0);
    expect(mockCreateProposals).not.toHaveBeenCalled();
  });
});
