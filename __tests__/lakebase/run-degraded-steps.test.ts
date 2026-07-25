/**
 * Tests for the per-run degraded-step helpers added to support the BV $0
 * surface-error UX.
 *
 *   - `getDegradedSteps`    -- read the list (returns [] for healthy runs)
 *   - `markRunStepDegraded` -- additive, idempotent
 *   - `clearRunStepDegraded`-- removes the step (NULL when list is empty)
 *
 * The recovery route relies on these to surface the "Recompute" banner and
 * to silence it when the rerun succeeds. The unit test mocks Prisma so we
 * can exercise the JSON encode/decode round-trip without a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma wrapper. `withPrisma` is a thin helper that opens a
// connection and runs a callback; in tests we pass it a stub prisma whose
// behavior we control per-case.
// Typed loosely on purpose -- Prisma's generated types are not in scope here
// and we only care about the encoded JSON string written to `data`.
type UpdateArg = { data: { degradedStepsJson: string | null } };

const findUnique = vi.fn<
  (arg: unknown) => Promise<{ degradedStepsJson: string | null }>
>(async () => ({ degradedStepsJson: null }));
const update = vi.fn<(arg: UpdateArg) => Promise<void>>(async () => undefined);

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) => {
    const prisma = {
      forgeRun: {
        findUnique,
        update,
      },
    };
    return cb(prisma);
  },
}));

vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  return {
    logger: { info: fn, warn: fn, debug: fn, error: fn },
    createScopedLogger: () => ({
      info: fn,
      warn: fn,
      debug: fn,
      error: fn,
      child: () => ({}),
      timed: fn,
      context: {},
    }),
    apiLogger: () => ({}),
  };
});

import {
  getDegradedSteps,
  markRunStepDegraded,
  clearRunStepDegraded,
} from "@/lib/lakebase/runs";

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
});

describe("getDegradedSteps", () => {
  it("returns an empty list when the run has no degraded steps", async () => {
    findUnique.mockResolvedValue({ degradedStepsJson: null });
    const out = await getDegradedSteps("run-1");
    expect(out).toEqual([]);
  });

  it("parses a JSON-encoded array", async () => {
    findUnique.mockResolvedValue({
      degradedStepsJson: JSON.stringify(["financial-quantification"]),
    });
    const out = await getDegradedSteps("run-1");
    expect(out).toEqual(["financial-quantification"]);
  });

  it("falls back to [] on malformed JSON", async () => {
    findUnique.mockResolvedValue({ degradedStepsJson: "{not-json" });
    const out = await getDegradedSteps("run-1");
    expect(out).toEqual([]);
  });
});

describe("markRunStepDegraded", () => {
  it("inserts the step when the run has no degraded steps", async () => {
    findUnique.mockResolvedValue({ degradedStepsJson: null });
    await markRunStepDegraded("run-1", "financial-quantification");
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as UpdateArg;
    expect(JSON.parse(arg.data.degradedStepsJson as string)).toEqual([
      "financial-quantification",
    ]);
  });

  it("is idempotent: does not write when the step is already flagged", async () => {
    findUnique.mockResolvedValue({
      degradedStepsJson: JSON.stringify(["financial-quantification"]),
    });
    await markRunStepDegraded("run-1", "financial-quantification");
    expect(update).not.toHaveBeenCalled();
  });

  it("appends to the existing list when a new step is added", async () => {
    findUnique.mockResolvedValue({
      degradedStepsJson: JSON.stringify(["financial-quantification"]),
    });
    await markRunStepDegraded("run-1", "executive-synthesis");
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as UpdateArg;
    expect(JSON.parse(arg.data.degradedStepsJson as string)).toEqual([
      "financial-quantification",
      "executive-synthesis",
    ]);
  });
});

describe("clearRunStepDegraded", () => {
  it("removes the step from the list when present", async () => {
    findUnique.mockResolvedValue({
      degradedStepsJson: JSON.stringify([
        "financial-quantification",
        "executive-synthesis",
      ]),
    });
    await clearRunStepDegraded("run-1", "financial-quantification");
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as UpdateArg;
    expect(JSON.parse(arg.data.degradedStepsJson as string)).toEqual(["executive-synthesis"]);
  });

  it("nulls the column when the last step is cleared (healthy state)", async () => {
    findUnique.mockResolvedValue({
      degradedStepsJson: JSON.stringify(["financial-quantification"]),
    });
    await clearRunStepDegraded("run-1", "financial-quantification");
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as UpdateArg;
    expect(arg.data.degradedStepsJson).toBeNull();
  });

  it("is a no-op when the step is not currently flagged", async () => {
    findUnique.mockResolvedValue({
      degradedStepsJson: JSON.stringify(["executive-synthesis"]),
    });
    await clearRunStepDegraded("run-1", "financial-quantification");
    expect(update).not.toHaveBeenCalled();
  });

  it("is a no-op when the run has no degraded steps at all", async () => {
    findUnique.mockResolvedValue({ degradedStepsJson: null });
    await clearRunStepDegraded("run-1", "financial-quantification");
    expect(update).not.toHaveBeenCalled();
  });
});
