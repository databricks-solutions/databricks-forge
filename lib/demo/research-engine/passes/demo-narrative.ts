/**
 * Pass 7: Demo Narrative Design (Full preset only)
 *
 * Engagement Partner persona. Turns analysis into compelling demo
 * moments with executive talking points and competitor angles.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { DemoScope } from "../../types";
import type {
  DemoNarrativeDesign,
  IndustryLandscapeAnalysis,
  CompanyStrategicProfile,
  DataStrategyMap,
  KeyQuote,
} from "../types";
import { DEMO_NARRATIVE_PROMPT } from "../prompts";

export async function runDemoNarrative(
  customerName: string,
  industryName: string,
  industryLandscape: IndustryLandscapeAnalysis,
  companyProfile: CompanyStrategicProfile,
  dataStrategy: DataStrategyMap,
  scope: DemoScope | undefined,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    maxTokens: number;
    modelTier?: TaskTier;
    keyQuotes?: KeyQuote[];
  },
): Promise<DemoNarrativeDesign> {
  const { llm, logger: log, signal, maxTokens, modelTier, keyQuotes } = opts;

  const division = scope?.division ?? "the company";
  const demoObjective = scope?.demoObjective ?? "Demonstrate the power of their data estate.";

  const keyQuotesJson = keyQuotes && keyQuotes.length > 0
    ? JSON.stringify(keyQuotes.slice(0, 15), null, 2).slice(0, 6_000)
    : "[]  // No pre-extracted quotes available.";

  const prompt = DEMO_NARRATIVE_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{industry_name}", industryName)
    .replace("{division}", division)
    .replace("{demo_objective}", demoObjective)
    .replace("{industry_landscape_json}", JSON.stringify(industryLandscape).slice(0, 4_000))
    .replace("{company_profile_json}", JSON.stringify(companyProfile).slice(0, 6_000))
    .replace("{data_strategy_json}", JSON.stringify(dataStrategy).slice(0, 6_000))
    .replace("{key_quotes_json}", keyQuotesJson);

  const endpoint = resolveResearchEndpoint(modelTier);

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  const result = parseLLMJson(response.content, "demo-narrative") as DemoNarrativeDesign;

  log.info("Demo narrative complete", {
    killerMoments: result.killerMoments?.length ?? 0,
    demoFlow: result.demoFlow?.length ?? 0,
    narratives: result.dataNarratives?.length ?? 0,
  });

  return result;
}
