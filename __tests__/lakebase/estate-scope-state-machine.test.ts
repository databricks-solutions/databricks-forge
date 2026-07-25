import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(cb: (prisma: unknown) => Promise<T>) =>
    cb({ forgeEstateProgramScope: { updateMany } }),
}));

import { pauseScopes, resumeScopes, cancelScopes } from "@/lib/lakebase/estate-programs";

describe("estate scope state machine", () => {
  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 3 });
  });

  it("pauseScopes flips planned + queued to paused", async () => {
    expect(await pauseScopes("p1")).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: { programId: "p1", status: { in: ["planned", "queued"] } },
      data: { status: "paused" },
    });
  });

  it("resumeScopes flips paused back to planned", async () => {
    await resumeScopes("p1");
    expect(updateMany).toHaveBeenCalledWith({
      where: { programId: "p1", status: "paused" },
      data: { status: "planned" },
    });
  });

  it("cancelScopes terminates all non-running, non-complete scopes but leaves running", async () => {
    await cancelScopes("p1");
    const arg = updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ status: "cancelled" });
    expect(arg.where.status.in).toEqual(["planned", "queued", "paused", "failed"]);
    expect(arg.where.status.in).not.toContain("running");
    expect(arg.where.status.in).not.toContain("complete");
  });

  // NOTE: stale-scope reclaim (queued AND running) is covered comprehensively
  // against real query semantics in estate-program-state-machine.test.ts
  // (`reclaimStaleScopes`), which replaced the old queued-only reclaimStuckScopes.
});
