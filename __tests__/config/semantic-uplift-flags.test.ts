import { describe, expect, it } from "vitest";
import {
  isDashboardDraftReadBackEnabled,
  isMetricFirstDashboardSourcesEnabled,
  isTypedMetricViewModelEnabled,
} from "@/lib/config/semantic-uplift-flags";

describe("semantic uplift rollout flags", () => {
  it.each([
    ["typed metric-view model", isTypedMetricViewModelEnabled],
    ["metric-first dashboard sources", isMetricFirstDashboardSourcesEnabled],
    ["dashboard draft read-back", isDashboardDraftReadBackEnabled],
  ] as const)("defaults %s off", (_name, helper) => {
    expect(helper({})).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes", "on"])(
    "accepts %s as an enabled value",
    (value) => {
      expect(isTypedMetricViewModelEnabled({ FORGE_TYPED_METRIC_VIEW_MODEL: value })).toBe(true);
      expect(
        isMetricFirstDashboardSourcesEnabled({
          FORGE_METRIC_FIRST_DASHBOARD_SOURCES: value,
        }),
      ).toBe(true);
      expect(
        isDashboardDraftReadBackEnabled({ FORGE_DASHBOARD_DRAFT_READBACK: value }),
      ).toBe(true);
    },
  );

  it.each(["false", "0", "no", "off", "", "unexpected"])(
    "treats %s as disabled",
    (value) => {
      expect(isTypedMetricViewModelEnabled({ FORGE_TYPED_METRIC_VIEW_MODEL: value })).toBe(false);
      expect(
        isMetricFirstDashboardSourcesEnabled({
          FORGE_METRIC_FIRST_DASHBOARD_SOURCES: value,
        }),
      ).toBe(false);
      expect(
        isDashboardDraftReadBackEnabled({ FORGE_DASHBOARD_DRAFT_READBACK: value }),
      ).toBe(false);
    },
  );
});
