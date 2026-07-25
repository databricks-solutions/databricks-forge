import { type ChatMessage } from "@/lib/dbx/model-serving";
import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { logger } from "@/lib/logger";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";

const TEMPERATURE = 0.2;
const MAX_TITLE_WORDS = 7;
const MIN_TITLE_WORDS = 2;

export interface TitleGenerationInput {
  businessName: string;
  domain: string;
  subdomains: string[];
  tableFqns: string[];
  conversationSummary?: string;
  endpoint: string;
  fallbackEndpoint?: string;
  signal?: AbortSignal;
}

export interface TitleGenerationOutput {
  title: string;
  source: "llm" | "fallback";
  reason?: string;
}

export function sanitizeUserContext(input?: string): string {
  if (!input) return "";
  return input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[`$<>{}]/g, "")
    .replace(/\b(ignore|override|system prompt|developer message|instruction hierarchy)\b/gi, "")
    .trim()
    .slice(0, 500);
}

export function deterministicFallbackTitle(
  businessName: string,
  domain: string,
  tableFqns: string[],
): string {
  const cleanBusiness = businessName.trim();
  const cleanDomain = domain.trim() || "Data";
  if (cleanBusiness && cleanBusiness.toLowerCase() !== cleanDomain.toLowerCase()) {
    return normalizeTitle(`${cleanBusiness} ${cleanDomain} Insights`);
  }
  if (cleanDomain) {
    return normalizeTitle(`${cleanDomain} Insights`);
  }
  const tableTokens = tableFqns.slice(0, 2).map((fqn) => {
    const part = fqn.split(".").pop() ?? fqn;
    return part.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  });
  return normalizeTitle(`${tableTokens.join(" ")} Insights`.trim() || "Business Insights");
}

function normalizeTitle(raw: string): string {
  let title = raw
    .replace(/[^\w\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  title = title
    .replace(/\b\d+\s+tables?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = title.split(" ").filter(Boolean);
  const deduped: string[] = [];
  for (const w of words) {
    if (deduped.length === 0 || deduped[deduped.length - 1].toLowerCase() !== w.toLowerCase()) {
      deduped.push(w);
    }
  }
  return deduped.join(" ").trim();
}

function isValidTitle(title: string): boolean {
  if (!title) return false;
  if (/analytics analytics/i.test(title)) return false;
  if (/\b\d+\s+tables?\b/i.test(title)) return false;
  const words = title.split(/\s+/).filter(Boolean);
  return words.length >= MIN_TITLE_WORDS && words.length <= MAX_TITLE_WORDS;
}

async function generateWithEndpoint(
  input: TitleGenerationInput,
  endpoint: string,
): Promise<string | null> {
  const subdomains = input.subdomains.slice(0, 5).join(", ") || "none";
  const tableNames = input.tableFqns
    .slice(0, 8)
    .map((fqn) => fqn.split(".").pop() ?? fqn)
    .join(", ");
  const intent = sanitizeUserContext(input.conversationSummary) || "none";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Return a JSON object with key `title` only. " +
        "Create a concise business-facing Genie space title. " +
        "Use 2-7 words, no punctuation except spaces/hyphens, no table counts, no generic filler.",
    },
    {
      role: "user",
      content: [
        `Business: ${input.businessName}`,
        `Domain: ${input.domain}`,
        `Subdomains: ${subdomains}`,
        `Tables: ${tableNames}`,
        `UserIntentSummary: ${intent}`,
        'Output JSON: {"title":"..."}',
      ].join("\n"),
    },
  ];

  const response = await cachedChatCompletion({
    endpoint,
    messages,
    temperature: TEMPERATURE,
    maxTokens: 1024,
    responseFormat: "json_object",
    signal: input.signal,
  });

  const parsed = parseLLMJson(response.content ?? "", "genie:title-generation") as Record<
    string,
    unknown
  >;
  const candidate = normalizeTitle(String(parsed.title ?? ""));
  return isValidTitle(candidate) ? candidate : null;
}

export async function runTitleGeneration(
  input: TitleGenerationInput,
): Promise<TitleGenerationOutput> {
  try {
    const fastTitle = await generateWithEndpoint(input, input.endpoint);
    if (fastTitle) return { title: fastTitle, source: "llm" };
  } catch (error) {
    logger.warn("Fast title generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (input.fallbackEndpoint && input.fallbackEndpoint !== input.endpoint) {
    try {
      const fallbackLlmTitle = await generateWithEndpoint(input, input.fallbackEndpoint);
      if (fallbackLlmTitle) {
        return { title: fallbackLlmTitle, source: "llm", reason: "fast_endpoint_fallback" };
      }
    } catch (error) {
      logger.warn("Fallback title generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    title: deterministicFallbackTitle(input.businessName, input.domain, input.tableFqns),
    source: "fallback",
    reason: "llm_unavailable_or_invalid",
  };
}
