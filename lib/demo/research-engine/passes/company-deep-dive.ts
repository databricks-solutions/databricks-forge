/**
 * Pass 5: Company Strategic Deep-Dive (Full preset only)
 *
 * McKinsey/BCG Partner persona. Goes deep on the specific company using
 * the industry landscape + pre-extracted verbatim source quotes as context.
 * In addition to the strategic profile, this pass now emits a fully formed
 * Executive Brief (5 paragraphs + Situation/Complication/Resolution +
 * tiered evidence) that the UI renders directly without client-side
 * stitching.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { DemoScope } from "../../types";
import type {
  CompanyStrategicProfile,
  ExecutiveBrief,
  IndustryLandscapeAnalysis,
  KeyQuote,
} from "../types";
import { COMPANY_DEEP_DIVE_PROMPT } from "../prompts";

interface CompanyDeepDiveOutput extends CompanyStrategicProfile {
  executiveBrief?: ExecutiveBrief | null;
}

export interface CompanyDeepDiveResult {
  profile: CompanyStrategicProfile;
  executiveBrief: ExecutiveBrief | null;
}

export async function runCompanyDeepDive(
  customerName: string,
  industryName: string,
  industryLandscape: IndustryLandscapeAnalysis,
  sourceText: string,
  scope: DemoScope | undefined,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    maxTokens: number;
    modelTier?: TaskTier;
    keyQuotes?: KeyQuote[];
  },
): Promise<CompanyDeepDiveResult> {
  const { llm, logger: log, signal, maxTokens, modelTier, keyQuotes } = opts;

  const division = scope?.division ?? "the company";
  const scopeContext = scope
    ? `Division: ${scope.division ?? "Full Enterprise"}\nFunctional Focus: ${scope.functionalFocus?.join(", ") ?? "All"}\nObjective: ${scope.demoObjective ?? "General demo"}`
    : "Full Enterprise scope.";

  const keyQuotesJson = keyQuotes && keyQuotes.length > 0
    ? JSON.stringify(keyQuotes.slice(0, 25), null, 2).slice(0, 10_000)
    : "[]  // No pre-extracted quotes available.";

  const prompt = COMPANY_DEEP_DIVE_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{industry_name}", industryName)
    .replace("{division}", division)
    .replace("{scope_context}", scopeContext)
    .replace("{industry_landscape_json}", JSON.stringify(industryLandscape).slice(0, 8_000))
    .replace("{key_quotes_json}", keyQuotesJson)
    .replace("{source_text}", sourceText.slice(0, 14_000));

  const endpoint = resolveResearchEndpoint(modelTier);

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens,
    responseFormat: "json_object",
    signal,
  });

  const result = parseLLMJson(response.content, "company-deep-dive") as CompanyDeepDiveOutput;

  log.info("Company deep-dive complete", {
    statedPriorities: result.statedPriorities?.length ?? 0,
    strategicGaps: result.strategicGaps?.length ?? 0,
    suggestedDivisions: result.suggestedDivisions?.length ?? 0,
    hasExecutiveBrief: !!result.executiveBrief,
  });

  const { executiveBrief, ...profileFields } = result;
  return {
    profile: profileFields as CompanyStrategicProfile,
    executiveBrief: executiveBrief ?? null,
  };
}
