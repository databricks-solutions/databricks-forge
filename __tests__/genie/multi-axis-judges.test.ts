import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/dbx/client", () => ({
  getReviewEndpoint: () => "fake-review-endpoint",
  isReviewEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/dbx/model-serving", async (orig) => {
  const actual = await orig<typeof import("@/lib/dbx/model-serving")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

import { scoreAnswer, JUDGES, isMultiAxisJudgingEnabled } from "@/lib/genie/multi-axis-judges";
import { chatCompletion } from "@/lib/dbx/model-serving";
import { isReviewEnabled } from "@/lib/dbx/client";

const mockedChat = chatCompletion as unknown as ReturnType<typeof vi.fn>;
const mockedReviewEnabled = isReviewEnabled as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  mockedChat.mockReset();
  mockedReviewEnabled.mockReturnValue(true);
});

describe("multi-axis judges", () => {
  it("aggregates the nine judge scores using the configured weights", async () => {
    mockedChat.mockResolvedValue({
      content: '{"score": 80, "rationale": "ok"}',
      usage: null,
      model: "fake",
      finishReason: "stop",
    });
    const result = await scoreAnswer({
      question: "How many users?",
      expectedSql: "SELECT COUNT(*) FROM users",
      actualSql: "SELECT COUNT(*) FROM users",
    });
    expect(result.scores.length).toBe(JUDGES.length);
    expect(result.aggregate).toBe(80);
    expect(mockedChat).toHaveBeenCalledTimes(JUDGES.length);
  });

  it("scores 0 when judging is disabled", async () => {
    mockedReviewEnabled.mockReturnValue(false);
    expect(isMultiAxisJudgingEnabled()).toBe(false);
    const result = await scoreAnswer({ question: "Q" });
    expect(result.aggregate).toBe(0);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("clamps score to [0, 100]", async () => {
    mockedChat.mockResolvedValue({
      content: '{"score": 150, "rationale": "x"}',
      usage: null,
      model: "fake",
      finishReason: "stop",
    });
    const result = await scoreAnswer({ question: "Q" });
    expect(result.aggregate).toBe(100);
  });

  it("absorbs malformed JSON as a 0-score judge", async () => {
    mockedChat.mockResolvedValue({
      content: "not json at all",
      usage: null,
      model: "fake",
      finishReason: "stop",
    });
    const result = await scoreAnswer({ question: "Q" });
    expect(result.aggregate).toBe(0);
  });
});
