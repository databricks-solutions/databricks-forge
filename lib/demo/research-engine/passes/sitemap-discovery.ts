/**
 * Sitemap Discovery
 *
 * Discovers all URLs on a website by parsing robots.txt and sitemap.xml.
 * Handles both regular sitemaps and sitemap index files.
 */

import type { Logger } from "@/lib/ports/logger";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_URLS = 500;
const MAX_SUB_SITEMAPS = 10;

const NON_CONTENT_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".css",
  ".js",
  ".xml",
  ".json",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mp3",
  ".zip",
  ".pdf",
];

export interface SitemapEntry {
  url: string;
  lastmod?: string;
  priority?: number;
}

export async function runSitemapDiscovery(
  websiteUrl: string,
  opts: {
    fetchFn?: typeof fetch;
    logger: Logger;
    signal?: AbortSignal;
  },
): Promise<SitemapEntry[]> {
  const { fetchFn = fetch, logger: log, signal } = opts;

  const base = websiteUrl.replace(/\/$/, "");
  const sitemapUrls = new Set<string>();

  // 1. Fetch robots.txt and extract Sitemap: directives
  const robotsUrl = `${base}/robots.txt`;
  const robotsResp = await timedFetch(fetchFn, robotsUrl, signal, FETCH_TIMEOUT_MS);
  if (robotsResp?.ok) {
    const robotsText = await robotsResp.text();
    const lines = robotsText.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^sitemap:\s*(.+)$/i);
      if (m) {
        const url = m[1].trim();
        if (url) sitemapUrls.add(url);
      }
    }
  }

  // 2. Always try sitemap.xml
  sitemapUrls.add(`${base}/sitemap.xml`);

  const allEntries: SitemapEntry[] = [];
  let subSitemapsFetched = 0;

  for (const sitemapUrl of sitemapUrls) {
    if (signal?.aborted || allEntries.length >= MAX_URLS) break;

    const resp = await timedFetch(fetchFn, sitemapUrl, signal, FETCH_TIMEOUT_MS);
    if (!resp?.ok) continue;

    const xml = await resp.text();

    // Check if sitemap index
    if (/<sitemapindex/i.test(xml)) {
      const subUrls = parseSitemapIndex(xml);
      for (const subUrl of subUrls) {
        if (subSitemapsFetched >= MAX_SUB_SITEMAPS || allEntries.length >= MAX_URLS || signal?.aborted)
          break;
        const subResp = await timedFetch(fetchFn, subUrl, signal, FETCH_TIMEOUT_MS);
        if (!subResp?.ok) continue;
        const subXml = await subResp.text();
        const entries = parseUrlset(subXml);
        for (const e of entries) {
          if (allEntries.length >= MAX_URLS) break;
          if (isContentUrl(e.url)) allEntries.push(e);
        }
        subSitemapsFetched++;
      }
    } else {
      const entries = parseUrlset(xml);
      for (const e of entries) {
        if (allEntries.length >= MAX_URLS) break;
        if (isContentUrl(e.url)) allEntries.push(e);
      }
    }
  }

  log.info("Sitemap discovery complete", {
    urlCount: allEntries.length,
    subSitemapsFetched,
  });

  return allEntries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function timedFetch(
  fetchFn: typeof fetch,
  url: string,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const resp = await fetchFn(url, {
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

function parseSitemapIndex(xml: string): string[] {
  const urls: string[] = [];
  const re = /<sitemap>\s*<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

function parseUrlset(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  // Match <url>...</url> blocks (non-greedy, allow newlines)
  const urlBlockRe = /<url>([\s\S]*?)<\/url>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = urlBlockRe.exec(xml)) !== null) {
    const block = blockMatch[1];
    const locMatch = block.match(/<loc>\s*([^<]+)\s*<\/loc>/i);
    if (!locMatch) continue;

    const url = locMatch[1].trim();
    const lastmodMatch = block.match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/i);
    const priorityMatch = block.match(/<priority>\s*([^<]+)\s*<\/priority>/i);

    const entry: SitemapEntry = { url };
    if (lastmodMatch) entry.lastmod = lastmodMatch[1].trim();
    if (priorityMatch) {
      const p = parseFloat(priorityMatch[1].trim());
      if (!Number.isNaN(p)) entry.priority = p;
    }
    entries.push(entry);
  }

  return entries;
}

function isContentUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    for (const ext of NON_CONTENT_EXTENSIONS) {
      if (path.endsWith(ext)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
