import { describe, expect, it, vi } from "vitest";

import { formatValidationResult, validateEndpoints } from "../../scripts/validate-endpoints.mjs";

const configuredEnv = {
  NODE_ENV: "test",
  DATABRICKS_HOST: "https://workspace.example",
  DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
  DATABRICKS_SERVING_ENDPOINT_FAST: "databricks-claude-sonnet-4-6",
} as const;

describe("startup endpoint validation", () => {
  it("normalizes a scheme-less Databricks Apps host for OAuth and endpoint probes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "oauth-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const log = vi.fn();

    const result = await validateEndpoints({
      env: {
        NODE_ENV: "test",
        DATABRICKS_HOST: "  fevm-serverless-stable-x7i65r.cloud.databricks.com/  ",
        DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
        DATABRICKS_CLIENT_ID: "client-id",
        DATABRICKS_CLIENT_SECRET: "do-not-log",
      },
      fetchImpl,
      log,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://fevm-serverless-stable-x7i65r.cloud.databricks.com/oidc/v1/token",
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://fevm-serverless-stable-x7i65r.cloud.databricks.com/api/2.0/serving-endpoints/databricks-claude-opus-4-7",
      expect.any(Object),
    );
    expect(result.state).toBe("completed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("do-not-log");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "fevm-serverless-stable-x7i65r.cloud.databricks.com",
    );
  });

  it.each([
    ["  https://workspace.example///  ", "https://workspace.example"],
    ["  http://localhost:8080/  ", "http://localhost:8080"],
  ])(
    "preserves an existing scheme and removes whitespace/trailing slashes",
    async (host, normalized) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

      const result = await validateEndpoints({
        env: {
          NODE_ENV: "test",
          DATABRICKS_HOST: host,
          DATABRICKS_TOKEN: "local-token",
          DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
        },
        fetchImpl,
        log: vi.fn(),
      });

      expect(fetchImpl).toHaveBeenCalledWith(
        `${normalized}/api/2.0/serving-endpoints/databricks-claude-opus-4-7`,
        expect.any(Object),
      );
      expect(result.state).toBe("completed");
    },
  );

  it("uses Databricks-injected OAuth credentials and prunes proven missing endpoints", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "oauth-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));

    const result = await validateEndpoints({
      env: {
        ...configuredEnv,
        DATABRICKS_CLIENT_ID: "client-id",
        DATABRICKS_CLIENT_SECRET: "client-secret",
      },
      fetchImpl,
      log: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://workspace.example/oidc/v1/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
        }),
      }),
    );
    expect(result).toMatchObject({
      state: "completed",
      validatedEndpoints: ["databricks-claude-opus-4-7"],
      configuredCount: 2,
      availableCount: 1,
      unavailableCount: 1,
    });
  });

  it("reports auth_skipped and preserves candidates when credentials are unavailable", async () => {
    const result = await validateEndpoints({
      env: configuredEnv,
      fetchImpl: vi.fn(),
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      state: "auth_skipped",
      validatedEndpoints: ["databricks-claude-opus-4-7", "databricks-claude-sonnet-4-6"],
      configuredCount: 2,
      availableCount: 2,
      unavailableCount: 0,
    });
    expect(result.diagnostic).toMatch(/credentials/i);
  });

  it("does not misreport endpoint authorization failures as a completed empty allowlist", async () => {
    const result = await validateEndpoints({
      env: { ...configuredEnv, DATABRICKS_TOKEN: "bad-token" },
      fetchImpl: vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })),
      log: vi.fn(),
    });

    expect(result.state).toBe("auth_skipped");
    expect(result.validatedEndpoints).toEqual([
      "databricks-claude-opus-4-7",
      "databricks-claude-sonnet-4-6",
    ]);
    expect(result.diagnostic).toMatch(/authentication|authorization/i);
  });

  it("distinguishes rejected injected credentials from missing credentials", async () => {
    const result = await validateEndpoints({
      env: {
        ...configuredEnv,
        DATABRICKS_CLIENT_ID: "client-id",
        DATABRICKS_CLIENT_SECRET: "rejected-secret",
      },
      fetchImpl: vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })),
      log: vi.fn(),
    });

    expect(result.state).toBe("auth_skipped");
    expect(result.diagnostic).toMatch(/token request failed.*401/i);
  });

  it("uses not_run for indeterminate transport failures while preserving candidates", async () => {
    const result = await validateEndpoints({
      env: { ...configuredEnv, DATABRICKS_TOKEN: "token" },
      fetchImpl: vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
      log: vi.fn(),
    });

    expect(result.state).toBe("not_run");
    expect(result.validatedEndpoints).toEqual([
      "databricks-claude-opus-4-7",
      "databricks-claude-sonnet-4-6",
    ]);
    expect(result.diagnostic).toMatch(/could not be established/i);
  });

  it("represents a completed probe with zero available endpoints unambiguously", async () => {
    const result = await validateEndpoints({
      env: { ...configuredEnv, DATABRICKS_API_TOKEN: "local-token" },
      fetchImpl: vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      state: "completed",
      validatedEndpoints: [],
      configuredCount: 2,
      availableCount: 0,
      unavailableCount: 2,
    });
    expect(formatValidationResult(result)).toBe("completed\n");
  });

  it("uses not_run only when there are no configured candidates", async () => {
    const result = await validateEndpoints({
      env: { NODE_ENV: "test", DATABRICKS_HOST: "https://workspace.example" },
      fetchImpl: vi.fn(),
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      state: "not_run",
      validatedEndpoints: [],
      configuredCount: 0,
    });
  });
});
