import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Stub the route-guards module so the endpoint behaves as if the caller has
// passed authorization. We're testing the response shape, not auth.
// ---------------------------------------------------------------------------
vi.mock("@/lib/auth/route-guards", () => ({
  loadRunOrRespond: vi.fn(async () => ({
    ok: true,
    value: { run: { runId: "00000000-0000-4000-8000-000000000000" } },
    user: { email: "tester@example.com", oboToken: null },
    permission: "owner",
  })),
}));

// Stub Lakebase persistence so the SQL engine status module stays purely
// in-memory for the duration of the test.
vi.mock("@/lib/lakebase/background-jobs", () => ({
  upsertJobStatus: vi.fn(async () => undefined),
  getPersistedJobStatus: vi.fn(async () => null),
}));

// Stub the per-use-case status count helper with a known response.
vi.mock("@/lib/lakebase/usecases", () => ({
  getSqlStatusCounts: vi.fn(async () => ({
    pending: 1,
    generating: 2,
    generated: 3,
    failed: 1,
    total: 7,
  })),
}));

import { NextRequest } from "next/server";
import {
  startSqlJob,
  setSqlJobTotal,
  updateSqlJob,
  completeSqlJob,
  cancelSqlJob,
} from "@/lib/pipeline/sql-engine-status";
import { GET } from "@/app/api/runs/[runId]/sql-engine/generate/status/route";
import { getSqlStatusCounts } from "@/lib/lakebase/usecases";

const runId = "00000000-0000-4000-8000-000000000000";
const getSqlStatusCountsMock = getSqlStatusCounts as unknown as ReturnType<typeof vi.fn>;

function makeReq() {
  return new NextRequest(`http://localhost/api/runs/${runId}/sql-engine/generate/status`);
}

async function getStatus(): Promise<{
  json: Record<string, unknown>;
  status: number;
}> {
  const res = await GET(makeReq(), { params: Promise.resolve({ runId }) });
  return { json: (await res.json()) as Record<string, unknown>, status: res.status };
}

describe("GET /api/runs/[runId]/sql-engine/generate/status shape", () => {
  beforeEach(async () => {
    getSqlStatusCountsMock.mockClear();
    // Drain any leftover in-memory state from previous tests.
    await cancelSqlJob(runId).catch(() => undefined);
  });

  it("returns idle shape when no job has been started", async () => {
    const { json, status } = await getStatus();
    expect(status).toBe(200);

    expect(json).toMatchObject({
      runId,
      status: "idle",
      message: expect.any(String),
      percent: 0,
      total: 7,
      counts: { pending: 1, generating: 2, generated: 3, failed: 1, total: 7 },
      error: null,
      elapsedMs: 0,
    });

    expect(Object.keys(json).sort()).toEqual(
      ["counts", "elapsedMs", "error", "message", "percent", "runId", "status", "total"].sort(),
    );
  });

  it("returns generating shape with percent + counts while a job is in flight", async () => {
    await startSqlJob(runId);
    setSqlJobTotal(runId, 7);
    updateSqlJob(runId, "Processing wave 2", 42);

    const { json, status } = await getStatus();
    expect(status).toBe(200);
    expect(json).toMatchObject({
      runId,
      status: "generating",
      message: "Processing wave 2",
      percent: 42,
      total: 7,
      counts: { pending: 1, generating: 2, generated: 3, failed: 1, total: 7 },
      error: null,
    });
    expect(typeof json.elapsedMs).toBe("number");
    expect(json.elapsedMs as number).toBeGreaterThanOrEqual(0);
  });

  it("returns completed shape after the job ends", async () => {
    await startSqlJob(runId);
    setSqlJobTotal(runId, 7);
    await completeSqlJob(runId, 6, 1);

    const { json, status } = await getStatus();
    expect(status).toBe(200);
    expect(json).toMatchObject({
      runId,
      status: "completed",
      percent: 100,
      total: 7,
      counts: { pending: 1, generating: 2, generated: 3, failed: 1, total: 7 },
      error: null,
    });
    expect(json.message).toMatch(/complete/i);
  });

  it("returns 400 for a malformed runId", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/runs/not-a-uuid/sql-engine/generate/status"),
      { params: Promise.resolve({ runId: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });
});
