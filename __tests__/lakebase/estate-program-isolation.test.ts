import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(
    callback: (prisma: {
      forgeEstateProgram: { findMany: typeof mocks.findMany };
      forgeEstateProgramScope: {
        deleteMany: typeof mocks.deleteMany;
        findUnique: typeof mocks.findUnique;
      };
    }) => Promise<T>,
  ) =>
    callback({
      forgeEstateProgram: { findMany: mocks.findMany },
      forgeEstateProgramScope: { deleteMany: mocks.deleteMany, findUnique: mocks.findUnique },
    }),
}));

import { deleteProgramScope, listEstatePrograms } from "@/lib/lakebase/estate-programs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("estate program data isolation", () => {
  it("lists only owner and explicitly shared program IDs", async () => {
    mocks.findMany.mockResolvedValue([]);

    await listEstatePrograms("owner@example.com", 25, ["shared-program"]);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ ownerEmail: "owner@example.com" }, { id: { in: ["shared-program"] } }],
        },
        take: 25,
      }),
    );
  });

  it("deletes a scope only when both scope and parent program match", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    const deleted = await deleteProgramScope("scope-from-p2", "p1");

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "scope-from-p2",
        programId: "p1",
        status: { notIn: ["queued", "running"] },
      },
    });
    expect(deleted).toEqual({ status: "not_found" });
  });

  it("reports an active conflict when the atomic conditional delete loses a start race", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue({ status: "running" });

    const deleted = await deleteProgramScope("scope-1", "p1");

    expect(deleted).toEqual({ status: "active" });
  });
});
