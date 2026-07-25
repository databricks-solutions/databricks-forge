/**
 * Source publication date extraction.
 *
 * Best-effort extraction of a publication date from a research source
 * using (in order of confidence):
 *   - high    -> structured signal: sitemap lastmod, SEC filingDate,
 *                HTTP Last-Modified, HTML meta tags (og/article), JSON-LD
 *   - medium  -> URL / filename year regex (e.g. annual-report-2023.pdf)
 *   - low     -> text-body scan of the first N chars for an obvious
 *                publication year (© 2016, FY2023 Results, etc.)
 *   - unknown -> no signal at all
 *
 * All parsing is synchronous regex work; the module has no network or
 * LLM dependencies so it is safe to use anywhere in the source pipeline.
 */

export type DateConfidence = "high" | "medium" | "low" | "unknown";

export interface DateExtractionResult {
  publishedAt?: string;
  publishedYear?: number;
  dateConfidence: DateConfidence;
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const MIN_YEAR = 1995;
const MAX_YEAR = CURRENT_YEAR + 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a publication date from a structured high-confidence signal.
 * Returns undefined if input is not a parseable date.
 */
export function fromStructuredDate(input: string | undefined | null): DateExtractionResult | undefined {
  if (!input || typeof input !== "string") return undefined;
  const ts = Date.parse(input.trim());
  if (!Number.isFinite(ts)) return undefined;
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return undefined;
  return {
    publishedAt: d.toISOString(),
    publishedYear: year,
    dateConfidence: "high",
  };
}

/**
 * Parse HTML and look for publication dates in this order:
 *   1. <meta property="article:published_time">
 *   2. <meta property="og:updated_time">
 *   3. JSON-LD datePublished / dateModified
 *   4. <time datetime="...">
 */
export function fromHtml(html: string | undefined | null): DateExtractionResult | undefined {
  if (!html || typeof html !== "string") return undefined;
  const head = html.slice(0, 40_000); // no need to scan huge bodies

  const meta = matchMetaContent(head, [
    "article:published_time",
    "article:published",
    "og:article:published_time",
    "article:modified_time",
    "og:updated_time",
    "og:published_time",
    "dcterms.created",
    "dcterms.issued",
    "dcterms.modified",
    "datePublished",
    "pubdate",
  ]);
  if (meta) {
    const parsed = fromStructuredDate(meta);
    if (parsed) return parsed;
  }

  const jsonLd = matchJsonLdDate(head);
  if (jsonLd) {
    const parsed = fromStructuredDate(jsonLd);
    if (parsed) return parsed;
  }

  const timeMatch = head.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (timeMatch) {
    const parsed = fromStructuredDate(timeMatch[1]);
    if (parsed) return parsed;
  }

  return undefined;
}

/**
 * Parse a URL or filename for an explicit year (medium confidence).
 * Matches common IR filename patterns:
 *   /2023/, -2023, _2023, fy2023, fy23, q3-2024, annual-report-2024.pdf, 2024-annual-report.pdf
 */
export function fromUrl(url: string | undefined | null): DateExtractionResult | undefined {
  if (!url || typeof url !== "string") return undefined;

  // Look for 4-digit years 19xx / 20xx anywhere in the URL.
  // We prefer the latest year found to handle URLs like /archive/2016/2024-annual.pdf.
  const fourDigit = Array.from(url.matchAll(/(?<![0-9])(19[9][0-9]|20[0-9]{2})(?![0-9])/g))
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= MIN_YEAR && y <= MAX_YEAR);

  let year: number | undefined;
  if (fourDigit.length > 0) {
    year = Math.max(...fourDigit);
  }

  // 2-digit fiscal-year shorthand (fy23 / fy-23 / fy_23).
  if (year == null) {
    const fy2 = url.match(/fy[-_]?([0-9]{2})\b/i);
    if (fy2) {
      const yy = parseInt(fy2[1], 10);
      const candidate = yy < 50 ? 2000 + yy : 1900 + yy;
      if (candidate >= MIN_YEAR && candidate <= MAX_YEAR) year = candidate;
    }
  }

  if (year == null) return undefined;
  return {
    publishedAt: new Date(Date.UTC(year, 0, 1)).toISOString(),
    publishedYear: year,
    dateConfidence: "medium",
  };
}

/**
 * Scan the first N chars of a text body for an obvious publication year
 * (© 2016, FY2023 Results, "For the year ended 31 December 2016", etc.).
 * Low-confidence fallback.
 */
export function fromTextBody(
  text: string | undefined | null,
  maxChars: number = 500,
): DateExtractionResult | undefined {
  if (!text || typeof text !== "string") return undefined;
  const head = text.slice(0, maxChars);
  const lower = head.toLowerCase();

  const patterns: Array<RegExp> = [
    /(?:©|copyright)\s*(?:\([c]\))?\s*(19[9][0-9]|20[0-9]{2})/i,
    /(?:fiscal[-\s]?year|fy)\s*(19[9][0-9]|20[0-9]{2})/i,
    /(?:annual\s+report|full\s+year\s+results|q[1-4]\s+results)[^0-9]{0,30}(19[9][0-9]|20[0-9]{2})/i,
    /(?:for\s+the\s+year\s+ended[^0-9]{0,40}|year\s+ended[^0-9]{0,30})(19[9][0-9]|20[0-9]{2})/i,
    /(?:published|publication\s+date|dated)[^0-9]{0,20}(19[9][0-9]|20[0-9]{2})/i,
  ];

  for (const re of patterns) {
    const m = lower.match(re);
    if (m) {
      const y = parseInt(m[1], 10);
      if (y >= MIN_YEAR && y <= MAX_YEAR) {
        return {
          publishedAt: new Date(Date.UTC(y, 0, 1)).toISOString(),
          publishedYear: y,
          dateConfidence: "low",
        };
      }
    }
  }

  return undefined;
}

/**
 * Combine signals to produce the best available date. Inputs are tried
 * in order of confidence: structured -> HTML -> URL -> text body.
 */
export function extractPublishedAt(signals: {
  structured?: string;
  html?: string;
  url?: string;
  text?: string;
}): DateExtractionResult {
  return (
    fromStructuredDate(signals.structured) ??
    fromHtml(signals.html) ??
    fromUrl(signals.url) ??
    fromTextBody(signals.text) ?? { dateConfidence: "unknown" }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchMetaContent(html: string, properties: string[]): string | undefined {
  for (const prop of properties) {
    // property="..."
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escapeRegex(prop)}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re1);
    if (!tag) continue;
    const content = tag[0].match(/content=["']([^"']+)["']/i);
    if (content) return content[1].trim();
  }
  return undefined;
}

function matchJsonLdDate(html: string): string | undefined {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!blocks) return undefined;
  for (const block of blocks) {
    const body = block.replace(/<script[^>]*>|<\/script>/gi, "");
    const date =
      body.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ||
      body.match(/"dateModified"\s*:\s*"([^"]+)"/i)?.[1];
    if (date) return date.trim();
  }
  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
