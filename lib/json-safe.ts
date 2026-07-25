/**
 * BigInt-safe JSON serialization.
 *
 * Prisma returns BigInt for PostgreSQL `bigint` columns, but
 * JSON.stringify() cannot handle BigInt values. This utility
 * recursively converts BigInt values to numbers (if within safe
 * integer range) or strings (if too large).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSafe<T>(value: T): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = toJsonSafe(v);
    }
    return result;
  }
  return value;
}
