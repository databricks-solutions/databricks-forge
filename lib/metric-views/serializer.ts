import { stringify } from "yaml";
import { validateIdentifier } from "@/lib/validation";
import type {
  MetricViewDefinition,
  MetricViewDimension,
  MetricViewJoin,
  MetricViewMaterialization,
  MetricViewMeasure,
} from "./definition";

type YamlRecord = Record<string, unknown>;

function serializeJoin(join: MetricViewJoin): YamlRecord {
  return {
    name: join.name,
    source: join.source,
    ...(join.kind === "on" ? { on: join.on } : { using: join.using }),
    ...(join.joins.length > 0 ? { joins: join.joins.map(serializeJoin) } : {}),
  };
}

function semanticMetadata(
  field: Pick<MetricViewDimension, "name" | "comment" | "displayName" | "synonyms">,
): YamlRecord {
  return {
    name: field.name,
    ...(field.comment !== undefined ? { comment: field.comment } : {}),
    ...(field.displayName !== undefined ? { display_name: field.displayName } : {}),
    ...(field.synonyms !== undefined ? { synonyms: field.synonyms } : {}),
  };
}

function serializeDimension(dimension: MetricViewDimension): YamlRecord {
  const { name, ...metadata } = semanticMetadata(dimension);
  return {
    name,
    expr: dimension.expr,
    ...metadata,
  };
}

function measureExpression(measure: MetricViewMeasure): string {
  switch (measure.kind) {
    case "expression":
    case "window":
      return measure.expr;
    case "ratio":
      return `${measure.numerator} / ${measure.denominator}`;
    case "filtered":
      return `${measure.expr} FILTER (WHERE ${measure.filter})`;
  }
}

function serializeMeasure(measure: MetricViewMeasure): YamlRecord {
  const { name, ...metadata } = semanticMetadata(measure);
  return {
    name,
    expr: measureExpression(measure),
    ...(measure.kind === "window"
      ? {
          window: measure.window.map((window) => ({
            order: window.order,
            range: window.range,
            ...(window.semiadditive !== undefined ? { semiadditive: window.semiadditive } : {}),
          })),
        }
      : {}),
    ...metadata,
    ...(measure.format !== undefined ? { format: measure.format } : {}),
  };
}

function serializeMaterialization(materialization: MetricViewMaterialization): YamlRecord {
  return {
    schedule:
      materialization.schedule.kind === "interval"
        ? materialization.schedule.interval
        : {
            quartz_cron: materialization.schedule.quartzCron,
            ...(materialization.schedule.timezone !== undefined
              ? { timezone: materialization.schedule.timezone }
              : {}),
          },
    ...(materialization.mode !== undefined ? { mode: materialization.mode } : {}),
    materialized_views: materialization.materializedViews.map((view) =>
      view.kind === "unaggregated"
        ? { name: view.name, type: "unaggregated" }
        : {
            name: view.name,
            type: "aggregated",
            dimensions: view.dimensions,
            measures: view.measures,
          },
    ),
  };
}

export function serializeMetricViewYaml(definition: MetricViewDefinition): string {
  const transport: YamlRecord = {
    version: definition.version,
    source: definition.source.kind === "table" ? definition.source.table : definition.source.query,
    ...(definition.comment !== undefined ? { comment: definition.comment } : {}),
    ...(definition.filter !== undefined ? { filter: definition.filter } : {}),
    ...(definition.joins.length > 0 ? { joins: definition.joins.map(serializeJoin) } : {}),
    dimensions: definition.dimensions.map(serializeDimension),
    measures: definition.measures.map(serializeMeasure),
    ...(definition.materialization !== undefined
      ? { materialization: serializeMaterialization(definition.materialization) }
      : {}),
  };

  return stringify(transport, { lineWidth: 0 });
}

export function buildMetricViewDdlFromDefinition(input: {
  catalog: string;
  schema: string;
  definition: MetricViewDefinition;
}): string {
  const catalog = validateIdentifier(input.catalog, "catalog");
  const schema = validateIdentifier(input.schema, "schema");
  const name = validateIdentifier(input.definition.name, "metric view name");
  const yaml = serializeMetricViewYaml(input.definition);
  if (yaml.includes("$$")) {
    throw new Error(
      "Metric view YAML contains the reserved outer DDL delimiter ($$); executable DDL was not emitted.",
    );
  }

  return (
    `CREATE OR REPLACE VIEW \`${catalog}\`.\`${schema}\`.\`${name}\`\n` +
    `WITH METRICS\n` +
    `LANGUAGE YAML\n` +
    `AS $$\n${yaml}$$`
  );
}
