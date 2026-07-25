import { describe, it, expect, vi } from "vitest";
import { resolveSourceScanMetadata } from "@/lib/pipeline/source-run-metadata";
import type { MetadataSnapshot, LineageGraph } from "@/lib/domain/types";
import type { SchemaSnapshot } from "@/lib/lakebase/runs";

function fakeReconstituted(): { snapshot: MetadataSnapshot; lineageGraph: LineageGraph } {
  const snapshot: MetadataSnapshot = {
    cacheKey: "scan:s1",
    ucPath: "cat.schema",
    tables: [
      {
        catalog: "cat",
        schema: "schema",
        tableName: "orders",
        fqn: "cat.schema.orders",
        tableType: "MANAGED",
        dataSourceFormat: "DELTA",
        comment: "Orders fact",
        discoveredVia: "selected",
      },
    ],
    columns: [
      {
        tableFqn: "cat.schema.orders",
        columnName: "order_id",
        dataType: "bigint",
        ordinalPosition: 1,
        isNullable: false,
        comment: null,
      },
    ],
    foreignKeys: [],
    metricViews: [],
    tableCount: 1,
    columnCount: 1,
    cachedAt: new Date().toISOString(),
    lineageDiscoveredFqns: ["cat.schema.upstream"],
  };
  const lineageGraph: LineageGraph = {
    edges: [
      {
        sourceTableFqn: "cat.schema.upstream",
        targetTableFqn: "cat.schema.orders",
        sourceType: "TABLE",
        targetType: "TABLE",
        lastEventTime: null,
        entityType: null,
        eventCount: 1,
      },
    ],
    seedTables: ["cat.schema.orders"],
    discoveredTables: ["cat.schema.upstream"],
    upstreamDepth: 1,
    downstreamDepth: 0,
  };
  return { snapshot, lineageGraph };
}

describe("resolveSourceScanMetadata", () => {
  it("reconstitutes snapshot + lineage AND persists a schema snapshot with columns", async () => {
    const reconstitute = vi.fn(async () => fakeReconstituted());
    const updateSchemaSnapshot = vi.fn(async (_runId: string, _snap: SchemaSnapshot) => {});

    const result = await resolveSourceScanMetadata("s1", "cat.schema", "run-1", {
      reconstitute,
      updateSchemaSnapshot,
    });

    expect(result).not.toBeNull();
    // Lineage identity preserved (edges + discovered tables).
    expect(result!.lineageGraph.edges).toHaveLength(1);
    expect(result!.lineageGraph.discoveredTables).toContain("cat.schema.upstream");

    // Ask Forge grounding: schema snapshot persisted for the run with columns.
    expect(updateSchemaSnapshot).toHaveBeenCalledTimes(1);
    const [runId, snap] = updateSchemaSnapshot.mock.calls[0];
    expect(runId).toBe("run-1");
    expect(snap["cat.schema.orders"]).toBeDefined();
    expect(snap["cat.schema.orders"].columns).toEqual([{ name: "order_id", type: "bigint" }]);
  });

  it("returns null and does not persist a schema snapshot when reconstitution fails", async () => {
    const reconstitute = vi.fn(async () => null);
    const updateSchemaSnapshot = vi.fn(async () => {});

    const result = await resolveSourceScanMetadata("missing", "cat.schema", "run-1", {
      reconstitute,
      updateSchemaSnapshot,
    });

    expect(result).toBeNull();
    expect(updateSchemaSnapshot).not.toHaveBeenCalled();
  });

  it("still returns the metadata when schema-snapshot persistence throws (non-fatal)", async () => {
    const reconstitute = vi.fn(async () => fakeReconstituted());
    const updateSchemaSnapshot = vi.fn(async () => {
      throw new Error("db down");
    });

    const result = await resolveSourceScanMetadata("s1", "cat.schema", "run-1", {
      reconstitute,
      updateSchemaSnapshot,
    });

    expect(result).not.toBeNull();
    expect(result!.snapshot.tableCount).toBe(1);
  });

  it("restores in-memory metadata on resume without overwriting persisted business-table flags", async () => {
    const persisted: SchemaSnapshot = {
      "cat.schema.orders": {
        columns: [{ name: "order_id", type: "bigint" }],
        tableType: "MANAGED",
        comment: "Orders fact",
        isBusinessTable: true,
      },
    };
    const before = structuredClone(persisted);
    const reconstitute = vi.fn(async () => fakeReconstituted());
    const updateSchemaSnapshot = vi.fn(async (_runId: string, replacement: SchemaSnapshot) => {
      Object.assign(persisted, replacement);
    });

    const result = await resolveSourceScanMetadata("s1", "cat.schema", "run-1", {
      persistSchemaSnapshot: false,
      reconstitute,
      updateSchemaSnapshot,
    });

    expect(result?.lineageGraph.edges).toHaveLength(1);
    expect(updateSchemaSnapshot).not.toHaveBeenCalled();
    expect(persisted).toEqual(before);
    expect(persisted["cat.schema.orders"].isBusinessTable).toBe(true);
  });
});
