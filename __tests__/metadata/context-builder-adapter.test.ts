import { describe, it, expect } from "vitest";
import { buildSchemaContextFromIntelligence } from "@/lib/metadata/context-builder";
import type { DataDomain, ForeignKey, LineageGraph } from "@/lib/domain/types";
import type { IntelligenceTableInput } from "@/lib/metadata/context-builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTable(
  fqn: string,
  overrides: Partial<IntelligenceTableInput> = {},
): IntelligenceTableInput {
  const _parts = fqn.split(".");
  return {
    fqn,
    columns: [
      { name: "id", type: "BIGINT", comment: null },
      { name: "name", type: "STRING", comment: "The name" },
      { name: "created_at", type: "TIMESTAMP", comment: null },
    ],
    comment: null,
    tags: [],
    detail: null,
    history: null,
    ...overrides,
  };
}

function emptyLineageGraph(): LineageGraph {
  return {
    edges: [],
    seedTables: [],
    discoveredTables: [],
    upstreamDepth: 0,
    downstreamDepth: 0,
  };
}

// ---------------------------------------------------------------------------
// buildSchemaContextFromIntelligence
// ---------------------------------------------------------------------------

describe("buildSchemaContextFromIntelligence", () => {
  it("returns empty context for no tables", () => {
    const ctx = buildSchemaContextFromIntelligence([], emptyLineageGraph(), [], []);
    expect(ctx.tables).toHaveLength(0);
    expect(ctx.relationships).toHaveLength(0);
    expect(ctx.schemaSummary).toBe("");
  });

  it("builds enriched tables from TableInput data", () => {
    const tables = [
      makeTable("catalog.gold.dim_customers"),
      makeTable("catalog.gold.fact_orders", {
        columns: [
          { name: "order_id", type: "BIGINT", comment: null },
          { name: "customer_id", type: "BIGINT", comment: null },
          { name: "total_amount", type: "DECIMAL", comment: null },
        ],
      }),
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), [], []);

    expect(ctx.tables).toHaveLength(2);

    const dimCustomers = ctx.tables.find((t) => t.fqn === "catalog.gold.dim_customers");
    expect(dimCustomers).toBeDefined();
    expect(dimCustomers!.catalog).toBe("catalog");
    expect(dimCustomers!.schema).toBe("gold");
    expect(dimCustomers!.tableName).toBe("dim_customers");
    expect(dimCustomers!.columns).toHaveLength(3);
    expect(dimCustomers!.namingSignals.prefixRole).toBe("dimension");
    expect(dimCustomers!.namingSignals.prefixTier).toBe("gold");

    const factOrders = ctx.tables.find((t) => t.fqn === "catalog.gold.fact_orders");
    expect(factOrders).toBeDefined();
    expect(factOrders!.namingSignals.prefixRole).toBe("fact");
  });

  it("applies domain classifications from Pass 1", () => {
    const tables = [
      makeTable("cat.schema.customers"),
      makeTable("cat.schema.orders"),
      makeTable("cat.schema.payments"),
    ];

    const domains: DataDomain[] = [
      {
        domain: "Sales",
        subdomain: "Orders",
        tables: ["cat.schema.orders", "cat.schema.payments"],
        description: "Order processing domain",
      },
      {
        domain: "CRM",
        subdomain: "Customers",
        tables: ["cat.schema.customers"],
        description: "Customer management",
      },
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), domains, []);

    const customers = ctx.tables.find((t) => t.fqn === "cat.schema.customers");
    expect(customers!.domain).toBe("CRM");

    const orders = ctx.tables.find((t) => t.fqn === "cat.schema.orders");
    expect(orders!.domain).toBe("Sales");

    const payments = ctx.tables.find((t) => t.fqn === "cat.schema.payments");
    expect(payments!.domain).toBe("Sales");
  });

  it("includes FK constraints as high-confidence relationships", () => {
    const tables = [
      makeTable("cat.schema.orders", {
        columns: [
          { name: "order_id", type: "BIGINT", comment: null },
          { name: "customer_id", type: "BIGINT", comment: null },
        ],
      }),
      makeTable("cat.schema.customers"),
    ];

    const fks: ForeignKey[] = [
      {
        constraintName: "fk_orders_customer",
        tableFqn: "cat.schema.orders",
        columnName: "customer_id",
        referencedTableFqn: "cat.schema.customers",
        referencedColumnName: "id",
      },
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), [], fks);

    const fkRels = ctx.relationships.filter((r) => r.basis === "fk_constraint");
    expect(fkRels.length).toBeGreaterThanOrEqual(1);
    expect(fkRels[0].sourceTable).toBe("cat.schema.orders");
    expect(fkRels[0].targetTable).toBe("cat.schema.customers");
    expect(fkRels[0].confidence).toBe("high");

    expect(ctx.foreignKeys).toHaveLength(1);
    expect(ctx.foreignKeys[0].tableFqn).toBe("cat.schema.orders");
  });

  it("extracts lineage edges from graph", () => {
    const tables = [makeTable("cat.schema.raw_events"), makeTable("cat.schema.clean_events")];

    const lineageGraph: LineageGraph = {
      edges: [
        {
          sourceTableFqn: "cat.schema.raw_events",
          targetTableFqn: "cat.schema.clean_events",
          sourceType: "TABLE",
          targetType: "TABLE",
          lastEventTime: null,
          entityType: "PIPELINE",
          eventCount: 5,
        },
      ],
      seedTables: ["cat.schema.raw_events"],
      discoveredTables: ["cat.schema.clean_events"],
      upstreamDepth: 1,
      downstreamDepth: 1,
    };

    const ctx = buildSchemaContextFromIntelligence(tables, lineageGraph, [], []);

    expect(ctx.lineageEdges).toHaveLength(1);
    expect(ctx.lineageEdges[0].sourceTableFqn).toBe("cat.schema.raw_events");
    expect(ctx.lineageEdges[0].targetTableFqn).toBe("cat.schema.clean_events");
  });

  it("builds schema summary text", () => {
    const tables = [makeTable("cat.schema.customers"), makeTable("cat.schema.orders")];

    const domains: DataDomain[] = [
      {
        domain: "Sales",
        subdomain: "Core",
        tables: ["cat.schema.customers", "cat.schema.orders"],
        description: "",
      },
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), domains, []);

    expect(ctx.schemaSummary).toContain("SCHEMA OVERVIEW");
    expect(ctx.schemaSummary).toContain("2 tables");
    expect(ctx.schemaSummary).toContain("Sales");
    expect(ctx.schemaSummary).toContain("cat.schema.customers");
  });

  it("enriches columns with deterministic roles", () => {
    const tables = [
      makeTable("cat.schema.orders", {
        columns: [
          { name: "order_id", type: "BIGINT", comment: null },
          { name: "customer_id", type: "BIGINT", comment: null },
          { name: "is_active", type: "BOOLEAN", comment: null },
          { name: "total_amount", type: "DECIMAL", comment: null },
          { name: "created_at", type: "TIMESTAMP", comment: null },
        ],
      }),
      makeTable("cat.schema.customers"),
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), [], []);

    const orders = ctx.tables.find((t) => t.fqn === "cat.schema.orders")!;
    const orderId = orders.columns.find((c) => c.name === "order_id");
    expect(orderId!.inferredRole).toBe("fk");

    const customerIdCol = orders.columns.find((c) => c.name === "customer_id");
    expect(customerIdCol!.inferredRole).toBe("fk");

    const isActive = orders.columns.find((c) => c.name === "is_active");
    expect(isActive!.inferredRole).toBe("flag");

    const createdAt = orders.columns.find((c) => c.name === "created_at");
    expect(createdAt!.inferredRole).toBe("timestamp");
  });

  it("uses detail and history data when available", () => {
    const tables = [
      makeTable("cat.schema.events", {
        detail: {
          catalog: "cat",
          schema: "schema",
          tableName: "events",
          fqn: "cat.schema.events",
          tableType: "STREAMING_TABLE",
          comment: null,
          sizeInBytes: 1024000,
          numFiles: 10,
          numRows: 50000,
          format: "delta",
          partitionColumns: [],
          clusteringColumns: [],
          location: "s3://bucket/events",
          owner: "data_team@corp.com",
          provider: "delta",
          isManaged: true,
          deltaMinReaderVersion: 1,
          deltaMinWriterVersion: 2,
          createdAt: "2024-01-01T00:00:00Z",
          lastModified: "2024-06-01T00:00:00Z",
          tableProperties: {},
          createdBy: null,
          lastAccess: null,
          isManagedLocation: null,
          discoveredVia: "selected" as const,
          dataDomain: null,
          dataSubdomain: null,
          dataTier: null,
          sensitivityLevel: null,
          generatedDescription: null,
          governancePriority: null,
        },
        history: {
          tableFqn: "cat.schema.events",
          lastWriteTimestamp: new Date(Date.now() - 3_600_000).toISOString(),
          lastWriteOperation: "STREAMING UPDATE",
          lastWriteRows: 100,
          lastWriteBytes: 5000,
          totalWriteOps: 500,
          totalStreamingOps: 400,
          totalOptimizeOps: 10,
          totalVacuumOps: 5,
          totalMergeOps: 0,
          lastOptimizeTimestamp: null,
          lastVacuumTimestamp: null,
          hasStreamingWrites: true,
          historyDays: 90,
          topOperations: { "STREAMING UPDATE": 400, WRITE: 100 },
        },
      }),
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), [], []);

    const events = ctx.tables.find((t) => t.fqn === "cat.schema.events")!;
    expect(events.tableType).toBe("STREAMING_TABLE");
    expect(events.format).toBe("delta");
    expect(events.owner).toBe("data_team@corp.com");
    expect(events.sizeInBytes).toBe(1024000);
    expect(events.writeFrequency).toBe("hourly");
  });

  it("builds naming conventions profile", () => {
    const tables = [
      makeTable("cat.schema.dim_customers"),
      makeTable("cat.schema.dim_products"),
      makeTable("cat.schema.fact_orders"),
    ];

    const ctx = buildSchemaContextFromIntelligence(tables, emptyLineageGraph(), [], []);

    expect(ctx.namingConventions).toBeDefined();
    expect(ctx.namingConventions.dominantConvention).toBe("snake_case");
  });
});
