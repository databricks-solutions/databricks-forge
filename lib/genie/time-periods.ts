/**
 * Time Period Generator — auto-generates standard date filters and
 * dimensions for Genie spaces.
 *
 * For every date/timestamp column in a domain's tables, this module
 * produces standard financial reporting filters (Last 7 Days, MTD, QTD,
 * YTD, etc.) and dimensions (Month, Quarter, Year, etc.) with
 * configurable fiscal year support.
 */

import type { ColumnInfo } from "@/lib/domain/types";
import type { EnrichedSqlSnippetFilter, EnrichedSqlSnippetDimension } from "./types";

const DATE_TYPE_PATTERN = /^(date|timestamp|datetime)/i;

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface TimePeriodOptions {
  fiscalYearStartMonth: number;
  targetDateColumns?: string[];
  /** Max date columns to generate time periods for (default: 6). */
  maxDateColumns?: number;
}

interface TimePeriodResult {
  filters: EnrichedSqlSnippetFilter[];
  dimensions: EnrichedSqlSnippetDimension[];
}

/**
 * Detect date/timestamp columns in the given tables and generate standard
 * time-period filters and dimensions.
 */
export function generateTimePeriods(
  columns: ColumnInfo[],
  tableFqns: string[],
  options: TimePeriodOptions,
): TimePeriodResult {
  const fiscalYearStartMonth = Math.max(1, Math.min(12, options.fiscalYearStartMonth));
  const { targetDateColumns } = options;
  const tableSet = new Set(tableFqns.map((f) => f.toLowerCase()));
  const filters: EnrichedSqlSnippetFilter[] = [];
  const dimensions: EnrichedSqlSnippetDimension[] = [];

  const targetColSet =
    targetDateColumns && targetDateColumns.length > 0
      ? new Set(targetDateColumns.map((c) => c.toLowerCase()))
      : null;

  const maxCols = options.maxDateColumns ?? 6;

  const allDateColumns = columns.filter((c) => {
    if (!tableSet.has(c.tableFqn.toLowerCase())) return false;
    if (!DATE_TYPE_PATTERN.test(c.dataType)) return false;
    if (targetColSet) {
      const key = `${c.tableFqn.toLowerCase()}.${c.columnName.toLowerCase()}`;
      return targetColSet.has(key) || targetColSet.has(c.columnName.toLowerCase());
    }
    return true;
  });

  const dateColumns = targetColSet
    ? allDateColumns
    : prioritizeDateColumns(allDateColumns).slice(0, maxCols);

  for (const col of dateColumns) {
    const tbl = col.tableFqn;
    const colRef = `${tbl}.${quoteIdent(col.columnName)}`;
    const label = humanize(col.columnName);

    filters.push(...generateFiltersForColumn(colRef, label, fiscalYearStartMonth));
    dimensions.push(...generateDimensionsForColumn(colRef, label, fiscalYearStartMonth));
  }

  return { filters, dimensions };
}

const PRIMARY_DATE_PATTERNS = [
  /^(created|updated|modified|inserted|loaded)[-_]?(at|on|date|time|ts)?$/i,
  /^(order|transaction|invoice|event|start|end|ship|delivery|payment|effective)[-_]?date$/i,
  /^date$/i,
  /^timestamp$/i,
];

function dateColumnPriority(colName: string): number {
  const lower = colName.toLowerCase();
  for (let i = 0; i < PRIMARY_DATE_PATTERNS.length; i++) {
    if (PRIMARY_DATE_PATTERNS[i].test(lower)) return i;
  }
  return PRIMARY_DATE_PATTERNS.length;
}

function prioritizeDateColumns(cols: ColumnInfo[]): ColumnInfo[] {
  const seen = new Set<string>();
  const unique: ColumnInfo[] = [];
  for (const c of cols) {
    const key = `${c.tableFqn.toLowerCase()}.${c.columnName.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  return unique.sort((a, b) => dateColumnPriority(a.columnName) - dateColumnPriority(b.columnName));
}

function generateFiltersForColumn(
  colRef: string,
  label: string,
  fiscalStart: number,
): EnrichedSqlSnippetFilter[] {
  const fyStartName = MONTH_NAMES[fiscalStart];

  return [
    {
      name: `${label} Last 7 Days`,
      sql: `${colRef} >= DATE_ADD(CURRENT_DATE(), -7)`,
      synonyms: ["last week", "past 7 days", "this week"],
      instructions: `Filters to the last 7 calendar days based on ${label}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Last 30 Days`,
      sql: `${colRef} >= DATE_ADD(CURRENT_DATE(), -30)`,
      synonyms: ["last month", "past 30 days", "past month"],
      instructions: `Filters to the last 30 calendar days based on ${label}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Last 90 Days`,
      sql: `${colRef} >= DATE_ADD(CURRENT_DATE(), -90)`,
      synonyms: ["last quarter", "past 90 days", "past 3 months"],
      instructions: `Filters to the last 90 calendar days based on ${label}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Month to Date`,
      sql: `${colRef} >= DATE_TRUNC('MONTH', CURRENT_DATE())`,
      synonyms: ["MTD", "this month", "current month"],
      instructions: `Filters from the start of the current calendar month to today based on ${label}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Quarter to Date`,
      sql:
        fiscalStart === 1
          ? `${colRef} >= DATE_TRUNC('QUARTER', CURRENT_DATE())`
          : buildFiscalQtdFilter(colRef, fiscalStart),
      synonyms: ["QTD", "this quarter", "current quarter"],
      instructions: `Filters from the start of the current fiscal quarter to today. Fiscal year starts in ${fyStartName}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Year to Date`,
      sql: buildFiscalYtdFilter(colRef, fiscalStart),
      synonyms: ["YTD", "this year", "current year"],
      instructions: `Filters from the start of the current fiscal year to today. Fiscal year starts in ${fyStartName}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Last Fiscal Year`,
      sql: buildLastFiscalYearFilter(colRef, fiscalStart),
      synonyms: ["last year", "previous year", "prior year", "LFY"],
      instructions: `Filters to the previous complete fiscal year. Fiscal year starts in ${fyStartName}.`,
      isTimePeriod: true,
    },
  ];
}

function generateDimensionsForColumn(
  colRef: string,
  label: string,
  fiscalStart: number,
): EnrichedSqlSnippetDimension[] {
  const fyStartName = MONTH_NAMES[fiscalStart];

  return [
    {
      name: `${label} Month`,
      sql: `DATE_TRUNC('MONTH', ${colRef})`,
      synonyms: ["monthly", "by month"],
      instructions: `Groups data by calendar month of ${label}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Quarter`,
      sql:
        fiscalStart === 1
          ? `DATE_TRUNC('QUARTER', ${colRef})`
          : buildFiscalQuarterDimension(colRef, fiscalStart),
      synonyms: ["quarterly", "by quarter", "Q1", "Q2", "Q3", "Q4"],
      instructions: `Groups data by fiscal quarter. Fiscal year starts in ${fyStartName}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Year`,
      sql: fiscalStart === 1 ? `YEAR(${colRef})` : buildFiscalYearDimension(colRef, fiscalStart),
      synonyms: ["yearly", "annual", "by year"],
      instructions: `Groups data by fiscal year. Fiscal year starts in ${fyStartName}.`,
      isTimePeriod: true,
    },
    {
      name: `${label} Day of Week`,
      sql: `DAYOFWEEK(${colRef})`,
      synonyms: ["weekday", "day name", "by day"],
      instructions: `Groups data by the day of the week (1=Sunday, 7=Saturday) of ${label}.`,
      isTimePeriod: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Fiscal year SQL builders
// ---------------------------------------------------------------------------

function buildFiscalYtdFilter(colRef: string, fiscalStart: number): string {
  if (fiscalStart === 1) {
    return `${colRef} >= DATE_TRUNC('YEAR', CURRENT_DATE())`;
  }
  return `${colRef} >= MAKE_DATE(YEAR(CURRENT_DATE()) - (CASE WHEN MONTH(CURRENT_DATE()) < ${fiscalStart} THEN 1 ELSE 0 END), ${fiscalStart}, 1)`;
}

function buildFiscalQtdFilter(colRef: string, fiscalStart: number): string {
  // Fiscal quarter start depends on the fiscal year start month
  // Fiscal quarters are 3-month blocks starting from fiscalStart
  return `${colRef} >= (
    MAKE_DATE(
      YEAR(CURRENT_DATE()) - (CASE WHEN MONTH(CURRENT_DATE()) < ${fiscalStart} THEN 1 ELSE 0 END),
      ${fiscalStart} + FLOOR((MONTH(CURRENT_DATE()) - ${fiscalStart} + (CASE WHEN MONTH(CURRENT_DATE()) < ${fiscalStart} THEN 12 ELSE 0 END)) / 3) * 3,
      1
    )
  )`;
}

function buildLastFiscalYearFilter(colRef: string, fiscalStart: number): string {
  if (fiscalStart === 1) {
    return `YEAR(${colRef}) = YEAR(CURRENT_DATE()) - 1`;
  }
  return `${colRef} >= MAKE_DATE(YEAR(CURRENT_DATE()) - (CASE WHEN MONTH(CURRENT_DATE()) < ${fiscalStart} THEN 2 ELSE 1 END), ${fiscalStart}, 1) AND ${colRef} < MAKE_DATE(YEAR(CURRENT_DATE()) - (CASE WHEN MONTH(CURRENT_DATE()) < ${fiscalStart} THEN 1 ELSE 0 END), ${fiscalStart}, 1)`;
}

function buildFiscalQuarterDimension(colRef: string, fiscalStart: number): string {
  return `CONCAT('FQ', FLOOR((MONTH(${colRef}) - ${fiscalStart} + (CASE WHEN MONTH(${colRef}) < ${fiscalStart} THEN 12 ELSE 0 END)) / 3) + 1)`;
}

function buildFiscalYearDimension(colRef: string, fiscalStart: number): string {
  return `YEAR(${colRef}) + (CASE WHEN MONTH(${colRef}) >= ${fiscalStart} THEN ${fiscalStart === 1 ? 0 : 1} ELSE 0 END)`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Backtick-quote an identifier if it contains non-word characters (spaces, parens, etc.). */
function quoteIdent(name: string): string {
  return /^\w+$/.test(name) ? name : `\`${name}\``;
}

function humanize(columnName: string): string {
  return columnName
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
