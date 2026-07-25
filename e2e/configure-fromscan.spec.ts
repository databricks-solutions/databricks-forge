import { test, expect } from "@playwright/test";
import { jsonRoute, mockCommonApis } from "./helpers";

/**
 * /configure?fromScan=<id> must never silently fall back: a ready scan shows the
 * "Discovery from estate scan" banner; a missing/failed scan shows an explicit
 * "Estate scan unavailable" error with a live-extraction escape hatch.
 */

test.describe("Configure from estate scan", () => {
  test("ready source scan shows the reuse banner", async ({ page }) => {
    await mockCommonApis(page);
    await page.route("**/api/environment/scan-ready/summary", (r) =>
      jsonRoute(r, {
        scanId: "scan-ready",
        ucPath: "cat.sales",
        tableCount: 12,
        scanStatus: "complete",
        complete: true,
        hasDetails: true,
      }),
    );
    await page.goto("/configure?fromScan=scan-ready");
    await expect(page.getByText("Discovery from estate scan")).toBeVisible();
  });

  test("missing source scan shows an explicit unavailable state", async ({ page }) => {
    await mockCommonApis(page);
    await page.route("**/api/environment/scan-missing/summary", (r) =>
      jsonRoute(r, { error: "Not found" }, 404),
    );
    await page.goto("/configure?fromScan=scan-missing");
    await expect(page.getByText("Estate scan unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: /live extraction/i })).toBeVisible();
  });
});
