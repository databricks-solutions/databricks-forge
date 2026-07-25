/**
 * Fetches a benchmark source URL and converts the HTML to clean markdown.
 *
 * No heavy DOM library -- strips noise tags via regex, then runs turndown.
 * The embedding model and retriever are tolerant of residual noise, so
 * perfect extraction is not required.
 */

import TurndownService from "turndown";
import { logger } from "@/lib/logger";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB cap on raw HTML

/**
 * Domains known to block server-side fetches (Cloudflare, JS-only rendering).
 * We skip the network call entirely for these and return null immediately
 * so the caller falls back to the hand-written summary without waiting.
 */
const BLOCKED_DOMAINS = new Set([
  "mckinsey.com",
  "hbr.org",
  "wsj.com",
  "ft.com",
  "bloomberg.com",
  "gartner.com",
  "forrester.com",
  "bcg.com",
  "bain.com",
  "deloitte.com",
]);

function isDomainBlocked(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return [...BLOCKED_DOMAINS].some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

const NOISE_TAGS: (keyof HTMLElementTagNameMap)[] = [
  "script",
  "style",
  "nav",
  "footer",
  "header",
  "aside",
  "noscript",
  "iframe",
];

const NOISE_REGEX = new RegExp(
  NOISE_TAGS.map((tag) => `<${tag}[^>]*>[\\s\\S]*?</${tag}>`).join("|"),
  "gi",
);

function stripNoiseTags(html: string): string {
  return html.replace(NOISE_REGEX, "");
}

function initTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.remove(NOISE_TAGS);
  return td;
}

export async function fetchAndConvertSource(url: string): Promise<string | null> {
  if (isDomainBlocked(url)) {
    logger.info("[source-fetcher] Skipping blocked domain, will use summary fallback", {
      url,
    });
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DatabricksForgeBot/1.0; +https://databricks.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!response.ok) {
      logger.warn("[source-fetcher] Non-OK response", { url, status: response.status });
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      logger.warn("[source-fetcher] Non-HTML content type", { url, contentType });
      return null;
    }

    const rawHtml = await response.text();
    if (rawHtml.length > MAX_HTML_BYTES) {
      logger.warn("[source-fetcher] HTML exceeds size limit, truncating", {
        url,
        size: rawHtml.length,
      });
    }
    const html = rawHtml.slice(0, MAX_HTML_BYTES);

    const cleaned = stripNoiseTags(html);
    const td = initTurndown();
    const markdown = td.turndown(cleaned).trim();

    if (markdown.length < 50) {
      logger.warn("[source-fetcher] Converted markdown too short, likely JS-rendered page", {
        url,
        length: markdown.length,
      });
      return null;
    }

    logger.info("[source-fetcher] Source fetched and converted", {
      url,
      htmlLength: html.length,
      markdownLength: markdown.length,
    });

    return markdown;
  } catch (err) {
    logger.warn("[source-fetcher] Fetch failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
