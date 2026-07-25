/**
 * Metric Views engine -- first-class module for generating, validating,
 * and deploying Unity Catalog metric view definitions.
 *
 * Decoupled from the Genie engine so it can be used standalone or as a
 * building block for Genie spaces, dashboards, and other consumers.
 */

export * from "./types";
export * from "./capabilities";
export * from "./parser";
export * from "./serializer";
export * from "./ddl-envelope";
export { isMetricViewsEnabled } from "./config";
export { buildLightweightSeed } from "./seed";
export { mapSubdomainsToTables } from "./subdomain-mapper";
export type { SubdomainTableGroup } from "./subdomain-mapper";
export { discoverExistingMetricViews, filterRelevantExistingViews } from "./discovery";
export { runMetricViewEngineV2 } from "./engine";
export type { MetricViewEngineV2Input, MetricViewEngineV2Output } from "./engine";
