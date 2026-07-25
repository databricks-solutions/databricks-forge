/**
 * Intent classification for Ask Forge assistant.
 *
 * Classifies user questions into one of five intent categories to route
 * to the appropriate engine branch. Uses a lightweight LLM call with
 * the fast serving endpoint for low-latency classification.
 */

import { chatCompletion, type ChatMessage } from "@/lib/dbx/model-serving";
import { resolveEndpoint } from "@/lib/dbx/client";
import { logger } from "@/lib/logger";

export type AssistantIntent =
  | "business"
  | "technical"
  | "dashboard"
  | "navigation"
  | "exploration"
  | "strategic";

export interface IntentClassification {
  intent: AssistantIntent;
  confidence: number;
  reasoning: string;
}

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a data intelligence assistant that helps users explore their Databricks Unity Catalog estate.

Classify the user's question into exactly ONE of these intents:

- "business": Questions about business value, KPIs, metrics, analytics use cases, or "how can I do X with my data?" (e.g. "How can I calculate Customer Lifetime Value?", "What revenue insights can I get?")
- "technical": Questions about data quality, table health, maintenance, technical metadata, freshness, PII, governance (e.g. "How many tables haven't run OPTIMIZE?", "Which tables have PII?")
- "dashboard": Questions that ask to visualise, chart, trend, or compare data -- the answer is best served as a dashboard (e.g. "Show me churn by region", "Trend of revenue over time")
- "navigation": Questions that are really looking for a specific entity -- a table, use case, domain, or document (e.g. "Find customer tables", "Show me the orders use case")
- "exploration": Open-ended questions about the data estate, risks, opportunities, domains, or general investigation (e.g. "What PII risks exist in Finance?", "What's in the Sales domain?")
- "strategic": Questions about executive strategy, business cases, stakeholder mapping, implementation roadmap, value quantification, or board-level summaries (e.g. "Write an executive summary", "Draft a business case", "What should I present to the CFO?", "Who are the key stakeholders?", "What is our implementation roadmap?")

Respond with a JSON object: { "intent": "<intent>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>" }`;

/**
 * Classify the intent of a user question.
 *
 * Falls back to "exploration" with a heuristic when the LLM call fails
 * or when the fast endpoint is unavailable.
 */
export async function classifyIntent(question: string): Promise<IntentClassification> {
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    const resp = await chatCompletion({
      endpoint: resolveEndpoint("classification"),
      messages,
      temperature: 0.0,
      maxTokens: 1024,
    });

    const parsed = JSON.parse(resp.content);
    const intent = parsed.intent as AssistantIntent;
    const valid: AssistantIntent[] = [
      "business",
      "technical",
      "dashboard",
      "navigation",
      "exploration",
      "strategic",
    ];
    if (!valid.includes(intent)) throw new Error(`Invalid intent: ${intent}`);

    return {
      intent,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.8)),
      reasoning: parsed.reasoning ?? "",
    };
  } catch (err) {
    logger.warn("[assistant/intent] LLM classification failed, using heuristic", {
      error: String(err),
    });
    return heuristicClassify(question);
  }
}

function heuristicClassify(question: string): IntentClassification {
  const q = question.toLowerCase();

  const dashboardPatterns =
    /\b(show me|chart|trend|dashboard|visuali[sz]e|compare .+ (by|across|over)|plot|graph)\b/;
  if (dashboardPatterns.test(q)) {
    return { intent: "dashboard", confidence: 0.6, reasoning: "Heuristic: dashboard pattern" };
  }

  const technicalPatterns =
    /\b(optimize|vacuum|health|pii|governance|stale|freshness|partition|cluster|delta|maintenance|schema|column|type|format)\b/;
  if (technicalPatterns.test(q)) {
    return { intent: "technical", confidence: 0.6, reasoning: "Heuristic: technical pattern" };
  }

  const navPatterns = /\b(find|where is|show the|navigate|go to|open|locate)\b/;
  if (navPatterns.test(q)) {
    return { intent: "navigation", confidence: 0.6, reasoning: "Heuristic: navigation pattern" };
  }

  const strategicPatterns =
    /\b(executive|business case|cfo|cdo|cio|board|stakeholder|roadmap|implementation plan|strategy|strategic|briefing|memo|value (tracking|realization)|portfolio|champion|change management)\b/;
  if (strategicPatterns.test(q)) {
    return {
      intent: "strategic",
      confidence: 0.7,
      reasoning: "Heuristic: strategic/executive pattern",
    };
  }

  const businessPatterns =
    /\b(calculate|kpi|metric|revenue|roi|churn|lifetime value|clv|ltv|forecast|predict|analytics|insight)\b/;
  if (businessPatterns.test(q)) {
    return { intent: "business", confidence: 0.6, reasoning: "Heuristic: business pattern" };
  }

  const fabricPatterns =
    /\b(power\s*bi|fabric|dax|pbi|powerbi|measure|pbix|dataset|report\s+tile)\b/;
  if (fabricPatterns.test(q)) {
    return { intent: "business", confidence: 0.6, reasoning: "Heuristic: Fabric/Power BI pattern" };
  }

  return { intent: "exploration", confidence: 0.5, reasoning: "Heuristic: default exploration" };
}
