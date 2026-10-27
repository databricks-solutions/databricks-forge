import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPoolAvailability: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: vi.fn(async () => ({ $queryRawUnsafe: vi.fn(async () => 1) })),
  getDatabaseAuthRuntimeState: vi.fn(() => ({ ready: true, authMode: "oauth" })),
}));
vi.mock("@/lib/dbx/sql", () => ({ executeSQL: vi.fn(async () => []) }));
vi.mock("@/lib/dbx/client", () => ({
  getCurrentUserEmail: vi.fn(async () => null),
  getConfig: vi.fn(() => ({ host: "https://workspace.example" })),
}));
vi.mock("@/lib/genie/metric-views-config", () => ({ isMetricViewsEnabled: vi.fn(() => false) }));
vi.mock("@/lib/demo/config", () => ({ isDemoModeEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/pipeline/memory-monitor", () => ({ getMemorySnapshot: vi.fn(() => ({})) }));
vi.mock("@/lib/dbx/model-registry", () => ({
  getPoolAvailability: mocks.getPoolAvailability,
}));

import { GET } from "@/app/api/health/route";

const MUTATED_ENV_KEYS = [
  "DATABRICKS_HOST",
  "FORGE_ENDPOINT_VALIDATION_STATE",
  "FORGE_VALIDATED_ENDPOINTS",
  "DATABRICKS_SERVING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_FAST",
  "DATABRICKS_REVIEW_ENDPOINT",
  "DATABRICKS_ALLOWED_MODELS",
] as const;

function healthRequest(options?: { authenticated?: boolean }) {
  return new Request(
    "http://localhost/api/health",
    options?.authenticated ? { headers: { "x-forwarded-email": "operator@example.com" } } : {},
  );
}

describe("GET /api/health endpoint validation state", () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of MUTATED_ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    mocks.getPoolAvailability.mockReturnValue({
      available: ["databricks-claude-opus-4-7", "databricks-gpt-5-4"],
      unavailable: ["databricks-gemini-3-flash"],
      total: 3,
    });
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
  });

  it("reports auth_skipped as degraded without exposing counts before auth", async () => {
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "auth_skipped";
    process.env.FORGE_VALIDATED_ENDPOINTS =
      "databricks-claude-opus-4-7,databricks-gpt-5-4,databricks-gemini-3-flash";

    const response = await GET(healthRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    // Unauthenticated callers get coarse state only -- pool sizing is an
    // operational diagnostic, not a liveness signal.
    expect(body.endpointValidation).toEqual({ state: "auth_skipped", status: "degraded" });
    expect(JSON.stringify(body.endpointValidation)).not.toContain("databricks-");
  });

  it("keeps authenticated auth_skipped diagnostics complete with no endpoint names", async () => {
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "auth_skipped";
    process.env.FORGE_VALIDATED_ENDPOINTS =
      "databricks-claude-opus-4-7,databricks-gpt-5-4,databricks-gemini-3-flash";

    const response = await GET(healthRequest({ authenticated: true }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.endpointValidation).toEqual({
      state: "auth_skipped",
      status: "degraded",
      configured: 3,
      available: 2,
      unavailable: 1,
      exhausted: false,
    });
    expect(JSON.stringify(body.endpointValidation)).not.toContain("databricks-");
  });

  it("reports completed validation counts to authenticated callers without degrading a usable pool", async () => {
    process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-7";
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "completed";
    process.env.FORGE_VALIDATED_ENDPOINTS = "databricks-claude-opus-4-7,databricks-gpt-5-4";

    const response = await GET(healthRequest({ authenticated: true }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe("healthy");
    expect(body.endpointValidation).toEqual({
      state: "completed",
      status: "healthy",
      configured: 3,
      available: 2,
      unavailable: 1,
      exhausted: false,
    });
  });

  it("hides pool counts from unauthenticated callers on a healthy deployment", async () => {
    process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-7";
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "completed";
    process.env.FORGE_VALIDATED_ENDPOINTS = "databricks-claude-opus-4-7,databricks-gpt-5-4";

    const response = await GET(healthRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe("healthy");
    expect(body.endpointValidation).toEqual({ state: "completed", status: "healthy" });
    expect(body).not.toHaveProperty("modelPool");
    expect(body).not.toHaveProperty("checks");
  });

  it("reports runtime endpoint exhaustion as degraded instead of a restart-triggering 503", async () => {
    process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-7";
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "completed";
    process.env.FORGE_VALIDATED_ENDPOINTS = "databricks-claude-opus-4-7";
    // Every endpoint was admitted at startup and later rotated out by runtime
    // 404 handling; a container restart cannot recover that.
    mocks.getPoolAvailability.mockReturnValue({
      available: [],
      unavailable: ["databricks-claude-opus-4-7"],
      total: 1,
    });

    const response = await GET(healthRequest({ authenticated: true }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.endpointValidation).toEqual({
      state: "completed",
      status: "degraded",
      configured: 1,
      available: 0,
      unavailable: 1,
      exhausted: true,
    });
  });

  it("keeps completed startup validation with no admitted required endpoint fatal", async () => {
    process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-7";
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "completed";
    process.env.FORGE_VALIDATED_ENDPOINTS = "databricks-gemini-3-flash";
    mocks.getPoolAvailability.mockReturnValue({
      available: [],
      unavailable: ["databricks-claude-opus-4-7"],
      total: 1,
    });

    const response = await GET(healthRequest({ authenticated: true }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.endpointValidation).toMatchObject({
      state: "completed",
      available: 0,
      exhausted: true,
    });
  });

  it("still fails an unauthenticated liveness probe closed when startup admission failed", async () => {
    process.env.DATABRICKS_SERVING_ENDPOINT = "databricks-claude-opus-4-7";
    process.env.FORGE_ENDPOINT_VALIDATION_STATE = "completed";
    process.env.FORGE_VALIDATED_ENDPOINTS = "databricks-gemini-3-flash";
    mocks.getPoolAvailability.mockReturnValue({
      available: [],
      unavailable: ["databricks-claude-opus-4-7"],
      total: 1,
    });

    const response = await GET(healthRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.endpointValidation).toEqual({ state: "completed", status: "unhealthy" });
  });
});
