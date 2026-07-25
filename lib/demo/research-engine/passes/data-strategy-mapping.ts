/**
 * Pass 6: Data Strategy Mapping (Full preset only)
 *
 * Chief Data Strategist persona. Maps business priorities to data
 * assets with surgical precision.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { DemoScope } from "../../types";
import type {
  DataStrategyMap,
  IndustryLandscapeAnalysis,
  CompanyStrategicProfile,
} from "../types";
import { DATA_STRATEGY_MAPPING_PROMPT } from "../prompts";

export async function runDataStrategyMapping(
  customerName: string,
  industryLandscape: IndustryLandscapeAnalysis,
  companyProfile: CompanyStrategicProfile,
  dataAssetsContext: string,
  scope: DemoScope | undefined,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    maxTokens: number;
    modelTier?: TaskTier;
  },
): Promise<DataStrategyMap> {
  const { llm, logger: log, signal, maxTokens, modelTier } = opts;

  const division = scope?.division ?? "the company";
  const scopeContext = scope
    ? `Division: ${scope.division ?? "Full Enterprise"}\nFunctional Focus: ${scope.functionalFocus?.join(", ") ?? "All"}\nAsset Families: ${scope.functionalFocus?.join(", ") ?? "All"}`
    : "Full Enterprise scope -- all asset families.";

  const prompt = DATA_STRATEGY_MAPPING_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{division}", division)
    .replace("{scope_context}", scopeContext)
    .replace("{industry_landscape_json}", JSON.stringify(industryLandscape).slice(0, 6_000))
    .replace("{company_profile_json}", JSON.stringify(companyProfile).slice(0, 8_000))
    .replace("{data_assets_context}", dataAssetsContext.slice(0, 8_000));

  const endpoint = resolveResearchEndpoint(modelTier);

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  const result = parseLLMJson(response.content, "data-strategy-mapping") as DataStrategyMap;

  log.info("Data strategy mapping complete", {
    assets: result.matchedDataAssetIds?.length ?? 0,
    useCases: result.prioritisedUseCases?.length ?? 0,
    maturity: result.dataMaturityAssessment,
  });

  return result;
}
