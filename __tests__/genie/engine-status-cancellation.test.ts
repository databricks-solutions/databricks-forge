import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  upsert: vi.fn(async () => undefined),
  get: vi.fn(async () => null),
}));

vi.mock("@/lib/lakebase/background-jobs", () => ({
  upsertJobStatus: persistence.upsert,
  getPersistedJobStatus: persistence.get,
}));

vi.mock("@/lib/lakebase/auth-errors", () => ({
  isAuthErrorMessage: vi.fn(() => false),
}));

import { cancelJob, getJobController, getJobStatus, startJob } from "@/lib/genie/engine-status";

describe("Genie engine-status cancellation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes the job AbortController and persists cancellation", async () => {
    await startJob("run-cancel");
    const controller = getJobController("run-cancel");

    expect(controller).not.toBeNull();
    expect(controller?.signal.aborted).toBe(false);

    await expect(cancelJob("run-cancel")).resolves.toBe(true);

    expect(controller?.signal.aborted).toBe(true);
    await expect(getJobStatus("run-cancel")).resolves.toMatchObject({
      status: "cancelled",
      message: "Generation cancelled by user",
    });
    expect(persistence.upsert).toHaveBeenLastCalledWith(
      "run-cancel",
      "genie",
      "cancelled",
      "Generation cancelled by user",
      0,
      expect.objectContaining({ completedAt: expect.any(Date) }),
    );
  });
});
