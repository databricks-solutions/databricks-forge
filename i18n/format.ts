"use client";

import { useFormatter, useLocale } from "next-intl";
import { useMemo } from "react";

/**
 * Hook bundle for common locale-aware formatting.
 * Use these in client components instead of toLocaleString / date-fns
 * with hardcoded locales.
 */
export function useL10n() {
  const formatter = useFormatter();
  const locale = useLocale();

  return useMemo(() => {
    const toDate = (value: Date | string | number) =>
      value instanceof Date ? value : new Date(value);

    return {
      locale,
      /** Short date (e.g., 07/05/2026 in pt-BR, 5/7/2026 in en). */
      date: (value: Date | string | number) =>
        formatter.dateTime(toDate(value), "short"),
      /** Date + time (e.g., 07 mai 2026, 14:32). */
      dateTime: (value: Date | string | number) =>
        formatter.dateTime(toDate(value), "medium"),
      /** Relative time (e.g., "há 2 horas"). */
      relative: (value: Date | string | number) =>
        formatter.relativeTime(toDate(value)),
      /** Decimal number with up to 2 fraction digits. */
      number: (value: number) => formatter.number(value, "precise"),
      /** Integer with grouping separators. */
      integer: (value: number) =>
        formatter.number(value, { maximumFractionDigits: 0 }),
      /** Percentage (input is fraction, e.g. 0.234 → "23,4%"). */
      percent: (value: number) => formatter.number(value, "percent"),
      /** Raw formatter for advanced use cases. */
      formatter,
    };
  }, [formatter, locale]);
}
