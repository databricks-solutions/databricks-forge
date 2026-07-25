import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  loadEstateProgramOrRespond: vi.fn(),
  getEstateProgramOwner: vi.fn(),
  getLatestSynthesisForEstate: vi.fn(),
  saveEstateSynthesis: vi.fn(),
  buildSynthesisInputForProgram: vi.fn(),
  runEstateSynthesis: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/lakebase/schema", () => ({ ensureMigrated: vi.fn() }));
vi.mock("@/lib/auth/route-guards", () => ({
  loadEstateProgramOrRespond: mocks.loadEstateProgramOrRespond,
}));
vi.mock("@/lib/lakebase/estate-programs", () => ({
  getEstateProgramOwner: mocks.getEstateProgramOwner,
}));
vi.mock("@/lib/lakebase/estate-synthesis", () => ({
  getLatestSynthesisForEstate: mocks.getLatestSynthesisForEstate,
  saveEstateSynthesis: mocks.saveEstateSynthesis,
}));
vi.mock("@/lib/ai/estate-synthesis/build-input", () => ({
  buildSynthesisInputForProgram: mocks.buildSynthesisInputForProgram,
}));
vi.mock("@/lib/ai/estate-synthesis/engine", () => ({
  runEstateSynthesis: mocks.runEstateSynthesis,
}));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/logger", () => ({
  apiLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/estate-programs/[programId]/synthesis/route";

const programId = "prog-1";
const caller = { email: "caller@example.com", oboToken: null };

function req(method: "GET" | "POST", body?: unknown) {
  return new NextRequest(`http://localhost/api/estate-programs/${programId}/synthesis`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function params() {
  return { params: Promise.resolve({ programId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadEstateProgramOrRespond.mockResolvedValue({
    ok: true,
    value: { ownerEmail: "owner@example.com" },
    user: caller,
    permission: "edit",
  });
  mocks.logActivity.mockResolvedValue(undefined);
});

describe("GET /api/estate-programs/[programId]/synthesis", () => {
  it("returns 403 without leaking synthesis when unauthorized", async () => {
    mocks.loadEstateProgramOrRespond.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(403);
    expect(mocks.getLatestSynthesisForEstate).not.toHaveBeenCalled();
  });

  it("returns the cached synthesis and NEVER writes", async () => {
    mocks.getLatestSynthesisForEstate.mockResolvedValue({
      id: "syn-1",
      estateId: programId,
      scores: { overall: 72, band: "established" },
    });
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("syn-1");
    // Read-only: no generation, no persistence on GET.
    expect(mocks.buildSynthesisInputForProgram).not.toHaveBeenCalled();
    expect(mocks.runEstateSynthesis).not.toHaveBeenCalled();
    expect(mocks.saveEstateSynthesis).not.toHaveBeenCalled();
  });

  it("returns 404 when no synthesis has been generated (no write)", async () => {
    mocks.getLatestSynthesisForEstate.mockResolvedValue(null);
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.generated).toBe(false);
    expect(mocks.saveEstateSynthesis).not.toHaveBeenCalled();
  });
});

describe("POST /api/estate-programs/[programId]/synthesis", () => {
  it("generates, persists against estateId + root owner, and activity-logs the caller", async () => {
    mocks.getEstateProgramOwner.mockResolvedValue("owner@example.com");
    mocks.buildSynthesisInputForProgram.mockResolvedValue({
      scanId: `program:${programId}`,
      industryId: "retail",
      tables: [{ fqn: "a" }],
      insights: [],
    });
    mocks.runEstateSynthesis.mockResolvedValue({
      scores: { overall: 80, band: "established" },
      brief: {},
      findings: [],
      passResults: {},
      valueAtRisk: null,
    });
    mocks.saveEstateSynthesis.mockResolvedValue("syn-new");

    const res = await POST(req("POST", { industryId: "retail" }), params());
    expect(res.status).toBe(201);

    // Root owner used for both the input build and persistence.
    expect(mocks.buildSynthesisInputForProgram).toHaveBeenCalledWith(
      programId,
      "owner@example.com",
      { industryId: "retail" },
    );
    expect(mocks.saveEstateSynthesis).toHaveBeenCalledWith(
      expect.objectContaining({ estateId: programId, ownerEmail: "owner@example.com" }),
    );
    // Activity logged against the CALLER, resourceId = program.
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "estate_synthesis_generated",
      expect.objectContaining({ userId: caller.email, resourceId: programId }),
    );
  });

  it("returns 404 when the program has no completed scans", async () => {
    mocks.getEstateProgramOwner.mockResolvedValue("owner@example.com");
    mocks.buildSynthesisInputForProgram.mockResolvedValue(null);
    const res = await POST(req("POST"), params());
    expect(res.status).toBe(404);
    expect(mocks.saveEstateSynthesis).not.toHaveBeenCalled();
  });

  it("returns 422 when the program owner is unavailable", async () => {
    mocks.getEstateProgramOwner.mockResolvedValue(null);
    const res = await POST(req("POST"), params());
    expect(res.status).toBe(422);
    expect(mocks.buildSynthesisInputForProgram).not.toHaveBeenCalled();
  });
});
