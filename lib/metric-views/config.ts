/**
 * Metric views feature gate.
 *
 * Metric views are **enabled by default**.  Set
 * `FORGE_METRIC_VIEWS_ENABLED=false` to explicitly disable metric view
 * generation, deployment, and UI toggles.
 */
export function isMetricViewsEnabled(): boolean {
  return process.env.FORGE_METRIC_VIEWS_ENABLED !== "false";
}
