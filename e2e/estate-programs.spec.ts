import { test, expect } from "@playwright/test";
import { mockCommonApis, jsonRoute, emptyAggregate } from "./helpers";

/**
 * Estate Programs index + create + detail lifecycle (owner).
 * Exercises the real rendered routes with a fully mocked API surface.
 */

test.describe("Estate Programs — owner lifecycle", () => {
  test("empty state shows one dominant create CTA", async ({ page }) => {
    await mockCommonApis(page, { programs: [] });
    await page.goto("/environment/programs");
    await expect(page.getByRole("heading", { name: "Estate Programs" })).toBeVisible();
    // Dominant CTA both in header and empty state.
    await expect(page.getByRole("button", { name: "New program" })).toHaveCount(2);
  });

  test("create program posts and reloads the list", async ({ page }) => {
    await mockCommonApis(page, { programs: [] });
    await page.goto("/environment/programs");
    await page.getByRole("button", { name: "New program" }).first().click();
    await page.getByPlaceholder(/customer or business unit/i).fill("Acme Corp");

    const post = page.waitForRequest(
      (r) => r.url().endsWith("/api/estate-programs") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Create program" }).click();
    await post;
    await expect(page.getByText("Estate program created")).toBeVisible();
  });

  test("owner can pause, resume, and cancel a planned sequence", async ({ page }) => {
    const program = {
      id: "p1",
      name: "Acme Corp",
      description: null,
      industryId: null,
      scopes: [
        {
          id: "s1",
          label: "cat.sales",
          ucMetadata: "cat.sales",
          status: "planned",
          scanId: null,
          sequence: 0,
          errorMessage: null,
          inclusionPatterns: null,
          workspaceId: null,
          teamLabel: null,
        },
      ],
    };
    await mockCommonApis(page, { programs: [program] });
    await page.route("**/api/estate-programs/p1/aggregate", (r) =>
      jsonRoute(r, { program, aggregate: emptyAggregate(), permission: "owner" }),
    );
    await page.route("**/api/estate-programs/p1/synthesis", (r) => jsonRoute(r, {}, 404));
    await page.route("**/api/estate-programs/p1", (r) =>
      jsonRoute(r, { program, permission: "owner" }),
    );
    await page.route("**/api/estate-programs/p1/run", (r) =>
      jsonRoute(r, { status: "started", scopeId: "s1", label: "cat.sales", scanId: "scan1" }, 202),
    );
    await page.route("**/api/estate-programs/p1/pause", (r) => {
      program.scopes[0].status = "paused";
      return jsonRoute(r, { status: "paused", paused: 1 });
    });
    await page.route("**/api/estate-programs/p1/resume", (r) => {
      program.scopes[0].status = "planned";
      return jsonRoute(r, { status: "resumed", resumed: 1 });
    });
    await page.route("**/api/estate-programs/p1/cancel", (r) => {
      program.scopes[0].status = "cancelled";
      return jsonRoute(r, { status: "cancelled", cancelled: 1 });
    });

    await page.goto("/environment/programs/p1");
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Run sequence/ })).toBeVisible();
    await expect(page.getByTitle("Delete this program")).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: /Resume/ })).toBeVisible();
    await page.getByRole("radio", { name: "Detail" }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Resume/ }).click();
    await expect(page.getByRole("button", { name: /Run sequence/ })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Run sequence/ }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });

  test("editable user retries a specific failed scope", async ({ page }) => {
    const program = {
      id: "p1",
      name: "Acme Corp",
      description: null,
      industryId: null,
      scopes: [
        {
          id: "failed-1",
          label: "cat.finance",
          ucMetadata: "cat.finance",
          status: "failed",
          scanId: null,
          sequence: 0,
          errorMessage: "Warehouse stopped",
          inclusionPatterns: null,
          workspaceId: "w1",
          teamLabel: null,
        },
      ],
    };
    await mockCommonApis(page, { programs: [program] });
    await page.route("**/api/estate-programs/p1/aggregate", (r) =>
      jsonRoute(r, { program, aggregate: emptyAggregate(), permission: "edit" }),
    );
    await page.route("**/api/estate-programs/p1/synthesis", (r) => jsonRoute(r, {}, 404));
    let postedScopeId: string | undefined;
    await page.route("**/api/estate-programs/p1/retry", async (r) => {
      postedScopeId = (await r.request().postDataJSON()).scopeId;
      program.scopes[0].status = "planned";
      return jsonRoute(r, { status: "retried", scopeId: postedScopeId }, 202);
    });

    await page.goto("/environment/programs/p1");
    await page.getByRole("radio", { name: "Detail" }).click();
    const retry = page.getByRole("button", { name: "Retry failed scope cat.finance" });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect.poll(() => postedScopeId).toBe("failed-1");
    await expect(page.getByText("Retry started for cat.finance")).toBeVisible();
    await expect(page.getByText("Planned", { exact: true })).toBeVisible();
  });
});
