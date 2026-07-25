import { afterEach, describe, expect, it, vi } from "vitest";
import { runThreeGateEval, pickHardestQuestionIds } from "@/lib/genie/three-gate-eval";
import type { EvalRunResult } from "@/lib/genie/benchmark-runner";

vi.mock("@/lib/genie/benchmark-runner", async (orig) => {
  const actual = await orig<typeof import("@/lib/genie/benchmark-runner")>();
  return {
    ...actual,
    runEval: vi.fn(),
  };
});

import { runEval } from "@/lib/genie/benchmark-runner";

const mockedRunEval = runEval as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  mockedRunEval.mockReset();
});

function buildEvalResult(opts: { accuracy: number; results?: EvalRunResult["results"] }): EvalRunResult {
  return {
    evalRunId: "run-1",
    spaceId: "space-1",
    status: "DONE",
    accuracy: opts.accuracy,
    numQuestions: opts.results?.length ?? 5,
    numCorrect: Math.round((opts.results?.length ?? 5) * opts.accuracy),
    numNeedsReview: 0,
    results: opts.results ?? [],
  } as unknown as EvalRunResult;
}

describe("runThreeGateEval", () => {
  it("abandons at the slice gate when fail rate is high", async () => {
    mockedRunEval.mockResolvedValueOnce(buildEvalResult({ accuracy: 0.4 }));
    const result = await runThreeGateEval({
      spaceId: "s",
      allQuestionIds: ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"],
      hardestQuestionIds: ["q1"],
      sliceFailThreshold: 0.4,
    });
    expect(result.status).toBe("abandoned");
    if (result.status === "abandoned") expect(result.gate).toBe("slice");
  });

  it("abandons at P0 when any P0 question regresses (<100%)", async () => {
    mockedRunEval
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 1 })) // slice ok
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 0.7 })); // P0 fails
    const result = await runThreeGateEval({
      spaceId: "s",
      allQuestionIds: ["q1", "q2", "q3", "q4", "q5"],
      hardestQuestionIds: ["q1", "q2"],
    });
    expect(result.status).toBe("abandoned");
    if (result.status === "abandoned") expect(result.gate).toBe("p0");
  });

  it("runs the full suite when both gates pass", async () => {
    mockedRunEval
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 1 }))
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 1 }))
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 0.85 }));
    const result = await runThreeGateEval({
      spaceId: "s",
      allQuestionIds: ["q1", "q2", "q3", "q4", "q5"],
      hardestQuestionIds: ["q1"],
    });
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.fullResult.accuracy).toBe(0.85);
  });

  it("normalises percentage-style accuracy (0-100) at the gates", async () => {
    // Codex P1: `benchmark-runner` emits `accuracy` as a percentage. Pre-fix,
    // a 60% slice would yield `sliceFailRate = -59` and never abandon, and a
    // 70 P0 score would compare against `< 1` and never trip. Confirm both.
    mockedRunEval
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 60 })) // 60% slice
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 70 })); // would-be P0
    const result = await runThreeGateEval({
      spaceId: "s",
      allQuestionIds: ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"],
      hardestQuestionIds: ["q1", "q2"],
      sliceFailThreshold: 0.4,
    });
    expect(result.status).toBe("abandoned");
    if (result.status === "abandoned") expect(result.gate).toBe("slice");
  });

  it("abandons P0 when accuracy is reported as percentage and < 100", async () => {
    mockedRunEval
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 100 })) // slice 100%
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 80 })); // P0 80%
    const result = await runThreeGateEval({
      spaceId: "s",
      allQuestionIds: ["q1", "q2", "q3", "q4", "q5"],
      hardestQuestionIds: ["q1", "q2"],
    });
    expect(result.status).toBe("abandoned");
    if (result.status === "abandoned") expect(result.gate).toBe("p0");
  });

  it("skips P0 gate when no hardest IDs are provided", async () => {
    mockedRunEval
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 1 }))
      .mockResolvedValueOnce(buildEvalResult({ accuracy: 0.9 }));
    const result = await runThreeGateEval({
      spaceId: "s",
      allQuestionIds: ["q1", "q2"],
      hardestQuestionIds: [],
    });
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.p0Result).toBeUndefined();
  });
});

describe("pickHardestQuestionIds", () => {
  it("ranks BAD before NEEDS_REVIEW before GOOD", () => {
    const r = buildEvalResult({
      accuracy: 0.5,
      results: [
        { benchmarkQuestionId: "g1", question: "x", assessment: "GOOD", assessmentReasons: [] },
        { benchmarkQuestionId: "b1", question: "x", assessment: "BAD", assessmentReasons: [] },
        { benchmarkQuestionId: "n1", question: "x", assessment: "NEEDS_REVIEW", assessmentReasons: [] },
        { benchmarkQuestionId: "b2", question: "x", assessment: "BAD", assessmentReasons: [] },
      ] as unknown as EvalRunResult["results"],
    });
    const ids = pickHardestQuestionIds(r, 3);
    expect(ids).toEqual(["b1", "b2", "n1"]);
  });
});
