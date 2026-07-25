/**
 * Pass 1: Website Scrape
 *
 * Fetches the company website URL (and optional division-specific pages),
 * converts HTML to markdown via turndown, truncates to 15K chars.
 *
 * For strategic-crawl mode, use runDeepWebsiteScrape which delegates to
 * runStrategicCrawl first, then falls back to homepage-only scrape.
 */

import TurndownService from "turndown";
import type { Logger } from "@/lib/ports/logger";
import type { LLMClient } from "@/lib/ports/llm-client";
import type { ResearchSource, DemoScope } from "../../types";
import { runStrategicCrawl } from "./strategic-crawl";
import {
  fromStructuredDate,
  fromHtml,
  fromUrl,
  fromTextBody,
  type DateExtractionResult,
} from "../date-extraction";

const MAX_CHARS = 15_000;
const FETCH_TIMEOUT_MS = 15_000;

export async function runWebsiteScrape(
  websiteUrl: string | undefined,
  scope: DemoScope | undefined,
  opts: {
    fetchFn?: typeof fetch;
    logger: Logger;
    signal?: AbortSignal;
    onSourceReady?: (source: ResearchSource) => void;
  },
): Promise<{ text: string; sources: ResearchSource[] }> {
  const { fetchFn = fetch, logger: log, signal, onSourceReady } = opts;
  const sources: ResearchSource[] = [];
  const texts: string[] = [];

  if (!websiteUrl) {
    return { text: "", sources };
  }

  const urls = [websiteUrl];
  if (scope?.division) {
    const slug = scope.division.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    urls.push(`${websiteUrl.replace(/\/$/, "")}/${slug}`);
    urls.push(`${websiteUrl.replace(/\/$/, "")}/about/${slug}`);
  }

  for (const url of urls) {
    const source: ResearchSource = {
      type: "website",
      title: url,
      url,
      charCount: 0,
      status: "fetching",
    };
    sources.push(source);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      if (signal?.aborted) break;

      const combined = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      const response = await fetchFn(url, {
        headers: { "User-Agent": "DatabricksForge/1.0" },
        signal: combined,
        redirect: "follow",
      });
      clearTimeout(timeout);

      if (!response.ok) {
        source.status = "failed";
        source.error = `HTTP ${response.status}`;
        log.debug("Website fetch failed", { url, status: response.status });
        continue;
      }

      const html = await response.text();
      const lastModified = response.headers.get("last-modified") ?? undefined;
      const markdown = htmlToMarkdown(html);
      const truncated = markdown.slice(0, MAX_CHARS);

      applyDateSignals(source, { lastModifiedHeader: lastModified, html, body: markdown });

      source.charCount = truncated.length;
      source.status = "ready";
      texts.push(`[WEBSITE: ${url}]\n${truncated}`);

      log.info("Website scraped", { url, chars: truncated.length });
    } catch (err) {
      source.status = "failed";
      source.error = err instanceof Error ? err.message : String(err);
      log.debug("Website scrape error", { url, error: source.error });
    }

    onSourceReady?.(source);
  }

  return { text: texts.join("\n\n---\n\n"), sources };
}

/**
 * Deep website scrape for strategic-crawl mode.
 * Tries strategic crawl (sitemap + strategic paths + LLM classification) first,
 * then falls back to homepage-only scrape if no content is found.
 */
export async function runDeepWebsiteScrape(
  websiteUrl: string | undefined,
  scope: DemoScope | undefined,
  opts: {
    fetchFn?: typeof fetch;
    llm: LLMClient;
    logger: Logger;
    signal?: AbortSignal;
    onSourceReady?: (source: ResearchSource) => void;
    onProgress?: (detail: string) => void;
  },
): Promise<{ text: string; sources: ResearchSource[] }> {
  if (!websiteUrl) return { text: "", sources: [] };

  // Try strategic crawl first (sitemap + strategic paths + LLM classification)
  const result = await runStrategicCrawl(websiteUrl, scope, opts);

  // If strategic crawl found content, use it; otherwise fall back to homepage-only
  if (result.sources.some((s) => s.status === "ready")) {
    return result;
  }

  opts.logger.info("Strategic crawl returned no content, falling back to homepage scrape");
  return runWebsiteScrape(websiteUrl, scope, {
    fetchFn: opts.fetchFn,
    logger: opts.logger,
    signal: opts.signal,
    onSourceReady: opts.onSourceReady,
  });
}

function applyDateSignals(
  source: ResearchSource,
  signals: { lastModifiedHeader?: string; html?: string; body?: string },
): void {
  let result: DateExtractionResult | undefined =
    fromStructuredDate(signals.lastModifiedHeader) ??
    fromHtml(signals.html) ??
    fromUrl(source.url) ??
    fromTextBody(signals.body);
  if (!result) result = { dateConfidence: "unknown" };
  if (result.publishedAt) source.publishedAt = result.publishedAt;
  if (typeof result.publishedYear === "number") source.publishedYear = result.publishedYear;
  source.dateConfidence = result.dateConfidence;
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  turndown.remove(["script", "style", "nav", "footer", "iframe", "noscript"]);

  return turndown.turndown(html);
}
