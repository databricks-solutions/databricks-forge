import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  getHeaders: vi.fn(),
}));

vi.mock("@/lib/dbx/client", () => ({
  getConfig: () => ({ host: "https://example.databricks.com" }),
  getAppHeaders: vi.fn(),
  getHeaders: mocks.getHeaders,
}));
vi.mock("@/lib/dbx/fetch-with-timeout", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  TIMEOUTS: { WORKSPACE: 30_000 },
}));
vi.mock("@/lib/dbx/workspace", () => ({ mkdirs: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { startConversation } from "@/lib/dbx/genie";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHeaders.mockResolvedValue({ Authorization: "Bearer fallback" });
});

describe("Genie conversation client", () => {
  it("parses modern query attachments from a completed poll response", async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(
        jsonResponse({ conversation_id: "conversation-1", message_id: "message-1" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "message-1",
          status: "COMPLETED",
          content: "raw prompt",
          attachments: [
            { query: { query: "SELECT SUM(revenue) FROM sales" } },
            { text: { content: "Here is the result." } },
          ],
        }),
      );

    await expect(
      startConversation("space-1", "Show revenue", 5_000, "request-obo-token"),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      question: "Show revenue",
      sql: "SELECT SUM(revenue) FROM sales",
      textResponse: "Here is the result.",
    });

    expect(mocks.getHeaders).not.toHaveBeenCalled();
    for (const [, init] of mocks.fetchWithTimeout.mock.calls) {
      expect(init.headers).toMatchObject({
        Authorization: "Bearer request-obo-token",
      });
    }
  });
});
