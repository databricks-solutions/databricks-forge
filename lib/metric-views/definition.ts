/**
 * Canonical, dependency-free intermediate representation for metric views.
 *
 * LLM-produced YAML remains a transport format. This model is the semantic
 * contract that later parser and serializer tasks will consume.
 */

export type MetricViewSpecVersion = "1.0" | "1.1";

export type MetricViewFeature =
  | "joins"
  | "nested_joins"
  | "window_measures"
  | "filtered_measures"
  | "materialization"
  | "source_query";

/** A normalized SQL fragment without a DDL or YAML envelope. */
export type SqlExpression = string;

export interface MetricViewTableSource {
  kind: "table";
  table: string;
}

export interface MetricViewQuerySource {
  kind: "query";
  query: SqlExpression;
}

export type MetricViewSource = MetricViewTableSource | MetricViewQuerySource;

interface MetricViewJoinBase {
  name: string;
  source: string;
  joins: MetricViewJoin[];
}

export type MetricViewJoin =
  | (MetricViewJoinBase & {
      kind: "on";
      on: SqlExpression;
    })
  | (MetricViewJoinBase & {
      kind: "using";
      using: string[];
    });

interface MetricViewSemanticField {
  name: string;
  expr: SqlExpression;
  comment?: string;
  displayName?: string;
  synonyms?: string[];
}

export interface MetricViewLocalDimension extends MetricViewSemanticField {
  kind: "local";
}

export interface MetricViewJoinedDimension extends MetricViewSemanticField {
  kind: "joined";
  /** Join aliases from the top-level join through any nested joins. */
  joinPath: string[];
}

export type MetricViewDimension = MetricViewLocalDimension | MetricViewJoinedDimension;

export type MetricViewFormat = "percent" | "currency" | "number" | `decimal(${number})`;

interface MetricViewMeasureBase {
  name: string;
  comment?: string;
  displayName?: string;
  synonyms?: string[];
  format?: MetricViewFormat;
}

export interface MetricViewExpressionMeasure extends MetricViewMeasureBase {
  kind: "expression";
  expr: SqlExpression;
}

export interface MetricViewRatioMeasure extends MetricViewMeasureBase {
  kind: "ratio";
  numerator: SqlExpression;
  denominator: SqlExpression;
}

export interface MetricViewFilteredMeasure extends MetricViewMeasureBase {
  kind: "filtered";
  expr: SqlExpression;
  filter: SqlExpression;
}

export type MetricViewWindowRange =
  | "cumulative"
  | "current"
  | "all"
  | `${"trailing" | "leading"} ${number} ${"day" | "week" | "month" | "quarter" | "year"}`;

export interface MetricViewWindowDefinition {
  order: string;
  range: MetricViewWindowRange;
  semiadditive?: "first" | "last";
}

export interface MetricViewWindowMeasure extends MetricViewMeasureBase {
  kind: "window";
  expr: SqlExpression;
  window: MetricViewWindowDefinition[];
}

export type MetricViewMeasure =
  | MetricViewExpressionMeasure
  | MetricViewRatioMeasure
  | MetricViewFilteredMeasure
  | MetricViewWindowMeasure;

export type MetricViewSchedule =
  | {
      kind: "interval";
      interval: string;
    }
  | {
      kind: "cron";
      quartzCron: string;
      timezone?: string;
    };

interface MetricViewMaterializedViewBase {
  name: string;
}

export type MetricViewMaterializedView =
  | (MetricViewMaterializedViewBase & {
      kind: "unaggregated";
    })
  | (MetricViewMaterializedViewBase & {
      kind: "aggregated";
      dimensions: string[];
      measures: string[];
    });

export interface MetricViewMaterialization {
  schedule: MetricViewSchedule;
  mode?: "relaxed" | "strict";
  materializedViews: MetricViewMaterializedView[];
}

export interface MetricViewDefinition {
  version: MetricViewSpecVersion;
  name: string;
  comment?: string;
  source: MetricViewSource;
  filter?: SqlExpression;
  joins: MetricViewJoin[];
  dimensions: MetricViewDimension[];
  measures: MetricViewMeasure[];
  materialization?: MetricViewMaterialization;
  requiredFeatures: MetricViewFeature[];
}
