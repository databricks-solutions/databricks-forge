import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  startConversation: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({ loadRunOrRespond: mocks.guard }));
vi.mock("@/lib/dbx/genie", () => ({ startConversation: mocks.startConversation }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/runs/[runId]/genie-engine/[domain]/test/route";

const runId = "11111111-1111-4111-8111-111111111111";

function post(question = "Show revenue") {
  return POST(
    new Request(`http://localhost/api/runs/${runId}/genie-engine/Sales/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-access-token": "request-obo-token",
      },
      body: JSON.stringify({ spaceId: "space-1", questions: [question] }),
    }) as never,
    { params: Promise.resolve({ runId, domain: "Sales" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    ok: true,
    value: { run: { runId } },
    user: { email: "editor@example.com", oboToken: "request-obo-token" },
  });
});

describe("Genie conversation smoke test route", () => {
  it("passes a completed response with nonblank modern SQL and preserves OBO", async () => {
    mocks.startConversation.mockResolvedValue({
      question: "Show revenue",
      conversationId: "conversation-1",
      messageId: "message-1",
      status: "COMPLETED",
      sql: "SELECT SUM(revenue) FROM sales",
    });

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [
        {
          question: "Show revenue",
          status: "COMPLETED",
          outcome: "passed",
          sql: "SELECT SUM(revenue) FROM sales",
        },
      ],
      summary: { passed: 1, clarifications: 0, failed: 0, total: 1 },
    });
    expect(mocks.startConversation).toHaveBeenCalledWith(
      "space-1",
      "Show revenue",
      90_000,
      "request-obo-token",
    );
  });

  it("reports completed text without SQL as a non-passing clarification", async () => {
    mocks.startConversation.mockResolvedValue({
      question: "Show revenue",
      conversationId: "conversation-1",
      messageId: "message-1",
      status: "COMPLETED",
      textResponse: "Which fiscal year should I use?",
    });

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [
        {
          question: "Show revenue",
          status: "COMPLETED",
          outcome: "clarification",
          textResponse: "Which fiscal year should I use?",
        },
      ],
      summary: { passed: 0, clarifications: 1, failed: 0, total: 1 },
    });
  });
});
