import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(
    callback: (prisma: {
      forgeBackgroundJob: { upsert: typeof mocks.upsert };
    }) => Promise<T>,
  ) => callback({ forgeBackgroundJob: { upsert: mocks.upsert } }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { replaceJobStatus } from "@/lib/lakebase/background-jobs";

describe("replaceJobStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({});
  });

  it("writes a new attempt timestamp and explicitly clears every terminal field", async () => {
    const startedAt = new Date("2026-07-24T02:00:00.000Z");

    await replaceJobStatus(
      "run-1",
      "dashboard",
      "generating",
      "Starting Dashboard Engine...",
      0,
      startedAt,
    );

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: "run-1_dashboard" },
      create: expect.objectContaining({
        startedAt,
        completedAt: null,
        error: null,
        detailsJson: null,
        domainCount: 0,
      }),
      update: {
        status: "generating",
        message: "Starting Dashboard Engine...",
        percent: 0,
        startedAt,
        completedAt: null,
        error: null,
        detailsJson: null,
        domainCount: 0,
      },
    });
  });
});
