/**
 * Shared auth-error detection for Lakebase (Postgres) connections.
 *
 * Used by lib/prisma.ts for the withPrisma retry wrapper and by
 * engine-status.ts for error classification in the frontend.
 */

export const AUTH_ERROR_PATTERNS = [
  "authentication failed",
  "password authentication failed",
  "provided database credentials",
  "not valid",
  "FATAL:  password",
] as const;

export const RATE_LIMIT_ERROR_PATTERNS = [
  "connection attempt rate limit exceeded",
  "too many requests",
  "request limit exceeded",
  "rate limit",
  "too many connections",
  "remaining connection slots are reserved",
] as const;

export const CREDENTIAL_PROPAGATION_PATTERNS = [
  "password authentication failed",
  "provided database credentials",
  "not valid",
] as const;

export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = msg.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = msg.toLowerCase();
  return RATE_LIMIT_ERROR_PATTERNS.some((p) => lower.includes(p));
}

export function isCredentialPropagationError(err: unknown): boolean {
  if (!isAuthError(err)) return false;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = msg.toLowerCase();
  return CREDENTIAL_PROPAGATION_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Check if an error message string looks like a DB auth failure.
 * Convenience overload for contexts that only have the message string.
 */
export function isAuthErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}

export function isRateLimitErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return RATE_LIMIT_ERROR_PATTERNS.some((p) => lower.includes(p));
}
