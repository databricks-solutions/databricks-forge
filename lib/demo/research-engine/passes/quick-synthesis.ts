/**
 * Pass 4Q: Quick Synthesis (Quick preset only)
 *
 * A single generation-tier LLM call that produces the minimum context
 * the Data Engine needs: matched assets, nomenclature, and basic narratives.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { DemoScope, DataNarrative } from "../../types";
import type { ResearchEngineResult, CompanyStrategicProfile } from "../types";
import { QUICK_SYNTHESIS_PROMPT } from "../prompts";

interface QuickSynthesisOutput {
  matchedDataAssetIds: string[];
  nomenclature: Record<string, string>;
  dataNarratives: DataNarrative[];
  companyProfile: {
    statedPriorities: Array<{ priority: string; source: string }>;
    products: string[];
    markets: string[];
  };
}

export async function runQuickSynthesis(
  customerName: string,
  industryId: string,
  industryName: string,
  outcomeMapContext: string,
  websiteText: string,
  scope: DemoScope | undefined,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    modelTier?: TaskTier;
  },
): Promise<Partial<ResearchEngineResult>> {
  const { llm, logger: log, signal, modelTier } = opts;

  const scopeContext = scope
    ? `Division: ${scope.division ?? "Full Enterprise"}\nFunctional Focus: ${scope.functionalFocus?.join(", ") ?? "All"}\nDepartments: ${scope.departments?.join(", ") ?? "All"}\nObjective: ${scope.demoObjective ?? "General demo"}`
    : "Full Enterprise -- no scope restrictions.";

  const prompt = QUICK_SYNTHESIS_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{industry_name}", industryName)
    .replace("{outcome_map_context}", outcomeMapContext.slice(0, 8_000))
    .replace("{website_text}", websiteText.slice(0, 6_000))
    .replace("{scope_context}", scopeContext);

  const endpoint = resolveResearchEndpoint(modelTier);

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens: 8_192,
    responseFormat: "json_object",
    signal,
  });

  const output = parseLLMJson(response.content, "quick-synthesis") as QuickSynthesisOutput;

  log.info("Quick synthesis complete", {
    assets: output.matchedDataAssetIds.length,
    narratives: output.dataNarratives.length,
  });

  const companyProfile: CompanyStrategicProfile = {
    statedPriorities: output.companyProfile.statedPriorities,
    inferredPriorities: [],
    strategicGaps: [],
    urgencySignals: [],
    executiveLanguage: output.nomenclature,
    swotSummary: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    divisionContext: {
      products: output.companyProfile.products,
      markets: output.companyProfile.markets,
      challenges: [],
    },
  };

  return {
    matchedDataAssetIds: output.matchedDataAssetIds,
    nomenclature: output.nomenclature,
    dataNarratives: output.dataNarratives,
    companyProfile,
    industryLandscape: null,
    dataStrategy: null,
    demoNarrative: null,
  };
}
