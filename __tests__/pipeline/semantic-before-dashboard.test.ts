import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineContext } from "@/lib/domain/types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";
import { runDashboardRecommendations } from "@/lib/pipeline/steps/dashboard-recommendations";
import {
  runGenieSemanticJob,
  runPostSqlDependentJobs,
} from "@/lib/pipeline/background-job-orchestration";

const mocks = vi.hoisted(() => ({
  loadGenieRecommendations: vi.fn(),
  runDashboardEngine: vi.fn(),
  saveDashboardRecommendations: vi.fn(),
}));

vi.mock("@/lib/lakebase/genie-recommendations", () => ({
  getGenieRecommendationsByRunId: mocks.loadGenieRecommendations,
}));

vi.mock("@/lib/dashboard/engine", () => ({
  runDashboardEngine: mocks.runDashboardEngine,
}));

vi.mock("@/lib/lakebase/dashboard-recommendations", () => ({
  saveDashboardRecommendations: mocks.saveDashboardRecommendations,
}));

vi.mock("@/lib/lakebase/metadata-cache", () => ({
  loadMetadataForRun: vi.fn(),
}));

vi.mock("@/lib/dashboard/engine-status", () => ({
  failDashboardJob: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const manifest: SemanticAssetManifest = {
  version: "1",
  domain: "Sales",
  subdomains: ["Revenue"],
  metricViews: [],
  measures: [],
  dimensions: [],
  filters: [],
  generatedAt: "2026-07-24T05:00:00.000Z",
};

const context = {
  run: { runId: "run-1", ownerEmail: "owner@example.com" },
  ownerEmail: "owner@example.com",
  useCases: [{ id: "uc-1", domain: "Sales", subdomain: "Revenue", tablesInvolved: [] }],
  metadata: { tables: [], columns: [] },
  discoveryResult: null,
} as unknown as PipelineContext;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

describe("semantic assets before dashboards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [],
      validationFailures: [],
    });
    mocks.saveDashboardRecommendations.mockResolvedValue(undefined);
  });

  it("waits for manifest persistence before starting Dashboard", async () => {
    const events: string[] = [];
    const persisted = deferred<void>();
    const chain = runPostSqlDependentJobs({
      runGenie: async () => {
        events.push("genie:start");
        await persisted.promise;
        events.push("genie:manifest-persisted");
        events.push("genie:end");
        return { status: "completed", recommendationCount: 1 };
      },
      runDashboard: async () => {
        events.push("dashboard:start");
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["genie:start"]);
    persisted.resolve();
    await chain;

    expect(events).toEqual([
      "genie:start",
      "genie:manifest-persisted",
      "genie:end",
      "dashboard:start",
    ]);
  });

  it.each(["failed", "empty", "cancelled"] as const)(
    "does not start Dashboard after Genie %s",
    async (status) => {
      const runDashboard = vi.fn(async () => undefined);

      await runPostSqlDependentJobs({
        runGenie: async () => ({ status }),
        runDashboard,
      });

      expect(runDashboard).not.toHaveBeenCalled();
    },
  );

  it("does not start Genie or Dashboard when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const runGenie = vi.fn(async () => ({ status: "completed" as const, recommendationCount: 1 }));
    const runDashboard = vi.fn(async () => undefined);

    await runPostSqlDependentJobs({
      signal: controller.signal,
      runGenie,
      runDashboard,
    });

    expect(runGenie).not.toHaveBeenCalled();
    expect(runDashboard).not.toHaveBeenCalled();
  });

  it("does not start Dashboard when cancelled during Genie", async () => {
    const controller = new AbortController();
    const runDashboard = vi.fn(async () => undefined);

    await runPostSqlDependentJobs({
      signal: controller.signal,
      runGenie: async () => {
        controller.abort();
        return { status: "completed", recommendationCount: 1 };
      },
      runDashboard,
    });

    expect(runDashboard).not.toHaveBeenCalled();
  });

  it("reports failure and does not complete when primary Genie fails", async () => {
    const failJob = vi.fn(async () => undefined);
    const completeJob = vi.fn(async () => undefined);

    const outcome = await runGenieSemanticJob({
      run: async () => {
        throw new Error("primary failed");
      },
      completeJob,
      failJob,
      getTerminalStatus: async () => "failed",
      isCancellationError: () => false,
    });

    expect(outcome).toEqual({ status: "failed", error: "primary failed" });
    expect(failJob).toHaveBeenCalledWith("primary failed");
    expect(completeJob).not.toHaveBeenCalled();
  });

  it("fails a zero-result Genie job instead of releasing Dashboard", async () => {
    const failJob = vi.fn(async () => undefined);

    const outcome = await runGenieSemanticJob({
      run: async () => 0,
      completeJob: vi.fn(async () => undefined),
      failJob,
      getTerminalStatus: async () => "generating",
      isCancellationError: () => false,
    });

    expect(outcome).toEqual({
      status: "empty",
      error: "Genie semantic stage produced zero persisted domain manifests",
    });
    expect(failJob).toHaveBeenCalledWith(
      "Genie semantic stage produced zero persisted domain manifests",
    );
  });

  it("preserves cancellation status without recording failure", async () => {
    const failJob = vi.fn(async () => undefined);
    const cancellation = new Error("cancelled");

    const outcome = await runGenieSemanticJob({
      run: async () => {
        throw cancellation;
      },
      completeJob: vi.fn(async () => undefined),
      failJob,
      getTerminalStatus: async () => "cancelled",
      isCancellationError: (error) => error === cancellation,
    });

    expect(outcome).toEqual({ status: "cancelled" });
    expect(failJob).not.toHaveBeenCalled();
  });

  it("requires the persisted Genie terminal status to be completed", async () => {
    const outcome = await runGenieSemanticJob({
      run: async () => 1,
      completeJob: vi.fn(async () => undefined),
      failJob: vi.fn(async () => undefined),
      getTerminalStatus: async () => "cancelled",
      isCancellationError: () => false,
    });

    expect(outcome).toEqual({ status: "cancelled" });
  });

  it("loads owner/run-scoped persisted manifests after Genie and threads them to Dashboard", async () => {
    const events: string[] = [];
    mocks.loadGenieRecommendations.mockImplementation(
      async (runId: string, ownerEmail: string | null) => {
        events.push("manifest:load");
        expect(runId).toBe("run-1");
        expect(ownerEmail).toBe("owner@example.com");
        return [
          {
            domain: "Sales",
            semanticAssetManifest: JSON.stringify(manifest),
          },
        ];
      },
    );
    mocks.runDashboardEngine.mockImplementation(async (input) => {
      events.push("dashboard:start");
      expect(input.semanticManifests).toEqual({ Sales: manifest });
      return { recommendations: [], validationFailures: [] };
    });

    events.push("genie:manifest-persisted");
    await runDashboardRecommendations(context, "run-1");

    expect(events).toEqual(["genie:manifest-persisted", "manifest:load", "dashboard:start"]);
  });

  it("fails closed before Dashboard when persisted manifests are absent", async () => {
    mocks.loadGenieRecommendations.mockResolvedValue([]);

    await expect(runDashboardRecommendations(context, "run-1")).rejects.toThrow(
      "No persisted Genie semantic manifests",
    );

    expect(mocks.runDashboardEngine).not.toHaveBeenCalled();
  });

  it("fails closed when persisted rows do not cover the dashboard domains", async () => {
    mocks.loadGenieRecommendations.mockResolvedValue([
      {
        domain: "Finance",
        semanticAssetManifest: JSON.stringify({ ...manifest, domain: "Finance" }),
      },
    ]);

    await expect(runDashboardRecommendations(context, "run-1")).rejects.toThrow("Sales");

    expect(mocks.runDashboardEngine).not.toHaveBeenCalled();
  });
});
