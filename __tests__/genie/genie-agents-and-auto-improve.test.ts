import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockGetGenieSpace,
  mockCreateGenieSpace,
  mockUpdateGenieSpace,
  mockTrashGenieSpace,
  mockRunEval,
} = vi.hoisted(() => ({
  mockGetGenieSpace: vi.fn(),
  mockCreateGenieSpace: vi.fn(),
  mockUpdateGenieSpace: vi.fn(),
  mockTrashGenieSpace: vi.fn(),
  mockRunEval: vi.fn(),
}));

vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  const log = { info: fn, warn: fn, debug: fn, error: fn, child: () => log, timed: fn };
  return { logger: log, createScopedLogger: () => log, apiLogger: () => log };
});

vi.mock("@/lib/dbx/genie", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dbx/genie")>("@/lib/dbx/genie");
  return {
    ...actual,
    getGenieSpace: (...args: unknown[]) => mockGetGenieSpace(...args),
    createGenieSpace: (...args: unknown[]) => mockCreateGenieSpace(...args),
    updateGenieSpace: (...args: unknown[]) => mockUpdateGenieSpace(...args),
    trashGenieSpace: (...args: unknown[]) => mockTrashGenieSpace(...args),
  };
});

vi.mock("@/lib/genie/benchmark-runner", () => ({
  runEval: (...args: unknown[]) => mockRunEval(...args),
}));

import { runAutoImproveLoop } from "@/lib/genie/auto-improve";
import { sanitizeSerializedSpace } from "@/lib/dbx/genie";
import { enforceConstraints, MAX_TABLES_PER_SPACE } from "@/lib/dbx/genie-cleanup";

describe("PR-05 Genie auto-improve 3-space isolation & Agent-mode benchmark support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies fixes to devWorking (not production), promotes devBest on improvement, and trashes dev spaces", async () => {
    mockGetGenieSpace.mockImplementation(async (id: string) => ({
      space_id: id,
      title: "Sales Space",
      warehouse_id: "wh-1",
      serialized_space: JSON.stringify({ version: 2, tag: id }),
    }));
    mockCreateGenieSpace
      .mockResolvedValueOnce({ space_id: "dev-best-id" })
      .mockResolvedValueOnce({ space_id: "dev-working-id" });
    mockUpdateGenieSpace.mockResolvedValue({});
    mockTrashGenieSpace.mockResolvedValue(undefined);

    mockRunEval
      .mockResolvedValueOnce({
        evalRunId: "eval-1",
        spaceId: "dev-working-id",
        status: "DONE",
        accuracy: 50,
        numCorrect: 5,
        numQuestions: 10,
        numNeedsReview: 0,
        results: [
          {
            question: "Q1",
            assessment: "BAD",
            assessmentReasons: ["LLM_JUDGE_MISSING_JOIN", "EMPTY_GOOD_SQL"],
          },
        ],
      })
      .mockResolvedValueOnce({
        evalRunId: "eval-2",
        spaceId: "dev-working-id",
        status: "DONE",
        accuracy: 85,
        numCorrect: 8,
        numQuestions: 10,
        numNeedsReview: 0,
        results: [],
      });

    const appliedTargets: Array<{ checkIds: string[]; targetSpaceId?: string }> = [];

    const result = await runAutoImproveLoop(
      {
        spaceId: "prod-space-id",
        targetScore: 80,
        maxIterations: 3,
        indexingWaitMs: 0,
        enableThreeSpace: true,
        enableThreeGateEval: false,
        enableMultiAxisJudges: false,
        persistHistory: false,
        oboToken: "obo-tok",
      },
      async (checkIds, targetSpaceId) => {
        appliedTargets.push({ checkIds, targetSpaceId });
        return checkIds;
      },
    );

    expect(result.targetReached).toBe(true);
    expect(result.finalScore).toBe(85);

    // 1. Fixes were applied to dev-working-id (never prod-space-id) and excluded benchmarks-exist
    expect(appliedTargets).toHaveLength(1);
    expect(appliedTargets[0].targetSpaceId).toBe("dev-working-id");
    expect(appliedTargets[0].checkIds).not.toContain("benchmarks-exist");

    // 2. Final winning config was promoted to prod-space-id
    const prodUpdates = mockUpdateGenieSpace.mock.calls.filter((c) => c[0] === "prod-space-id");
    expect(prodUpdates).toHaveLength(1);

    // 3. Both dev clones were trashed during cleanup
    expect(mockTrashGenieSpace).toHaveBeenCalledWith("dev-working-id");
    expect(mockTrashGenieSpace).toHaveBeenCalledWith("dev-best-id");
  });

  it("preserves Agent-mode benchmark questions with evaluation_note and empty SQL content[]", () => {
    expect(MAX_TABLES_PER_SPACE).toBe(30);

    const space = {
      version: 2,
      benchmarks: {
        questions: [
          {
            id: "40000000000000000000000000000001",
            question: ["What is driving the revenue decline this quarter?"],
            answer: [{ format: "SQL", content: [] }],
            evaluation_note: "Agent must investigate region and product dimensions.",
          },
          {
            id: "40000000000000000000000000000002",
            question: ["Empty question with no SQL and no evaluation_note"],
            answer: [{ format: "SQL", content: [] }],
          },
        ],
      },
    };

    const sanitized = JSON.parse(sanitizeSerializedSpace(JSON.stringify(space)));
    expect(sanitized.benchmarks.questions[0].evaluation_note).toEqual([
      "Agent must investigate region and product dimensions.",
    ]);

    const res = enforceConstraints(sanitized);
    expect(res.benchmarksDropped).toBe(1);
    expect(sanitized.benchmarks.questions).toHaveLength(1);
    expect(sanitized.benchmarks.questions[0].id).toBe("40000000000000000000000000000001");
  });
});
