import type { MetricViewDefinition, MetricViewFeature, MetricViewSpecVersion } from "./definition";

/**
 * The single source of truth for metric-view feature support by spec version.
 * Frozen arrays avoid the mutability loophole of JavaScript Set instances.
 */
export const METRIC_VIEW_CAPABILITIES: Readonly<
  Record<MetricViewSpecVersion, readonly MetricViewFeature[]>
> = Object.freeze({
  "1.0": Object.freeze(["joins", "filtered_measures"] satisfies MetricViewFeature[]),
  "1.1": Object.freeze([
    "joins",
    "nested_joins",
    "window_measures",
    "filtered_measures",
    "materialization",
    "source_query",
  ] satisfies MetricViewFeature[]),
});

export interface MetricViewCapabilityIssue {
  path: string;
  code: "FEATURE_UNSUPPORTED";
  message: string;
}

export function supportsMetricViewFeature(
  version: MetricViewSpecVersion,
  feature: MetricViewFeature,
): boolean {
  return METRIC_VIEW_CAPABILITIES[version].includes(feature);
}

export function assertMetricViewCapabilities(
  definition: MetricViewDefinition,
): MetricViewCapabilityIssue[] {
  return definition.requiredFeatures.flatMap((feature, index) =>
    supportsMetricViewFeature(definition.version, feature)
      ? []
      : [
          {
            path: `requiredFeatures.${index}`,
            code: "FEATURE_UNSUPPORTED" as const,
            message: `Metric view feature "${feature}" is not supported by spec version ${definition.version}.`,
          },
        ],
  );
}
