import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({
  row: null as null | {
    runId: string;
    engine: string;
    status: string;
    message: string;
    percent: number;
    startedAt: Date;
    completedAt: Date | null;
    error: string | null;
    domainCount: number;
    detailsJson: string | null;
  },
}));

vi.mock("@/lib/lakebase/background-jobs", () => ({
  upsertJobStatus: vi.fn(
    async (
      runId: string,
      engine: string,
      status: string,
      message: string,
      percent: number,
      opts?: {
        startedAt?: Date;
        completedAt?: Date | null;
        error?: string | null;
        domainCount?: number;
        detailsJson?: string | null;
      },
    ) => {
      const previous = durable.row;
      durable.row = {
        runId,
        engine,
        status,
        message,
        percent,
        // Match production upsert semantics: ordinary transitions preserve
        // startedAt and only update optional fields when explicitly present.
        startedAt: previous?.startedAt ?? opts?.startedAt ?? new Date(),
        completedAt:
          opts && "completedAt" in opts
            ? (opts.completedAt ?? null)
            : (previous?.completedAt ?? null),
        error: opts && "error" in opts ? (opts.error ?? null) : (previous?.error ?? null),
        domainCount:
          opts?.domainCount !== undefined ? opts.domainCount : (previous?.domainCount ?? 0),
        detailsJson:
          opts && "detailsJson" in opts
            ? (opts.detailsJson ?? null)
            : (previous?.detailsJson ?? null),
      };
    },
  ),
  replaceJobStatus: vi.fn(
    async (
      runId: string,
      engine: string,
      status: string,
      message: string,
      percent: number,
      startedAt: Date,
    ) => {
      durable.row = {
        runId,
        engine,
        status,
        message,
        percent,
        startedAt,
        completedAt: null,
        error: null,
        domainCount: 0,
        detailsJson: null,
      };
    },
  ),
  getPersistedJobStatus: vi.fn(async () => durable.row),
}));

describe("dashboard engine status durable validation failures", () => {
  beforeEach(() => {
    durable.row = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconstructs compact domain evidence after an in-memory reset", async () => {
    const firstProcess = await import("@/lib/dashboard/engine-status");
    await firstProcess.startDashboardJob("run-1");
    await firstProcess.failDashboardJob("run-1", "validation failed", [
      {
        domain: "Sales",
        evidence: [
          {
            stage: "dataset-probe",
            status: "failed",
            code: "dataset.invalid",
            message: "Dataset validation failed",
            durationMs: 21,
            observedSchema: [
              {
                name: "revenue",
                dataType: "DECIMAL(18,2)",
                sampleValues: ["must-not-persist"],
              } as never,
            ],
            observedRowCount: 0,
            rawRows: [{ revenue: "must-not-persist" }],
          } as never,
        ],
      },
    ]);

    vi.resetModules();
    const restartedProcess = await import("@/lib/dashboard/engine-status");
    const recovered = await restartedProcess.getDashboardJobStatus("run-1");

    expect(recovered?.validationFailures).toEqual([
      {
        domain: "Sales",
        evidence: [
          {
            stage: "dataset-probe",
            status: "failed",
            code: "dataset.invalid",
            message: "Dataset validation failed",
            durationMs: 21,
            observedSchema: [{ name: "revenue", dataType: "DECIMAL(18,2)" }],
            observedRowCount: 0,
          },
        ],
      },
    ]);
    expect(durable.row?.detailsJson).not.toContain("must-not-persist");
  });

  it("reconstructs explicit partial-success failures after an in-memory reset", async () => {
    const firstProcess = await import("@/lib/dashboard/engine-status");
    await firstProcess.startDashboardJob("run-1");
    await firstProcess.completeDashboardJob("run-1", 1, [
      {
        domain: "Sales",
        evidence: [
          {
            stage: "dataset_result",
            status: "failed",
            code: "ALIAS_MISSING",
            message: "Missing revenue",
          },
        ],
      },
    ]);

    vi.resetModules();
    const restartedProcess = await import("@/lib/dashboard/engine-status");
    const recovered = await restartedProcess.getDashboardJobStatus("run-1");

    expect(recovered).toMatchObject({
      status: "completed_with_failures",
      message: "Partial success: 1 dashboard generated; 1 domain failed validation",
      domainCount: 1,
      validationFailures: [
        {
          domain: "Sales",
          evidence: [
            {
              stage: "dataset_result",
              status: "failed",
              code: "ALIAS_MISSING",
              message: "Missing revenue",
            },
          ],
        },
      ],
    });
    expect(durable.row?.detailsJson).toContain("ALIAS_MISSING");
  });

  it("clears stale validation failures when a new job starts", async () => {
    const firstProcess = await import("@/lib/dashboard/engine-status");
    await firstProcess.startDashboardJob("run-1");
    await firstProcess.failDashboardJob("run-1", "validation failed", [
      {
        domain: "Sales",
        evidence: [
          {
            stage: "contract",
            status: "failed",
            code: "dashboard.invalid",
            message: "Invalid dashboard",
          },
        ],
      },
    ]);

    await firstProcess.startDashboardJob("run-1");
    vi.resetModules();

    const restartedProcess = await import("@/lib/dashboard/engine-status");
    const recovered = await restartedProcess.getDashboardJobStatus("run-1");
    expect(recovered?.status).toBe("generating");
    expect(recovered?.validationFailures).toEqual([]);
  });

  it("replaces every stale terminal field with a fresh attempt state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T01:00:00.000Z"));

    const firstProcess = await import("@/lib/dashboard/engine-status");
    await firstProcess.startDashboardJob("run-1");
    await firstProcess.completeDashboardJob("run-1", 4);
    await firstProcess.failDashboardJob("run-1", "old validation failure", [
      {
        domain: "Sales",
        evidence: [
          {
            stage: "contract",
            status: "failed",
            code: "dashboard.invalid",
            message: "Invalid dashboard",
          },
        ],
      },
    ]);

    const replacementStartedAt = new Date("2026-07-24T02:00:00.000Z");
    vi.setSystemTime(replacementStartedAt);
    await firstProcess.startDashboardJob("run-1");
    vi.resetModules();

    const restartedProcess = await import("@/lib/dashboard/engine-status");
    const recovered = await restartedProcess.getDashboardJobStatus("run-1");
    expect(recovered).toMatchObject({
      status: "generating",
      startedAt: replacementStartedAt.getTime(),
      completedAt: null,
      error: null,
      domainCount: 0,
      validationFailures: [],
    });
  });
});
