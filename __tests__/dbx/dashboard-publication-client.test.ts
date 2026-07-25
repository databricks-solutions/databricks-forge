import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  getAppHeaders: vi.fn(),
}));

vi.mock("@/lib/dbx/client", () => ({
  getConfig: vi.fn(() => ({
    host: "https://example.cloud.databricks.com",
    warehouseId: "warehouse-1",
  })),
  getAppHeaders: mocks.getAppHeaders,
}));
vi.mock("@/lib/dbx/fetch-with-timeout", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  TIMEOUTS: { WORKSPACE: 30_000 },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createDashboard,
  getDashboard,
  getPublishedDashboard,
  publishDashboard,
  updateDashboard,
} from "@/lib/dbx/dashboards";
import { dashboardApiError } from "@/lib/dbx/dashboard-capability";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppHeaders.mockResolvedValue({
    Authorization: "Bearer app-m2m-token",
    "Content-Type": "application/json",
  });
  mocks.fetchWithTimeout.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      display_name: "Sales",
      warehouse_id: "warehouse-1",
      embed_credentials: false,
      revision_create_time: "2026-07-24T08:00:00.000Z",
    }),
  });
});

describe("getPublishedDashboard", () => {
  it("uses the published GET endpoint and the captured OBO token", async () => {
    const result = await getPublishedDashboard("dash-1", {
      mode: "user",
      oboToken: "request-obo-token",
    });

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "https://example.cloud.databricks.com/api/2.0/lakeview/dashboards/dash-1/published",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer request-obo-token",
          "Content-Type": "application/json",
        },
      },
      30_000,
    );
    expect(result).toMatchObject({
      dashboard_id: "dash-1",
      revision_create_time: "2026-07-24T08:00:00.000Z",
    });
    expect(mocks.getAppHeaders).not.toHaveBeenCalled();
  });
});

describe("Lakeview OBO scope capability", () => {
  it("classifies the deployed 403 missing dashboards scope payload explicitly", async () => {
    mocks.fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error_code: "PERMISSION_DENIED",
          message: "Missing required scope: dashboards",
        }),
    });

    await expect(
      getDashboard("external-dashboard", {
        mode: "user",
        oboToken: "request-obo-token",
      }),
    ).rejects.toMatchObject({
      name: "DashboardScopeUnsupportedError",
      code: "DASHBOARD_OBO_SCOPE_UNSUPPORTED",
      status: 403,
      requiredScope: "dashboards",
      operation: "get dashboard",
    });
    expect(mocks.getAppHeaders).not.toHaveBeenCalled();
  });

  it("retains a precise M2M denial instead of classifying app mode as OBO unavailable", async () => {
    mocks.fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error_code: "PERMISSION_DENIED",
          message: "Provided OAuth token does not have required scopes: dashboards",
        }),
    });

    await expect(
      createDashboard({
        displayName: "Sales",
        serializedDashboard: '{"datasets":[],"pages":[]}',
        warehouseId: "warehouse-1",
        parentPath: "/Shared/Forge Dashboards/",
        auth: { mode: "app" },
      }),
    ).rejects.toMatchObject({
      name: "DashboardApiError",
      status: 403,
      operation: "create dashboard",
      diagnosticCode: "PERMISSION_DENIED",
      diagnosticMessage: "Provided OAuth token does not have required scopes: dashboards",
    });
  });

  it("does not classify ordinary dashboard permission failures as missing scope", () => {
    const error = dashboardApiError(
      403,
      JSON.stringify({
        error_code: "PERMISSION_DENIED",
        message: "User does not have permission to access dashboard external-dashboard",
      }),
      "get dashboard",
    );

    expect(error).toMatchObject({
      name: "DashboardApiError",
      status: 403,
      operation: "get dashboard",
      diagnosticCode: "PERMISSION_DENIED",
      diagnosticMessage: "User does not have permission to access dashboard external-dashboard",
    });
    expect(error).not.toHaveProperty("requiredScope");
  });

  it("does not classify dashboards.genie as the unavailable dashboards scope", () => {
    const error = dashboardApiError(
      403,
      JSON.stringify({
        error_code: "PERMISSION_DENIED",
        message: "Missing required scope: dashboards.genie",
      }),
      "get dashboard",
    );

    expect(error).toMatchObject({
      name: "DashboardApiError",
      diagnosticCode: "PERMISSION_DENIED",
      diagnosticMessage: "Missing required scope: dashboards.genie",
    });
    expect(error).not.toHaveProperty("requiredScope");
  });

  it("retains bounded diagnostics while redacting SQL, prompts, and bearer tokens", () => {
    const error = dashboardApiError(
      500,
      JSON.stringify({
        error_code: "INTERNAL_ERROR",
        message:
          "Warehouse failed; SELECT * FROM private.customer; Authorization: Bearer secret-token; prompt=private strategy",
      }),
      "create dashboard",
    ) as Error & {
      diagnosticCode?: string;
      diagnosticMessage?: string;
    };

    expect(error).toMatchObject({
      name: "DashboardApiError",
      status: 500,
      operation: "create dashboard",
      diagnosticCode: "INTERNAL_ERROR",
    });
    expect(error.diagnosticMessage).toContain("Warehouse failed");
    expect(error.diagnosticMessage?.length).toBeLessThanOrEqual(240);
    for (const secret of [
      "SELECT",
      "private.customer",
      "Bearer",
      "secret-token",
      "prompt",
      "private strategy",
    ]) {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error.message).not.toContain(secret);
    }
  });

  it.each([
    [
      "Basic authorization",
      "Request failed; Authorization: Basic dXNlcjpzZWNyZXQ=",
      ["Basic", "dXNlcjpzZWNyZXQ="],
    ],
    [
      "Bearer authorization",
      "Request failed; Authorization: Bearer bearer-secret",
      ["Bearer", "bearer-secret"],
    ],
    [
      "arbitrary authorization scheme",
      "Request failed; Authorization: DPoP arbitrary-credential",
      ["DPoP", "arbitrary-credential"],
    ],
    [
      "underscored query tokens",
      "Request failed?access_token=access-secret&client_secret=client-secret",
      ["access-secret", "client-secret"],
    ],
    ["dashed header token", "Request failed; refresh-token: refresh-secret", ["refresh-secret"]],
    ["camel-case secret", "Request failed; clientSecret=camel-secret", ["camel-secret"]],
    ["API key query", "Request failed?api_key=api-secret&safe=value", ["api-secret"]],
    [
      "password JSON-style value",
      'Request failed; "password": "password-secret"',
      ["password-secret"],
    ],
  ])("redacts %s credentials", (_label, message, secrets) => {
    const error = dashboardApiError(
      500,
      JSON.stringify({ error_code: "INTERNAL_ERROR", message }),
      "get dashboard",
    ) as Error & { diagnosticCode?: string; diagnosticMessage?: string };

    expect(error.diagnosticCode).toBe("INTERNAL_ERROR");
    expect(error.diagnosticMessage).toContain("Request failed");
    for (const secret of secrets) {
      expect(error.diagnosticMessage).not.toContain(secret);
      expect(error.message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("does not redact ordinary security vocabulary without credential values", () => {
    const message =
      "Password policy rejected the client secret rotation; refresh token endpoint unavailable; API key metadata missing";
    const error = dashboardApiError(
      400,
      JSON.stringify({ error_code: "BAD_REQUEST", message }),
      "get dashboard",
    ) as Error & { diagnosticMessage?: string };

    expect(error.diagnosticMessage).toBe(message);
  });
});

describe("createDashboard name conflicts", () => {
  it("returns the actual suffixed display name selected by the create response", async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => "RESOURCE_ALREADY_EXISTS",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          dashboard_id: "dash-2",
          display_name: "Sales (2)",
          warehouse_id: "warehouse-1",
          parent_path: "/Shared/Forge Dashboards/",
        }),
      });

    const result = await createDashboard({
      displayName: "Sales",
      serializedDashboard: '{"datasets":[],"pages":[]}',
      warehouseId: "warehouse-1",
      parentPath: "/Shared/Forge Dashboards/",
      auth: { mode: "user", oboToken: "request-obo-token" },
    });

    expect(result).toMatchObject({
      dashboard_id: "dash-2",
      display_name: "Sales (2)",
    });
    expect(JSON.parse(mocks.fetchWithTimeout.mock.calls[1][1].body)).toMatchObject({
      display_name: "Sales (2)",
    });
  });
});

describe("explicit dashboard auth mode", () => {
  it("forwards the exact user OBO token without requesting app credentials", async () => {
    await createDashboard({
      displayName: "Sales",
      serializedDashboard: '{"datasets":[],"pages":[]}',
      warehouseId: "warehouse-1",
      auth: { mode: "user", oboToken: "exact-request-token" },
    });

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "https://example.cloud.databricks.com/api/2.0/lakeview/dashboards",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer exact-request-token",
          "Content-Type": "application/json",
        },
      }),
      30_000,
    );
    expect(mocks.getAppHeaders).not.toHaveBeenCalled();
  });

  it("uses app M2M for create, update, read-back, publish, and publication read-back", async () => {
    await createDashboard({
      displayName: "Sales",
      serializedDashboard: '{"datasets":[],"pages":[]}',
      warehouseId: "warehouse-1",
      auth: { mode: "app" },
    });
    await updateDashboard("dash-1", {
      displayName: "Sales",
      auth: { mode: "app" },
    });
    await getDashboard("dash-1", { mode: "app" });
    await publishDashboard("dash-1", "warehouse-1", false, { mode: "app" });
    await getPublishedDashboard("dash-1", { mode: "app" });

    expect(mocks.getAppHeaders).toHaveBeenCalledTimes(5);
    for (const [, init] of mocks.fetchWithTimeout.mock.calls) {
      expect(init.headers).toEqual({
        Authorization: "Bearer app-m2m-token",
        "Content-Type": "application/json",
      });
      expect(JSON.stringify(init.headers)).not.toContain("request");
      expect(JSON.stringify(init.headers)).not.toContain("obo");
    }
  });
});
