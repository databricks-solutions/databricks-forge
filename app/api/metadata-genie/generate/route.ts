/**
 * API: POST /api/metadata-genie/generate
 *
 * Probes system.information_schema, detects industry via LLM, and saves
 * a draft space with preview data (questions, domains, detection).
 * The viewTarget and SerializedSpace are set later at deploy time.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { safeErrorMessage } from "@/lib/error-utils";
import { probeSystemInformationSchema } from "@/lib/metadata-genie/probe";
import { detectIndustry } from "@/lib/metadata-genie/industry-detect";
import { fetchUndocumentedTables, generateTableDescriptions } from "@/lib/metadata-genie/describe";
import { buildPreviewQuestions, buildMetadataGenieSpace } from "@/lib/metadata-genie/space-builder";
import { saveMetadataGenieSpace } from "@/lib/lakebase/metadata-genie";
import { logger } from "@/lib/logger";
import { GenerateBodySchema } from "@/lib/metadata-genie/schemas";

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const parsed = GenerateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        { status: 400 },
      );
    }
    const { title, catalogScope, questionComplexity } = parsed.data;

    const probe = await probeSystemInformationSchema();
    if (!probe.accessible) {
      return NextResponse.json(
        { error: probe.error ?? "Cannot access system.information_schema" },
        { status: 403 },
      );
    }

    const tableNames = probe.tableNames ?? [];
    const detection = await detectIndustry(tableNames);

    // Generate AI descriptions for tables without comments
    let aiDescriptions: Record<string, string> = {};
    try {
      const undocumented = await fetchUndocumentedTables(
        catalogScope ?? probe.catalogs ?? undefined,
      );
      if (undocumented.length > 0) {
        const descMap = await generateTableDescriptions(undocumented);
        aiDescriptions = Object.fromEntries(descMap);
      }
    } catch (err) {
      logger.warn("AI description generation failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const sampleQuestions = buildPreviewQuestions(
      detection.outcomeMap,
      detection.llmDetection,
      probe.lineageAccessible,
      questionComplexity,
    );

    const previewSpace = buildMetadataGenieSpace({
      viewTarget: { catalog: "{catalog}", schema: "{schema}" },
      outcomeMap: detection.outcomeMap,
      llmDetection: detection.llmDetection,
      catalogScope,
      lineageAccessible: probe.lineageAccessible,
      title: title ?? "Meta Data Genie",
      questionComplexity,
    });

    const id = randomUUID();
    const saved = await saveMetadataGenieSpace({
      id,
      title: title ?? "Meta Data Genie",
      catalogScope,
      industryId: detection.outcomeMapId,
      industryName: detection.outcomeMap?.name ?? null,
      domains: detection.llmDetection.domains,
      detection: detection.llmDetection,
      sampleQuestions,
      aiDescriptions: Object.keys(aiDescriptions).length > 0 ? aiDescriptions : undefined,
      lineageAccessible: probe.lineageAccessible,
      serializedSpace: JSON.stringify(previewSpace),
      tableCount: tableNames.length,
    });

    logger.info("Metadata Genie draft generated", {
      id,
      industryId: detection.outcomeMapId,
      tableCount: tableNames.length,
      questionCount: sampleQuestions.length,
      aiDescriptionCount: Object.keys(aiDescriptions).length,
      lineageAccessible: probe.lineageAccessible,
      catalogScope: catalogScope?.join(", ") ?? "all",
    });

    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Metadata Genie generation failed", { error: message });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
