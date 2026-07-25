import type {
  SemanticAssetManifest,
  VerifiedMetricViewAsset,
} from "@/lib/semantic-assets/types";
import { isMetricFirstDashboardSourcesEnabled } from "@/lib/config/semantic-uplift-flags";
import type { DatasetPurpose, DatasetSourceKind } from "./types";

export type DatasetSourceDecision =
  | { kind: "metric_view"; asset: VerifiedMetricViewAsset }
  | { kind: "semantic_expression"; expressionIds: string[] }
  | { kind: "table" };

type DecisionKind = DatasetSourceDecision["kind"];

function deployedMetricViewIds(manifest: SemanticAssetManifest): Set<string> {
  return new Set(
    manifest.metricViews
      .filter(
        (asset) =>
          asset.validationState === "valid" &&
          asset.deploymentState === "deployed" &&
          typeof asset.deployedFqn === "string" &&
          asset.deployedFqn.trim().length > 0,
      )
      .map((asset) => asset.id),
  );
}

export function dashboardVisibleSemanticManifest(
  manifest: SemanticAssetManifest,
): SemanticAssetManifest {
  const deployedIds = deployedMetricViewIds(manifest);
  const isVisible = (entry: { source: string; metricViewId?: string }) =>
    entry.source !== "metric_view" ||
    (typeof entry.metricViewId === "string" && deployedIds.has(entry.metricViewId));
  return {
    ...manifest,
    metricViews: manifest.metricViews.filter((asset) => deployedIds.has(asset.id)),
    measures: manifest.measures.filter(isVisible),
    dimensions: manifest.dimensions.filter(isVisible),
    filters: manifest.filters.filter(isVisible),
  };
}

function normalizedSqlReference(value: string): string {
  return value.replaceAll("`", "").replace(/\s+/g, "").toLowerCase();
}

export function referencesUnavailableMetricAsset(
  sql: string,
  manifest: SemanticAssetManifest,
): boolean {
  if (/\bMEASURE\s*\(/i.test(sql)) return true;
  const normalizedSql = normalizedSqlReference(sql);
  return manifest.metricViews
    .filter((asset) => asset.deploymentState !== "deployed" || !asset.deployedFqn?.trim())
    .some((asset) => normalizedSql.includes(normalizedSqlReference(asset.intendedFqn)));
}

function includesEvery(availableIds: Set<string>, requestedIds: string[]): boolean {
  return requestedIds.every((id) => availableIds.has(id));
}

function matchingMetricView(
  manifest: SemanticAssetManifest,
  measureIds: string[],
  dimensionIds: string[],
): VerifiedMetricViewAsset | null {
  const candidates = manifest.metricViews
    .filter((asset) => asset.validationState === "valid")
    .filter(
      (asset) =>
        asset.deploymentState === "deployed" &&
        typeof asset.deployedFqn === "string" &&
        asset.deployedFqn.trim().length > 0,
    )
    .filter((asset) => {
      const measureIdsOnAsset = new Set(asset.measures.map((measure) => measure.id));
      const dimensionIdsOnAsset = new Set(asset.dimensions.map((dimension) => dimension.id));
      return (
        includesEvery(measureIdsOnAsset, measureIds) &&
        includesEvery(dimensionIdsOnAsset, dimensionIds)
      );
    })
    .sort((left, right) => {
      const leftFqn = left.deployedFqn ?? left.intendedFqn;
      const rightFqn = right.deployedFqn ?? right.intendedFqn;
      return leftFqn.localeCompare(rightFqn) || left.id.localeCompare(right.id);
    });

  return candidates[0] ?? null;
}

export function selectDatasetSource(input: {
  purpose: DatasetPurpose;
  measureIds: string[];
  dimensionIds: string[];
  manifest: SemanticAssetManifest;
  metricFirstEnabled?: boolean;
}): DatasetSourceDecision {
  if (!(input.metricFirstEnabled ?? isMetricFirstDashboardSourcesEnabled())) {
    return { kind: "table" };
  }
  if (
    input.purpose === "detail" ||
    input.measureIds.length === 0
  ) {
    return { kind: "table" };
  }

  const metricView = matchingMetricView(input.manifest, input.measureIds, input.dimensionIds);
  if (metricView) return { kind: "metric_view", asset: metricView };

  return { kind: "table" };
}

export function summarizeDatasetSourceKind(kinds: DecisionKind[]): DatasetSourceKind {
  const usesTable = kinds.some((kind) => kind !== "metric_view");
  const usesGoverned = kinds.includes("metric_view");
  if (usesTable && usesGoverned) return "mixed";
  return usesGoverned ? "governed" : "table";
}
