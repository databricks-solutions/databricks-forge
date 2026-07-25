import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listAccessibleIds: vi.fn(),
  loadScanOrRespond: vi.fn(),
  loadEstateProgramOrRespond: vi.fn(),
  createRun: vi.fn(),
  getEnvironmentScan: vi.fn(),
  listEstatePrograms: vi.fn(),
  updateEstateProgram: vi.fn(),
  deleteEstateProgram: vi.fn(),
  deleteProgramScope: vi.fn(),
  findManyScans: vi.fn(),
  findUniqueScan: vi.fn(),
  getLatestSynthesisForScan: vi.fn(),
  saveEstateSynthesis: vi.fn(),
  buildSynthesisInputForScan: vi.fn(),
  runEstateSynthesis: vi.fn(),
  getLatestDataGapAnalysisForScan: vi.fn(),
  computeEstateDataGap: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/lakebase/schema", () => ({ ensureMigrated: vi.fn() }));
vi.mock("@/lib/auth/route-user", () => ({
  requireUser: mocks.requireUser,
  ForgeAuthError: class ForgeAuthError extends Error {},
}));
vi.mock("@/lib/lakebase/acl", () => ({ listAccessibleIds: mocks.listAccessibleIds }));
vi.mock("@/lib/auth/route-guards", () => ({
  loadScanOrRespond: mocks.loadScanOrRespond,
  loadEstateProgramOrRespond: mocks.loadEstateProgramOrRespond,
}));
vi.mock("@/lib/lakebase/runs", () => ({
  createRun: mocks.createRun,
  listRuns: vi.fn(),
  listRunSummaries: vi.fn(),
}));
vi.mock("@/lib/lakebase/environment-scans", () => ({
  getEnvironmentScan: mocks.getEnvironmentScan,
  clearAggregateEstateCache: vi.fn(),
}));
vi.mock("@/lib/lakebase/estate-programs", () => ({
  createEstateProgram: vi.fn(),
  getEstateProgram: vi.fn(),
  updateEstateProgram: mocks.updateEstateProgram,
  listEstatePrograms: mocks.listEstatePrograms,
  deleteEstateProgram: mocks.deleteEstateProgram,
  deleteProgramScope: mocks.deleteProgramScope,
}));
vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(
    callback: (prisma: {
      forgeEnvironmentScan: {
        findMany: typeof mocks.findManyScans;
        findUnique: typeof mocks.findUniqueScan;
      };
    }) => Promise<T>,
  ) =>
    callback({
      forgeEnvironmentScan: {
        findMany: mocks.findManyScans,
        findUnique: mocks.findUniqueScan,
      },
    }),
}));
vi.mock("@/lib/lakebase/estate-synthesis", () => ({
  getLatestSynthesisForScan: mocks.getLatestSynthesisForScan,
  saveEstateSynthesis: mocks.saveEstateSynthesis,
}));
vi.mock("@/lib/ai/estate-synthesis/build-input", () => ({
  buildSynthesisInputForScan: mocks.buildSynthesisInputForScan,
}));
vi.mock("@/lib/ai/estate-synthesis/engine", () => ({
  runEstateSynthesis: mocks.runEstateSynthesis,
}));
vi.mock("@/lib/lakebase/data-gap-analyses", () => ({
  getLatestDataGapAnalysisForScan: mocks.getLatestDataGapAnalysisForScan,
}));
vi.mock("@/lib/engines/data-gap-analysis/estate-data-gap", () => ({
  computeEstateDataGap: mocks.computeEstateDataGap,
}));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/logger", () => ({
  apiLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as createRun } from "@/app/api/runs/route";
import { GET as getTrends } from "@/app/api/environment/trends/route";
import { GET as listPrograms } from "@/app/api/estate-programs/route";
import {
  DELETE as deleteProgram,
  PATCH as patchProgram,
} from "@/app/api/estate-programs/[programId]/route";
import { DELETE as deleteScope } from "@/app/api/estate-programs/[programId]/scopes/[scopeId]/route";
import {
  GET as getSynthesis,
  POST as generateSynthesis,
} from "@/app/api/environment/[scanId]/synthesis/route";
import {
  GET as getDataGap,
  POST as generateDataGap,
} from "@/app/api/environment/[scanId]/data-gap/route";

const caller = { email: "viewer@example.com", oboToken: null };
const owner = "owner@example.com";
const sourceScanId = "00000000-0000-4000-8000-000000000001";

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init);
}

function guard(permission: "owner" | "view" | "edit" = "owner") {
  return {
    ok: true as const,
    value: { ownerEmail: owner },
    user: caller,
    permission,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(caller);
  mocks.listAccessibleIds.mockResolvedValue([]);
  mocks.loadScanOrRespond.mockResolvedValue(guard());
  mocks.loadEstateProgramOrRespond.mockResolvedValue(guard());
  mocks.getLatestSynthesisForScan.mockResolvedValue(null);
  mocks.getLatestDataGapAnalysisForScan.mockResolvedValue(null);
  mocks.logActivity.mockResolvedValue(undefined);
});

describe("POST /api/runs source scan authorization", () => {
  const body = {
    businessName: "Acme",
    ucMetadata: "caller.supplied",
    sourceScanId,
  };

  it("rejects an unauthorized source scan before loading it or creating a run", async () => {
    mocks.loadScanOrRespond.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await createRun(
      request("/api/runs", { method: "POST", body: JSON.stringify(body) }),
    );

    expect(response.status).toBe(403);
    expect(mocks.loadScanOrRespond).toHaveBeenCalledWith(expect.anything(), sourceScanId, "read");
    expect(mocks.getEnvironmentScan).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("derives ucMetadata from the authorized non-empty source scan", async () => {
    mocks.getEnvironmentScan.mockResolvedValue({
      scanId: sourceScanId,
      ucPath: "trusted.catalog.schema",
      details: [{ tableFqn: "trusted.catalog.schema.table" }],
    });

    const response = await createRun(
      request("/api/runs", { method: "POST", body: JSON.stringify(body) }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sourceScanId,
        ucMetadata: "trusted.catalog.schema",
        estateScanEnabled: false,
      }),
      caller.email,
    );
  });

  it("rejects an authorized source scan with no details", async () => {
    mocks.getEnvironmentScan.mockResolvedValue({
      scanId: sourceScanId,
      ucPath: "trusted.catalog.schema",
      details: [],
    });

    const response = await createRun(
      request("/api/runs", { method: "POST", body: JSON.stringify(body) }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});

describe("GET /api/environment/trends isolation", () => {
  it("limits unscoped trends to owned and ACL-shared scans", async () => {
    mocks.listAccessibleIds.mockResolvedValue(["shared-scan"]);
    mocks.findManyScans.mockResolvedValue([]);

    const response = await getTrends(request("/api/environment/trends"));

    expect(response.status).toBe(200);
    expect(mocks.listAccessibleIds).toHaveBeenCalledWith(caller.email, "scan");
    expect(mocks.findManyScans).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ ownerEmail: caller.email }, { scanId: { in: ["shared-scan"] } }],
        },
      }),
    );
  });

  it("authorizes a requested estate before querying its scans", async () => {
    mocks.loadEstateProgramOrRespond.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await getTrends(
      request("/api/environment/trends?estateId=another-program"),
    );

    expect(response.status).toBe(403);
    expect(mocks.loadEstateProgramOrRespond).toHaveBeenCalledWith(
      expect.anything(),
      "another-program",
      "read",
    );
    expect(mocks.findManyScans).not.toHaveBeenCalled();
  });
});

describe("estate program isolation", () => {
  it("lists owner and ACL-shared programs", async () => {
    mocks.listAccessibleIds.mockResolvedValue(["shared-program"]);
    mocks.listEstatePrograms.mockResolvedValue([]);

    const response = await listPrograms(request("/api/estate-programs?limit=25"));

    expect(response.status).toBe(200);
    expect(mocks.listAccessibleIds).toHaveBeenCalledWith(caller.email, "estate_program");
    expect(mocks.listEstatePrograms).toHaveBeenCalledWith(
      caller.email,
      25,
      ["shared-program"],
    );
  });

  it("does not let an edit-share recipient delete the program", async () => {
    mocks.loadEstateProgramOrRespond.mockResolvedValue(guard("edit"));

    const response = await deleteProgram(request("/api/estate-programs/p1", { method: "DELETE" }), {
      params: Promise.resolve({ programId: "p1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.deleteEstateProgram).not.toHaveBeenCalled();
  });

  it("returns 404 when the scope is not a child of the guarded program", async () => {
    mocks.deleteProgramScope.mockResolvedValue({ status: "not_found" });

    const response = await deleteScope(
      request("/api/estate-programs/p1/scopes/s2", { method: "DELETE" }),
      { params: Promise.resolve({ programId: "p1", scopeId: "s2" }) },
    );

    expect(mocks.deleteProgramScope).toHaveBeenCalledWith("s2", "p1");
    expect(response.status).toBe(404);
  });

  it("returns 409 when a scope becomes active before the conditional delete", async () => {
    mocks.deleteProgramScope.mockResolvedValue({ status: "active" });

    const response = await deleteScope(
      request("/api/estate-programs/p1/scopes/s2", { method: "DELETE" }),
      { params: Promise.resolve({ programId: "p1", scopeId: "s2" }) },
    );

    expect(response.status).toBe(409);
  });

  it("rejects an invalid PATCH industry with 400 and never writes", async () => {
    const response = await patchProgram(
      request("/api/estate-programs/p1", {
        method: "PATCH",
        body: JSON.stringify({ industryId: "not-a-registered-industry" }),
      }),
      { params: Promise.resolve({ programId: "p1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateEstateProgram).not.toHaveBeenCalled();
  });

  it("rejects oversized PATCH prompt context with 400 and never writes", async () => {
    const response = await patchProgram(
      request("/api/estate-programs/p1", {
        method: "PATCH",
        body: JSON.stringify({ orgContext: "x".repeat(2001) }),
      }),
      { params: Promise.resolve({ programId: "p1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateEstateProgram).not.toHaveBeenCalled();
  });

  it("normalizes and writes a valid bounded PATCH", async () => {
    const response = await patchProgram(
      request("/api/estate-programs/p1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "  NOC estate  ",
          description: "  National portfolio  ",
          industryId: "oil-gas-noc",
          subVertical: "  National Oil Company  ",
          orgContext: "  State-owned integrated operator  ",
        }),
      }),
      { params: Promise.resolve({ programId: "p1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateEstateProgram).toHaveBeenCalledWith("p1", {
      name: "NOC estate",
      description: "National portfolio",
      industryId: "oil-gas-noc",
      subVertical: "National Oil Company",
      orgContext: "State-owned integrated operator",
    });
  });
});

describe("estate synthesis and data-gap side effects", () => {
  it("does not generate or persist synthesis from GET on a cache miss", async () => {
    const response = await getSynthesis(request(`/api/environment/${sourceScanId}/synthesis`), {
      params: Promise.resolve({ scanId: sourceScanId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ generated: false });
    expect(mocks.buildSynthesisInputForScan).not.toHaveBeenCalled();
    expect(mocks.runEstateSynthesis).not.toHaveBeenCalled();
    expect(mocks.saveEstateSynthesis).not.toHaveBeenCalled();
  });

  it("does not resolve, compute, or persist data-gap from GET on a cache miss", async () => {
    const response = await getDataGap(
      request(`/api/environment/${sourceScanId}/data-gap?industryId=retail`),
      { params: Promise.resolve({ scanId: sourceScanId }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ generated: false });
    expect(mocks.findUniqueScan).not.toHaveBeenCalled();
    expect(mocks.computeEstateDataGap).not.toHaveBeenCalled();
    expect(mocks.getLatestDataGapAnalysisForScan).toHaveBeenCalledWith(sourceScanId, owner);
  });

  it("persists POST synthesis under the root owner and logs the caller", async () => {
    const result = {
      brief: { evidence: [] },
      findings: [],
      scores: { overall: 80, band: "ready" },
      valueAtRisk: null,
      passResults: {},
    };
    mocks.buildSynthesisInputForScan.mockResolvedValue({ industryId: "retail" });
    mocks.runEstateSynthesis.mockResolvedValue(result);
    mocks.saveEstateSynthesis.mockResolvedValue("synthesis-1");

    const response = await generateSynthesis(
      request(`/api/environment/${sourceScanId}/synthesis`, {
        method: "POST",
        body: JSON.stringify({ industryId: "retail" }),
      }),
      { params: Promise.resolve({ scanId: sourceScanId }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.buildSynthesisInputForScan).toHaveBeenCalledWith(
      sourceScanId,
      owner,
      expect.anything(),
    );
    expect(mocks.saveEstateSynthesis).toHaveBeenCalledWith(
      expect.objectContaining({ scanId: sourceScanId, ownerEmail: owner }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "estate_synthesis_generated",
      expect.objectContaining({ userId: caller.email }),
    );
  });

  it("persists POST data-gap under the root owner and logs the caller", async () => {
    const result = { summary: { missingAssets: 3 } };
    mocks.computeEstateDataGap.mockResolvedValue(result);

    const response = await generateDataGap(
      request(`/api/environment/${sourceScanId}/data-gap`, {
        method: "POST",
        body: JSON.stringify({ industryId: "retail" }),
      }),
      { params: Promise.resolve({ scanId: sourceScanId }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.computeEstateDataGap).toHaveBeenCalledWith({
      scanId: sourceScanId,
      industryId: "retail",
      ownerEmail: owner,
    });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "estate_data_gap_computed",
      expect.objectContaining({ userId: caller.email }),
    );
  });
});
