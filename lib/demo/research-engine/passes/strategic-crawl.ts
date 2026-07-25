/**
 * Strategic Crawl
 *
 * Replaces the shallow homepage scrape with a deep strategic crawl:
 * sitemap discovery, strategic path probing, LLM URL classification,
 * and parallel page fetching.
 */

import TurndownService from "turndown";
import { resolveEndpoint } from "@/lib/dbx/client";
import type { Logger } from "@/lib/ports/logger";
import type { LLMClient } from "@/lib/ports/llm-client";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import type { ResearchSource, DemoScope } from "../../types";
import { runSitemapDiscovery } from "./sitemap-discovery";
import {
  fromStructuredDate,
  fromHtml,
  fromUrl,
  fromTextBody,
  type DateExtractionResult,
} from "../date-extraction";

const STRATEGIC_PATHS = [
  "/about",
  "/about-us",
  "/about/strategy",
  "/about/leadership",
  "/about/our-business",
  "/strategy",
  "/our-strategy",
  "/corporate-strategy",
  "/sustainability",
  "/esg",
  "/corporate-responsibility",
  "/environment",
  "/annual-report",
  "/annual-review",
  "/media",
  "/news",
  "/press",
  "/press-releases",
  "/newsroom",
  "/governance",
  "/corporate-governance",
  "/innovation",
  "/technology",
  "/digital",
  "/digital-transformation",
  "/our-business",
  "/what-we-do",
  "/services",
  "/products",
  "/solutions",
];

const PROBE_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CHARS_PER_PAGE = 25_000;
const MAX_URLS_TO_CRAWL = 20;
const FALLBACK_CAP = 25;
const CRAWL_CONCURRENCY = 5;

export async function runStrategicCrawl(
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
  const { fetchFn = fetch, llm, logger: log, signal, onSourceReady, onProgress } = opts;
  const sources: ResearchSource[] = [];
  const texts: string[] = [];

  if (!websiteUrl) {
    return { text: "", sources };
  }

  const baseUrl = websiteUrl.replace(/\/$/, "");
  const homepageUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  onProgress?.("Discovering URLs via sitemap...");
  const sitemapEntries = await runSitemapDiscovery(websiteUrl, {
    fetchFn,
    logger: log,
    signal,
  });
  const sitemapUrls = new Set(sitemapEntries.map((e) => e.url));
  const urlToLastmod = new Map<string, string>();
  for (const e of sitemapEntries) {
    if (e.lastmod) urlToLastmod.set(e.url, e.lastmod);
  }

  onProgress?.("Probing strategic paths...");
  const probePaths = [...STRATEGIC_PATHS];
  if (scope?.division) {
    const slug = scope.division.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    probePaths.push(`/${slug}`, `/about/${slug}`, `/${slug}/strategy`, `/${slug}/our-business`);
  }

  const probedUrls: string[] = [];
  for (const path of probePaths) {
    if (signal?.aborted) break;
    const url = `${baseUrl}${path}`;
    const resp = await probeUrl(fetchFn, url, signal);
    if (resp?.ok) probedUrls.push(url);
  }

  const allUrls = new Set<string>([homepageUrl]);
  for (const u of sitemapUrls) allUrls.add(u);
  for (const u of probedUrls) allUrls.add(u);

  let urlsToCrawl = [homepageUrl, ...Array.from(allUrls).filter((u) => u !== homepageUrl)];

  if (urlsToCrawl.length > MAX_URLS_TO_CRAWL) {
    onProgress?.("Classifying URLs by strategic value...");
    try {
      const topUrls = await classifyUrls(llm, urlsToCrawl, signal);
      urlsToCrawl = topUrls.slice(0, MAX_URLS_TO_CRAWL);
    } catch (err) {
      log.warn("LLM URL classification failed, using discovered URLs", {
        error: err instanceof Error ? err.message : String(err),
      });
      urlsToCrawl = urlsToCrawl.slice(0, FALLBACK_CAP);
    }
  }

  onProgress?.(`Crawling ${urlsToCrawl.length} pages...`);

  const tasks = urlsToCrawl.map((url) => async () => {
    const source: ResearchSource = {
      type: "website",
      title: url,
      url,
      charCount: 0,
      status: "fetching",
    };
    sources.push(source);

    try {
      const fetched = await fetchPage(fetchFn, url, signal);
      if (!fetched) {
        source.status = "failed";
        source.error = "Fetch failed or empty response";
        onSourceReady?.(source);
        return null;
      }
      const { html, lastModified } = fetched;

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;
      source.title = title;

      const markdown = htmlToMarkdown(html);
      const truncated = markdown.slice(0, MAX_CHARS_PER_PAGE);

      applyDateSignals(source, {
        sitemapLastmod: urlToLastmod.get(url),
        lastModifiedHeader: lastModified,
        html,
        body: markdown,
      });

      source.charCount = truncated.length;
      source.status = "ready";
      onSourceReady?.(source);

      return { url, title, text: `[WEBSITE: ${url}]\n${truncated}` };
    } catch (err) {
      source.status = "failed";
      source.error = err instanceof Error ? err.message : String(err);
      onSourceReady?.(source);
      return null;
    }
  });

  const results = await mapWithConcurrency(tasks, CRAWL_CONCURRENCY);
  for (const r of results) {
    if (r?.text) texts.push(r.text);
  }

  return { text: texts.join("\n\n---\n\n"), sources };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function probeUrl(
  fetchFn: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const resp = await fetchFn(url, {
      method: "GET",
      headers: { "User-Agent": "DatabricksForge/1.0" },
      signal: combined,
      redirect: "follow",
    });
    clearTimeout(timeout);
    return resp;
  } catch {
    return null;
  }
}

async function fetchPage(
  fetchFn: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<{ html: string; lastModified?: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const resp = await fetchFn(url, {
      headers: { "User-Agent": "DatabricksForge/1.0" },
      signal: combined,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    const lastModified = resp.headers.get("last-modified") ?? undefined;
    return { html, lastModified };
  } catch {
    return null;
  }
}

function applyDateSignals(
  source: ResearchSource,
  signals: {
    sitemapLastmod?: string;
    lastModifiedHeader?: string;
    html?: string;
    body?: string;
  },
): void {
  let result: DateExtractionResult | undefined =
    fromStructuredDate(signals.sitemapLastmod) ??
    fromStructuredDate(signals.lastModifiedHeader) ??
    fromHtml(signals.html) ??
    fromUrl(source.url) ??
    fromTextBody(signals.body);
  if (!result) result = { dateConfidence: "unknown" };
  if (result.publishedAt) source.publishedAt = result.publishedAt;
  if (typeof result.publishedYear === "number") source.publishedYear = result.publishedYear;
  source.dateConfidence = result.dateConfidence;
}

async function classifyUrls(
  llm: LLMClient,
  urls: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");

  const prompt = `You are classifying URLs from a company website for strategic research.

Rate each URL by strategic value (0-10) for understanding:
- Company strategy and financial performance
- Sustainability and ESG
- Leadership and governance
- Data, technology, and digital transformation direction

URLs to classify:
${urlList}

Return a JSON object with a single key "urls" containing an array of the top 20 URLs in order of strategic value (highest first). Use the exact URLs as provided.
Example: { "urls": ["https://example.com/strategy", "https://example.com/about", ...] }`;

  const response = await llm.chat({
    endpoint: resolveEndpoint("lightweight"),
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxTokens: 4096,
    responseFormat: "json_object",
    signal,
  });

  const parsed = parseLLMJson(response.content, "strategic-crawl");
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { urls?: unknown }).urls)) {
    throw new Error("Invalid LLM response: expected { urls: string[] }");
  }

  const result = (parsed as { urls: string[] }).urls;
  if (!Array.isArray(result) || result.some((u) => typeof u !== "string")) {
    throw new Error("Invalid LLM response: urls must be string array");
  }

  return result;
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.remove(["script", "style", "nav", "footer", "iframe", "noscript"]);
  return turndown.turndown(html);
}
