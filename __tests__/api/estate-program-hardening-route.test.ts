/**
 * Task 7 production-hardening: estate-program API route contracts.
 *
 * Covers:
 *  - Req2: GET (single) and aggregate responses carry the caller's `permission`
 *    so the client can render view-only UI without guessing.
 *  - Req3: program deletion is server-enforced-blocked (409) while any scope is
 *    queued/running, independent of the client-side guard.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  loadEstateProgramOrRespond: vi.fn(),
  getEstateProgram: vi.fn(),
  deleteEstateProgram: vi.fn(),
  countActiveProgramScopes: vi.fn(),
  getAggregateEstateView: vi.fn(),
  clearAggregateEstateCache: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/lakebase/schema", () => ({ ensureMigrated: vi.fn() }));
vi.mock("@/lib/auth/route-guards", () => ({
  loadEstateProgramOrRespond: mocks.loadEstateProgramOrRespond,
}));
vi.mock("@/lib/lakebase/estate-programs", () => ({
  getEstateProgram: mocks.getEstateProgram,
  updateEstateProgram: vi.fn(),
  deleteEstateProgram: mocks.deleteEstateProgram,
  countActiveProgramScopes: mocks.countActiveProgramScopes,
}));
vi.mock("@/lib/lakebase/environment-scans", () => ({
  getAggregateEstateView: mocks.getAggregateEstateView,
  clearAggregateEstateCache: mocks.clearAggregateEstateCache,
}));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/domain/industry-outcomes", () => ({ getIndustryOutcome: () => null }));
vi.mock("@/lib/logger", () => ({
  apiLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET as getProgram, DELETE as deleteProgram } from "@/app/api/estate-programs/[programId]/route";
import { GET as getAggregate } from "@/app/api/estate-programs/[programId]/aggregate/route";

const caller = { email: "owner@example.com", oboToken: null };
const owner = "owner@example.com";

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init);
}

function guard(permission: "owner" | "view" | "edit" = "owner") {
  return { ok: true as const, value: { ownerEmail: owner }, user: caller, permission };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadEstateProgramOrRespond.mockResolvedValue(guard());
  mocks.getEstateProgram.mockResolvedValue({ id: "p1", name: "Acme", scopes: [] });
  mocks.getAggregateEstateView.mockResolvedValue({ details: [], insights: [], stats: {} });
  mocks.countActiveProgramScopes.mockResolvedValue(0);
  mocks.deleteEstateProgram.mockResolvedValue(undefined);
});

describe("Req2 — GET single program returns caller permission", () => {
  it("echoes the guard permission for a view-only recipient", async () => {
    mocks.loadEstateProgramOrRespond.mockResolvedValue(guard("view"));
    const res = await getProgram(request("/api/estate-programs/p1"), {
      params: Promise.resolve({ programId: "p1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permission).toBe("view");
    expect(body.program).toBeTruthy();
  });

  it("reports owner for the owner", async () => {
    const res = await getProgram(request("/api/estate-programs/p1"), {
      params: Promise.resolve({ programId: "p1" }),
    });
    expect((await res.json()).permission).toBe("owner");
  });
});

describe("Req2 — aggregate returns caller permission", () => {
  it("includes permission alongside program + aggregate", async () => {
    mocks.loadEstateProgramOrRespond.mockResolvedValue(guard("edit"));
    const res = await getAggregate(request("/api/estate-programs/p1/aggregate"), {
      params: Promise.resolve({ programId: "p1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permission).toBe("edit");
    expect(body).toHaveProperty("program");
    expect(body).toHaveProperty("aggregate");
  });
});

describe("Req3 — delete is blocked while a scope is queued/running", () => {
  it("returns 409 and never deletes when active scopes exist", async () => {
    mocks.countActiveProgramScopes.mockResolvedValue(1);
    const res = await deleteProgram(request("/api/estate-programs/p1", { method: "DELETE" }), {
      params: Promise.resolve({ programId: "p1" }),
    });
    expect(res.status).toBe(409);
    expect(mocks.deleteEstateProgram).not.toHaveBeenCalled();
  });

  it("deletes when there is no active work", async () => {
    const res = await deleteProgram(request("/api/estate-programs/p1", { method: "DELETE" }), {
      params: Promise.resolve({ programId: "p1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.deleteEstateProgram).toHaveBeenCalledWith("p1");
  });

  it("still forbids a non-owner (edit share) before checking active work", async () => {
    mocks.loadEstateProgramOrRespond.mockResolvedValue(guard("edit"));
    const res = await deleteProgram(request("/api/estate-programs/p1", { method: "DELETE" }), {
      params: Promise.resolve({ programId: "p1" }),
    });
    expect(res.status).toBe(403);
    expect(mocks.countActiveProgramScopes).not.toHaveBeenCalled();
    expect(mocks.deleteEstateProgram).not.toHaveBeenCalled();
  });
});
