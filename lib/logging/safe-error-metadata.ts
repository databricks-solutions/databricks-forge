export interface SafeErrorMetadata {
  errorName: string;
  errorCategory: "cancellation" | "parsing" | "programming" | "timeout" | "runtime";
  safeSummary: string;
  location?: string;
  code?: string;
}

const ERROR_NAMES = new Set([
  "AbortError",
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
]);
const ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const CODE_LOCATION =
  /(?:^|[(\s])((?:[^()\s]+\/)?(?:app|components|lib|scripts)\/[^()\s]+:\d+:\d+)\)?$/;

function safeName(error: unknown): string {
  const candidate = error instanceof Error ? error.name : "";
  return ERROR_NAMES.has(candidate) ? candidate : "Error";
}

function categoryOf(name: string): SafeErrorMetadata["errorCategory"] {
  if (name === "AbortError") return "cancellation";
  if (name === "SyntaxError") return "parsing";
  if (name === "TypeError" || name === "ReferenceError" || name === "RangeError") {
    return "programming";
  }
  if (/timeout/i.test(name)) return "timeout";
  return "runtime";
}

function safeLocation(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  for (const line of error.stack.split("\n").slice(1, 12)) {
    const match = line.trim().match(CODE_LOCATION);
    if (!match) continue;
    const rooted = match[1].match(/(?:app|components|lib|scripts)\/.+$/)?.[0];
    if (rooted && rooted.length <= 200) return rooted;
  }
  return undefined;
}

export function safeErrorMetadata(error: unknown, safeSummary: string): SafeErrorMetadata {
  const errorName = safeName(error);
  const location = safeLocation(error);
  const rawCode =
    error !== null && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code = typeof rawCode === "string" && ERROR_CODES.has(rawCode) ? rawCode : undefined;
  return {
    errorName,
    errorCategory: categoryOf(errorName),
    safeSummary: safeSummary.slice(0, 160),
    ...(location ? { location } : {}),
    ...(code ? { code } : {}),
  };
}
