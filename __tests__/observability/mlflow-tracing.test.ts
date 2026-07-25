import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/lib/dbx/fetch-with-timeout", () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("@/lib/dbx/client", () => ({
  getConfig: () => ({ host: "https://example.databricks.com" }),
  getAppHeaders: async () => ({ authorization: "Bearer x" }),
}));

import { isMlflowTracingEnabled, recordSpan, withSpan } from "@/lib/observability/mlflow-tracing";

beforeEach(() => {
  delete process.env.FORGE_MLFLOW_EXPERIMENT_ID;
  delete process.env.FORGE_MLFLOW_TRACING_ENABLED;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
});

afterEach(() => {
  delete process.env.FORGE_MLFLOW_EXPERIMENT_ID;
  delete process.env.FORGE_MLFLOW_TRACING_ENABLED;
});

describe("mlflow tracing feature gate", () => {
  it("disabled by default", () => {
    expect(isMlflowTracingEnabled()).toBe(false);
  });

  it("enabled when FORGE_MLFLOW_EXPERIMENT_ID is set", () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "12345";
    expect(isMlflowTracingEnabled()).toBe(true);
  });

  it("disabled when explicitly turned off", () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "12345";
    process.env.FORGE_MLFLOW_TRACING_ENABLED = "false";
    expect(isMlflowTracingEnabled()).toBe(false);
  });
});

describe("recordSpan", () => {
  it("is a no-op when disabled", async () => {
    await recordSpan({ name: "x", spanType: "LLM", inputs: { foo: 1 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to MLflow when enabled", async () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "exp-42";
    await recordSpan({
      name: "chatCompletion:gpt",
      spanType: "LLM",
      inputs: { messages: [{ role: "user", content: "hi" }] },
      outputs: { content: "hello" },
      attributes: { tokensTotal: 12 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const args = fetchMock.mock.calls[0];
    expect(args[0]).toContain("/api/2.0/mlflow/traces/log");
    const body = JSON.parse((args[1] as { body: string }).body);
    expect(body.experiment_id).toBe("exp-42");
    expect(body.spans[0].span_type).toBe("LLM");
    expect(body.spans[0].outputs.content).toBe("hello");
  });

  it("redacts sensitive keys", async () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "exp-1";
    await recordSpan({
      name: "x",
      spanType: "TOOL",
      inputs: { authorization: "Bearer secret-token", apiKey: "k", visible: "ok" },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const ins = body.spans[0].inputs;
    expect(ins.authorization).toBe("[REDACTED]");
    expect(ins.apiKey).toBe("[REDACTED]");
    expect(ins.visible).toBe("ok");
  });

  it("swallows network errors", async () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "exp-1";
    fetchMock.mockRejectedValue(new Error("connection reset"));
    await expect(
      recordSpan({ name: "x", spanType: "TOOL" }),
    ).resolves.toBeUndefined();
  });
});

describe("withSpan", () => {
  it("returns the inner function's value when disabled", async () => {
    const result = await withSpan({ name: "noop", spanType: "TOOL" }, async () => 99);
    expect(result).toBe(99);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a span on success when enabled", async () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "exp-2";
    const result = await withSpan({ name: "ok", spanType: "TOOL" }, async () => "yay");
    expect(result).toBe("yay");
    // recordSpan is awaited via void/microtask; allow event loop
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("records error and rethrows on failure", async () => {
    process.env.FORGE_MLFLOW_EXPERIMENT_ID = "exp-2";
    await expect(
      withSpan({ name: "boom", spanType: "TOOL" }, async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalled();
  });
});
