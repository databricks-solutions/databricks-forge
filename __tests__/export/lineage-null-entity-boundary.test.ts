import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildERDGraph, generateMermaidLineageFlow } from "@/lib/export/erd-generator";
import { generateEnvironmentExcel, type ScanWithRelations } from "@/lib/export/environment-excel";

const SENTINEL = "__forge_null_entity__";

function minimalScan(): ScanWithRelations {
  return {
    scanId: "scan-1",
    ucPath: "cat.sch",
    tableCount: 2,
    totalSizeBytes: BigInt(0),
    totalFiles: 0,
    tablesWithStreaming: 0,
    tablesWithCDF: 0,
    tablesNeedingOptimize: 0,
    tablesNeedingVacuum: 0,
    lineageDiscoveredCount: 0,
    domainCount: 0,
    piiTablesCount: 0,
    redundancyPairsCount: 0,
    dataProductCount: 0,
    avgGovernanceScore: 0,
    scanDurationMs: 1,
    passResultsJson: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    details: ["a", "b"].map((tableName) => ({
      tableFqn: `cat.sch.${tableName}`,
      catalog: "cat",
      schema: "sch",
      tableName,
      tableType: "TABLE",
      comment: null,
      generatedDescription: null,
      format: "DELTA",
      provider: null,
      location: null,
      isManaged: true,
      owner: null,
      sizeInBytes: BigInt(0),
      numFiles: 0,
      numRows: BigInt(0),
      partitionColumns: "[]",
      clusteringColumns: "[]",
      dataDomain: null,
      dataSubdomain: null,
      dataTier: null,
      sensitivityLevel: null,
      governancePriority: null,
      governanceScore: null,
      tableCreatedAt: null,
      lastModified: null,
      discoveredVia: "selected",
      propertiesJson: "{}",
      tagsJson: "[]",
      columnTagsJson: "[]",
      columnsJson: "[]",
    })),
    histories: [],
    lineage: [
      {
        sourceTableFqn: "cat.sch.a",
        targetTableFqn: "cat.sch.b",
        sourceType: "TABLE",
        targetType: "TABLE",
        entityType: SENTINEL,
        lastEventTime: null,
        eventCount: 1,
      },
    ],
    insights: [],
  };
}

describe("lineage logical-null presentation boundaries", () => {
  it("does not leak the storage sentinel into ERD labels or Mermaid", () => {
    const scan = minimalScan();
    const graph = buildERDGraph(scan);

    expect(graph.edges[0].entityType).toBeUndefined();
    expect(graph.edges[0].label).toBe("data flow");
    expect(generateMermaidLineageFlow(graph)).not.toContain(SENTINEL);
  });

  it("does not leak the storage sentinel into the Excel lineage sheet", async () => {
    const bytes = await generateEnvironmentExcel(minimalScan());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Lineage");

    expect(sheet).toBeDefined();
    expect(sheet!.getCell("E2").value).toBe("—");
    expect(JSON.stringify(workbook.model)).not.toContain(SENTINEL);
  });
});
