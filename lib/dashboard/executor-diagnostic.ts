import { sanitizeBoundedDiagnostic } from "@/lib/logging/bounded-diagnostic";
import { safeErrorMetadata } from "@/lib/logging/safe-error-metadata";

export interface SafeSqlExecutorDiagnostic {
  errorCategory: ReturnType<typeof safeErrorMetadata>["errorCategory"];
  errorCode?: string;
  message: string;
}

export function safeSqlExecutorDiagnostic(error: unknown): SafeSqlExecutorDiagnostic {
  const metadata = safeErrorMetadata(error, "SQL executor failed.");
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeBoundedDiagnostic(rawMessage) ?? metadata.safeSummary;
  return {
    errorCategory: metadata.errorCategory,
    ...(metadata.code ? { errorCode: metadata.code } : {}),
    message,
  };
}

export function formatSqlExecutorDiagnostic(diagnostic: SafeSqlExecutorDiagnostic): string {
  const identity = diagnostic.errorCode
    ? `${diagnostic.errorCategory}/${diagnostic.errorCode}`
    : diagnostic.errorCategory;
  return `${identity}: ${diagnostic.message}`;
}

const REPAIRABLE_SQL_DIAGNOSTIC =
  /\b(?:AMBIGUOUS_REFERENCE|UNRESOLVED_COLUMN(?:_WITH_SUGGESTION)?|UNRESOLVED_FIELD)\b/i;

export function isRepairableSqlExecutorDiagnostic(
  diagnostic: SafeSqlExecutorDiagnostic | undefined,
): diagnostic is SafeSqlExecutorDiagnostic {
  if (!diagnostic) return false;
  return REPAIRABLE_SQL_DIAGNOSTIC.test(`${diagnostic.errorCode ?? ""} ${diagnostic.message}`);
}
