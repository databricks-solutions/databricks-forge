import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { walkLineage } from "@/lib/queries/lineage";

vi.mock("@/lib/dbx/sql", () => ({
  executeSQL: vi.fn(),
}));

const _mockLineageLog = {
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
  createScopedLogger: () => _mockLineageLog,
  apiLogger: () => _mockLineageLog,
}));

import { executeSQL } from "@/lib/dbx/sql";

const mockExecuteSQL = vi.mocked(executeSQL);

beforeEach(() => {
  vi.clearAllMocks();
});

function accessibleRow() {
  return { columns: [], rows: [["1"]], totalRowCount: 1 };
}

function emptyResult() {
  return { columns: [], rows: [], totalRowCount: 0 };
}

describe("walkLineage", () => {
  it("returns empty graph for no seed tables", async () => {
    const result = await walkLineage([]);
    expect(result.edges).toHaveLength(0);
    expect(result.discoveredTables).toHaveLength(0);
    expect(mockExecuteSQL).not.toHaveBeenCalled();
  });

  it("returns empty graph when lineage is not accessible", async () => {
    mockExecuteSQL.mockRejectedValueOnce(new Error("Table not found"));
    const result = await walkLineage(["catalog.schema.table1"]);
    expect(result.edges).toHaveLength(0);
    expect(result.discoveredTables).toHaveLength(0);
  });

  it("performs BFS walk and returns edges", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());

    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      totalRowCount: 2,
      rows: [
        [
          "catalog.schema.source",
          "catalog.schema.table1",
          "TABLE",
          "TABLE",
          "TABLE",
          "2024-01-01",
          "5",
        ],
        [
          "catalog.schema.table1",
          "catalog.schema.target",
          "TABLE",
          "TABLE",
          "TABLE",
          "2024-01-02",
          "3",
        ],
      ],
    });

    // Second BFS round for discovered tables -- no further edges
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    const result = await walkLineage(["catalog.schema.table1"]);

    expect(result.edges).toHaveLength(2);
    expect(result.discoveredTables).toContain("catalog.schema.source");
    expect(result.discoveredTables).toContain("catalog.schema.target");

    // accessibility check + depth-1 BFS query + depth-2 BFS query (empty frontier)
    expect(mockExecuteSQL).toHaveBeenCalledTimes(3);

    const bfsCall = mockExecuteSQL.mock.calls[1][0];
    expect(bfsCall).toContain("system.access.table_lineage");
    expect(bfsCall).toContain("GROUP BY");
  });

  it("uses correct direction for upstream-only walk", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    await walkLineage(["catalog.schema.table1"], { direction: "upstream" });

    const bfsCall = mockExecuteSQL.mock.calls[1][0];
    expect(bfsCall).toContain("target_table_full_name IN");
    expect(bfsCall).not.toContain("source_table_full_name IN");
  });

  it("uses correct direction for downstream-only walk", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    await walkLineage(["catalog.schema.table1"], { direction: "downstream" });

    const bfsCall = mockExecuteSQL.mock.calls[1][0];
    expect(bfsCall).toContain("source_table_full_name IN");
    expect(bfsCall).not.toContain("target_table_full_name IN");
  });

  it("uses both directions by default", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    await walkLineage(["catalog.schema.table1"]);

    const bfsCall = mockExecuteSQL.mock.calls[1][0];
    expect(bfsCall).toContain("target_table_full_name IN");
    expect(bfsCall).toContain("source_table_full_name IN");
  });

  it("caps discovered tables at maxDiscoveredTables", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());

    const manyEdges = Array.from({ length: 20 }, (_, i) => [
      `catalog.schema.src_${i}`,
      `catalog.schema.tgt_${i}`,
      "TABLE",
      "TABLE",
      "TABLE",
      "2024-01-01",
      "1",
    ]);
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      rows: manyEdges,
      totalRowCount: manyEdges.length,
    });

    const result = await walkLineage(["catalog.schema.table1"], {
      maxDiscoveredTables: 5,
    });

    expect(result.discoveredTables.length).toBeLessThanOrEqual(5);
  });

  it("returns partial results when BFS query fails mid-walk", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockRejectedValueOnce(new Error("SQL execution failed"));

    const result = await walkLineage(["catalog.schema.table1"]);
    expect(result.edges).toHaveLength(0);
    expect(result.discoveredTables).toHaveLength(0);
    expect(result.seedTables).toEqual(["catalog.schema.table1"]);
  });

  it("deduplicates edges by source+target+entityType", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      totalRowCount: 2,
      rows: [
        ["catalog.schema.a", "catalog.schema.b", "TABLE", "TABLE", "TABLE", "2024-01-01", "5"],
        ["catalog.schema.a", "catalog.schema.b", "TABLE", "TABLE", "TABLE", "2024-01-02", "3"],
      ],
    });
    // No further frontier since b is the only discovered table
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    const result = await walkLineage(["catalog.schema.a"]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].eventCount).toBe(5);
  });

  it("respects maxDepth option", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());

    // Depth 1: discover table_b from table_a
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      totalRowCount: 1,
      rows: [
        [
          "catalog.schema.table_a",
          "catalog.schema.table_b",
          "TABLE",
          "TABLE",
          "TABLE",
          "2024-01-01",
          "1",
        ],
      ],
    });

    const result = await walkLineage(["catalog.schema.table_a"], { maxDepth: 1 });

    // accessibility + 1 BFS round only
    expect(mockExecuteSQL).toHaveBeenCalledTimes(2);
    expect(result.edges).toHaveLength(1);
    expect(result.discoveredTables).toContain("catalog.schema.table_b");
  });
});

describe("walkLineage shared sample-catalog guard", () => {
  const originalEnv = process.env.FORGE_LINEAGE_SHARED_CATALOGS;

  beforeEach(() => {
    delete process.env.FORGE_LINEAGE_SHARED_CATALOGS;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FORGE_LINEAGE_SHARED_CATALOGS;
    else process.env.FORGE_LINEAGE_SHARED_CATALOGS = originalEnv;
  });

  it("skips the walk entirely when all seeds are in shared sample catalogs", async () => {
    const result = await walkLineage([
      "samples.bakehouse.media_customer_reviews",
      "samples.bakehouse.media_gold_reviews_chunked",
    ]);

    expect(result.edges).toHaveLength(0);
    expect(result.discoveredTables).toHaveLength(0);
    expect(result.skippedSeeds).toEqual([
      "samples.bakehouse.media_customer_reviews",
      "samples.bakehouse.media_gold_reviews_chunked",
    ]);
    // Never even probes accessibility — nothing to walk.
    expect(mockExecuteSQL).not.toHaveBeenCalled();
  });

  it("walks only non-sample seeds when scope is mixed", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    const result = await walkLineage([
      "samples.bakehouse.media_customer_reviews",
      "main.sales.orders",
    ]);

    expect(result.skippedSeeds).toEqual(["samples.bakehouse.media_customer_reviews"]);
    // accessibility + 1 BFS round (empty)
    expect(mockExecuteSQL).toHaveBeenCalledTimes(2);
    const bfsCall = mockExecuteSQL.mock.calls[1][0];
    expect(bfsCall).toContain("'main.sales.orders'");
    expect(bfsCall).not.toContain("samples.bakehouse");
  });

  it("preserves prior behavior when skipSharedCatalogSeeds is false", async () => {
    mockExecuteSQL.mockResolvedValueOnce(accessibleRow());
    mockExecuteSQL.mockResolvedValueOnce(emptyResult());

    const result = await walkLineage(["samples.bakehouse.media_customer_reviews"], {
      skipSharedCatalogSeeds: false,
    });

    expect(result.skippedSeeds).toEqual([]);
    expect(mockExecuteSQL).toHaveBeenCalledTimes(2);
    const bfsCall = mockExecuteSQL.mock.calls[1][0];
    expect(bfsCall).toContain("samples.bakehouse.media_customer_reviews");
  });

  it("honors the FORGE_LINEAGE_SHARED_CATALOGS env override", async () => {
    process.env.FORGE_LINEAGE_SHARED_CATALOGS = "demo_shared,samples";

    const result = await walkLineage(["demo_shared.public.things"]);

    expect(result.skippedSeeds).toEqual(["demo_shared.public.things"]);
    expect(mockExecuteSQL).not.toHaveBeenCalled();
  });
});
