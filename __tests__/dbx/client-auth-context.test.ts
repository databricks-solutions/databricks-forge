import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("outside request context");
  },
}));

import { runWithDatabricksAuthContext } from "@/lib/dbx/auth-context";
import { getBearerToken, getHeaders } from "@/lib/dbx/client";

describe("Databricks client auth context", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DATABRICKS_TOKEN = "pat-fallback";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses contextual OBO headers after request headers are unavailable", async () => {
    const headers = await runWithDatabricksAuthContext({ oboToken: "obo-context" }, () =>
      getHeaders(),
    );

    expect(headers.Authorization).toBe("Bearer obo-context");
  });

  it("prefers contextual OBO over PAT and service-principal fallbacks", async () => {
    process.env.DATABRICKS_CLIENT_ID = "client-id";
    process.env.DATABRICKS_CLIENT_SECRET = "client-secret";

    const token = await runWithDatabricksAuthContext({ oboToken: "obo-context" }, () =>
      getBearerToken(),
    );

    expect(token).toBe("obo-context");
  });

  it("fails closed when deferred user-scoped work has no OBO token", async () => {
    process.env.DATABRICKS_TOKEN = "pat-fallback";
    process.env.DATABRICKS_API_TOKEN = "api-token-fallback";
    process.env.DATABRICKS_CLIENT_ID = "client-id";
    process.env.DATABRICKS_CLIENT_SECRET = "client-secret";

    await expect(
      runWithDatabricksAuthContext({ oboToken: null }, () => getBearerToken()),
    ).rejects.toThrow("Databricks OBO token is required for deferred user-scoped work");
  });

  it("returns to the normal fallback chain outside the context", async () => {
    await runWithDatabricksAuthContext({ oboToken: "obo-context" }, () => getBearerToken());

    await expect(getBearerToken()).resolves.toBe("pat-fallback");
  });
});
