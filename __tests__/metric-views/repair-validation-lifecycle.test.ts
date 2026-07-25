import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  loadMetadata: vi.fn(),
  validateFull: vi.fn(),
  updateProposal: vi.fn(),
  updateDeploymentStatus: vi.fn(),
  getProposal: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  loadMetricViewProposalOrRespond: mocks.guard,
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  getMetricViewProposalById: mocks.getProposal,
  updateMetricViewProposal: mocks.updateProposal,
  updateDeploymentStatus: mocks.updateDeploymentStatus,
}));
vi.mock("@/lib/lakebase/metadata-cache", () => ({ loadMetadataForRun: mocks.loadMetadata }));
vi.mock("@/lib/genie/schema-allowlist", () => ({
  buildSchemaAllowlist: vi.fn(() => ({ tables: new Map() })),
  buildSchemaContextBlock: vi.fn(() => "schema"),
  buildCompactColumnsBlock: vi.fn(() => "columns"),
}));
vi.mock("@/lib/genie/passes/metric-view-proposals", () => ({
  validateMetricViewYaml: vi.fn(() => ({ status: "valid", issues: [] })),
  validateMetricViewDefinitionWithProbes: mocks.validateFull,
  nestSnowflakeJoins: vi.fn((value) => value),
  qualifyNestedAliasRefs: vi.fn((value) => value),
  autoRenameCollidingJoinAliases: vi.fn((yaml, ddl) => ({ yaml, ddl })),
  autoRenameShadowedMeasures: vi.fn((yaml, ddl) => ({ yaml, ddl })),
  autoRenameShadowedDimensions: vi.fn((yaml, ddl) => ({ yaml, ddl })),
  autoFixMaterializationRefs: vi.fn((yaml, ddl) => ({ yaml, ddl })),
  repairProposal: vi.fn(),
  hasColumnErrors: vi.fn(() => false),
}));
vi.mock("@/lib/dbx/client", () => ({ resolveEndpoint: vi.fn(() => "endpoint") }));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/metric-views/[id]/repair/route";

const legacyYaml = `measures:
  - expr: SUM(amount)
    name: total_revenue
version: "1.1"
dimensions:
  - expr: DATE_TRUNC('MONTH', order_date)
    name: order_month
source: main.sales.orders
`;

const staleProposal = {
  id: "mv-1",
  runId: "run-1",
  ownerEmail: "owner@example.com",
  schemaScope: "main.sales",
  name: "revenue_metrics",
  description: "Revenue",
  yaml: legacyYaml,
  ddl:
    "CREATE OR REPLACE VIEW `published-cat`.`semantic-schema`.`stable-name`\n" +
    "WITH METRICS\nLANGUAGE YAML\nAS $$\n" +
    legacyYaml +
    "$$",
  sourceTables: ["main.sales.orders"],
  hasJoins: false,
  validationStatus: "valid",
  validationIssues: [],
  validatorVersion: "stale-validator",
  validationEvidence: [
    { stage: "metric_view_probe", status: "passed", code: "STALE", message: "stale" },
  ],
  validatedAt: "2026-01-01T00:00:00.000Z",
  deploymentStatus: "proposed",
};

const freshEvidence = [
  {
    stage: "metric_view_static",
    status: "passed" as const,
    code: "METRIC_VIEW_STATIC_VALIDATION_PASSED",
    message: "static validation passed",
  },
  {
    stage: "metric_view_create",
    status: "passed" as const,
    code: "TEMP_METRIC_VIEW_CREATED",
    message: "created",
  },
  {
    stage: "metric_view_probe",
    status: "passed" as const,
    code: "ATOMIC_MEASURE_PROBE_PASSED",
    message: "probed",
  },
  {
    stage: "metric_view_cleanup",
    status: "passed" as const,
    code: "TEMP_METRIC_VIEW_DROPPED",
    message: "dropped",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    ok: true,
    value: { proposal: staleProposal },
    user: { email: "editor@example.com", oboToken: "obo-token" },
    permission: "edit",
  });
  mocks.loadMetadata.mockResolvedValue({ tables: [], columns: [] });
  mocks.getProposal.mockResolvedValue({ ...staleProposal });
});

async function repair() {
  return POST(
    new Request("http://localhost/api/metric-views/mv-1/repair", { method: "POST" }) as never,
    { params: Promise.resolve({ id: "mv-1" }) },
  );
}

describe("metric-view repair validation freshness", () => {
  it("persists fresh full-probe evidence before logging validation success", async () => {
    mocks.validateFull.mockResolvedValue({
      status: "valid",
      issues: [],
      evidence: freshEvidence,
      validatorVersion: "metric-view-probes-v1",
      validatedAt: "2026-07-24T04:00:00.000Z",
    });

    const response = await repair();

    expect(response.status).toBe(200);
    expect(mocks.validateFull).toHaveBeenCalledWith(
      expect.objectContaining({
        yaml: expect.stringMatching(/^version: "1.1"\nsource: main\.sales\.orders\n/),
        ddl: expect.stringMatching(
          /^CREATE OR REPLACE VIEW `published-cat`\.`semantic-schema`\.`stable-name`/,
        ),
      }),
    );
    expect(mocks.updateProposal).toHaveBeenCalledWith(
      "mv-1",
      expect.objectContaining({
        definition: expect.objectContaining({
          name: "revenue_metrics",
          source: { kind: "table", table: "main.sales.orders" },
        }),
        validationStatus: "valid",
        validationEvidence: freshEvidence,
        validatorVersion: "metric-view-probes-v1",
        validatedAt: "2026-07-24T04:00:00.000Z",
      }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "metric_view_validated",
      expect.objectContaining({ resourceId: "mv-1" }),
    );
    expect(mocks.logActivity.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.updateProposal.mock.invocationCallOrder[0],
    );
  });

  it("persists permission-limited repair as unverified with fresh evidence", async () => {
    const evidence = [
      {
        stage: "metric_view_create",
        status: "skipped",
        code: "TEMP_METRIC_VIEW_PERMISSION_UNVERIFIED",
        message: "permission denied",
      },
    ];
    mocks.validateFull.mockResolvedValue({
      status: "unverified",
      issues: ["CREATE VIEW permission unavailable"],
      evidence,
      validatorVersion: "metric-view-probes-v1",
      validatedAt: "2026-07-24T04:01:00.000Z",
    });

    await repair();

    expect(mocks.updateProposal).toHaveBeenCalledWith(
      "mv-1",
      expect.objectContaining({
        validationStatus: "unverified",
        validationEvidence: evidence,
      }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "metric_view_validation_unverified",
      expect.anything(),
    );
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "metric_view_validated",
      expect.anything(),
    );
  });

  it("persists failed probes as error and logs validation failure", async () => {
    const evidence = [
      {
        stage: "metric_view_probe",
        status: "failed",
        code: "ATOMIC_MEASURE_PROBE_EXECUTION_FAILED",
        message: "probe failed",
      },
    ];
    mocks.validateFull.mockResolvedValue({
      status: "error",
      issues: ["probe failed"],
      evidence,
      validatorVersion: "metric-view-probes-v1",
      validatedAt: "2026-07-24T04:02:00.000Z",
    });

    await repair();

    expect(mocks.updateProposal).toHaveBeenCalledWith(
      "mv-1",
      expect.objectContaining({
        validationStatus: "error",
        validationEvidence: evidence,
      }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "metric_view_validation_failed",
      expect.anything(),
    );
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "metric_view_validated",
      expect.anything(),
    );
  });

  it("does not log validation success for incomplete provenance", async () => {
    mocks.validateFull.mockResolvedValue({
      status: "valid",
      issues: [],
      evidence: freshEvidence.filter((entry) => entry.stage !== "metric_view_cleanup"),
      validatorVersion: "metric-view-probes-v1",
      validatedAt: "2026-07-24T04:03:00.000Z",
    });

    await repair();

    expect(mocks.logActivity).toHaveBeenCalledWith(
      "metric_view_validation_failed",
      expect.anything(),
    );
    expect(mocks.logActivity).not.toHaveBeenCalledWith(
      "metric_view_validated",
      expect.anything(),
    );
  });

  it("fails closed before runtime validation when repaired YAML cannot parse", async () => {
    mocks.guard.mockResolvedValue({
      ok: true,
      value: {
        proposal: {
          ...staleProposal,
          yaml: "version: [",
          validatorVersion: "metric-view-probes-v1",
          validatedAt: "2026-07-24T03:00:00.000Z",
          validationEvidence: freshEvidence,
        },
      },
      user: { email: "editor@example.com", oboToken: "obo-token" },
      permission: "edit",
    });
    mocks.getProposal.mockResolvedValue({
      ...staleProposal,
      validationStatus: "error",
      validatorVersion: null,
      validatedAt: null,
      validationEvidence: [
        {
          stage: "metric_view_parse",
          status: "failed",
          code: "METRIC_VIEW_PARSE_FAILED",
          message: "parse failed",
        },
      ],
    });

    const response = await repair();

    expect(response.status).toBe(200);
    expect(mocks.validateFull).not.toHaveBeenCalled();
    expect(mocks.updateProposal).toHaveBeenCalledWith(
      "mv-1",
      expect.objectContaining({
        definition: null,
        validationStatus: "error",
        validatorVersion: null,
        validatedAt: null,
        validationEvidence: [
          expect.objectContaining({
            stage: "metric_view_parse",
            status: "failed",
            code: "METRIC_VIEW_PARSE_FAILED",
          }),
        ],
      }),
    );
  });
});
