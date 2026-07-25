import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  loadEstateProgramOrRespond: vi.fn(),
  retryEstateFailedScope: vi.fn(),
}));

vi.mock("@/lib/lakebase/schema", () => ({ ensureMigrated: vi.fn() }));
vi.mock("@/lib/auth/route-guards", () => ({
  loadEstateProgramOrRespond: mocks.loadEstateProgramOrRespond,
}));
vi.mock("@/lib/pipeline/estate-sequence", () => ({
  retryEstateFailedScope: mocks.retryEstateFailedScope,
}));
vi.mock("@/lib/logger", () => ({
  apiLogger: () => ({ error: vi.fn() }),
}));

import { POST } from "@/app/api/estate-programs/[programId]/retry/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadEstateProgramOrRespond.mockResolvedValue({
    ok: true,
    user: { email: "editor@example.com", oboToken: "obo" },
    permission: "edit",
    value: { id: "p1" },
  });
});

const request = () =>
  new NextRequest("http://localhost/api/estate-programs/p1/retry", {
    method: "POST",
    body: JSON.stringify({ scopeId: "failed-1" }),
  });

describe("estate program retry route", () => {
  it("returns 202 and targets the requested failed scope", async () => {
    mocks.retryEstateFailedScope.mockResolvedValue({
      retry: { ok: true, scopeId: "failed-1" },
      run: { status: "started" },
    });
    const response = await POST(request(), { params: Promise.resolve({ programId: "p1" }) });

    expect(response.status).toBe(202);
    expect(mocks.retryEstateFailedScope).toHaveBeenCalledWith(
      "p1",
      "editor@example.com",
      "obo",
      "failed-1",
    );
  });

  it.each([
    ["active_work", 409],
    ["max_attempts", 422],
  ] as const)("maps %s to %s", async (reason, status) => {
    mocks.retryEstateFailedScope.mockResolvedValue({ retry: { ok: false, reason } });
    const response = await POST(request(), { params: Promise.resolve({ programId: "p1" }) });

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ status: "rejected", reason });
  });
});
