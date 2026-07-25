import { describe, expect, it } from "vitest";
import { computeAggregateAssetInventory } from "@/lib/lakebase/environment-scans";

const scan = (
  scanId: string,
  workspaceId: string | null,
  counts: Partial<{ genieSpaceCount: number; dashboardCount: number; metricViewCount: number }>,
) => ({
  scanId,
  workspaceId,
  genieSpaceCount: counts.genieSpaceCount ?? 0,
  dashboardCount: counts.dashboardCount ?? 0,
  metricViewCount: counts.metricViewCount ?? 0,
});

const discovery = (scanId: string, payload: Record<string, unknown>) => ({
  scanId,
  insightType: "asset_discovery",
  payloadJson: JSON.stringify({ discovery: payload }),
});

describe("aggregate estate asset inventory", () => {
  it("does not add overlapping and repeated scan headers in one workspace", () => {
    const inventory = computeAggregateAssetInventory(
      [
        scan("old", "w1", { genieSpaceCount: 4, dashboardCount: 2 }),
        scan("new", "w1", { genieSpaceCount: 4, dashboardCount: 3 }),
      ],
      [],
    );

    expect(inventory.genieSpaces).toBe(4);
    expect(inventory.dashboards).toBe(3);
  });

  it("deduplicates stable asset identities and retains a larger workspace header floor", () => {
    const inventory = computeAggregateAssetInventory(
      [scan("s1", "w1", { genieSpaceCount: 3, dashboardCount: 1, metricViewCount: 1 })],
      [
        discovery("s1", {
          genieSpaces: [
            { spaceId: "space-1", title: "Sales" },
            { spaceId: "space-1", title: "Sales duplicate" },
          ],
          dashboards: [{ dashboardId: "dash-1", displayName: "Sales" }],
          metricViews: [{ fqn: "main.sales.revenue" }],
        }),
      ],
    );

    expect(inventory).toMatchObject({ genieSpaces: 3, dashboards: 1, metricViews: 1 });
  });

  it("sums conservative floors for distinct workspaces and groups unknown workspaces together", () => {
    const inventory = computeAggregateAssetInventory(
      [
        scan("w1-a", "w1", { genieSpaceCount: 2 }),
        scan("w2-a", "w2", { genieSpaceCount: 3 }),
        scan("unknown-a", null, { genieSpaceCount: 5 }),
        scan("unknown-rescan", null, { genieSpaceCount: 4 }),
      ],
      [],
    );

    expect(inventory.genieSpaces).toBe(10);
  });
});
