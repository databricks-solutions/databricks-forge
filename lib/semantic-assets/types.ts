import type {
  MetricViewDimension,
  MetricViewMeasure,
} from "@/lib/metric-views/definition";

export type SemanticAssetSource = "metric_view" | "genie_expression";

interface GovernedAssetBase {
  id: string;
  name: string;
  source: SemanticAssetSource;
  synonyms: string[];
  description?: string;
  fallback: boolean;
}

export type GovernedMeasure =
  | (GovernedAssetBase & {
      source: "metric_view";
      metricViewId: string;
      definition: MetricViewMeasure;
    })
  | (GovernedAssetBase & {
      source: "genie_expression";
      sql: string;
      instructions: string;
      fallback: true;
    });

export type GovernedDimension =
  | (GovernedAssetBase & {
      source: "metric_view";
      metricViewId: string;
      definition: MetricViewDimension;
    })
  | (GovernedAssetBase & {
      source: "genie_expression";
      sql: string;
      instructions: string;
      isTimePeriod: boolean;
      fallback: true;
    });

export type GovernedFilter =
  | (GovernedAssetBase & {
      source: "metric_view";
      metricViewId: string;
      sql: string;
    })
  | (GovernedAssetBase & {
      source: "genie_expression";
      sql: string;
      instructions: string;
      isTimePeriod: boolean;
      fallback: true;
    });

export interface VerifiedMetricViewAsset {
  id: string;
  intendedFqn: string;
  deployedFqn?: string;
  proposalId?: string;
  validationState: "valid" | "unverified" | "invalid";
  measures: GovernedMeasure[];
  dimensions: GovernedDimension[];
  representativeQueries: string[];
  deploymentState: "proposal" | "deployed" | "failed";
  sourceTables: string[];
}

export interface SemanticAssetManifest {
  version: "1";
  domain: string;
  subdomains: string[];
  metricViews: VerifiedMetricViewAsset[];
  measures: GovernedMeasure[];
  dimensions: GovernedDimension[];
  filters: GovernedFilter[];
  generatedAt: string;
}
