import { describe, it, expect, vi } from "vitest";
import { chatCompletion, extractContentText } from "@/lib/dbx/model-serving";

const fetchWithTimeoutMock = vi.fn();

vi.mock("@/lib/dbx/fetch-with-timeout", () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeoutMock(...args),
  TIMEOUTS: { AUTH: 15_000 },
}));

vi.mock("@/lib/dbx/client", () => ({
  getConfig: () => ({ host: "https://workspace.cloud.databricks.com", warehouseId: "wh-1" }),
  getAppHeaders: async () => ({
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
  }),
}));

vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  const log = {
    info: fn,
    warn: fn,
    debug: fn,
    error: fn,
    child: () => log,
    timed: fn,
    context: {},
  };
  return {
    logger: { info: fn, warn: fn, debug: fn, error: fn },
    createScopedLogger: () => log,
    apiLogger: () => log,
  };
});

describe("extractContentText", () => {
  it("returns plain string content unchanged", () => {
    expect(extractContentText("Hello world")).toBe("Hello world");
  });

  it("returns empty string for null", () => {
    expect(extractContentText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractContentText(undefined)).toBe("");
  });

  it("converts number to string", () => {
    expect(extractContentText(42)).toBe("42");
  });

  it("extracts text from Gemini-style reasoning model array (type:text blocks)", () => {
    const geminiContent = [
      { type: "reasoning", reasoning: "internal chain of thought..." },
      { type: "text", text: "The answer is 42" },
    ];
    expect(extractContentText(geminiContent)).toBe("The answer is 42");
  });

  it("joins multiple text blocks from array", () => {
    const content = [
      { type: "text", text: "Part 1. " },
      { type: "reasoning", reasoning: "thinking..." },
      { type: "text", text: "Part 2." },
    ];
    expect(extractContentText(content)).toBe("Part 1. Part 2.");
  });

  it("handles array of plain strings", () => {
    const content = ["Hello", " ", "world"];
    expect(extractContentText(content)).toBe("Hello world");
  });

  it("handles mixed array of strings and text objects", () => {
    const content = ["Prefix: ", { type: "text", text: "the answer" }];
    expect(extractContentText(content)).toBe("Prefix: the answer");
  });

  it("falls back to .text extraction when no type:text blocks found", () => {
    const content = [{ text: "fallback content", other: "data" }];
    expect(extractContentText(content)).toBe("fallback content");
  });

  it("returns empty string for empty array", () => {
    expect(extractContentText([])).toBe("");
  });

  it("handles reasoning-only array (no text blocks) by extracting .text fields", () => {
    const content = [
      { type: "reasoning", reasoning: "deep thought", text: "exposed reasoning text" },
    ];
    expect(extractContentText(content)).toBe("exposed reasoning text");
  });

  it("skips blocks without text property in fallback", () => {
    const content = [{ type: "reasoning", reasoning: "no text field here" }];
    expect(extractContentText(content)).toBe("");
  });

  it("extracts text from Responses API output_text blocks", () => {
    const blocks = [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      { type: "output_text", text: '{"status":"ok"}' },
    ];
    expect(extractContentText(blocks)).toBe('{"status":"ok"}');
  });
});

describe("chatCompletion 2026 wire protocol & temperature omission", () => {
  it("omits temperature for Claude Opus 5.5 and Sonnet 5.5 even when caller passes temperature", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "databricks-claude-opus-5-5",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      ),
    );

    const res = await chatCompletion({
      endpoint: "databricks-claude-opus-5-5",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.2,
    });

    expect(res.content).toBe("ok");
    const [url, init] = fetchWithTimeoutMock.mock.calls.at(-1)!;
    expect(url).toBe(
      "https://workspace.cloud.databricks.com/serving-endpoints/databricks-claude-opus-5-5/invocations",
    );
    const sentBody = JSON.parse((init as { body: string }).body);
    expect(sentBody).not.toHaveProperty("temperature");
    expect(sentBody.max_tokens).toBe(8192);
  });

  it("uses Responses API (/serving-endpoints/responses) for GPT-6.1 Sol, GPT-6 Sol, and GPT-6 Luna without temperature", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          model: "databricks-gpt-6-1-sol",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"valid":true}' }],
            },
          ],
          usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        }),
        { status: 200 },
      ),
    );

    const res = await chatCompletion({
      endpoint: "databricks-gpt-6-1-sol",
      messages: [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Check status in JSON." },
      ],
      temperature: 0.1,
      responseFormat: "json_object",
    });

    expect(res.content).toBe('{"valid":true}');
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 20, completionTokens: 8, totalTokens: 28 });

    const [url, init] = fetchWithTimeoutMock.mock.calls.at(-1)!;
    expect(url).toBe("https://workspace.cloud.databricks.com/serving-endpoints/responses");
    const sentBody = JSON.parse((init as { body: string }).body);
    expect(sentBody.model).toBe("databricks-gpt-6-1-sol");
    expect(sentBody.input).toEqual([
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Check status in JSON." },
    ]);
    expect(sentBody.max_output_tokens).toBe(16384);
    expect(sentBody.text).toEqual({ format: { type: "json_object" } });
    expect(sentBody).not.toHaveProperty("temperature");
    expect(sentBody).not.toHaveProperty("messages");
  });

  it("auto-retries against Unity Gateway (/ai-gateway/mlflow/v1) when workspace enforces Unity Gateway (403)", async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error_code: "PERMISSION_DENIED",
            message:
              "Querying pay-per-token foundation model endpoint 'databricks-claude-sonnet-5-5' is disabled for this workspace. Please use Unity Gateway.",
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "system.ai.claude-sonnet-5-5",
            choices: [{ message: { content: "gateway-ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
          { status: 200 },
        ),
      );

    const res = await chatCompletion({
      endpoint: "databricks-claude-sonnet-5-5",
      messages: [{ role: "user", content: "Ping" }],
    });

    expect(res.content).toBe("gateway-ok");
    const [gwUrl, gwInit] = fetchWithTimeoutMock.mock.calls.at(-1)!;
    expect(gwUrl).toBe(
      "https://workspace.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
    );
    const gwBody = JSON.parse((gwInit as { body: string }).body);
    expect(gwBody.model).toBe("system.ai.claude-sonnet-5-5");
    expect(gwBody).not.toHaveProperty("temperature");
  });
});
