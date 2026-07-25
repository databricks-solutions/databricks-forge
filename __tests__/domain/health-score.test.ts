import { describe, it, expect } from "vitest";
import { computeTableHealth, computeAllTableHealth } from "@/lib/domain/health-score";
import type { TableDetail, TableHistorySummary } from "@/lib/domain/types";

function makeDetail(overrides: Partial<TableDetail> = {}): TableDetail {
  return {
    fqn: "catalog.schema.test_table",
    catalog: "catalog",
    schema: "schema",
    tableName: "test_table",
    tableType: "MANAGED",
    format: "DELTA",
    comment: "A well-documented table",
    owner: "admin",
    provider: null,
    isManaged: true,
    location: null,
    createdAt: "2024-01-01T00:00:00Z",
    lastModified: "2024-06-01T00:00:00Z",
    sizeInBytes: 1_073_741_824,
    numFiles: 10,
    numRows: 1_000_000,
    partitionColumns: [],
    clusteringColumns: [],
    tableProperties: {},
    createdBy: null,
    lastAccess: null,
    isManagedLocation: null,
    deltaMinReaderVersion: 3,
    deltaMinWriterVersion: 7,
    dataDomain: null,
    dataSubdomain: null,
    dataTier: null,
    generatedDescription: null,
    sensitivityLevel: null,
    governancePriority: null,
    discoveredVia: "selected",
    ...overrides,
  };
}

function makeHistory(overrides: Partial<TableHistorySummary> = {}): TableHistorySummary {
  const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
  return {
    tableFqn: "catalog.schema.test_table",
    lastWriteTimestamp: recent,
    lastWriteOperation: "WRITE",
    lastWriteRows: 1000,
    lastWriteBytes: 50000,
    totalWriteOps: 50,
    totalStreamingOps: 0,
    totalOptimizeOps: 10,
    totalVacuumOps: 5,
    totalMergeOps: 0,
    lastOptimizeTimestamp: recent,
    lastVacuumTimestamp: recent,
    hasStreamingWrites: false,
    historyDays: 90,
    topOperations: { WRITE: 50, OPTIMIZE: 10, VACUUM: 5 },
    ...overrides,
  };
}

describe("computeTableHealth", () => {
  it("returns 100 for a perfectly healthy table", () => {
    const result = computeTableHealth(makeDetail(), makeHistory());
    expect(result.healthScore).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it("deducts 15 for missing OPTIMIZE in 30+ days", () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const result = computeTableHealth(makeDetail(), makeHistory({ lastOptimizeTimestamp: old }));
    expect(result.issues).toContain("No OPTIMIZE run in the last 30 days");
    expect(result.healthScore).toBeLessThanOrEqual(85);
  });

  it("deducts 15 for missing VACUUM in 30+ days", () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const result = computeTableHealth(makeDetail(), makeHistory({ lastVacuumTimestamp: old }));
    expect(result.issues).toContain("No VACUUM run in the last 30 days");
  });

  it("deducts 20 for small file problem", () => {
    const detail = makeDetail({ sizeInBytes: 10_000_000, numFiles: 100 }); // 100KB avg
    const result = computeTableHealth(detail, makeHistory());
    expect(result.issues).toContain("Small file problem detected (average file size < 32MB)");
  });

  it("deducts 10 for missing table comment", () => {
    const detail = makeDetail({ comment: null });
    const result = computeTableHealth(detail, makeHistory());
    expect(result.issues).toContain("No table description/comment set");
  });

  it("deducts 15 for stale data (90+ days)", () => {
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const result = computeTableHealth(makeDetail(), makeHistory({ lastWriteTimestamp: old }));
    expect(result.issues).toContain("Stale data: no writes in the last 90 days");
  });

  it("deducts 10 for streaming without CDF", () => {
    const result = computeTableHealth(
      makeDetail({ tableProperties: {} }),
      makeHistory({ hasStreamingWrites: true }),
    );
    expect(result.issues).toContain(
      "Streaming writes detected but Change Data Feed (CDF) is not enabled",
    );
  });

  it("deducts 5 for outdated Delta protocol", () => {
    const detail = makeDetail({ deltaMinReaderVersion: 1 });
    const result = computeTableHealth(detail, makeHistory());
    expect(result.issues).toContain("Outdated Delta protocol version (reader version < 2)");
  });

  it("deducts 10 for empty table", () => {
    const detail = makeDetail({ numRows: 0 });
    const result = computeTableHealth(detail, makeHistory());
    expect(result.issues).toContain("Table has zero rows");
  });

  it("deducts 5 for very large table", () => {
    const detail = makeDetail({ numRows: 2_000_000_000 });
    const result = computeTableHealth(detail, makeHistory());
    expect(result.issues).toContain("Very large table (> 1,000,000,000 rows)");
  });

  it("accumulates deductions from many rules firing", () => {
    const detail = makeDetail({
      comment: null,
      sizeInBytes: 100_000,
      numFiles: 100,
      numRows: 0,
      deltaMinReaderVersion: 1,
      partitionColumns: Array.from({ length: 150 }, (_, i) => `p${i}`),
    });
    const result = computeTableHealth(detail, null);
    expect(result.healthScore).toBeLessThanOrEqual(50);
    expect(result.issues.length).toBeGreaterThan(3);
  });

  it("handles null history gracefully", () => {
    const result = computeTableHealth(makeDetail(), null);
    expect(result.healthScore).toBeLessThanOrEqual(100);
    expect(result.tableFqn).toBe("catalog.schema.test_table");
  });
});

describe("computeAllTableHealth", () => {
  it("computes health for multiple tables", () => {
    const details = [
      makeDetail({ fqn: "cat.s.t1" }),
      makeDetail({ fqn: "cat.s.t2", comment: null }),
    ];
    const histories = new Map<string, TableHistorySummary>();
    histories.set("cat.s.t1", makeHistory({ tableFqn: "cat.s.t1" }));

    const results = computeAllTableHealth(details, histories);
    expect(results.size).toBe(2);
    expect(results.get("cat.s.t1")!.healthScore).toBeGreaterThanOrEqual(
      results.get("cat.s.t2")!.healthScore,
    );
  });
});
