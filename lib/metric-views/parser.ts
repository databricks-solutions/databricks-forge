import { parse } from "yaml";
import { validateFqn, validateIdentifier } from "@/lib/validation";
import { assertMetricViewCapabilities } from "./capabilities";
import type {
  MetricViewDefinition,
  MetricViewDimension,
  MetricViewFeature,
  MetricViewFormat,
  MetricViewJoin,
  MetricViewMaterialization,
  MetricViewMeasure,
  MetricViewSchedule,
  MetricViewSpecVersion,
  MetricViewWindowDefinition,
  MetricViewWindowRange,
} from "./definition";

export interface MetricViewParseIssue {
  path: string;
  code: string;
  message: string;
}

export class MetricViewParseError extends Error {
  constructor(readonly issues: MetricViewParseIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "MetricViewParseError";
  }
}

type UnknownRecord = Record<string, unknown>;

const FEATURE_ORDER: readonly MetricViewFeature[] = [
  "joins",
  "nested_joins",
  "window_measures",
  "filtered_measures",
  "materialization",
  "source_query",
];

const QUERY_SOURCE_RE = /^(?:SELECT|WITH)\b/i;
const WINDOW_RANGE_RE =
  /^(?:cumulative|current|all|(?:trailing|leading) \d+ (?:day|week|month|quarter|year))$/;
const FORMAT_RE = /^(?:percent|currency|number|decimal\(\d+\))$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: MetricViewParseIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

export function normalizeThreePartFqn(value: string): string | null {
  const input = value.trim();
  const segments: string[] = [];
  let segment = "";
  let quoted = false;
  let quoteClosed = false;

  for (const char of input) {
    if (char === "`") {
      if (quoted) {
        quoted = false;
        quoteClosed = true;
        segment += char;
      } else {
        if (segment.length > 0 || quoteClosed) return null;
        quoted = true;
        segment += char;
      }
      continue;
    }
    if (char === "." && !quoted) {
      if (!segment) return null;
      segments.push(segment);
      segment = "";
      quoteClosed = false;
      continue;
    }
    if (quoteClosed) return null;
    segment += char;
  }

  if (quoted || !segment) return null;
  segments.push(segment);
  if (segments.length !== 3) return null;

  try {
    const unquoted = segments.map((part, index) => {
      let identifier: string;
      if (part.startsWith("`")) {
        if (!part.endsWith("`") || part.length < 3) throw new Error("Invalid quoting");
        identifier = part.slice(1, -1);
        if (identifier.includes("`")) throw new Error("Invalid quoting");
      } else {
        if (part.includes("`")) throw new Error("Invalid quoting");
        identifier = part;
      }
      return validateIdentifier(identifier, `metric view source segment ${index + 1}`);
    });
    const normalized = unquoted.join(".");
    const validated = validateFqn(normalized, "metric view source");
    return validated.split(".").length === 3 ? validated : null;
  } catch {
    return null;
  }
}

function requiredString(value: unknown, path: string, issues: MetricViewParseIssue[]): string {
  if (value === undefined || value === null) {
    addIssue(issues, path, "FIELD_REQUIRED", "Field is required.");
    return "";
  }
  if (typeof value !== "string") {
    addIssue(issues, path, "TYPE_INVALID", "Expected a string.");
    return "";
  }
  const normalized = value.trim();
  if (!normalized) {
    addIssue(issues, path, "VALUE_INVALID", "Value must not be empty.");
  }
  return normalized;
}

function optionalString(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    addIssue(issues, path, "TYPE_INVALID", "Expected a string.");
    return undefined;
  }
  return value.trim();
}

function stringArray(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
  required = false,
): string[] {
  if (value === undefined) {
    if (required) addIssue(issues, path, "FIELD_REQUIRED", "Field is required.");
    return [];
  }
  if (!Array.isArray(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected a list of strings.");
    return [];
  }
  return value.map((entry, index) => requiredString(entry, `${path}.${index}`, issues));
}

function semanticMetadata(
  raw: UnknownRecord,
  path: string,
  issues: MetricViewParseIssue[],
): {
  name: string;
  comment?: string;
  displayName?: string;
  synonyms?: string[];
} {
  const comment = optionalString(raw.comment, `${path}.comment`, issues);
  const displayName = optionalString(raw.display_name, `${path}.display_name`, issues);
  const synonyms =
    raw.synonyms === undefined ? undefined : stringArray(raw.synonyms, `${path}.synonyms`, issues);
  return {
    name: requiredString(raw.name, `${path}.name`, issues),
    ...(comment !== undefined ? { comment } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(synonyms !== undefined ? { synonyms } : {}),
  };
}

function parseJoin(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
): MetricViewJoin | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected a join object.");
    return null;
  }

  const name = requiredString(value.name, `${path}.name`, issues);
  const source = requiredString(value.source, `${path}.source`, issues);
  const normalizedSource = source ? normalizeThreePartFqn(source) : null;
  if (source && !normalizedSource) {
    addIssue(
      issues,
      `${path}.source`,
      "SOURCE_INVALID",
      "Join source must be a fully qualified three-part table or view name.",
    );
  }
  const nestedRaw = value.joins;
  const joins: MetricViewJoin[] = [];
  if (nestedRaw !== undefined) {
    if (!Array.isArray(nestedRaw)) {
      addIssue(issues, `${path}.joins`, "TYPE_INVALID", "Expected a list of joins.");
    } else {
      nestedRaw.forEach((entry, index) => {
        const join = parseJoin(entry, `${path}.joins.${index}`, issues);
        if (join) joins.push(join);
      });
    }
  }

  const hasOn = value.on !== undefined;
  const hasUsing = value.using !== undefined;
  if (hasOn === hasUsing) {
    addIssue(
      issues,
      path,
      "JOIN_CONDITION_INVALID",
      'A join must define exactly one of "on" or "using".',
    );
    return null;
  }

  if (hasOn) {
    return {
      kind: "on",
      name,
      source: normalizedSource ?? source,
      on: requiredString(value.on, `${path}.on`, issues),
      joins,
    };
  }
  return {
    kind: "using",
    name,
    source: normalizedSource ?? source,
    using: stringArray(value.using, `${path}.using`, issues, true),
    joins,
  };
}

function collectJoinPaths(joins: MetricViewJoin[], parent: string[] = []): string[][] {
  return joins.flatMap((join) => {
    const path = [...parent, join.name];
    return [path, ...collectJoinPaths(join.joins, path)];
  });
}

function inferJoinPath(expr: string, joinPaths: string[][]): string[] | null {
  const candidates = [...joinPaths].sort((left, right) => right.length - left.length);
  return (
    candidates.find((path) => {
      const reference = path.join(".");
      return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(reference)}\\.`).test(expr);
    }) ?? null
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDimension(
  value: unknown,
  path: string,
  joinPaths: string[][],
  issues: MetricViewParseIssue[],
): MetricViewDimension | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected a dimension object.");
    return null;
  }
  const metadata = semanticMetadata(value, path, issues);
  const expr = requiredString(value.expr, `${path}.expr`, issues);
  const joinPath = inferJoinPath(expr, joinPaths);
  return joinPath
    ? { kind: "joined", ...metadata, expr, joinPath }
    : { kind: "local", ...metadata, expr };
}

function splitTopLevelRatio(expr: string): [string, string] | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index];
    if (quote) {
      if (char === quote && expr[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "/" && depth === 0) {
      const numerator = expr.slice(0, index).trim();
      const denominator = expr.slice(index + 1).trim();
      return numerator && denominator ? [numerator, denominator] : null;
    }
  }
  return null;
}

function stripEnclosingParentheses(expr: string): string {
  let normalized = expr.trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    let depth = 0;
    let quote: "'" | '"' | "`" | null = null;
    let enclosesWholeExpression = true;
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      if (quote) {
        if (char === quote && normalized[index - 1] !== "\\") quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0 && index < normalized.length - 1) {
          enclosesWholeExpression = false;
          break;
        }
      }
    }
    if (!enclosesWholeExpression || depth !== 0) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function parseWindow(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
): MetricViewWindowDefinition[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected a list of window definitions.");
    return [];
  }
  if (value.length === 0) {
    addIssue(issues, path, "VALUE_INVALID", "Window definitions must not be empty.");
  }
  return value.flatMap((entry, index) => {
    const entryPath = `${path}.${index}`;
    if (!isRecord(entry)) {
      addIssue(issues, entryPath, "TYPE_INVALID", "Expected a window object.");
      return [];
    }
    const order = requiredString(entry.order, `${entryPath}.order`, issues);
    const range = requiredString(entry.range, `${entryPath}.range`, issues);
    if (range && !WINDOW_RANGE_RE.test(range)) {
      addIssue(
        issues,
        `${entryPath}.range`,
        "VALUE_INVALID",
        `Unsupported window range "${range}".`,
      );
    }
    const semiadditive = optionalString(entry.semiadditive, `${entryPath}.semiadditive`, issues);
    if (semiadditive !== undefined && semiadditive !== "first" && semiadditive !== "last") {
      addIssue(
        issues,
        `${entryPath}.semiadditive`,
        "VALUE_INVALID",
        `Unsupported semiadditive value "${semiadditive}".`,
      );
    }
    return [
      {
        order,
        range: range as MetricViewWindowRange,
        ...(semiadditive === "first" || semiadditive === "last" ? { semiadditive } : {}),
      },
    ];
  });
}

function parseMeasure(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
): MetricViewMeasure | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected a measure object.");
    return null;
  }
  const metadata = semanticMetadata(value, path, issues);
  const expr = requiredString(value.expr, `${path}.expr`, issues);
  const rawFormat = optionalString(value.format, `${path}.format`, issues);
  if (rawFormat !== undefined && !FORMAT_RE.test(rawFormat)) {
    addIssue(issues, `${path}.format`, "VALUE_INVALID", `Unsupported format "${rawFormat}".`);
  }
  const base = {
    ...metadata,
    ...(rawFormat !== undefined && FORMAT_RE.test(rawFormat)
      ? { format: rawFormat as MetricViewFormat }
      : {}),
  };

  if (value.window !== undefined) {
    return {
      kind: "window",
      ...base,
      expr,
      window: parseWindow(value.window, `${path}.window`, issues),
    };
  }

  const classificationExpr = stripEnclosingParentheses(expr);
  const ratio = splitTopLevelRatio(classificationExpr);
  if (ratio) {
    return {
      kind: "ratio",
      ...base,
      numerator: ratio[0],
      denominator: ratio[1],
    };
  }

  const filtered = classificationExpr.match(/^([\s\S]+?)\s+FILTER\s*\(\s*WHERE\s+([\s\S]+)\)$/i);
  if (filtered) {
    return {
      kind: "filtered",
      ...base,
      expr: filtered[1].trim(),
      filter: filtered[2].trim(),
    };
  }

  return { kind: "expression", ...base, expr };
}

function parseSchedule(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
): MetricViewSchedule {
  if (value === undefined || value === null) {
    addIssue(issues, path, "FIELD_REQUIRED", "Field is required.");
    return { kind: "interval", interval: "" };
  }
  if (typeof value === "string") {
    return { kind: "interval", interval: requiredString(value, path, issues) };
  }
  if (!isRecord(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected an interval string or cron object.");
    return { kind: "interval", interval: "" };
  }
  const quartzCron = requiredString(value.quartz_cron, `${path}.quartz_cron`, issues);
  const timezone = optionalString(value.timezone, `${path}.timezone`, issues);
  return {
    kind: "cron",
    quartzCron,
    ...(timezone !== undefined ? { timezone } : {}),
  };
}

function parseMaterialization(
  value: unknown,
  path: string,
  issues: MetricViewParseIssue[],
): MetricViewMaterialization | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "TYPE_INVALID", "Expected a materialization object.");
    return undefined;
  }
  const schedule = parseSchedule(value.schedule, `${path}.schedule`, issues);
  const mode = optionalString(value.mode, `${path}.mode`, issues);
  if (mode !== undefined && mode !== "relaxed" && mode !== "strict") {
    addIssue(issues, `${path}.mode`, "VALUE_INVALID", `Unsupported mode "${mode}".`);
  }

  const rawViews = value.materialized_views;
  const materializedViews: MetricViewMaterialization["materializedViews"] = [];
  if (!Array.isArray(rawViews)) {
    addIssue(
      issues,
      `${path}.materialized_views`,
      rawViews === undefined ? "FIELD_REQUIRED" : "TYPE_INVALID",
      "Expected a list of materialized views.",
    );
  } else {
    rawViews.forEach((entry, index) => {
      const entryPath = `${path}.materialized_views.${index}`;
      if (!isRecord(entry)) {
        addIssue(issues, entryPath, "TYPE_INVALID", "Expected a materialized view object.");
        return;
      }
      const name = requiredString(entry.name, `${entryPath}.name`, issues);
      const type = requiredString(entry.type, `${entryPath}.type`, issues);
      if (type === "unaggregated") {
        materializedViews.push({ kind: "unaggregated", name });
      } else if (type === "aggregated") {
        materializedViews.push({
          kind: "aggregated",
          name,
          dimensions: stringArray(entry.dimensions, `${entryPath}.dimensions`, issues, true),
          measures: stringArray(entry.measures, `${entryPath}.measures`, issues, true),
        });
      } else if (type) {
        addIssue(
          issues,
          `${entryPath}.type`,
          "VALUE_INVALID",
          `Unsupported materialized view type "${type}".`,
        );
      }
    });
  }
  return {
    schedule,
    ...(mode === "relaxed" || mode === "strict" ? { mode } : {}),
    materializedViews,
  };
}

function reportDuplicateNames(
  entries: Array<{ name: string }>,
  path: string,
  issues: MetricViewParseIssue[],
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const normalized = entry.name.toLocaleLowerCase();
    if (seen.has(normalized)) {
      addIssue(
        issues,
        `${path}.${index}.name`,
        "NAME_DUPLICATE",
        `Duplicate semantic name "${entry.name}".`,
      );
    }
    seen.add(normalized);
  });
}

function inferRequiredFeatures(
  definition: Omit<MetricViewDefinition, "requiredFeatures">,
): MetricViewFeature[] {
  const inferred = new Set<MetricViewFeature>();
  if (definition.joins.length > 0) inferred.add("joins");
  if (definition.joins.some(hasNestedJoin)) inferred.add("nested_joins");
  if (definition.measures.some((measure) => measure.kind === "window")) {
    inferred.add("window_measures");
  }
  if (
    definition.measures.some(
      (measure) =>
        measure.kind === "filtered" ||
        (measure.kind === "ratio" &&
          /\bFILTER\s*\(\s*WHERE\b/i.test(`${measure.numerator} ${measure.denominator}`)),
    )
  ) {
    inferred.add("filtered_measures");
  }
  if (definition.materialization) inferred.add("materialization");
  if (definition.source.kind === "query") inferred.add("source_query");
  return FEATURE_ORDER.filter((feature) => inferred.has(feature));
}

function hasNestedJoin(join: MetricViewJoin): boolean {
  return join.joins.length > 0 || join.joins.some(hasNestedJoin);
}

export function parseMetricViewYaml(yamlText: string, name: string): MetricViewDefinition {
  let validatedName: string;
  if (typeof name !== "string") {
    throw new MetricViewParseError([
      {
        path: "name",
        code: "FIELD_REQUIRED",
        message: "An external metric view name is required.",
      },
    ]);
  }
  try {
    validatedName = validateIdentifier(name, "metric view name");
  } catch (error) {
    throw new MetricViewParseError([
      {
        path: "name",
        code: "NAME_INVALID",
        message: error instanceof Error ? error.message : "Invalid metric view name.",
      },
    ]);
  }

  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    throw new MetricViewParseError([
      {
        path: "$",
        code: "YAML_INVALID",
        message: error instanceof Error ? error.message : "Invalid YAML.",
      },
    ]);
  }

  const issues: MetricViewParseIssue[] = [];
  if (!isRecord(raw)) {
    throw new MetricViewParseError([
      { path: "$", code: "TYPE_INVALID", message: "Expected a YAML mapping." },
    ]);
  }

  const versionValue = requiredString(raw.version, "version", issues);
  const version =
    versionValue === "1.0" || versionValue === "1.1"
      ? (versionValue as MetricViewSpecVersion)
      : "1.1";
  if (versionValue && versionValue !== "1.0" && versionValue !== "1.1") {
    addIssue(
      issues,
      "version",
      "VERSION_UNSUPPORTED",
      `Unsupported metric view version "${versionValue}".`,
    );
  }

  const sourceValue = requiredString(raw.source, "source", issues);
  const normalizedTableSource = normalizeThreePartFqn(sourceValue);
  const isQuerySource = !normalizedTableSource && QUERY_SOURCE_RE.test(sourceValue);
  if (sourceValue && !isQuerySource && !normalizedTableSource) {
    addIssue(
      issues,
      "source",
      "SOURCE_INVALID",
      "Source must be a fully qualified three-part name or a SELECT/WITH query.",
    );
  }
  const source = isQuerySource
    ? ({ kind: "query", query: sourceValue } as const)
    : ({ kind: "table", table: normalizedTableSource ?? sourceValue } as const);

  const joins: MetricViewJoin[] = [];
  if (raw.joins !== undefined) {
    if (!Array.isArray(raw.joins)) {
      addIssue(issues, "joins", "TYPE_INVALID", "Expected a list of joins.");
    } else {
      raw.joins.forEach((entry, index) => {
        const join = parseJoin(entry, `joins.${index}`, issues);
        if (join) joins.push(join);
      });
    }
  }

  const joinPaths = collectJoinPaths(joins);
  const dimensions: MetricViewDimension[] = [];
  if (!Array.isArray(raw.dimensions)) {
    addIssue(
      issues,
      "dimensions",
      raw.dimensions === undefined ? "FIELD_REQUIRED" : "TYPE_INVALID",
      "Expected a list of dimensions.",
    );
  } else {
    if (raw.dimensions.length === 0) {
      addIssue(issues, "dimensions", "VALUE_INVALID", "Dimensions must not be empty.");
    }
    raw.dimensions.forEach((entry, index) => {
      const dimension = parseDimension(entry, `dimensions.${index}`, joinPaths, issues);
      if (dimension) dimensions.push(dimension);
    });
  }

  const measures: MetricViewMeasure[] = [];
  if (!Array.isArray(raw.measures)) {
    addIssue(
      issues,
      "measures",
      raw.measures === undefined ? "FIELD_REQUIRED" : "TYPE_INVALID",
      "Expected a list of measures.",
    );
  } else {
    if (raw.measures.length === 0) {
      addIssue(issues, "measures", "VALUE_INVALID", "Measures must not be empty.");
    }
    raw.measures.forEach((entry, index) => {
      const measure = parseMeasure(entry, `measures.${index}`, issues);
      if (measure) measures.push(measure);
    });
  }

  reportDuplicateNames(dimensions, "dimensions", issues);
  reportDuplicateNames(measures, "measures", issues);
  const dimensionNames = new Set(dimensions.map((dimension) => dimension.name.toLocaleLowerCase()));
  measures.forEach((measure, index) => {
    if (dimensionNames.has(measure.name.toLocaleLowerCase())) {
      addIssue(
        issues,
        `measures.${index}.name`,
        "NAME_DUPLICATE",
        `Semantic name "${measure.name}" is already used by a dimension.`,
      );
    }
  });

  const comment = optionalString(raw.comment, "comment", issues);
  const filter = optionalString(raw.filter, "filter", issues);
  const materialization =
    raw.materialization === undefined
      ? undefined
      : parseMaterialization(raw.materialization, "materialization", issues);

  const baseDefinition: Omit<MetricViewDefinition, "requiredFeatures"> = {
    version,
    name: validatedName,
    source,
    ...(comment !== undefined ? { comment } : {}),
    ...(filter !== undefined ? { filter } : {}),
    joins,
    dimensions,
    measures,
    ...(materialization !== undefined ? { materialization } : {}),
  };
  const definition: MetricViewDefinition = {
    ...baseDefinition,
    requiredFeatures: inferRequiredFeatures(baseDefinition),
  };

  if (issues.length === 0) {
    issues.push(...assertMetricViewCapabilities(definition));
  }
  if (issues.length > 0) throw new MetricViewParseError(issues);
  return definition;
}
