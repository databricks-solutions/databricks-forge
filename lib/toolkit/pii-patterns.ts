/**
 * Shared PII / sensitive column detection patterns.
 *
 * Used by the Genie assembler to enable format_assistance for sensitive columns,
 * and by example query generation to avoid exposing PII in sample queries.
 */

export const PII_COLUMN_PATTERN =
  /(email|phone|ssn|social_security|tax_id|dob|birth|address|passport|driver_?license|national_id|medicare)/i;

/**
 * Columns where `enable_format_assistance` should be turned on because users
 * are likely to reference them by display label rather than stored value
 * (e.g. day_of_week, month_name, quarter, status, category, segment, type).
 */
export const FORMAT_ASSISTANCE_PATTERN =
  /(day_of_week|weekday|month_name|quarter|status|category|segment|type|level|stage|tier|gender|channel|preference|classification|priority|severity|flag$)/i;

export function isPiiColumn(columnName: string): boolean {
  return PII_COLUMN_PATTERN.test(columnName);
}

export function isFormatAssistanceCandidate(columnName: string): boolean {
  return FORMAT_ASSISTANCE_PATTERN.test(columnName);
}
