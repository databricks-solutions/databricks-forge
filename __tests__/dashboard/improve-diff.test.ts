import { describe, expect, it } from "vitest";
import {
  applyDashboardImproveDiff,
  buildDashboardImproveDiff,
  DashboardImproveConflictError,
  fingerprintDashboardDesign,
  parseDashboardImproveDiff,
} from "@/lib/dashboard/improve-diff";
import type { DashboardDesignV2 } from "@/lib/dashboard/design-ir";

function design(): DashboardDesignV2 {
  return {
    version: "2",
    title: "Sales",
    description: "Sales dashboard",
    datasets: [
      {
        name: "sales",
        displayName: "Sales",
        purpose: "kpi",
        sourceKind: "table",
        metricIds: [],
        dimensionIds: [],
        sql: "SELECT SUM(amount) AS amount FROM catalog.sales.orders",
        expectedFields: [{ name: "amount", roles: ["value"], compatibleTypes: ["numeric"] }],
      },
    ],
    pages: [
      {
        name: "overview",
        displayName: "Overview",
        widgets: [
          {
            type: "counter",
            title: "Revenue",
            datasetName: "sales",
            fields: [{ name: "amount", expression: "`amount`", role: "value" }],
          },
        ],
        filters: [],
      },
    ],
    globalFilters: [],
  };
}

describe("dashboard improvement diffs", () => {
  const liveBaseFingerprint = "a".repeat(64);
  it("references the discovered asset and merges additions deterministically", () => {
    const existing = design();
    const desired: DashboardDesignV2 = {
      ...existing,
      datasets: [
        ...existing.datasets,
        { ...existing.datasets[0], name: "z_trend", displayName: "Trend", purpose: "trend" },
        { ...existing.datasets[0], name: "a_detail", displayName: "Detail", purpose: "detail" },
      ],
      pages: [
        {
          ...existing.pages[0],
          widgets: [
            ...existing.pages[0].widgets,
            { ...existing.pages[0].widgets[0], title: "Z Orders" },
            { ...existing.pages[0].widgets[0], title: "A Margin" },
          ],
        },
      ],
      globalFilters: [
        {
          type: "filter-single-select",
          title: "Region",
          field: "region",
          bindings: [{ datasetName: "sales", fieldName: "region", expression: "`region`" }],
        },
      ],
    };

    const diff = buildDashboardImproveDiff("dashboard-123", existing, desired, liveBaseFingerprint);
    expect(diff.existingAssetId).toBe("dashboard-123");
    expect(diff.liveBaseFingerprint).toBe(liveBaseFingerprint);
    expect(diff.baseFingerprint).toBe(fingerprintDashboardDesign(existing));
    expect(diff.mergedFingerprint).toBe(fingerprintDashboardDesign(desired));
    expect(diff.addDatasets.map((item) => item.name)).toEqual(["a_detail", "z_trend"]);
    expect(diff.addWidgets.map((item) => item.title)).toEqual(["A Margin", "Z Orders"]);
    expect(diff.addWidgets.every((item) => item.pageName === "overview")).toBe(true);
    expect(diff.addFilters.map((item) => item.title)).toEqual(["Region"]);

    const merged = applyDashboardImproveDiff(existing, diff);
    expect(merged.datasets.map((item) => item.name)).toEqual(["sales", "a_detail", "z_trend"]);
    expect(merged.pages[0].widgets.map((item) => item.title)).toEqual([
      "Revenue",
      "A Margin",
      "Z Orders",
    ]);
    expect(merged.globalFilters.map((item) => item.title)).toEqual(["Region"]);
  });

  it("suppresses exact duplicates", () => {
    const existing = design();
    expect(
      buildDashboardImproveDiff("dashboard-123", existing, existing, liveBaseFingerprint),
    ).toEqual({
      existingAssetId: "dashboard-123",
      liveBaseFingerprint,
      baseFingerprint: fingerprintDashboardDesign(existing),
      mergedFingerprint: fingerprintDashboardDesign(existing),
      addDatasets: [],
      addWidgets: [],
      addFilters: [],
    });
  });

  it("rejects conflicting widget identities and malformed targets", () => {
    const existing = design();
    const desired = design();
    desired.pages[0].widgets[0] = {
      ...desired.pages[0].widgets[0],
      datasetName: "other",
    };

    expect(() =>
      buildDashboardImproveDiff("dashboard-123", existing, desired, liveBaseFingerprint),
    ).toThrow(DashboardImproveConflictError);
    expect(() => buildDashboardImproveDiff("", existing, existing, liveBaseFingerprint)).toThrow(
      DashboardImproveConflictError,
    );
  });

  it("rejects externally supplied additions with duplicate identities or missing pages", () => {
    const existing = design();
    expect(() =>
      applyDashboardImproveDiff(existing, {
        existingAssetId: "dashboard-123",
        liveBaseFingerprint,
        baseFingerprint: fingerprintDashboardDesign(existing),
        mergedFingerprint: fingerprintDashboardDesign(existing),
        addDatasets: [],
        addWidgets: [{ ...existing.pages[0].widgets[0], pageName: "missing" }],
        addFilters: [],
      }),
    ).toThrow(DashboardImproveConflictError);
  });

  it("strictly parses persisted diffs and rejects corruption", () => {
    const existing = design();
    const diff = buildDashboardImproveDiff(
      "dashboard-123",
      existing,
      existing,
      liveBaseFingerprint,
    );
    expect(parseDashboardImproveDiff(JSON.parse(JSON.stringify(diff)))).toEqual(diff);
    expect(() =>
      parseDashboardImproveDiff({
        ...diff,
        addWidgets: [{ pageName: "overview", type: "unknown" }],
      }),
    ).toThrow(DashboardImproveConflictError);
    expect(() => parseDashboardImproveDiff({ ...diff, mergedFingerprint: null })).toThrow(
      DashboardImproveConflictError,
    );
    expect(() => parseDashboardImproveDiff({ ...diff, replacement: true })).toThrow(
      DashboardImproveConflictError,
    );
  });

  it("rejects base and merged fingerprint drift during apply", () => {
    const existing = design();
    const diff = buildDashboardImproveDiff(
      "dashboard-123",
      existing,
      existing,
      liveBaseFingerprint,
    );
    expect(() => applyDashboardImproveDiff({ ...existing, description: "drift" }, diff)).toThrow(
      DashboardImproveConflictError,
    );
    expect(() =>
      applyDashboardImproveDiff(existing, { ...diff, mergedFingerprint: "0".repeat(64) }),
    ).toThrow(DashboardImproveConflictError);
  });
});
