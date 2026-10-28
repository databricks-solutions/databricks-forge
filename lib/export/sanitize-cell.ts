/**
 * Spreadsheet formula-injection sanitization for CSV and Excel exports.
 *
 * Leading `=`, `+`, `-`, `@`, `\t`, or `\r` characters in string cells can
 * be interpreted as executable formulas (`=cmd|' /C calc'!A0`, `@SUM(...)`)
 * when opened in Excel or Google Sheets. Prefixing string cells with `'`
 * neutralizes formula execution while keeping numeric cells (`number`) intact.
 */

const FORMULA_LEAD_RE = /^[=+\-@\t\r]/;

export function sanitizeSpreadsheetString(value: string): string {
  if (!value) return value;
  if (FORMULA_LEAD_RE.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function sanitizeSpreadsheetRow<T>(row: T): T {
  if (typeof row === "string") {
    return sanitizeSpreadsheetString(row) as unknown as T;
  }
  if (Array.isArray(row)) {
    return row.map((v) =>
      typeof v === "string" ? sanitizeSpreadsheetString(v) : v,
    ) as unknown as T;
  }
  if (row && typeof row === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? sanitizeSpreadsheetString(v) : v;
    }
    return out as T;
  }
  return row;
}
