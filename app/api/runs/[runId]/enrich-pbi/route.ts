/**
 * API: /api/runs/[runId]/enrich-pbi
 *
 * POST -- Enrich a completed run with Power BI / Fabric scan data.
 *
 * Computes per-use-case overlap with PBI assets (tables, measures, reports)
 * and updates enrichment tags + context manifest.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRunOrRespond } from "@/lib/auth/route-guards";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import { getFabricScanDetail } from "@/lib/lakebase/fabric-scans";
import { persistManifest } from "@/lib/pipeline/context-manifest";
import { withPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const body = await request.json();
    const fabricScanId = body.fabricScanId;
    if (!fabricScanId || !isValidUUID(fabricScanId)) {
      return NextResponse.json(
        { error: "fabricScanId is required and must be a valid UUID" },
        { status: 400 },
      );
    }

    const guard = await loadRunOrRespond(request, runId, "edit");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;
    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Run must be completed before enrichment" },
        { status: 400 },
      );
    }

    const scanDetail = await getFabricScanDetail(fabricScanId);
    if (!scanDetail) {
      return NextResponse.json({ error: "Fabric scan not found" }, { status: 404 });
    }

    const useCases = await getUseCasesByRunId(runId);
    if (useCases.length === 0) {
      return NextResponse.json({ error: "No use cases found for this run" }, { status: 400 });
    }

    // Build PBI name index for overlap matching
    const pbiTableNames = new Set<string>();
    const pbiMeasureNames = new Set<string>();
    const pbiReportNames = new Map<string, string[]>(); // datasetName -> reportNames

    for (const ds of scanDetail.datasets) {
      for (const table of ds.tables) {
        pbiTableNames.add(normalize(table.name));
        for (const measure of table.measures ?? []) {
          pbiMeasureNames.add(normalize(measure.name));
        }
      }
      for (const measure of ds.measures) {
        pbiMeasureNames.add(normalize(measure.name));
      }
    }

    for (const report of scanDetail.reports) {
      const dsName =
        scanDetail.datasets.find((ds) => ds.datasetId === report.datasetId)?.name ?? "unknown";
      if (!pbiReportNames.has(dsName)) pbiReportNames.set(dsName, []);
      pbiReportNames.get(dsName)!.push(report.name);
    }

    // Compute overlap per use case
    let overlapCount = 0;
    const updates: Array<{ id: string; tags: string[]; overlap: Record<string, unknown> }> = [];

    for (const uc of useCases) {
      const matchedTables: string[] = [];
      for (const fqn of uc.tablesInvolved) {
        const parts = fqn.split(".");
        const tableName = normalize(parts[parts.length - 1]);
        if (pbiTableNames.has(tableName)) {
          matchedTables.push(fqn);
        }
      }

      const nameTokens = normalize(uc.name).split(/[\s_-]+/);
      const matchedMeasures = [...pbiMeasureNames].filter((m) =>
        nameTokens.some((token) => m.includes(token) && token.length > 3),
      );

      if (matchedTables.length > 0 || matchedMeasures.length > 0) {
        overlapCount++;
        const existingTags = uc.enrichmentTags ?? [];
        const newTags = existingTags.includes("fabric")
          ? existingTags
          : [...existingTags, "fabric"];

        const overlap = {
          matchedTables,
          matchedMeasures,
          pbiReports:
            matchedTables.length > 0 ? [...pbiReportNames.values()].flat().slice(0, 5) : [],
        };

        updates.push({ id: uc.id, tags: newTags, overlap });
      }
    }

    // Batch update use cases (transaction for atomicity)
    if (updates.length > 0) {
      await withPrisma(async (prisma) => {
        await prisma.$transaction(
          updates.map((upd) =>
            prisma.forgeUseCase.update({
              where: { id: upd.id },
              data: { enrichmentTags: JSON.stringify(upd.tags) },
            }),
          ),
        );
      });
    }

    // Update run's generationOptions to include fabricScanId
    await withPrisma(async (prisma) => {
      const row = await prisma.forgeRun.findUnique({
        where: { runId },
        select: { generationOptions: true },
      });

      let genOpts: Record<string, unknown> = {};
      try {
        genOpts = row?.generationOptions ? JSON.parse(row.generationOptions) : {};
        if (typeof genOpts !== "object" || genOpts === null) genOpts = {};
      } catch {
        genOpts = {};
      }

      genOpts.fabricScanId = fabricScanId;

      await prisma.forgeRun.update({
        where: { runId },
        data: { generationOptions: JSON.stringify(genOpts) },
      });
    });

    // Update context manifest with fabric provenance
    await persistManifest(runId, {
      fabric: {
        scanId: fabricScanId,
        datasetCount: scanDetail.datasetCount,
        measureCount: scanDetail.measureCount,
        reportCount: scanDetail.reportCount,
      },
      steps: ["enrich-pbi"],
    });

    logger.info("[api/enrich-pbi] Enrichment complete", {
      runId,
      fabricScanId,
      totalUseCases: useCases.length,
      overlapCount,
    });

    return NextResponse.json({
      success: true,
      runId,
      fabricScanId,
      totalUseCases: useCases.length,
      overlapCount,
      pbiReportsAvailable: scanDetail.reportCount,
      pbiDatasetsAvailable: scanDetail.datasetCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("[api/enrich-pbi] Enrichment failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
