/**
 * Pass 2: IR (Investor Relations) Auto-Discovery
 *
 * Probes common IR page paths, extracts PDF links, downloads top PDFs,
 * and extracts text. Falls back to SEC EDGAR for US public companies.
 */

import type { Logger } from "@/lib/ports/logger";
import type { ResearchSource, DemoScope } from "../../types";
import { fromStructuredDate, fromUrl, fromTextBody } from "../date-extraction";

const IR_PATHS = [
  "/investor-relations",
  "/investors",
  "/about/investors",
  "/ir",
  "/about/investor-relations",
];

const IR_SUB_PATHS = [
  "/presentations",
  "/annual-reports",
  "/governance",
  "/filings",
  "/proxy",
  "/sec-filings",
  "/financial-reports",
  "/sustainability",
];

const PDF_PATTERNS = [
  /annual[-_]?report/i,
  /10-K/i,
  /investor[-_]?presentation/i,
  /earnings/i,
  /shareholder[-_]?letter/i,
  /strategy[-_]?update/i,
  /proxy[-_]?statement/i,
  /DEF[-_]?14A/i,
  /sustainability[-_]?report/i,
  /ESG[-_]?report/i,
  /capital[-_]?markets[-_]?day/i,
  /CMD/i,
  /corporate[-_]?governance/i,
  /half[-_]?year/i,
  /interim[-_]?report/i,
];

const MAX_PDF_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TEXT_PER_DOC = 50_000;
const MAX_PDFS = 5;

export async function runIRDiscovery(
  websiteUrl: string | undefined,
  scope: DemoScope | undefined,
  opts: {
    fetchFn?: typeof fetch;
    parsePdf?: (buffer: Buffer) => Promise<string>;
    logger: Logger;
    signal?: AbortSignal;
    onSourceReady?: (source: ResearchSource) => void;
  },
): Promise<{ text: string; sources: ResearchSource[] }> {
  const { fetchFn = fetch, logger: log, signal, onSourceReady } = opts;
  const sources: ResearchSource[] = [];
  const texts: string[] = [];

  if (!websiteUrl) return { text: "", sources };

  const baseUrl = websiteUrl.replace(/\/$/, "");

  // Step 1: Find the IR page
  let irPageHtml: string | null = null;
  let irPageUrl: string | null = null;

  for (const path of IR_PATHS) {
    if (signal?.aborted) break;
    try {
      const url = `${baseUrl}${path}`;
      const resp = await timedFetch(fetchFn, url, signal);
      if (resp?.ok) {
        irPageHtml = await resp.text();
        irPageUrl = url;
        log.info("IR page found", { url });
        break;
      }
    } catch {
      // continue trying
    }
  }

  if (!irPageHtml || !irPageUrl) {
    log.debug("No IR page found, attempting SEC EDGAR fallback");
    const edgarResult = await trySecEdgar(websiteUrl, opts);
    return edgarResult;
  }

  // Step 1.5: Crawl IR sub-pages for more PDF links
  const irBase = irPageUrl.replace(/\/$/, "");
  const allIRPages: { url: string; html: string }[] = [{ url: irPageUrl, html: irPageHtml }];
  const maxSubPages = 5;
  let subPagesCrawled = 0;

  for (const subPath of IR_SUB_PATHS) {
    if (subPagesCrawled >= maxSubPages || signal?.aborted) break;
    try {
      const subUrl = `${irBase}${subPath}`;
      const subResp = await timedFetch(fetchFn, subUrl, signal);
      if (subResp?.ok) {
        const subHtml = await subResp.text();
        allIRPages.push({ url: subUrl, html: subHtml });
        subPagesCrawled++;
        log.info("IR sub-page found", { url: subUrl });
      }
    } catch {
      // continue
    }
  }

  // Step 2: Extract PDF links from ALL IR pages
  const pdfLinks: PdfLink[] = [];
  for (const page of allIRPages) {
    pdfLinks.push(...extractPdfLinks(page.html, page.url));
  }
  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueLinks = pdfLinks.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  uniqueLinks.sort((a, b) => b.score - a.score);
  log.info("PDF links found across IR pages", { count: uniqueLinks.length, pagesScanned: allIRPages.length });

  // Step 3: Download and parse top PDFs
  const parsePdf = opts.parsePdf ?? defaultParsePdf;
  let downloaded = 0;

  for (const link of uniqueLinks) {
    if (downloaded >= MAX_PDFS || signal?.aborted) break;

    const source: ResearchSource = {
      type: "investor-doc",
      title: link.title,
      url: link.url,
      charCount: 0,
      status: "fetching",
      publishedAt: link.publishedAt,
      publishedYear: link.publishedYear,
      dateConfidence: link.dateConfidence,
    };
    sources.push(source);

    try {
      const resp = await timedFetch(fetchFn, link.url, signal);
      if (!resp?.ok) {
        source.status = "failed";
        source.error = `HTTP ${resp?.status}`;
        continue;
      }

      const contentLength = parseInt(resp.headers.get("content-length") ?? "0", 10);
      if (contentLength > MAX_PDF_SIZE) {
        source.status = "failed";
        source.error = "Too large";
        continue;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      const text = await parsePdf(buffer);
      const truncated = text.slice(0, MAX_TEXT_PER_DOC);

      // Upgrade date info from the PDF body if we only have a weak URL match.
      const lastModified = resp.headers.get("last-modified") ?? undefined;
      applyPdfDateSignals(source, { lastModifiedHeader: lastModified, body: truncated });

      source.charCount = truncated.length;
      source.status = "ready";
      texts.push(`[INVESTOR DOC: ${link.title}]\n${truncated}`);
      downloaded++;

      log.info("IR document parsed", { title: link.title, chars: truncated.length });
    } catch (err) {
      source.status = "failed";
      source.error = err instanceof Error ? err.message : String(err);
    }

    onSourceReady?.(source);
  }

  return { text: texts.join("\n\n---\n\n"), sources };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PdfLink {
  url: string;
  title: string;
  score: number;
  publishedAt?: string;
  publishedYear?: number;
  dateConfidence?: "high" | "medium" | "low" | "unknown";
}

function extractPdfLinks(html: string, pageUrl: string): PdfLink[] {
  const links: PdfLink[] = [];
  const hrefRegex = /href=["']([^"']*\.pdf[^"']*?)["']/gi;
  let match: RegExpExecArray | null;
  const currentYear = new Date().getUTCFullYear();

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    const url = href.startsWith("http") ? href : new URL(href, pageUrl).href;
    const filename = url.split("/").pop() ?? "";

    let score = 0;
    for (const pattern of PDF_PATTERNS) {
      if (pattern.test(filename) || pattern.test(href)) score += 10;
    }

    if (score > 0) {
      // Apply URL/filename year regex and fold recency into the ranking
      // so annual-report-2024.pdf beats annual-report-2016.pdf.
      const dateResult = fromUrl(url) ?? fromUrl(href);
      let recencyBoost = 0;
      if (dateResult?.publishedYear) {
        const age = currentYear - dateResult.publishedYear;
        // Younger-than-2y = +12, 2-3y = +6, 3-5y = +0, older = -8.
        if (age <= 2) recencyBoost = 12;
        else if (age <= 3) recencyBoost = 6;
        else if (age <= 5) recencyBoost = 0;
        else recencyBoost = -8;
      }

      links.push({
        url,
        title: filename.replace(/\.pdf$/i, "").replace(/[-_]/g, " "),
        score: score + recencyBoost,
        publishedAt: dateResult?.publishedAt,
        publishedYear: dateResult?.publishedYear,
        dateConfidence: dateResult?.dateConfidence,
      });
    }
  }

  return links.sort((a, b) => b.score - a.score);
}

async function trySecEdgar(
  websiteUrl: string,
  opts: { fetchFn?: typeof fetch; logger: Logger; signal?: AbortSignal; onSourceReady?: (source: ResearchSource) => void },
): Promise<{ text: string; sources: ResearchSource[] }> {
  const { fetchFn = fetch, logger: log, signal, onSourceReady } = opts;
  const sources: ResearchSource[] = [];

  try {
    const domain = new URL(websiteUrl).hostname.replace(/^www\./, "");

    // Skip SEC EDGAR for non-US domains (country-code TLDs)
    if (isNonUsDomain(domain)) {
      log.debug("Skipping SEC EDGAR for non-US domain", { domain });
      return { text: "", sources };
    }

    const companyName = domain.split(".")[0];
    if (companyName.length < 3) {
      log.debug("Domain label too short for SEC EDGAR lookup", { companyName });
      return { text: "", sources };
    }

    // Try company tickers endpoint for CIK lookup
    const tickerResp = await timedFetch(fetchFn, "https://www.sec.gov/files/company_tickers.json", signal);
    if (!tickerResp?.ok) return { text: "", sources };

    const tickerData = (await tickerResp.json()) as Record<
      string,
      { cik_str: number; ticker: string; title: string }
    >;

    const entries = Object.values(tickerData);
    const match = findBestEdgarMatch(companyName, entries);

    if (!match) {
      log.debug("No SEC EDGAR match found", { companyName });
      return { text: "", sources };
    }

    const cik = String(match.cik_str).padStart(10, "0");
    log.info("SEC EDGAR CIK found", { companyName: match.title, cik, ticker: match.ticker });

    // Fetch filing index
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const subResp = await timedFetch(fetchFn, submissionsUrl, signal);
    if (!subResp?.ok) return { text: "", sources };

    const submissions = (await subResp.json()) as {
      filings: {
        recent: {
          form: string[];
          accessionNumber: string[];
          primaryDocument: string[];
          filingDate?: string[];
          reportDate?: string[];
        };
      };
    };

    // Find the MOST RECENT 10-K (parallel arrays are usually newest-first,
    // but we pick by filingDate/reportDate defensively).
    const recent = submissions.filings.recent;
    const forms = recent.form;
    let tenKIdx = -1;
    let tenKTimestamp = -Infinity;
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== "10-K") continue;
      const candidate =
        (recent.reportDate && recent.reportDate[i]) ||
        (recent.filingDate && recent.filingDate[i]) ||
        "";
      const ts = Date.parse(candidate);
      const effective = Number.isFinite(ts) ? ts : 0;
      if (effective > tenKTimestamp) {
        tenKTimestamp = effective;
        tenKIdx = i;
      }
    }
    if (tenKIdx === -1) {
      log.debug("No 10-K filing found", { cik });
      return { text: "", sources };
    }

    const accession = recent.accessionNumber[tenKIdx].replace(/-/g, "");
    const primaryDoc = recent.primaryDocument[tenKIdx];
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${match.cik_str}/${accession}/${primaryDoc}`;
    const filingDate =
      (recent.reportDate && recent.reportDate[tenKIdx]) ||
      (recent.filingDate && recent.filingDate[tenKIdx]) ||
      undefined;
    const filingDateResult = fromStructuredDate(filingDate);

    const source: ResearchSource = {
      type: "sec-filing",
      title: filingDateResult?.publishedYear
        ? `10-K ${filingDateResult.publishedYear}: ${match.title}`
        : `10-K: ${match.title}`,
      url: filingUrl,
      charCount: 0,
      status: "fetching",
      publishedAt: filingDateResult?.publishedAt,
      publishedYear: filingDateResult?.publishedYear,
      dateConfidence: filingDateResult?.dateConfidence ?? "unknown",
    };
    sources.push(source);

    const filingResp = await timedFetch(fetchFn, filingUrl, signal, 30_000);
    if (!filingResp?.ok) {
      source.status = "failed";
      source.error = `HTTP ${filingResp?.status}`;
      return { text: "", sources };
    }

    const html = await filingResp.text();
    // Strip HTML tags for plain text extraction
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const truncated = text.slice(0, 80_000);

    source.charCount = truncated.length;
    source.status = "ready";
    onSourceReady?.(source);

    log.info("SEC EDGAR 10-K retrieved", { company: match.title, chars: truncated.length });

    return {
      text: `[SEC FILING: 10-K ${match.title}]\n${truncated}`,
      sources,
    };
  } catch (err) {
    log.debug("SEC EDGAR lookup failed (non-fatal)", { error: String(err) });
    return { text: "", sources };
  }
}

// Country-code TLDs and compound ccTLDs (e.g. .co.uk, .com.au) indicate non-US companies.
const NON_US_TLDS = new Set([
  "au", "uk", "de", "fr", "jp", "cn", "in", "br", "ca", "nz", "za", "sg",
  "hk", "kr", "tw", "it", "es", "nl", "se", "no", "dk", "fi", "ch", "at",
  "be", "ie", "pt", "pl", "cz", "ru", "mx", "ar", "cl", "co", "pe", "il",
  "ae", "sa", "th", "my", "ph", "id", "vn", "ng", "ke", "eg", "tr",
]);

function isNonUsDomain(domain: string): boolean {
  const parts = domain.split(".");
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1].toLowerCase();
  // Two-letter TLDs that aren't generic (exclude .io, .ai, .co used globally)
  const genericTwoLetter = new Set(["io", "ai", "co", "me", "tv", "gg"]);
  if (NON_US_TLDS.has(tld)) return true;
  // Compound ccTLDs: .com.au, .co.uk, .co.nz, etc.
  if (parts.length >= 3) {
    const secondLevel = parts[parts.length - 2].toLowerCase();
    if ((secondLevel === "com" || secondLevel === "co" || secondLevel === "org" || secondLevel === "net") &&
        tld.length === 2 && !genericTwoLetter.has(tld)) {
      return true;
    }
  }
  return false;
}

function findBestEdgarMatch(
  companyName: string,
  entries: { cik_str: number; ticker: string; title: string }[],
): { cik_str: number; ticker: string; title: string } | undefined {
  const cn = companyName.toLowerCase();

  // Exact ticker match (highest confidence)
  const tickerMatch = entries.find((e) => e.ticker.toLowerCase() === cn);
  if (tickerMatch) return tickerMatch;

  // Normalize SEC title for comparison: "O REILLY" → "oreilly"
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cnNorm = normalize(cn);

  // Collect scored candidates instead of returning first hit
  const candidates: { entry: typeof entries[0]; score: number }[] = [];

  for (const e of entries) {
    const titleNorm = normalize(e.title);
    // SEC title (normalized) starts with the domain name, or vice versa
    if (titleNorm.startsWith(cnNorm) || cnNorm.startsWith(titleNorm)) {
      const overlap = Math.min(cnNorm.length, titleNorm.length);
      const maxLen = Math.max(cnNorm.length, titleNorm.length);
      candidates.push({ entry: e, score: overlap / maxLen });
    }
  }

  if (candidates.length === 0) return undefined;

  // Require at least 40% overlap to avoid spurious matches
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score >= 0.4 ? candidates[0].entry : undefined;
}

async function timedFetch(
  fetchFn: typeof fetch,
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

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

function applyPdfDateSignals(
  source: ResearchSource,
  signals: { lastModifiedHeader?: string; body?: string },
): void {
  // Prefer high-confidence signals if we don't already have one.
  if (source.dateConfidence === "high") return;

  const structured = fromStructuredDate(signals.lastModifiedHeader);
  if (structured) {
    source.publishedAt = structured.publishedAt;
    source.publishedYear = structured.publishedYear;
    source.dateConfidence = "high";
    return;
  }

  // Only fall through to body scan if URL regex failed.
  if (source.dateConfidence === "medium" || source.dateConfidence === "low") return;

  const fromBody = fromTextBody(signals.body);
  if (fromBody) {
    source.publishedAt = fromBody.publishedAt;
    source.publishedYear = fromBody.publishedYear;
    source.dateConfidence = "low";
    return;
  }

  if (!source.dateConfidence) source.dateConfidence = "unknown";
}

async function defaultParsePdf(buffer: Buffer): Promise<string> {
  try {
    const mod = await import("pdf-parse");
    const pdfParse = ((mod as Record<string, unknown>).default ?? mod) as (
      buf: Buffer
    ) => Promise<{ text: string }>;
    const result = await pdfParse(buffer);
    return result.text;
  } catch {
    return "";
  }
}
