/**
 * LLM-generated executive and domain summaries for PDF/PPTX exports.
 *
 * Uses the fast model endpoint for cost efficiency, with graceful fallback
 * to static summaries if the LLM call fails.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { logger } from "@/lib/logger";
import type { PipelineRun, UseCase } from "@/lib/domain/types";

export interface ExportSummaries {
  executiveSummary: string;
  domainSummaries: Record<string, string>;
}

/**
 * Generate export summaries via LLM. Returns null on failure
 * so callers can fall back to static summaries.
 */
export async function generateExportSummaries(
  run: PipelineRun,
  useCases: UseCase[],
): Promise<ExportSummaries | null> {
  if (useCases.length === 0) return null;

  const domains = [...new Set(useCases.map((uc) => uc.domain))].sort();
  const domainList = domains
    .map((d) => {
      const count = useCases.filter((uc) => uc.domain === d).length;
      return `- **${d}** (${count} use cases)`;
    })
    .join("\n");

  const outputLanguage = run.config.languages?.[0] ?? "English";

  try {
    const result = await executeAIQuery({
      promptKey: "SUMMARY_GEN_PROMPT",
      variables: {
        business_name: run.config.businessName,
        total_cases: String(useCases.length),
        domain_list: domainList,
        output_language: outputLanguage,
      },
      modelEndpoint: resolveEndpoint("lightweight"),
      temperature: 0.4,
      maxTokens: 8192,
    });

    const parsed = parseLLMJson(result.rawResponse, "export:summaries") as {
      executiveSummary?: string;
      domainSummaries?: Record<string, string>;
    };

    if (!parsed?.executiveSummary) {
      logger.warn("LLM summary missing executiveSummary", { runId: run.runId });
      return null;
    }

    return {
      executiveSummary: parsed.executiveSummary,
      domainSummaries: parsed.domainSummaries ?? {},
    };
  } catch (err) {
    logger.warn("Failed to generate LLM export summaries -- using static fallback", {
      runId: run.runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
