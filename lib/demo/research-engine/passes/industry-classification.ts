/**
 * Pass 3.25: Industry Classification
 *
 * Conditional pass -- only runs when industryId was not pre-selected.
 * Matches the company against the closed list of registered outcome map
 * industries. The classifier MUST return one of the registered ids; the
 * caller still runs the result through `normalizeIndustryId` with a
 * closest-match fallback so a degenerate LLM response cannot bypass the
 * registry. The wizard never invents new industries.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { IndustryClassification } from "../types";
import { INDUSTRY_CLASSIFICATION_PROMPT } from "../prompts";

export async function runIndustryClassification(
  sourceText: string,
  existingIndustries: Array<{ id: string; name: string }>,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    modelTier?: TaskTier;
  },
): Promise<IndustryClassification> {
  const { llm, logger: log, signal, modelTier } = opts;

  const industriesList = existingIndustries
    .map((i) => `- ${i.id}: ${i.name}`)
    .join("\n");

  const prompt = INDUSTRY_CLASSIFICATION_PROMPT
    .replace("{existing_industries}", industriesList)
    .replace("{source_text}", sourceText.slice(0, 10_000));

  // Classification is a lightweight task; always prefer classification tier.
  const endpoint = resolveResearchEndpoint(modelTier === "reasoning" ? "classification" : (modelTier ?? "classification"));

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 512,
    responseFormat: "json_object",
    signal,
  });

  const parsed = parseLLMJson(response.content, "industry-classification") as IndustryClassification & { reasoning?: string };

  log.info("Industry classified", {
    industryId: parsed.industryId,
    industryName: parsed.industryName,
    confidence: parsed.confidence,
  });

  return {
    industryId: parsed.industryId,
    industryName: parsed.industryName,
    confidence: parsed.confidence ?? 0.8,
  };
}
