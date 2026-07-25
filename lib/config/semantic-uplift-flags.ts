type Env = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function isTypedMetricViewModelEnabled(env: Env = process.env): boolean {
  return enabled(env.FORGE_TYPED_METRIC_VIEW_MODEL);
}

export function isMetricFirstDashboardSourcesEnabled(env: Env = process.env): boolean {
  return enabled(env.FORGE_METRIC_FIRST_DASHBOARD_SOURCES);
}

export function isDashboardDraftReadBackEnabled(env: Env = process.env): boolean {
  return enabled(env.FORGE_DASHBOARD_DRAFT_READBACK);
}
