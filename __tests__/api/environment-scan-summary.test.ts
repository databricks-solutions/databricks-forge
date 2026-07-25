import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  loadScanOrRespond: vi.fn(),
  getEnvironmentScan: vi.fn(),
}));

vi.mock("@/lib/lakebase/schema", () => ({ ensureMigrated: vi.fn() }));
vi.mock("@/lib/auth/route-guards", () => ({ loadScanOrRespond: mocks.loadScanOrRespond }));
vi.mock("@/lib/lakebase/environment-scans", () => ({
  getEnvironmentScan: mocks.getEnvironmentScan,
}));
vi.mock("@/lib/logger", () => ({
  apiLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from "@/app/api/environment/[scanId]/summary/route";

const scanId = "00000000-0000-4000-8000-000000000009";
const caller = { email: "viewer@example.com", oboToken: null };

function req() {
  return new NextRequest(`http://localhost/api/environment/${scanId}/summary`);
}
function params() {
  return { params: Promise.resolve({ scanId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadScanOrRespond.mockResolvedValue({
    ok: true,
    value: { ownerEmail: "owner@example.com" },
    user: caller,
    permission: "view",
  });
});

describe("GET /api/environment/[scanId]/summary", () => {
  it("returns 403 for an unauthorized scan without leaking summary", async () => {
    mocks.loadScanOrRespond.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET(req(), params());
    expect(res.status).toBe(403);
    expect(mocks.getEnvironmentScan).not.toHaveBeenCalled();
  });

  it("returns a summary with authoritative ucPath for a complete scan", async () => {
    mocks.getEnvironmentScan.mockResolvedValue({
      scanId,
      ucPath: "trusted.catalog.schema",
      tableCount: 7,
      scanStatus: "complete",
      details: [{ tableFqn: "trusted.catalog.schema.t" }],
    });
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      scanId,
      ucPath: "trusted.catalog.schema",
      complete: true,
      hasDetails: true,
    });
  });

  it("reports an incomplete (running) scan as not complete", async () => {
    mocks.getEnvironmentScan.mockResolvedValue({
      scanId,
      ucPath: "trusted.catalog.schema",
      tableCount: 0,
      scanStatus: "running",
      details: [],
    });
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.complete).toBe(false);
    expect(body.hasDetails).toBe(false);
  });

  it("returns 404 when the scan row is gone despite passing the guard", async () => {
    mocks.getEnvironmentScan.mockResolvedValue(null);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
  });
});
