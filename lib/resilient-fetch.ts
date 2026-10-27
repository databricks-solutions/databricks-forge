/**
 * Client-side fetch wrapper with transparent retry for transient errors.
 *
 * Retries server errors (5xx) and network failures up to `retries` times
 * with a fixed delay between attempts. Client errors (4xx) and abort
 * signals are never retried.
 */
export async function resilientFetch(
  url: string,
  init?: RequestInit,
  options?: { retries?: number; delayMs?: number },
): Promise<Response> {
  const { retries = 2, delayMs = 1000 } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err;
    }

    if (attempt < retries) {
      if (init?.signal?.aborted) break;
      await new Promise((r) => setTimeout(r, delayMs));
      if (init?.signal?.aborted) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Fetch failed after retries");
}

// ---------------------------------------------------------------------------
// Server-Side Request Forgery (SSRF) Guard for External Fetchers
// ---------------------------------------------------------------------------

export class SsrfBlockedError extends Error {
  readonly blockedUrl: string;
  constructor(url: string, reason: string) {
    super(`Blocked unsafe outbound URL (${reason}): ${url}`);
    this.name = "SsrfBlockedError";
    this.blockedUrl = url;
  }
}

/**
 * Returns true if an IPv4 or IPv6 literal belongs to loopback, link-local,
 * cloud metadata (`169.254.169.254`), RFC1918 private, CGNAT, or multicast space.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = ip
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleaned.startsWith("::ffff:")) {
    const v4Part = cleaned.slice("::ffff:".length);
    if (v4Part.includes(".")) {
      return isPrivateOrReservedIp(v4Part);
    }
    return true;
  }

  // IPv6 checks
  if (cleaned.includes(":")) {
    if (cleaned === "::" || cleaned === "::1") return true;
    if (
      cleaned.startsWith("fe80:") ||
      cleaned.startsWith("fe90:") ||
      cleaned.startsWith("fea0:") ||
      cleaned.startsWith("feb0:")
    ) {
      return true; // link-local fe80::/10
    }
    if (cleaned.startsWith("fc") || cleaned.startsWith("fd")) {
      return true; // unique local fc00::/7
    }
    if (cleaned.startsWith("ff")) {
      return true; // multicast ff00::/8
    }
    return false;
  }

  // IPv4 checks
  const parts = cleaned.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local & AWS/Azure/GCP IMDS)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a >= 224) return true; // 224.0.0.0/4 (multicast & reserved)

  return false;
}

/**
 * Validate that a URL is a safe public HTTP/HTTPS target and does not target
 * localhost, private/reserved IP ranges, cloud metadata services, or the
 * workspace's internal Databricks host.
 */
export function assertSafePublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "invalid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SsrfBlockedError(rawUrl, `disallowed protocol ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError(rawUrl, "credentials in URL are not allowed");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata"
  ) {
    throw new SsrfBlockedError(rawUrl, `disallowed internal hostname ${host}`);
  }

  // Block requests targeting the configured Databricks workspace host
  const dbxHostRaw = process.env.DATABRICKS_HOST;
  if (dbxHostRaw) {
    try {
      const normalizedDbx = dbxHostRaw.startsWith("http") ? dbxHostRaw : `https://${dbxHostRaw}`;
      const dbxHostname = new URL(normalizedDbx).hostname.toLowerCase();
      if (host === dbxHostname) {
        throw new SsrfBlockedError(rawUrl, "cannot scrape internal Databricks workspace host");
      }
    } catch (e) {
      if (e instanceof SsrfBlockedError) throw e;
    }
  }

  // Check numeric IPv4/IPv6 literals or integer/hex IP encodings
  const isIpv4Literal = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const isIpv6Literal = host.includes(":");
  if (isIpv4Literal || isIpv6Literal) {
    if (isPrivateOrReservedIp(host)) {
      throw new SsrfBlockedError(rawUrl, `private or reserved IP ${host}`);
    }
  } else if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    throw new SsrfBlockedError(rawUrl, `obfuscated IP literal ${host}`);
  }

  return parsed;
}

const MAX_SAFE_REDIRECTS = 4;

/**
 * Perform an outbound HTTP fetch that validates the initial URL and every
 * redirect hop against `assertSafePublicUrl`, preventing open-redirect SSRF
 * pivots into internal VPC / cloud metadata endpoints.
 */
export async function safePublicFetch(
  url: string,
  init?: RequestInit,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  let currentUrl = assertSafePublicUrl(url).href;

  for (let hop = 0; hop <= MAX_SAFE_REDIRECTS; hop++) {
    const resp = await fetchFn(currentUrl, {
      ...init,
      redirect: "manual",
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return resp;
      const nextUrl = new URL(location, currentUrl).href;
      currentUrl = assertSafePublicUrl(nextUrl).href;
      continue;
    }

    return resp;
  }

  throw new SsrfBlockedError(url, `exceeded maximum redirects (${MAX_SAFE_REDIRECTS})`);
}
