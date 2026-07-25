import type { MetricViewDefinition, MetricViewDimension } from "./definition";

const AGGREGATE_FUNCTIONS = new Set([
  "avg",
  "collect_list",
  "collect_set",
  "count",
  "max",
  "min",
  "percentile",
  "percentile_approx",
  "sum",
]);

function calledFunctions(expression: string): string[] {
  const functions: string[] = [];
  let state: "normal" | "single" | "double" | "backtick" | "line-comment" | "block-comment" =
    "normal";

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];
    if (state === "line-comment") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    if (state !== "normal") {
      const delimiter = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === delimiter) {
        if (next === delimiter) index += 1;
        else state = "normal";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      state = char === "'" ? "single" : char === '"' ? "double" : "backtick";
      continue;
    }
    if (!/[A-Za-z_]/.test(char)) continue;

    let end = index + 1;
    while (end < expression.length && /[A-Za-z0-9_]/.test(expression[end])) end += 1;
    let cursor = end;
    while (cursor < expression.length && /\s/.test(expression[cursor])) cursor += 1;
    if (expression[cursor] === "(") functions.push(expression.slice(index, end).toLowerCase());
    index = end - 1;
  }

  return functions;
}

export function isAggregateDimension(dimension: MetricViewDimension): boolean {
  return calledFunctions(dimension.expr).some((name) => AGGREGATE_FUNCTIONS.has(name));
}

export type MetricViewNormalizationResult =
  | {
      ok: true;
      definition: MetricViewDefinition;
      removedAggregateDimensions: string[];
    }
  | {
      ok: false;
      invalidAggregateDimensions: string[];
      reason: "no_scalar_dimensions" | "no_measures";
    };

export function normalizeMetricViewDefinition(
  definition: MetricViewDefinition,
): MetricViewNormalizationResult {
  const invalid = definition.dimensions.filter(isAggregateDimension);
  if (invalid.length === 0) {
    return { ok: true, definition, removedAggregateDimensions: [] };
  }

  const scalarDimensions = definition.dimensions.filter((dimension) => !isAggregateDimension(dimension));
  if (definition.measures.length === 0) {
    return {
      ok: false,
      invalidAggregateDimensions: invalid.map((dimension) => dimension.name),
      reason: "no_measures",
    };
  }
  if (scalarDimensions.length === 0) {
    return {
      ok: false,
      invalidAggregateDimensions: invalid.map((dimension) => dimension.name),
      reason: "no_scalar_dimensions",
    };
  }

  return {
    ok: true,
    definition: { ...definition, dimensions: scalarDimensions },
    removedAggregateDimensions: invalid.map((dimension) => dimension.name),
  };
}
