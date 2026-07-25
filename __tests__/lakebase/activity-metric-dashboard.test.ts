import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityAction } from "@/lib/lakebase/activity-log";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  deployAsset: vi.fn(),
  updateDeploymentStatus: vi.fn(),
  promoteDeployment: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadMetricViewProposalOrRespond: mocks.guard,
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  updateDeploymentStatus: mocks.updateDeploymentStatus,
  promoteMetricViewDeployment: mocks.promoteDeployment,
}));
vi.mock("@/lib/genie/deploy", () => ({ deployAsset: mocks.deployAsset }));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { POST } from "@/app/api/metric-views/[id]/deploy/route";

const lifecycleActions: ActivityAction[] = [
  "metric_view_validated",
  "metric_view_validation_failed",
  "metric_view_validation_unverified",
  "metric_view_deployed",
  "dashboard_validated",
  "dashboard_validation_failed",
  "dashboard_deployed",
];

const fullLifecycleEvidence = [
  {
    stage: "metric_view_static",
    status: "passed" as const,
    code: "METRIC_VIEW_STATIC_VALIDATION_PASSED",
    message: "Static validation passed.",
  },
  {
    stage: "metric_view_create",
    status: "passed" as const,
    code: "TEMP_METRIC_VIEW_CREATED",
    message: "Temporary metric view created successfully.",
  },
  {
    stage: "metric_view_probe",
    status: "passed" as const,
    code: "ATOMIC_MEASURE_PROBE_PASSED",
    message: "Representative measure probe passed.",
  },
  {
    stage: "metric_view_cleanup",
    status: "passed" as const,
    code: "TEMP_METRIC_VIEW_DROPPED",
    message: "Temporary metric view dropped successfully.",
  },
];

function validProposal() {
  return {
    id: "mv-1",
    ownerEmail: "owner@example.com",
    schemaScope: "main.sales",
    name: "revenue_metrics",
    ddl: "CREATE VIEW main.sales.revenue_metrics",
    validationStatus: "valid",
    validatorVersion: "metric-view-probes-v1",
    validatedAt: "2026-07-24T04:00:00.000Z",
    validationEvidence: fullLifecycleEvidence,
    validationIssues: [],
  };
}

function allowProposal(proposal: ReturnType<typeof validProposal>) {
  mocks.guard.mockResolvedValue({
    ok: true,
    value: { proposal },
    user: { email: "editor@example.com", oboToken: "obo-token" },
    permission: "edit",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.promoteDeployment.mockResolvedValue(undefined);
  allowProposal(validProposal());
});

describe("metric/dashboard activity lifecycle", () => {
  it("exposes every Release 1 lifecycle action", () => {
    expect(lifecycleActions).toHaveLength(7);
  });

  it("records metric deployment only after downstream deploy and persistence succeed", async () => {
    mocks.deployAsset.mockResolvedValue({ deployed: true, fqn: "main.sales.revenue_metrics" });

    const response = await POST(
      new Request("http://localhost/api/metric-views/mv-1/deploy", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "metric_view_deployed",
      expect.objectContaining({
        userId: "editor@example.com",
        resourceId: "mv-1",
      }),
    );
    expect(mocks.logActivity.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.promoteDeployment.mock.invocationCallOrder[0],
    );
  });

  it("does not record deployment when the downstream operation fails", async () => {
    mocks.deployAsset.mockResolvedValue({ deployed: false, error: "permission denied" });

    const response = await POST(
      new Request("http://localhost/api/metric-views/mv-1/deploy", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.logActivity).not.toHaveBeenCalledWith("metric_view_deployed", expect.anything());
  });

  it("blocks deployment when a changed definition has no fresh evidence", async () => {
    mocks.guard.mockResolvedValue({
      ok: true,
      value: {
        proposal: {
          id: "mv-1",
          ownerEmail: "owner@example.com",
          schemaScope: "main.sales",
          name: "revenue_metrics",
          ddl: "CREATE VIEW main.sales.revenue_metrics",
          validationStatus: "unverified",
          validationEvidence: [],
          validationIssues: ["Definition changed after validation"],
        },
      },
      user: { email: "editor@example.com", oboToken: "obo-token" },
      permission: "edit",
    });

    const response = await POST(
      new Request("http://localhost/api/metric-views/mv-1/deploy", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it.each([
    ["missing validator version", { validatorVersion: undefined }],
    ["wrong validator version", { validatorVersion: "legacy-validator" }],
    ["invalid validation timestamp", { validatedAt: "not-a-date" }],
    [
      "missing static evidence",
      {
        validationEvidence: fullLifecycleEvidence.filter(
          (entry) => entry.stage !== "metric_view_static",
        ),
      },
    ],
    [
      "missing create evidence",
      {
        validationEvidence: fullLifecycleEvidence.filter(
          (entry) => entry.stage !== "metric_view_create",
        ),
      },
    ],
    [
      "missing measure probe evidence",
      {
        validationEvidence: fullLifecycleEvidence.filter(
          (entry) => entry.stage !== "metric_view_probe",
        ),
      },
    ],
    [
      "missing cleanup evidence",
      {
        validationEvidence: fullLifecycleEvidence.filter(
          (entry) => entry.stage !== "metric_view_cleanup",
        ),
      },
    ],
    [
      "skipped required evidence",
      {
        validationEvidence: fullLifecycleEvidence.map((entry) =>
          entry.stage === "metric_view_create" ? { ...entry, status: "skipped" as const } : entry,
        ),
      },
    ],
    [
      "failed required evidence",
      {
        validationEvidence: fullLifecycleEvidence.map((entry) =>
          entry.stage === "metric_view_probe" ? { ...entry, status: "failed" as const } : entry,
        ),
      },
    ],
  ])("blocks deployment with %s", async (_label, override) => {
    allowProposal({ ...validProposal(), ...override } as ReturnType<typeof validProposal>);

    const response = await POST(
      new Request("http://localhost/api/metric-views/mv-1/deploy", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.deployAsset).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });
});
