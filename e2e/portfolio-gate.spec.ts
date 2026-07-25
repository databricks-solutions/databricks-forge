import { test, expect } from "@playwright/test";
import { mockCommonApis, jsonRoute } from "./helpers";

/**
 * The cross-estate Portfolio tab is admin-gated: the trigger appears only when
 * `/api/portfolio/access` reports `allowed`. The server route stays
 * authoritative regardless of the tab's visibility.
 */

test("non-admin does not see the Portfolio tab", async ({ page }) => {
  await mockCommonApis(page, { portfolioAllowed: false });
  await page.route("**/api/environment/aggregate", (r) =>
    jsonRoute(r, {
      details: [
        {
          tableFqn: "cat.s.t",
          dataDomain: "Finance",
          numRows: 1,
          sizeInBytes: 1,
          discoveredVia: "selected",
        },
      ],
      insights: [],
      stats: {
        totalScans: 1,
        totalTables: 1,
        coverageByScope: [
          { ucPath: "cat", scanId: "scan1", tableCount: 1, scannedAt: new Date().toISOString() },
        ],
      },
    }),
  );
  await page.goto("/environment");
  await expect(page.getByRole("tab", { name: "State of the Nation" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Portfolio/ })).toHaveCount(0);
});

test("admin sees the Portfolio tab", async ({ page }) => {
  await mockCommonApis(page, { portfolioAllowed: true });
  await page.route("**/api/environment/aggregate", (r) =>
    jsonRoute(r, {
      details: [
        {
          tableFqn: "cat.s.t",
          dataDomain: "Finance",
          numRows: 1,
          sizeInBytes: 1,
          discoveredVia: "selected",
        },
      ],
      insights: [],
      stats: {
        totalScans: 1,
        totalTables: 1,
        coverageByScope: [
          { ucPath: "cat", scanId: "scan1", tableCount: 1, scannedAt: new Date().toISOString() },
        ],
      },
    }),
  );
  await page.route("**/api/portfolio", (r) => jsonRoute(r, { estates: [], totals: {} }));
  await page.goto("/environment");
  await expect(page.getByRole("tab", { name: /Portfolio/ })).toBeVisible();
});
