/**
 * API: /api/environment-scan/[scanId]/erd
 *
 * GET ?format=mermaid -- returns Mermaid markdown text
 * GET ?format=json    -- returns ERDGraph JSON
 */

import { NextRequest, NextResponse } from "next/server";
import { getEnvironmentScan } from "@/lib/lakebase/environment-scans";
import {
  buildERDGraph,
  generateMermaidERD,
  generateMermaidLineageFlow,
} from "@/lib/export/erd-generator";
import { isValidUUID } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const { scanId } = await params;
    const format = request.nextUrl.searchParams.get("format") ?? "json";
    const includeFKs = request.nextUrl.searchParams.get("includeFKs") !== "false";
    const includeImplicit = request.nextUrl.searchParams.get("includeImplicit") !== "false";
    const includeLineage = request.nextUrl.searchParams.get("includeLineage") !== "false";
    const domain = request.nextUrl.searchParams.get("domain") ?? undefined;

    if (!isValidUUID(scanId)) {
      logger.warn("[api/environment-scan/erd] Invalid scan ID", { scanId });
      return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
    }

    const scan = await getEnvironmentScan(scanId);
    if (!scan) {
      logger.warn("[api/environment-scan/erd] Scan not found", { scanId });
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    const graph = buildERDGraph(scan, { includeFKs, includeImplicit, includeLineage, domain });

    if (format === "mermaid") {
      const erdMermaid = generateMermaidERD(graph);
      const lineageMermaid = generateMermaidLineageFlow(graph);
      return NextResponse.json({
        erd: erdMermaid,
        lineage: lineageMermaid,
      });
    }

    return NextResponse.json(graph);
  } catch (error) {
    logger.error("[api/environment-scan/erd] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to generate ERD" }, { status: 500 });
  }
}
