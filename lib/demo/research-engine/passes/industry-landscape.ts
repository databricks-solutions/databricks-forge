/**
 * Pass 4: Industry Landscape Analysis (Balanced + Full)
 *
 * Senior Industry Analyst persona. Synthesises market forces with
 * benchmark data from the Master Repository.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { IndustryLandscapeAnalysis } from "../types";
import { INDUSTRY_LANDSCAPE_PROMPT } from "../prompts";

export async function runIndustryLandscape(
  industryName: string,
  outcomeMapContext: string,
  benchmarkContext: string,
  sourceText: string,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    maxTokens: number;
    modelTier?: TaskTier;
  },
): Promise<IndustryLandscapeAnalysis> {
  const { llm, logger: log, signal, maxTokens, modelTier } = opts;

  const prompt = INDUSTRY_LANDSCAPE_PROMPT
    .replace("{industry_name}", industryName)
    .replace("{outcome_map_context}", outcomeMapContext.slice(0, 8_000))
    .replace("{benchmark_context}", benchmarkContext.slice(0, 4_000))
    .replace("{source_text}", sourceText.slice(0, 12_000));

  const endpoint = resolveResearchEndpoint(modelTier);

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  const result = parseLLMJson(response.content, "industry-landscape") as IndustryLandscapeAnalysis;

  log.info("Industry landscape complete", {
    forces: result.marketForces?.length ?? 0,
    benchmarks: result.keyBenchmarks?.length ?? 0,
  });

  return result;
}
