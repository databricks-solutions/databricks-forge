import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the lakebase accessor so the reconstitution runs against a fixture.
const getEnvironmentScan = vi.fn();
vi.mock("@/lib/lakebase/environment-scans", () => ({
  getEnvironmentScan: (scanId: string) => getEnvironmentScan(scanId),
}));

import { reconstituteMetadataFromScan } from "@/lib/pipeline/scan-reconstitution";

function fixtureScan() {
  return {
    scanId: "scan-1",
    ucPath: "cat.sch",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    details: [
      {
        tableFqn: "cat.sch.orders",
        catalog: "cat",
        schema: "sch",
        tableName: "orders",
        tableType: "TABLE",
        format: "DELTA",
        comment: "Orders fact",
        generatedDescription: null,
        discoveredVia: "selected",
        columnsJson: JSON.stringify([
          { name: "order_id", type: "bigint", nullable: false, comment: "PK" },
          { name: "customer_id", type: "bigint", nullable: true, comment: null },
        ]),
      },
      {
        tableFqn: "cat.sch.customers",
        catalog: "cat",
        schema: "sch",
        tableName: "customers",
        tableType: "TABLE",
        format: null,
        comment: null,
        generatedDescription: "Customer dimension",
        discoveredVia: "lineage",
        columnsJson: JSON.stringify([
          { name: "customer_id", type: "bigint", nullable: false, comment: null },
        ]),
      },
    ],
    insights: [
      {
        insightType: "foreign_key",
        payloadJson: JSON.stringify({
          constraintName: "fk_orders_customer",
          tableFqn: "cat.sch.orders",
          columnName: "customer_id",
          referencedTableFqn: "cat.sch.customers",
          referencedColumnName: "customer_id",
        }),
      },
      { insightType: "data_product", payloadJson: JSON.stringify({ productName: "Sales" }) },
    ],
    lineage: [
      {
        sourceTableFqn: "cat.sch.customers",
        targetTableFqn: "cat.sch.orders",
        sourceType: "TABLE",
        targetType: "TABLE",
        lastEventTime: null,
        entityType: "JOB",
        eventCount: 3,
      },
    ],
  };
}

describe("reconstituteMetadataFromScan", () => {
  beforeEach(() => getEnvironmentScan.mockReset());

  it("rebuilds a metadata snapshot + lineage graph from a persisted scan", async () => {
    getEnvironmentScan.mockResolvedValue(fixtureScan());

    const result = await reconstituteMetadataFromScan("scan-1", "cat.sch");
    expect(result).not.toBeNull();
    const { snapshot, lineageGraph } = result!;

    expect(snapshot.cacheKey).toBe("scan:scan-1");
    expect(snapshot.tableCount).toBe(2);
    expect(snapshot.columnCount).toBe(3);

    // ordinalPosition synthesised from array index.
    const orderCols = snapshot.columns.filter((c) => c.tableFqn === "cat.sch.orders");
    expect(orderCols.map((c) => c.ordinalPosition)).toEqual([1, 2]);
    expect(orderCols[0].columnName).toBe("order_id");
    expect(orderCols[0].isNullable).toBe(false);

    // generatedDescription used as comment fallback.
    const customers = snapshot.tables.find((t) => t.fqn === "cat.sch.customers")!;
    expect(customers.comment).toBe("Customer dimension");
    expect(customers.discoveredVia).toBe("lineage");

    // FK parsed from foreign_key insight (data_product ignored).
    expect(snapshot.foreignKeys).toHaveLength(1);
    expect(snapshot.foreignKeys[0].referencedTableFqn).toBe("cat.sch.customers");

    // Lineage + seed/discovered split.
    expect(lineageGraph!.edges).toHaveLength(1);
    expect(lineageGraph!.seedTables).toEqual(["cat.sch.orders"]);
    expect(lineageGraph!.discoveredTables).toEqual(["cat.sch.customers"]);
    expect(snapshot.lineageDiscoveredFqns).toEqual(["cat.sch.customers"]);
  });

  it("returns null when the scan is missing", async () => {
    getEnvironmentScan.mockResolvedValue(null);
    expect(await reconstituteMetadataFromScan("missing", "cat.sch")).toBeNull();
  });

  it("returns null when the scan has no table details", async () => {
    getEnvironmentScan.mockResolvedValue({ ...fixtureScan(), details: [] });
    expect(await reconstituteMetadataFromScan("scan-1", "cat.sch")).toBeNull();
  });

  it("tolerates a scan with no foreign-key insights", async () => {
    const scan = fixtureScan();
    scan.insights = [];
    getEnvironmentScan.mockResolvedValue(scan);
    const result = await reconstituteMetadataFromScan("scan-1", "cat.sch");
    expect(result!.snapshot.foreignKeys).toEqual([]);
  });

  it("maps the database null-entity sentinel back to domain null", async () => {
    const scan = fixtureScan();
    scan.lineage[0].entityType = "__forge_null_entity__";
    getEnvironmentScan.mockResolvedValue(scan);

    const result = await reconstituteMetadataFromScan("scan-1", "cat.sch");

    expect(result!.lineageGraph.edges[0].entityType).toBeNull();
  });
});
