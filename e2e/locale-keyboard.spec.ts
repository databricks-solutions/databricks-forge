import { test, expect } from "@playwright/test";
import { mockCommonApis, jsonRoute } from "./helpers";

/**
 * Locale switching (NEXT_LOCALE cookie drives the RSC render) and keyboard
 * drill-down of the Domain Explorer bubble map.
 */

test("Estate Programs page renders the active locale", async ({ page, context }) => {
  await context.addCookies([
    { name: "NEXT_LOCALE", value: "es", url: "http://localhost:3100" },
  ]);
  await mockCommonApis(page, { programs: [] });
  await page.goto("/environment/programs");
  await expect(page.getByRole("heading", { name: "Programas de patrimonio" })).toBeVisible();
});

test("Domain Explorer bubbles are keyboard-drillable", async ({ page }) => {
  const details = [
    { tableFqn: "cat.fin.ledger", dataDomain: "Finance", dataSubdomain: "GL", numRows: 1000, sizeInBytes: 5000, dataTier: "gold", discoveredVia: "selected" },
    { tableFqn: "cat.sales.orders", dataDomain: "Sales", dataSubdomain: "Orders", numRows: 2000, sizeInBytes: 9000, dataTier: "silver", discoveredVia: "selected" },
  ];
  const aggregate = {
    details,
    insights: [],
    stats: {
      totalScans: 1,
      totalTables: 2,
      coverageByScope: [{ ucPath: "cat", scanId: "scan1", tableCount: 2, scannedAt: new Date().toISOString() }],
    },
  };
  await mockCommonApis(page);
  await page.route("**/api/environment/aggregate", (r) => jsonRoute(r, aggregate));
  await page.route("**/api/environment/aggregate/erd**", (r) => jsonRoute(r, { nodes: [], edges: [] }));
  await page.route("**/api/stats", (r) => jsonRoute(r, {}));

  await page.goto("/environment?tab=domains");
  const bubble = page.locator('g[role="button"]').first();
  await expect(bubble).toBeVisible();
  await bubble.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Subdomains of/)).toBeVisible();
});
