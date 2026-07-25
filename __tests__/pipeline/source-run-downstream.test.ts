import { describe, it, expect } from "vitest";
import { runSourceSystemAttribution } from "@/lib/pipeline/steps/source-system-attribution";
import { resolveSourceScanMetadata } from "@/lib/pipeline/source-run-metadata";
import type { PipelineContext, MetadataSnapshot, LineageGraph } from "@/lib/domain/types";

/**
 * End-to-end (pure) check that a source-scan run's reconstituted lineage +
 * metadata flows into a downstream metadata consumer (source-system
 * attribution) and yields lineage-origin attribution — the same signal a live
 * extraction would produce. Exercises the resume path shape: metadata resolved
 * via resolveSourceScanMetadata, then consumed by runSourceSystemAttribution.
 */
describe("downstream consumers receive reconstituted lineage + source attribution", () => {
  it("attributes a source system via the restored lineage graph", async () => {
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
          comment: null,
          discoveredVia: "selected",
        },
      ],
      columns: [],
      foreignKeys: [],
      metricViews: [],
      tableCount: 1,
      columnCount: 0,
      cachedAt: new Date().toISOString(),
      lineageDiscoveredFqns: [],
    };
    const lineageGraph: LineageGraph = {
      edges: [
        {
          sourceTableFqn: "salesforce_conn.raw.accounts",
          targetTableFqn: "cat.schema.orders",
          sourceType: "CONNECTION",
          targetType: "TABLE",
          lastEventTime: null,
          entityType: null,
          eventCount: 1,
        },
      ],
      seedTables: ["cat.schema.orders"],
      discoveredTables: [],
      upstreamDepth: 1,
      downstreamDepth: 0,
    };

    // Resume-shaped resolution: reconstitute injected, schema-snapshot no-op.
    const resolved = await resolveSourceScanMetadata("s1", "cat.schema", "run-1", {
      reconstitute: async () => ({ snapshot, lineageGraph }),
      updateSchemaSnapshot: async () => {},
    });
    expect(resolved).not.toBeNull();

    const ctx = {
      metadata: resolved!.snapshot,
      lineageGraph: resolved!.lineageGraph,
      useCases: [
        {
          id: "uc-1",
          tablesInvolved: ["cat.schema.orders"],
          sourceSystems: null,
          sourceSystemsOrigin: null,
        },
      ],
    } as unknown as PipelineContext;

    const summary = runSourceSystemAttribution(ctx);

    expect(summary.attributedCount).toBe(1);
    expect(summary.systemsSeen).toContain("Salesforce");
    expect(ctx.useCases[0].sourceSystems).toContain("Salesforce");
    expect(ctx.useCases[0].sourceSystemsOrigin).toBe("lineage");
  });
});
