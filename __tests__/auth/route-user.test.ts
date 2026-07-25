import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// We import lazily so we can mock `next/headers` and the bearer-token
// chain per-test. Both modules are dynamic in production but the
// resolution semantics we want to verify don't actually reach
// `getBearerToken` -- we mock it to a fixed null to keep tests
// deterministic.
async function loadModule(headers: Record<string, string>) {
  vi.resetModules();
  vi.doMock("next/headers", () => ({
    headers: async () => ({
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    }),
  }));
  vi.doMock("@/lib/dbx/client", () => ({
    getBearerToken: async () => null,
  }));
  return await import("@/lib/auth/route-user");
}

describe("requireUser", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FORGE_LOCAL_USER_EMAIL;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock("next/headers");
    vi.doUnmock("@/lib/dbx/client");
  });

  it("falls back to x-forwarded-email when x-forge-user is missing", async () => {
    const { requireUser } = await loadModule({
      "x-forwarded-email": "BOB@Example.com",
    });
    const user = await requireUser();
    expect(user.email).toBe("bob@example.com");
  });

  it("captures x-forwarded-access-token onto user.oboToken", async () => {
    const { requireUser } = await loadModule({
      "x-forwarded-email": "carol@example.com",
      "x-forwarded-access-token": "obo-token-xyz",
    });
    const user = await requireUser();
    expect(user.oboToken).toBe("obo-token-xyz");
  });

  it("parses the x-forge-user JSON envelope set by proxy", async () => {
    const { requireUser } = await loadModule({
      "x-forge-user": JSON.stringify({ email: "Dave@Example.com" }),
    });
    const user = await requireUser();
    expect(user.email).toBe("dave@example.com");
  });

  it("throws when no email header is present and no local fallback is set", async () => {
    const { requireUser, ForgeAuthError } = await loadModule({});
    await expect(requireUser()).rejects.toBeInstanceOf(ForgeAuthError);
  });

  it("uses FORGE_LOCAL_USER_EMAIL fallback when in local dev with no headers", async () => {
    process.env.FORGE_LOCAL_USER_EMAIL = "local-dev@example.com";
    const { requireUser } = await loadModule({});
    const user = await requireUser();
    expect(user.email).toBe("local-dev@example.com");
  });
});
