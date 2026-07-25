export const DASHBOARD_DATE_TRUNC_UNITS = [
  "YEAR",
  "QUARTER",
  "MONTH",
  "WEEK",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
] as const;

const DATE_TRUNC_UNIT_SET = new Set<string>(DASHBOARD_DATE_TRUNC_UNITS);

export function isSupportedDateTruncUnit(unit: string): boolean {
  return DATE_TRUNC_UNIT_SET.has(unit.trim().toUpperCase());
}

export interface WidgetExpressionClassification {
  kind: "identifier" | "aggregate" | "date_trunc";
  sourceIdentifier: string | null;
  dateTruncUnit?: (typeof DASHBOARD_DATE_TRUNC_UNITS)[number];
}

function directIdentifier(expression: string): string | null {
  const quoted = /^`((?:``|[^`])+)`$/.exec(expression);
  if (quoted) return quoted[1].replace(/``/g, "`");
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(expression) ? expression : null;
}

export function classifyWidgetExpression(
  expression: string,
): WidgetExpressionClassification | null {
  const trimmed = expression.trim();
  const identifier = directIdentifier(trimmed);
  if (identifier !== null) {
    return { kind: "identifier", sourceIdentifier: identifier };
  }

  const dateTrunc =
    /^DATE_TRUNC\s*\(\s*(?:"((?:""|[^"])*)"|'((?:''|[^'])*)')\s*,\s*(.*?)\s*\)$/i.exec(trimmed);
  if (dateTrunc) {
    const unit = (dateTrunc[1]?.replace(/""/g, '"') ?? dateTrunc[2].replace(/''/g, "'"))
      .trim()
      .toUpperCase();
    const sourceIdentifier = directIdentifier(dateTrunc[3]);
    if (!isSupportedDateTruncUnit(unit) || sourceIdentifier === null) return null;
    return {
      kind: "date_trunc",
      sourceIdentifier,
      dateTruncUnit: unit as WidgetExpressionClassification["dateTruncUnit"],
    };
  }

  const aggregate = /^(SUM|AVG|MIN|MAX|COUNT)\s*\(\s*(.*?)\s*\)$/i.exec(trimmed);
  if (!aggregate) return null;
  if (aggregate[2] === "*") {
    return aggregate[1].toUpperCase() === "COUNT"
      ? { kind: "aggregate", sourceIdentifier: null }
      : null;
  }
  const sourceIdentifier = directIdentifier(aggregate[2]);
  return sourceIdentifier === null ? null : { kind: "aggregate", sourceIdentifier };
}
