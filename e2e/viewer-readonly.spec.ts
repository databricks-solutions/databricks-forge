import { test, expect } from "@playwright/test";
import { mockCommonApis, jsonRoute, emptyAggregate } from "./helpers";

/**
 * A shared view-only recipient must not see or activate any mutating control,
 * but read tabs + exports remain available. The API is authoritative; this
 * verifies the client honours the `permission` echoed by the aggregate.
 */

test("view-only recipient sees no mutating controls, keeps exports", async ({ page }) => {
  const program = {
    id: "p1",
    name: "Shared Estate",
    description: null,
    industryId: null,
    scopes: [
      {
        id: "s1",
        label: "cat.sales",
        ucMetadata: "cat.sales",
        status: "complete",
        scanId: "scan1",
        sequence: 0,
        errorMessage: null,
        inclusionPatterns: null,
        workspaceId: null,
        teamLabel: null,
      },
    ],
  };
  const aggregate = emptyAggregate();
  aggregate.stats.totalScans = 1;

  await mockCommonApis(page, { programs: [program] });
  await page.route("**/api/estate-programs/p1/aggregate", (r) =>
    jsonRoute(r, { program, aggregate, permission: "view" }),
  );
  await page.route("**/api/estate-programs/p1/synthesis", (r) => jsonRoute(r, {}, 404));
  await page.route("**/api/estate-programs/p1", (r) =>
    jsonRoute(r, { program, permission: "view" }),
  );

  await page.goto("/environment/programs/p1");
  await expect(page.getByRole("heading", { name: "Shared Estate" })).toBeVisible();

  // No mutating controls.
  await expect(page.getByRole("button", { name: /Run sequence/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Pause$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Cancel$/ })).toHaveCount(0);
  await expect(page.getByTitle("Delete this program")).toHaveCount(0);

  // Read-only exports remain.
  await expect(page.getByRole("button", { name: /Board pack/ })).toBeVisible();
});
