/**
 * Outcome Map Parser
 *
 * Uses Model Serving to extract structured IndustryOutcome data from raw
 * markdown outcome map documents. The LLM handles the varied formatting
 * across different industry documents.
 */

import { executeAIQuery } from "@/lib/ai/agent";
import { resolveEndpoint } from "@/lib/dbx/client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { logger } from "@/lib/logger";
import type { IndustryOutcome } from "./industry-outcomes";

// The parsing prompt is registered in lib/ai/templates.ts as PARSE_OUTCOME_MAP

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseResult {
  success: boolean;
  outcome: IndustryOutcome | null;
  error?: string;
}

/**
 * Parse a raw markdown outcome map document into a structured IndustryOutcome
 * using AI (Model Serving chat completions API).
 *
 * @param markdown - Raw markdown content of the outcome map
 * @param aiModel  - AI model endpoint to use for parsing
 */
export async function parseOutcomeMapWithAI(
  markdown: string,
  aiModel?: string,
): Promise<ParseResult> {
  const endpoint = aiModel || resolveEndpoint("classification");
  // Truncate very large documents to avoid exceeding context windows
  const MAX_CHARS = 80_000;
  const truncated =
    markdown.length > MAX_CHARS
      ? markdown.slice(0, MAX_CHARS) + "\n\n[... document truncated for processing ...]"
      : markdown;

  try {
    const result = await executeAIQuery({
      promptKey: "PARSE_OUTCOME_MAP",
      variables: {
        markdown_content: truncated,
      },
      modelEndpoint: endpoint,
      temperature: 0.2,
      retries: 1,
      responseFormat: "json_object",
      step: "outcome-map-parse",
    });

    const parsed = parseLLMJson(result.rawResponse, "outcome-map-parser") as Record<
      string,
      unknown
    >;

    // Validate required fields
    if (!parsed.id || !parsed.name || !Array.isArray(parsed.objectives)) {
      return {
        success: false,
        outcome: null,
        error:
          "AI response missing required fields (id, name, objectives). Try again or edit manually.",
      };
    }

    // Normalize the parsed data into a proper IndustryOutcome
    const outcome = normalizeOutcome(parsed);

    return { success: true, outcome };
  } catch (err) {
    logger.error("Failed to parse outcome map with AI", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      outcome: null,
      error: err instanceof Error ? err.message : "AI parsing failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeOutcome(raw: Record<string, unknown>): IndustryOutcome {
  const objectives = Array.isArray(raw.objectives) ? raw.objectives.map(normalizeObjective) : [];

  return {
    id: String(raw.id ?? "custom"),
    name: String(raw.name ?? "Custom Industry"),
    subVerticals: normalizeStringArray(raw.subVerticals),
    suggestedDomains: normalizeStringArray(raw.suggestedDomains),
    suggestedPriorities: normalizeStringArray(raw.suggestedPriorities),
    objectives,
  };
}

function normalizeObjective(raw: unknown): IndustryOutcome["objectives"][0] {
  if (typeof raw !== "object" || raw === null) {
    return { name: "Unknown", whyChange: "", priorities: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    name: String(obj.name ?? "Unknown"),
    whyChange: String(obj.whyChange ?? ""),
    priorities: Array.isArray(obj.priorities) ? obj.priorities.map(normalizePriority) : [],
  };
}

function normalizePriority(raw: unknown): IndustryOutcome["objectives"][0]["priorities"][0] {
  if (typeof raw !== "object" || raw === null) {
    return { name: "Unknown", useCases: [], kpis: [], personas: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    name: String(obj.name ?? "Unknown"),
    useCases: Array.isArray(obj.useCases) ? obj.useCases.map(normalizeUseCase) : [],
    kpis: normalizeStringArray(obj.kpis),
    personas: normalizeStringArray(obj.personas),
  };
}

function normalizeUseCase(raw: unknown): {
  name: string;
  description: string;
  businessValue?: string;
  typicalDataEntities?: string[];
  typicalSourceSystems?: string[];
} {
  if (typeof raw !== "object" || raw === null) {
    return { name: "Unknown", description: "" };
  }
  const obj = raw as Record<string, unknown>;
  const result: {
    name: string;
    description: string;
    businessValue?: string;
    typicalDataEntities?: string[];
    typicalSourceSystems?: string[];
  } = {
    name: String(obj.name ?? "Unknown"),
    description: String(obj.description ?? ""),
  };
  if (obj.businessValue && String(obj.businessValue).trim()) {
    result.businessValue = String(obj.businessValue);
  }
  const entities = normalizeStringArray(obj.typicalDataEntities);
  if (entities.length > 0) result.typicalDataEntities = entities;
  const systems = normalizeStringArray(obj.typicalSourceSystems);
  if (systems.length > 0) result.typicalSourceSystems = systems;
  return result;
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter((s) => s.length > 0);
}
