import { sanitizeBoundedDiagnostic } from "@/lib/logging/bounded-diagnostic";

export const DASHBOARD_OBO_SCOPE_UNSUPPORTED = "DASHBOARD_OBO_SCOPE_UNSUPPORTED";
export type DashboardAuthMode = "user" | "app";

export class DashboardScopeUnsupportedError extends Error {
  readonly code = DASHBOARD_OBO_SCOPE_UNSUPPORTED;
  readonly status = 403;
  readonly requiredScope = "dashboards";

  constructor(readonly operation: string) {
    super(
      "Lakeview user authorization is unavailable because Databricks Apps does not issue the required dashboards scope.",
    );
    this.name = "DashboardScopeUnsupportedError";
  }
}

const TRUSTED_DIAGNOSTIC_CODES = new Set([
  "BAD_REQUEST",
  "INTERNAL_ERROR",
  "INVALID_PARAMETER_VALUE",
  "PERMISSION_DENIED",
  "RESOURCE_ALREADY_EXISTS",
  "RESOURCE_DOES_NOT_EXIST",
  "TEMPORARILY_UNAVAILABLE",
  "TOO_MANY_REQUESTS",
  "UNAUTHENTICATED",
]);

export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    readonly diagnosticCode?: string,
    readonly diagnosticMessage?: string,
  ) {
    super(
      `Lakeview ${operation} failed (${status})${
        diagnosticMessage ? `: ${diagnosticMessage}` : ""
      }`,
    );
    this.name = "DashboardApiError";
  }
}

export function isDashboardScopeUnsupportedError(
  error: unknown,
): error is DashboardScopeUnsupportedError {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === DASHBOARD_OBO_SCOPE_UNSUPPORTED
  );
}

function parseDiagnostic(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      code: typeof parsed.error_code === "string" ? parsed.error_code : undefined,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
    };
  } catch {
    return { message: body };
  }
}

function hasExactMissingDashboardScope(message: string | undefined): boolean {
  if (!message) return false;
  const match = message.match(
    /\b(?:missing|required)\b[^.\n]{0,80}\bscope\s*:?\s*["']?(dashboards(?:\.genie)?)["']?(?=$|[\s,;}])/i,
  );
  return match?.[1].toLowerCase() === "dashboards";
}

export function dashboardApiError(
  status: number,
  body: string,
  operation: string,
  authMode: DashboardAuthMode = "user",
): Error {
  const diagnostic = parseDiagnostic(body);
  const missingDashboardScope =
    authMode === "user" && status === 403 && hasExactMissingDashboardScope(diagnostic.message);
  const diagnosticCode =
    diagnostic.code && TRUSTED_DIAGNOSTIC_CODES.has(diagnostic.code) ? diagnostic.code : undefined;
  const diagnosticMessage = sanitizeBoundedDiagnostic(diagnostic.message);
  return missingDashboardScope
    ? new DashboardScopeUnsupportedError(operation)
    : new DashboardApiError(status, operation, diagnosticCode, diagnosticMessage);
}
