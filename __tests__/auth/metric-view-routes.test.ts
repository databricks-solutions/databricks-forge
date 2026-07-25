import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listAccessibleIds: vi.fn(),
  loadMetricViewProposalOrRespond: vi.fn(),
  loadRunOrRespond: vi.fn(),
  getByRun: vi.fn(),
  getBySchema: vi.fn(),
  getByRunDomain: vi.fn(),
  updateProposal: vi.fn(),
  deleteProposal: vi.fn(),
  updateDeploymentStatus: vi.fn(),
  deployAsset: vi.fn(),
  checkDependencies: vi.fn(),
  share: vi.fn(),
  logActivity: vi.fn(),
  findUniqueProposal: vi.fn(),
}));

vi.mock("@/lib/auth/route-user", () => ({
  requireUser: mocks.requireUser,
  ForgeAuthError: class ForgeAuthError extends Error {},
}));
vi.mock("@/lib/auth/route-guards", () => ({
  loadMetricViewProposalOrRespond: mocks.loadMetricViewProposalOrRespond,
  loadRunOrRespond: mocks.loadRunOrRespond,
}));
vi.mock("@/lib/lakebase/acl", () => ({
  RESOURCE_TYPES: ["metric_view_proposal"],
  listAccessibleIds: mocks.listAccessibleIds,
  listAclForResource: vi.fn(),
  share: mocks.share,
  unshare: vi.fn(),
}));
vi.mock("@/lib/lakebase/metric-view-proposals", () => ({
  getMetricViewProposalsByRun: mocks.getByRun,
  getMetricViewProposalsBySchema: mocks.getBySchema,
  getMetricViewProposalsByRunDomain: mocks.getByRunDomain,
  getMetricViewProposalById: vi.fn(),
  updateMetricViewProposal: mocks.updateProposal,
  deleteMetricViewProposal: mocks.deleteProposal,
  updateDeploymentStatus: mocks.updateDeploymentStatus,
}));
vi.mock("@/lib/genie/metric-view-dependencies", () => ({
  checkMetricViewDependencies: mocks.checkDependencies,
}));
vi.mock("@/lib/genie/deploy", () => ({ deployAsset: mocks.deployAsset }));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T>(
    callback: (prisma: {
      forgeMetricViewProposal: { findUnique: typeof mocks.findUniqueProposal };
    }) => Promise<T>,
  ) =>
    callback({
      forgeMetricViewProposal: { findUnique: mocks.findUniqueProposal },
    }),
}));
vi.mock("@/lib/validation", () => ({
  isValidUUID: vi.fn(() => true),
  validateFqn: vi.fn((fqn: string) => fqn.replace(/`/g, "")),
  validateIdentifier: vi.fn((identifier: string) => identifier),
  IdentifierValidationError: class IdentifierValidationError extends Error {},
}));
vi.mock("@/lib/dbx/client", () => ({ resolveEndpoint: vi.fn(() => "endpoint") }));
vi.mock("@/lib/lakebase/metadata-cache", () => ({ loadMetadataForRun: vi.fn() }));
vi.mock("@/lib/genie/schema-allowlist", () => ({
  buildSchemaAllowlist: vi.fn(),
  buildSchemaContextBlock: vi.fn(),
  buildCompactColumnsBlock: vi.fn(),
}));
vi.mock("@/lib/genie/passes/metric-view-proposals", () => ({
  validateMetricViewYaml: vi.fn(),
  nestSnowflakeJoins: vi.fn((value) => value),
  qualifyNestedAliasRefs: vi.fn((value) => value),
  autoRenameCollidingJoinAliases: vi.fn(),
  autoRenameShadowedMeasures: vi.fn(),
  autoRenameShadowedDimensions: vi.fn(),
  autoFixMaterializationRefs: vi.fn(),
  repairProposal: vi.fn(),
  hasColumnErrors: vi.fn(),
  dryRunMetricViewDdl: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET as listProposals } from "@/app/api/metric-views/route";
import {
  GET as getProposal,
  PATCH as patchProposal,
  DELETE as deleteProposal,
} from "@/app/api/metric-views/[id]/route";
import { POST as repairProposal } from "@/app/api/metric-views/[id]/repair/route";
import { POST as deployProposal } from "@/app/api/metric-views/[id]/deploy/route";
import { POST as checkDependencies } from "@/app/api/metric-views/check-dependencies/route";
import { POST as shareResource } from "@/app/api/share/route";

const caller = { email: "caller@example.com", oboToken: "obo-token" };
const proposal = {
  id: "mv-1",
  ownerEmail: "owner@example.com",
  runId: "00000000-0000-4000-8000-000000000001",
  schemaScope: "main.sales",
  domain: "Sales",
  name: "revenue_metrics",
  ddl: "CREATE VIEW main.sales.revenue_metrics",
  yaml: "version: 1.1",
  sourceTables: [],
  validationStatus: "valid",
  validationIssues: [],
  validationEvidence: [{ stage: "measure-probe", status: "passed" }],
  deploymentStatus: "proposed",
};

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init);
}

function allowed(permission: "owner" | "view" | "edit" = "owner") {
  return {
    ok: true as const,
    value: { proposal },
    user: caller,
    permission,
  };
}

function denied() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(caller);
  mocks.listAccessibleIds.mockResolvedValue(["shared-mv"]);
  mocks.loadMetricViewProposalOrRespond.mockResolvedValue(allowed());
  mocks.loadRunOrRespond.mockResolvedValue({
    ok: true,
    value: { run: { runId: proposal.runId, ownerEmail: proposal.ownerEmail } },
    user: caller,
    permission: "view",
  });
  mocks.getByRun.mockResolvedValue([]);
  mocks.getBySchema.mockResolvedValue([]);
  mocks.getByRunDomain.mockResolvedValue([]);
  mocks.checkDependencies.mockResolvedValue({ allDeployed: true, missing: [], deployed: [] });
  mocks.deployAsset.mockResolvedValue({ deployed: true, fqn: "main.sales.revenue_metrics" });
  mocks.share.mockResolvedValue({ id: "acl-1" });
  mocks.findUniqueProposal.mockResolvedValue({ ownerEmail: caller.email });
});

describe("metric-view list authorization", () => {
  it("lists only proposals owned by the caller or shared through ACL", async () => {
    const response = await listProposals(request(`/api/metric-views?runId=${proposal.runId}`));

    expect(response.status).toBe(200);
    expect(mocks.listAccessibleIds).toHaveBeenCalledWith(caller.email, "metric_view_proposal");
    expect(mocks.getByRun).toHaveBeenCalledWith(proposal.runId, {
      ownerEmail: caller.email,
      sharedIds: ["shared-mv"],
    });
  });

  it("applies the same owner/share scope to schema lists", async () => {
    await listProposals(request("/api/metric-views?schemaScope=main.sales"));

    expect(mocks.getBySchema).toHaveBeenCalledWith("main.sales", {
      ownerEmail: caller.email,
      sharedIds: ["shared-mv"],
    });
  });
});

describe("metric-view resource guards", () => {
  it.each([
    ["GET", getProposal],
    ["PATCH", patchProposal],
    ["DELETE", deleteProposal],
    ["repair", repairProposal],
    ["deploy", deployProposal],
  ])("rejects unauthorized %s requests", async (method, handler) => {
    mocks.loadMetricViewProposalOrRespond.mockResolvedValue(denied());
    const verb =
      method === "GET"
        ? "GET"
        : method === "PATCH"
          ? "PATCH"
          : method === "DELETE"
            ? "DELETE"
            : "POST";
    const response = await handler(
      request(
        `/api/metric-views/mv-1${method === "repair" || method === "deploy" ? `/${method}` : ""}`,
        {
          method: verb,
          body: verb === "GET" || verb === "DELETE" ? undefined : JSON.stringify({}),
        },
      ),
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.loadMetricViewProposalOrRespond).toHaveBeenCalled();
  });

  it("permits a shared edit recipient to patch a proposal", async () => {
    mocks.loadMetricViewProposalOrRespond.mockResolvedValue(allowed("edit"));

    const response = await patchProposal(
      request("/api/metric-views/mv-1", {
        method: "PATCH",
        body: JSON.stringify({ yaml: "version: 1.1\ncomment: edited" }),
      }),
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProposal).toHaveBeenCalledWith("mv-1", {
      definition: null,
      yaml: "version: 1.1\ncomment: edited",
      validationStatus: "unverified",
      validationIssues: ["Definition changed after validation; repair to validate again."],
      validationEvidence: null,
      validatorVersion: null,
      validatedAt: null,
    });
  });

  it("persists a parsed typed definition when edited YAML remains valid", async () => {
    const yaml = `version: "1.1"
source: main.sales.orders
dimensions:
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
measures:
  - name: total_revenue
    expr: SUM(amount)
`;

    const response = await patchProposal(
      request("/api/metric-views/mv-1", {
        method: "PATCH",
        body: JSON.stringify({ yaml }),
      }),
      { params: Promise.resolve({ id: "mv-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProposal).toHaveBeenCalledWith(
      "mv-1",
      expect.objectContaining({
        definition: expect.objectContaining({
          version: "1.1",
          name: "revenue_metrics",
          source: { kind: "table", table: "main.sales.orders" },
        }),
        yaml,
      }),
    );
  });

  it.each(["improve", "reuse"] as const)(
    "rejects YAML or DDL edits for immutable %s proposals",
    async (classification) => {
      mocks.loadMetricViewProposalOrRespond.mockResolvedValue({
        ...allowed("edit"),
        value: { proposal: { ...proposal, classification } },
      });

      const response = await patchProposal(
        request("/api/metric-views/mv-1", {
          method: "PATCH",
          body: JSON.stringify({ yaml: "version: 1.1\ncomment: replacement" }),
        }),
        { params: Promise.resolve({ id: "mv-1" }) },
      );

      expect(response.status).toBe(409);
      expect(mocks.updateProposal).not.toHaveBeenCalled();
    },
  );

  it.each(["improve", "reuse"] as const)(
    "rejects repair for immutable %s proposals",
    async (classification) => {
      mocks.loadMetricViewProposalOrRespond.mockResolvedValue({
        ...allowed("edit"),
        value: { proposal: { ...proposal, classification } },
      });

      const response = await repairProposal(
        request("/api/metric-views/mv-1/repair", { method: "POST", body: "{}" }),
        { params: Promise.resolve({ id: "mv-1" }) },
      );

      expect(response.status).toBe(409);
      expect(mocks.updateProposal).not.toHaveBeenCalled();
    },
  );

  it("keeps deletion owner-only even for an edit recipient", async () => {
    mocks.loadMetricViewProposalOrRespond.mockResolvedValue(allowed("edit"));

    const response = await deleteProposal(request("/api/metric-views/mv-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "mv-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.deleteProposal).not.toHaveBeenCalled();
  });

  it("guards run-derived dependency checks before reading proposals", async () => {
    mocks.loadRunOrRespond.mockResolvedValue(denied());

    const response = await checkDependencies(
      request("/api/metric-views/check-dependencies", {
        method: "POST",
        body: JSON.stringify({ runId: proposal.runId, domain: "Sales" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.getByRunDomain).not.toHaveBeenCalled();
  });

  it("passes owner/shared scope into explicit-FQN dependency checks", async () => {
    const response = await checkDependencies(
      request("/api/metric-views/check-dependencies", {
        method: "POST",
        body: JSON.stringify({ fqns: ["main.sales.revenue_metrics"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.checkDependencies).toHaveBeenCalledWith(["main.sales.revenue_metrics"], {
      ownerEmail: caller.email,
      sharedIds: ["shared-mv"],
    });
  });
});

describe("metric-view sharing", () => {
  it("allows the owner to share a proposal", async () => {
    const response = await shareResource(
      request("/api/share", {
        method: "POST",
        body: JSON.stringify({
          resourceType: "metric_view_proposal",
          resourceId: "mv-1",
          viewerEmail: "viewer@example.com",
          permission: "edit",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.findUniqueProposal).toHaveBeenCalledWith({
      where: { id: "mv-1" },
      select: { ownerEmail: true },
    });
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "metric_view_proposal",
        resourceId: "mv-1",
        grantedBy: caller.email,
      }),
    );
  });
});
