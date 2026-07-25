/**
 * Verifies that empty-content responses from Model Serving are treated as
 * retryable and fallback-eligible by the agent retry loop.
 *
 * Regression: previously the BV $0 incident -- the financial-quantification
 * model returned `content = ""` once, the retry loop did NOT classify it
 * as a known retryable failure, never tried the fallback endpoint, and
 * surfaced a generic Error that the BV step swallowed in a log.warn-only
 * catch. After the fix, an empty content response throws a typed
 * `EmptyContentError`, the retry loop backs off and retries on the same
 * endpoint, then on exhaustion rotates to the fallback endpoint exactly
 * the same way as a 429.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Silence logger noise.
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

// Avoid Lakebase touch.
vi.mock("@/lib/lakebase/prompt-logs", () => ({
  insertPromptLog: vi.fn(),
}));

// Stub the model registry so executeAIQueryOnce skips JSON-mode coercion.
vi.mock("@/lib/dbx/model-registry", () => ({
  getModelCapabilities: () => ({
    supportsJsonMode: false,
    supportsTemperature: true,
    maxOutputTokens: 8192,
    defaultMaxTokens: 4096,
  }),
}));

// Stub fallback endpoint resolution to a stable second endpoint.
vi.mock("@/lib/dbx/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dbx/client")>(
    "@/lib/dbx/client",
  );
  return {
    ...actual,
    getFallbackEndpoint: vi.fn((current: string) =>
      current === "primary-empty" ? "fallback-ok" : null,
    ),
  };
});

// Stub the prompt formatter so we don't need a real PROMPT_TEMPLATES entry.
// `formatPrompt` closes over the original PROMPT_TEMPLATES inside the module,
// so spreading the templates object via vi.mock alone doesn't reach it -- we
// replace `formatPrompt` directly. We keep the real `PROMPT_VERSIONS` /
// `PROMPT_SYSTEM_MESSAGES` exports intact via `vi.importActual`.
vi.mock("@/lib/ai/templates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/templates")>(
    "@/lib/ai/templates",
  );
  return {
    ...actual,
    formatPrompt: (_key: string, variables: Record<string, string>) =>
      `Hello ${variables.name ?? ""}`,
    PROMPT_VERSIONS: {
      ...actual.PROMPT_VERSIONS,
      EMPTY_CONTENT_TEST_PROMPT: "1.0.0",
    },
    PROMPT_SYSTEM_MESSAGES: {
      ...actual.PROMPT_SYSTEM_MESSAGES,
      EMPTY_CONTENT_TEST_PROMPT: "test system",
    },
  };
});

// We mock the model-serving module so the retry loop talks to a controllable
// stub instead of the real Databricks endpoint.
const chatCompletionMock = vi.fn();

vi.mock("@/lib/dbx/model-serving", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dbx/model-serving")>(
    "@/lib/dbx/model-serving",
  );
  return {
    ...actual,
    chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
  };
});

// Imports under test (after mocks).
import { executeAIQuery } from "@/lib/ai/agent";
import { EmptyContentError } from "@/lib/dbx/model-serving";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyResponse() {
  return {
    content: "",
    finishReason: "stop" as string | null,
    model: "primary-empty",
    usage: undefined,
  };
}

function makeOkResponse(content: string) {
  return {
    content,
    finishReason: "stop" as string | null,
    model: "fallback-ok",
    usage: undefined,
  };
}

beforeEach(() => {
  chatCompletionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("empty-content retry + fallback (executeAIQuery)", () => {
  it(
    "retries on empty content, then rotates to the fallback endpoint and succeeds",
    async () => {
      // Primary endpoint returns empty 3 times (initial + 2 retries),
      // then we expect the loop to try the fallback endpoint.
      chatCompletionMock
        .mockResolvedValueOnce(makeEmptyResponse())
        .mockResolvedValueOnce(makeEmptyResponse())
        .mockResolvedValueOnce(makeEmptyResponse())
        .mockResolvedValueOnce(makeOkResponse('{"ok": true}'));

      const result = await executeAIQuery({
        promptKey: "EMPTY_CONTENT_TEST_PROMPT" as never,
        variables: { name: "world" },
        modelEndpoint: "primary-empty",
        // Speed up the retry test by lowering retries; the fallback path
        // is independent of `retries` -- it triggers on exhaustion.
        retries: 2,
      });

      expect(result.rawResponse).toBe('{"ok": true}');

      // Verify the loop attempted the primary endpoint multiple times before
      // rotating. The fallback call is the last one.
      const endpointArgs = chatCompletionMock.mock.calls.map(
        (c) => (c[0] as { endpoint: string }).endpoint,
      );
      expect(endpointArgs.filter((e) => e === "primary-empty").length).toBeGreaterThanOrEqual(
        2,
      );
      expect(endpointArgs[endpointArgs.length - 1]).toBe("fallback-ok");
    },
    20_000,
  );

  it("throws an EmptyContentError-shaped failure when both endpoints fail", async () => {
    // Every call returns empty -- both primary retries and fallback attempts.
    chatCompletionMock.mockResolvedValue(makeEmptyResponse());

    await expect(
      executeAIQuery({
        promptKey: "EMPTY_CONTENT_TEST_PROMPT" as never,
        variables: { name: "world" },
        modelEndpoint: "primary-empty",
        retries: 1,
      }),
    ).rejects.toBeInstanceOf(EmptyContentError);
  }, 20_000);
});
