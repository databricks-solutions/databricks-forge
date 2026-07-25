/**
 * Pass B: Key Quotes Extraction
 *
 * A single batched lightweight LLM call that reads the concatenated raw
 * source text and returns 15-25 verbatim quotes tagged by theme, with
 * exact sourceUrl + sourceTitle preserved.
 *
 * Runs in parallel with industry-landscape + source-summaries (Phase 1
 * fan-out) so it absorbs into the critical path with little wall-clock
 * cost.
 *
 * Used downstream by:
 *   - evidence-linking (authoritative set of source-grounded statements)
 *   - persona-talk-track (proof material for objection handling)
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { ResearchSource } from "../../types";
import type { KeyQuote } from "../types";
import { KEY_QUOTES_PROMPT } from "../prompts";

interface KeyQuotesOutput {
  quotes: Array<{
    quote: string;
    sourceUrl: string;
    sourceTitle: string;
    tags: string[];
  }>;
}

/** Format a "Published: 2024-06-15 (high confidence)" line for the manifest. */
function formatPublishedLine(source: ResearchSource): string {
  const date =
    (source.publishedAt && source.publishedAt.slice(0, 10)) ||
    (typeof source.publishedYear === "number" ? String(source.publishedYear) : "");
  if (!date) return "";
  const conf =
    source.dateConfidence && source.dateConfidence !== "unknown"
      ? ` (${source.dateConfidence} confidence)`
      : "";
  return `\nPublished: ${date}${conf}`;
}

const VALID_TAGS = new Set([
  "strategy",
  "priorities",
  "pain",
  "risk",
  "technology",
  "customer",
  "regulatory",
  "financial",
]);

export async function runKeyQuotesExtraction(
  customerName: string,
  sourcesWithText: Array<{ source: ResearchSource; text: string }>,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    modelTier?: TaskTier;
  },
): Promise<KeyQuote[]> {
  const { llm, logger: log, signal, modelTier } = opts;

  const ready = sourcesWithText.filter(
    (s) => s.source.status === "ready" && s.text && s.text.length > 100,
  );
  if (ready.length === 0) {
    log.info("key-quotes: no ready sources, skipping");
    return [];
  }

  // Build a compact per-source manifest. We cap each source body so the
  // total fits comfortably within a lightweight-tier context window.
  const perSourceBudget = Math.floor(30_000 / Math.max(ready.length, 1));
  const manifest = ready
    .map((s, idx) => {
      const title = (s.source.title || `Source ${idx + 1}`).slice(0, 120);
      const url = s.source.url ?? "";
      const body = s.text.slice(0, perSourceBudget);
      const published = formatPublishedLine(s.source);
      return `---\n[SOURCE ${idx + 1}]\nTitle: ${title}\nURL: ${url}${published}\n${body}`;
    })
    .join("\n");

  const prompt = KEY_QUOTES_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{source_manifest}", manifest);

  const endpoint = resolveResearchEndpoint(modelTier ?? "classification");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 4_096,
    responseFormat: "json_object",
    signal,
  });

  const parsed = parseLLMJson(response.content, "key-quotes") as KeyQuotesOutput;
  const raw = Array.isArray(parsed?.quotes) ? parsed.quotes : [];

  // Build a URL -> title lookup so we can repair LLM drift in titles.
  const urlToTitle = new Map<string, string>();
  for (const { source } of ready) {
    if (source.url) urlToTitle.set(source.url, source.title);
  }

  const quotes: KeyQuote[] = [];
  const seen = new Set<string>();
  for (const q of raw) {
    const quote = typeof q?.quote === "string" ? q.quote.trim() : "";
    if (!quote || quote.length < 20) continue;
    const sourceUrl = typeof q?.sourceUrl === "string" ? q.sourceUrl.trim() : "";
    if (!sourceUrl) continue;
    const sourceTitle = urlToTitle.get(sourceUrl) ?? (typeof q?.sourceTitle === "string" ? q.sourceTitle : "Source");

    const tags = Array.isArray(q?.tags)
      ? (q.tags
          .map((t) => (typeof t === "string" ? t.toLowerCase() : ""))
          .filter((t) => VALID_TAGS.has(t)) as KeyQuote["tags"])
      : [];

    const dedupeKey = quote.slice(0, 80).toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    quotes.push({ quote, sourceUrl, sourceTitle, tags });
  }

  log.info("key-quotes complete", { count: quotes.length, sources: ready.length });
  return quotes;
}
