/**
 * Pass C: Source Summaries
 *
 * A single batched lightweight LLM call producing a 2-sentence summary +
 * 3 bullet takeaways for each ready source. Fed into the Sources tab and
 * the StickyBriefRail so users can evaluate source quality at a glance.
 *
 * Runs in Phase 1 parallel fan-out with key-quotes and industry-landscape.
 */

import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { resolveResearchEndpoint } from "../resolve-endpoint";
import type { TaskTier } from "@/lib/dbx/model-registry";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { Logger } from "@/lib/ports/logger";
import type { ResearchSource } from "../../types";
import type { SourceSummary } from "../types";
import { SOURCE_SUMMARIES_PROMPT } from "../prompts";

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

interface SourceSummariesOutput {
  summaries: Array<{
    sourceUrl: string;
    sourceTitle?: string;
    twoSentenceSummary?: string;
    keyTakeaways?: string[];
  }>;
}

export async function runSourceSummaries(
  customerName: string,
  sourcesWithText: Array<{ source: ResearchSource; text: string }>,
  opts: {
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    modelTier?: TaskTier;
  },
): Promise<SourceSummary[]> {
  const { llm, logger: log, signal, modelTier } = opts;

  const ready = sourcesWithText.filter(
    (s) => s.source.status === "ready" && s.text && s.text.length > 100,
  );
  if (ready.length === 0) {
    log.info("source-summaries: no ready sources, skipping");
    return [];
  }

  const perSourceBudget = Math.floor(22_000 / Math.max(ready.length, 1));
  const manifest = ready
    .map((s, idx) => {
      const title = (s.source.title || `Source ${idx + 1}`).slice(0, 120);
      const url = s.source.url ?? "";
      const body = s.text.slice(0, perSourceBudget);
      const published = formatPublishedLine(s.source);
      return `---\n[SOURCE ${idx + 1}]\nTitle: ${title}\nURL: ${url}${published}\n${body}`;
    })
    .join("\n");

  const prompt = SOURCE_SUMMARIES_PROMPT
    .replace("{customer_name}", customerName)
    .replace("{source_manifest}", manifest);

  const endpoint = resolveResearchEndpoint(modelTier ?? "classification");

  const response = await llm.chat({
    endpoint,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    maxTokens: 6_144,
    responseFormat: "json_object",
    signal,
  });

  const parsed = parseLLMJson(response.content, "source-summaries") as SourceSummariesOutput;
  const raw = Array.isArray(parsed?.summaries) ? parsed.summaries : [];

  const urlToSource = new Map<string, ResearchSource>();
  for (const { source } of ready) {
    if (source.url) urlToSource.set(source.url, source);
  }

  const summaries: SourceSummary[] = [];
  const seenUrls = new Set<string>();
  for (const s of raw) {
    const sourceUrl = typeof s?.sourceUrl === "string" ? s.sourceUrl.trim() : "";
    if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
    const matched = urlToSource.get(sourceUrl);
    if (!matched) continue;
    seenUrls.add(sourceUrl);

    const twoSentenceSummary =
      typeof s?.twoSentenceSummary === "string" ? s.twoSentenceSummary.trim() : "";
    if (!twoSentenceSummary) continue;

    const keyTakeaways = Array.isArray(s?.keyTakeaways)
      ? s.keyTakeaways
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .slice(0, 3)
      : [];

    summaries.push({
      sourceUrl,
      sourceTitle: matched.title,
      twoSentenceSummary,
      keyTakeaways,
    });
  }

  log.info("source-summaries complete", { count: summaries.length, sources: ready.length });
  return summaries;
}
