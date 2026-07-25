import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = [
  {
    id: "owner-run-sales",
    dashboardId: "shared-dashboard-id",
    runId: "run-owner",
    domain: "Sales",
    ownerEmail: "owner@example.com",
    status: "created",
  },
  {
    id: "other-run-sales",
    dashboardId: "shared-dashboard-id",
    runId: "run-other",
    domain: "Sales",
    ownerEmail: "other@example.com",
    status: "created",
  },
  {
    id: "legacy-run-sales",
    dashboardId: "shared-dashboard-id",
    runId: "run-legacy",
    domain: "Sales",
    ownerEmail: null,
    status: "created",
  },
];

const updateMany = vi.fn(
  async ({
    where,
    data,
  }: {
    where: { id?: string; dashboardId?: string; ownerEmail?: string };
    data: Record<string, unknown>;
  }) => {
    let count = 0;
    for (const row of rows) {
      if (
        (where.id === undefined || row.id === where.id) &&
        (where.dashboardId === undefined || row.dashboardId === where.dashboardId) &&
        (where.ownerEmail === undefined || row.ownerEmail === where.ownerEmail)
      ) {
        Object.assign(row, data);
        count += 1;
      }
    }
    return { count };
  },
);

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(
    callback: (prisma: { forgeDashboard: { updateMany: typeof updateMany } }) => Promise<T>,
  ) => callback({ forgeDashboard: { updateMany } }),
}));

import { trackDashboardUpdated } from "@/lib/lakebase/dashboards";

describe("dashboard tracking update scope", () => {
  beforeEach(() => {
    for (const row of rows) row.status = "created";
    vi.clearAllMocks();
  });

  it("updates only the exact owner-bound tracking row when dashboard IDs collide", async () => {
    await trackDashboardUpdated({
      id: "owner-run-sales",
      title: "Owner dashboard",
      publicationStatus: "draft",
      embedCredentials: false,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "owner-run-sales",
      },
      data: expect.objectContaining({ status: "updated", title: "Owner dashboard" }),
    });
    expect(rows[0].status).toBe("updated");
    expect(rows[1].status).toBe("created");
  });

  it.each([
    ["owner-run-sales", "owner@example.com"],
    ["other-run-sales", "other@example.com"],
    ["legacy-run-sales", null],
  ])("preserves stored owner %s when updating exact row", async (id, expectedOwner) => {
    await trackDashboardUpdated({
      id,
      title: "Updated dashboard",
      publicationStatus: "draft",
      embedCredentials: false,
    });

    expect(rows.find((row) => row.id === id)?.ownerEmail).toBe(expectedOwner);
    expect(updateMany.mock.calls.at(-1)?.[0].data).not.toHaveProperty("ownerEmail");
  });
});
