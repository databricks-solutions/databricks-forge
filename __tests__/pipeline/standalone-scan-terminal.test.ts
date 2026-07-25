import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  filterAccessibleScopes: vi.fn(),
  listTables: vi.fn(),
  listColumns: vi.fn(),
  listForeignKeys: vi.fn(),
  fetchTableComments: vi.fn(),
  fetchTableTypes: vi.fn(),
  saveEnvironmentScan: vi.fn(),
  markScanFailed: vi.fn(),
  updateScanProgress: vi.fn(),
}));

vi.mock("@/lib/queries/metadata", () => ({
  listTables: mocks.listTables,
  listColumns: mocks.listColumns,
  listForeignKeys: mocks.listForeignKeys,
  fetchTableComments: mocks.fetchTableComments,
  mergeTableComments: vi.fn(),
  fetchTableTypes: mocks.fetchTableTypes,
  mergeTableTypes: vi.fn(),
  fetchColumnsBatch: vi.fn(),
  fetchTableInfoBatch: vi.fn(),
  filterAccessibleScopes: mocks.filterAccessibleScopes,
}));
vi.mock("@/lib/queries/metadata-detail", () => ({
  enrichTablesInBatches: vi.fn(),
  getTableTags: vi.fn(),
  getColumnTags: vi.fn(),
}));
vi.mock("@/lib/queries/lineage", () => ({ walkLineage: vi.fn() }));
vi.mock("@/lib/ai/environment-intelligence", () => ({
  runIntelligenceLayer: vi.fn(),
  buildTableInputs: vi.fn(),
}));
vi.mock("@/lib/domain/health-score", () => ({ computeAllTableHealth: vi.fn() }));
vi.mock("@/lib/lakebase/environment-scans", () => ({
  saveEnvironmentScan: mocks.saveEnvironmentScan,
  markScanFailed: mocks.markScanFailed,
}));
vi.mock("@/lib/dbx/client", () => ({ resolveEndpoint: vi.fn() }));
vi.mock("@/lib/pipeline/scan-progress", () => ({
  initScanProgress: vi.fn(),
  updateScanProgress: mocks.updateScanProgress,
}));
vi.mock("@/lib/discovery/asset-scanner", () => ({ discoverExistingAssets: vi.fn() }));
vi.mock("@/lib/discovery/coverage", () => ({ computeCoverage: vi.fn() }));
vi.mock("@/lib/toolkit/column-budget", () => ({
  resolveColumnBudget: () => ({ maxColumnRowsPerScope: 10_000 }),
  detectWideSchema: () => ({ hasWideTables: false, wideTableCount: 0, maxColumnCount: 0 }),
  WIDE_SCHEMA_FETCH_LIMITS: { maxSampleColumns: 100 },
}));
vi.mock("@/lib/logger", () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("@/lib/domain/scope-selection", () => ({
  parseExcludedString: () => [],
  parsePatternsString: () => [],
  globMatch: () => false,
}));

import { runStandaloneEnrichment } from "@/lib/pipeline/standalone-scan";

describe("runStandaloneEnrichment terminal outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchTableComments.mockResolvedValue([]);
    mocks.fetchTableTypes.mockResolvedValue([]);
    mocks.listColumns.mockResolvedValue([]);
    mocks.listForeignKeys.mockResolvedValue([]);
  });

  it("throws a typed no_access terminal error instead of returning success", async () => {
    mocks.filterAccessibleScopes.mockResolvedValue({
      accessible: [],
      skipped: [{ label: "cat.schema" }],
    });

    await expect(runStandaloneEnrichment("scan-1", "cat.schema")).rejects.toMatchObject({
      name: "StandaloneScanTerminalError",
      reason: "no_access",
    });
    expect(mocks.saveEnvironmentScan).not.toHaveBeenCalled();
    expect(mocks.markScanFailed).toHaveBeenCalledWith("scan-1");
  });

  it("throws a typed no_tables terminal error instead of returning success", async () => {
    mocks.filterAccessibleScopes.mockResolvedValue({
      accessible: [{ catalog: "cat", schema: "schema" }],
      skipped: [],
    });
    mocks.listTables.mockResolvedValue([]);

    await expect(runStandaloneEnrichment("scan-2", "cat.schema")).rejects.toMatchObject({
      name: "StandaloneScanTerminalError",
      reason: "no_tables",
    });
    expect(mocks.saveEnvironmentScan).not.toHaveBeenCalled();
    expect(mocks.markScanFailed).toHaveBeenCalledWith("scan-2");
  });
});
