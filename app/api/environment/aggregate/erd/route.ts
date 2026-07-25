/**
 * API: /api/environment/aggregate/erd
 *
 * GET -- returns an ERDGraph built from the aggregate estate view
 *        (merged latest-per-table data across all scans).
 *
 * Query params:
 *   includeImplicit - "false" to exclude (default: included)
 *   includeLineage  - "false" to exclude (default: included)
 *   domain          - filter to a specific domain
 */

import { NextRequest, NextResponse } from "next/server";
import { getAggregateEstateView } from "@/lib/lakebase/environment-scans";
import {
  buildERDGraph,
  generateMermaidERD,
  generateMermaidLineageFlow,
} from "@/lib/export/erd-generator";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format") ?? "json";
    const includeImplicit = request.nextUrl.searchParams.get("includeImplicit") !== "false";
    const includeLineage = request.nextUrl.searchParams.get("includeLineage") !== "false";
    const domain = request.nextUrl.searchParams.get("domain") ?? undefined;

    const estate = await getAggregateEstateView();

    // Map aggregate data to the ScanData shape that buildERDGraph expects
    const scanData = {
      details: estate.details.map((d) => ({
        tableFqn: d.tableFqn as string,
        catalog: d.catalog as string,
        schema: d.schema as string,
        tableName: d.tableName as string,
        dataDomain: (d.dataDomain as string) ?? null,
        dataTier: (d.dataTier as string) ?? null,
        sensitivityLevel: (d.sensitivityLevel as string) ?? null,
        sizeInBytes: d.sizeInBytes ? BigInt(d.sizeInBytes as string) : null,
        numRows: d.numRows ? BigInt(d.numRows as string) : null,
        partitionColumns: (d.partitionColumns as string) ?? null,
        clusteringColumns: (d.clusteringColumns as string) ?? null,
        columnsJson: (d.columnsJson as string) ?? null,
        comment: (d.comment as string) ?? null,
        generatedDescription: (d.generatedDescription as string) ?? null,
      })),
      lineage: estate.lineage.map((l) => ({
        sourceTableFqn: l.sourceTableFqn as string,
        targetTableFqn: l.targetTableFqn as string,
        sourceType: (l.sourceType as string) ?? null,
        targetType: (l.targetType as string) ?? null,
        entityType: (l.entityType as string) ?? null,
        lastEventTime: (l.lastEventTime as string) ?? null,
        eventCount: (l.eventCount as number) ?? 1,
      })),
      insights: estate.insights.map((i) => ({
        insightType: i.insightType as string,
        tableFqn: (i.tableFqn as string) ?? null,
        payloadJson: i.payloadJson as string,
      })),
    };

    const graph = buildERDGraph(scanData, {
      includeImplicit,
      includeLineage,
      domain,
    });

    if (format === "mermaid") {
      return NextResponse.json({
        erd: generateMermaidERD(graph),
        lineage: generateMermaidLineageFlow(graph),
      });
    }

    return NextResponse.json(graph, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    logger.error("[api/environment/aggregate/erd] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to generate aggregate ERD" }, { status: 500 });
  }
}
