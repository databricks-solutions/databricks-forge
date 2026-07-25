import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  saveMetricViews: vi.fn(),
  runMetricViews: vi.fn(),
  runAdHocGenie: vi.fn(),
  loadGenieSpace: vi.fn(),
}));

vi.mock("@/lib/auth/route-user", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  saveMetricViewProposals: mocks.saveMetricViews,
}));

vi.mock("@/lib/lakebase/activity-log", () => ({
  logActivity: vi.fn(),
}));

vi.mock("@/lib/genie/passes/metric-view-proposals", () => ({
  runMetricViewProposals: mocks.runMetricViews,
}));

vi.mock("@/lib/dbx/client", () => ({
  resolveEndpoint: vi.fn(() => "endpoint"),
}));

vi.mock("@/lib/queries/metadata", () => ({
  listTables: vi.fn(async () => [
    {
      fqn: "main.sales.orders",
      catalog: "main",
      schema: "sales",
      tableName: "orders",
      tableType: "MANAGED",
      comment: null,
    },
  ]),
  listColumns: vi.fn(async () => []),
  listForeignKeys: vi.fn(async () => []),
}));

vi.mock("@/lib/genie/schema-allowlist", () => ({
  buildSchemaAllowlist: vi.fn(() => ({})),
}));

vi.mock("@/lib/metric-views/seed", () => ({
  buildLightweightSeed: vi.fn(() => ({
    measures: [],
    dimensions: [],
    columnEnrichments: [],
  })),
}));

vi.mock("@/lib/metric-views/discovery", () => ({
  discoverExistingMetricViews: vi.fn(async () => []),
}));

vi.mock("@/lib/genie/adhoc-engine", () => ({
  runAdHocGenieEngine: mocks.runAdHocGenie,
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadGenieSpaceBySpaceIdOrRespond: mocks.loadGenieSpace,
}));

vi.mock("@/lib/dbx/genie", () => ({
  getGenieSpace: vi.fn(async () => ({
    title: "Sales Space",
    description: "Sales",
    serialized_space: "{}",
  })),
  sanitizeSerializedSpace: vi.fn((value) => value),
}));

vi.mock("@/lib/genie/space-cache", () => ({
  getSpaceCache: vi.fn(() => "{}"),
  setSpaceCache: vi.fn(),
}));

vi.mock("@/lib/genie/space-metadata", () => ({
  parseSerializedSpace: vi.fn(() => ({
    data_sources: { tables: [{ identifier: "main.sales.orders" }] },
  })),
}));

vi.mock("@/lib/genie/space-health-check", () => ({
  runHealthCheck: vi.fn(),
}));

vi.mock("@/lib/genie/space-fixer", () => ({
  runFixes: vi.fn(),
}));

vi.mock("@/lib/genie/improve-jobs", () => ({
  startImproveJob: vi.fn(() => new AbortController()),
  getImproveJob: vi.fn(() => null),
  updateImproveJob: vi.fn(),
  completeImproveJob: vi.fn(),
  failImproveJob: vi.fn(),
  cancelImproveJob: vi.fn(),
  dismissImproveJob: vi.fn(),
  computeImproveStats: vi.fn(() => ({})),
  computeImproveChanges: vi.fn(() => []),
}));

vi.mock("@/lib/validation", () => ({
  isSafeId: vi.fn(() => true),
  validateIdentifier: vi.fn((value: string) => value),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as generateMetricViews } from "@/app/api/metric-views/generate/route";
import { POST as improveGenieSpace } from "@/app/api/genie-spaces/[spaceId]/improve/route";

describe("metric-view generation owner propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ email: "caller@example.com" });
    mocks.runMetricViews.mockResolvedValue({ proposals: [] });
    mocks.loadGenieSpace.mockResolvedValue({
      ok: true,
      value: {
        trackingId: "tracking-1",
        ownerEmail: "space-owner@example.com",
        spaceId: "space-1",
        offPlatform: false,
      },
    });
    mocks.runAdHocGenie.mockResolvedValue({
      recommendation: {
        serializedSpace: "{}",
        title: "Sales Space",
      },
    });
  });

  it("derives standalone proposal ownership from requireUser", async () => {
    const response = await generateMetricViews(
      new Request("http://localhost/api/metric-views/generate", {
        method: "POST",
        body: JSON.stringify({ schemaScope: "main.sales" }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.saveMetricViews).toHaveBeenCalledWith(
      null,
      "main.sales",
      null,
      [],
      "caller@example.com",
    );
  });

  it("passes the guarded space owner into full ad-hoc generation", async () => {
    const response = await improveGenieSpace(
      new Request("http://localhost/api/genie-spaces/space-1/improve", {
        method: "POST",
        body: JSON.stringify({ config: { mode: "full" } }),
      }) as never,
      { params: Promise.resolve({ spaceId: "space-1" }) },
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(mocks.runAdHocGenie).toHaveBeenCalledWith(
        expect.objectContaining({ ownerEmail: "space-owner@example.com" }),
      ),
    );
  });
});
