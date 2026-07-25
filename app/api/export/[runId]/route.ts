/**
 * API: /api/export/[runId]
 *
 * GET -- export use cases in the specified format
 *
 * Query params:
 *   ?format=excel|pdf|pptx|notebooks
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { isValidUUID } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { getRunById } from "@/lib/lakebase/runs";
import { getUseCasesByRunId } from "@/lib/lakebase/usecases";
import { generateExcel, type BusinessValueExportData } from "@/lib/export/excel";
import { generatePptx } from "@/lib/export/pptx";
import { generatePdf } from "@/lib/export/pdf";
import { generateNotebooks } from "@/lib/export/notebooks";
import { generateCsv } from "@/lib/export/csv";
import { generateJson } from "@/lib/export/json";
import { generateExportSummaries } from "@/lib/export/summaries";
import { loadLineageFqnsForRun } from "@/lib/lakebase/metadata-cache";
import { ensureMigrated } from "@/lib/lakebase/schema";
import { getConfig } from "@/lib/dbx/client";
import { insertExportRecord } from "@/lib/lakebase/exports";
import { logActivity } from "@/lib/lakebase/activity-log";
import type { ExportFormat } from "@/lib/domain/types";
import { loadRunOrRespond } from "@/lib/auth/route-guards";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    await ensureMigrated();
    const { runId } = await params;
    if (!isValidUUID(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") as ExportFormat | null;

    if (!format || !["excel", "pdf", "pptx", "notebooks", "csv", "json"].includes(format)) {
      logger.warn("[api/export/runId] Invalid or missing format", {
        runId,
        format: format ?? "missing",
        reason: "format query param required: excel, pdf, pptx, notebooks, csv, or json",
      });
      return NextResponse.json(
        { error: "format query param required: excel, pdf, pptx, notebooks, csv, or json" },
        { status: 400 },
      );
    }

    const guard = await loadRunOrRespond(request, runId, "read");
    if (!guard.ok) return guard.response;
    const run = guard.value.run;

    if (run.status !== "completed") {
      logger.warn("[api/export/runId] Run not completed", {
        runId,
        format,
        status: run.status,
        reason: "Run has not completed yet",
      });
      return NextResponse.json({ error: "Run has not completed yet" }, { status: 400 });
    }

    const useCases = await getUseCasesByRunId(runId);

    let lineageDiscoveredFqns: string[] = [];
    try {
      lineageDiscoveredFqns = await loadLineageFqnsForRun(runId);
    } catch {
      // Non-critical
    }

    const userEmail = guard.user.email;

    // Generate LLM summaries for PDF/PPTX (non-blocking, with fallback)
    let summaries: Awaited<ReturnType<typeof generateExportSummaries>> = null;
    if (format === "pdf" || format === "pptx") {
      summaries = await generateExportSummaries(run, useCases);
    }

    switch (format) {
      case "excel": {
        let bvData: BusinessValueExportData | undefined;
        try {
          const [
            { getValueEstimatesForRun },
            { getRoadmapPhasesForRun },
            { getStakeholderProfilesForRun },
          ] = await Promise.all([
            import("@/lib/lakebase/value-estimates"),
            import("@/lib/lakebase/roadmap-phases"),
            import("@/lib/lakebase/stakeholder-profiles"),
          ]);
          const { withPrisma } = await import("@/lib/prisma");
          const [estimates, phases, stakeholders, synthRow] = await Promise.all([
            getValueEstimatesForRun(runId),
            getRoadmapPhasesForRun(runId),
            getStakeholderProfilesForRun(runId),
            withPrisma(async (prisma) => {
              const r = await prisma.forgeRun.findUnique({
                where: { runId },
                select: { synthesisJson: true },
              });
              return r?.synthesisJson ?? null;
            }),
          ]);
          let synthesis = null;
          if (synthRow) {
            try {
              synthesis = JSON.parse(synthRow);
            } catch {
              /* skip */
            }
          }
          if (estimates.length > 0) {
            bvData = { estimates, phases, synthesis, stakeholders };
          }
        } catch {
          /* business value data optional */
        }
        const buffer = await generateExcel(run, useCases, lineageDiscoveredFqns, bvData);
        insertExportRecord(runId, "excel");
        logActivity("exported", {
          userId: userEmail,
          resourceId: runId,
          metadata: { format: "excel", businessName: run.config.businessName },
        });
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="forge_${run.config.businessName.replace(/\s+/g, "_")}_${runId.substring(0, 8)}.xlsx"`,
          },
        });
      }
      case "pptx": {
        let pptxSynthesis = null;
        try {
          const { withPrisma } = await import("@/lib/prisma");
          const synthRow = await withPrisma(async (prisma) => {
            const r = await prisma.forgeRun.findUnique({
              where: { runId },
              select: { synthesisJson: true },
            });
            return r?.synthesisJson ?? null;
          });
          if (synthRow) {
            try {
              pptxSynthesis = JSON.parse(synthRow);
            } catch {
              /* skip */
            }
          }
        } catch {
          /* synthesis data optional */
        }
        const buffer = await generatePptx(
          run,
          useCases,
          lineageDiscoveredFqns,
          summaries,
          pptxSynthesis,
        );
        insertExportRecord(runId, "pptx");
        logActivity("exported", {
          userId: userEmail,
          resourceId: runId,
          metadata: { format: "pptx", businessName: run.config.businessName },
        });
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "Content-Disposition": `attachment; filename="forge_${run.config.businessName.replace(/\s+/g, "_")}_${runId.substring(0, 8)}.pptx"`,
          },
        });
      }
      case "pdf": {
        const pdfBuffer = await generatePdf(run, useCases, lineageDiscoveredFqns, summaries);
        insertExportRecord(runId, "pdf");
        logActivity("exported", {
          userId: userEmail,
          resourceId: runId,
          metadata: { format: "pdf", businessName: run.config.businessName },
        });
        return new NextResponse(new Uint8Array(pdfBuffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="forge_${run.config.businessName.replace(/\s+/g, "_")}_${runId.substring(0, 8)}.pdf"`,
          },
        });
      }
      case "csv": {
        const csvBuffer = generateCsv(run, useCases);
        insertExportRecord(runId, "csv");
        logActivity("exported", {
          userId: userEmail,
          resourceId: runId,
          metadata: { format: "csv", businessName: run.config.businessName },
        });
        return new NextResponse(new Uint8Array(csvBuffer), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="forge_${run.config.businessName.replace(/\s+/g, "_")}_${runId.substring(0, 8)}.csv"`,
          },
        });
      }
      case "json": {
        const jsonBuffer = generateJson(run, useCases);
        insertExportRecord(runId, "json");
        logActivity("exported", {
          userId: userEmail,
          resourceId: runId,
          metadata: { format: "json", businessName: run.config.businessName },
        });
        return new NextResponse(new Uint8Array(jsonBuffer), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="forge_${run.config.businessName.replace(/\s+/g, "_")}_${runId.substring(0, 8)}.json"`,
          },
        });
      }
      case "notebooks": {
        const result = await generateNotebooks(run, useCases, userEmail, lineageDiscoveredFqns);
        const { host } = getConfig();
        const workspaceUrl = `${host}/#workspace${result.path}`;
        insertExportRecord(runId, "notebooks", workspaceUrl);
        logActivity("exported", {
          userId: userEmail,
          resourceId: runId,
          metadata: {
            format: "notebooks",
            businessName: run.config.businessName,
            path: result.path,
          },
        });
        return NextResponse.json({ ...result, url: workspaceUrl });
      }
      default:
        logger.warn("[api/export/runId] Unsupported format", {
          runId,
          format,
          reason: `Unsupported format: ${format}`,
        });
        return NextResponse.json({ error: `Unsupported format: ${format}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[api/export/runId] GET failed", { error: msg });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
