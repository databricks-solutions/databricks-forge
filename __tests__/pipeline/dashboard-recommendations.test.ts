import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDashboardRecommendations } from "@/lib/pipeline/steps/dashboard-recommendations";
import type { PipelineContext } from "@/lib/domain/types";
import type { DashboardRecommendation, DashboardValidationFailure } from "@/lib/dashboard/types";

const mocks = vi.hoisted(() => ({
  runDashboardEngine: vi.fn(),
  saveRecommendations: vi.fn(),
  failJob: vi.fn(),
  loadGenieRecommendations: vi.fn(),
}));

vi.mock("@/lib/dashboard/engine", () => ({
  runDashboardEngine: mocks.runDashboardEngine,
}));

vi.mock("@/lib/lakebase/dashboard-recommendations", () => ({
  saveDashboardRecommendations: mocks.saveRecommendations,
}));

vi.mock("@/lib/lakebase/genie-recommendations", () => ({
  getGenieRecommendationsByRunId: mocks.loadGenieRecommendations,
}));

vi.mock("@/lib/lakebase/metadata-cache", () => ({
  loadMetadataForRun: vi.fn(),
}));

vi.mock("@/lib/dashboard/engine-status", () => ({
  failDashboardJob: mocks.failJob,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const failure: DashboardValidationFailure = {
  domain: "Sales",
  evidence: [
    {
      stage: "dataset_result",
      status: "failed",
      code: "ALIAS_MISSING",
      message: 'Dataset "sales" did not return alias "revenue".',
    },
  ],
};

const recommendation = {
  domain: "Finance",
  title: "Finance",
} as DashboardRecommendation;

const context = {
  run: { runId: "run-1" },
  useCases: [{ id: "uc-1", domain: "Sales", subdomain: "Revenue", tablesInvolved: [] }],
  metadata: { tables: [], columns: [] },
  discoveryResult: null,
} as unknown as PipelineContext;

describe("runDashboardRecommendations validation outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadGenieRecommendations.mockResolvedValue([
      {
        domain: "Sales",
        semanticAssetManifest: JSON.stringify({
          version: "1",
          domain: "Sales",
          subdomains: [],
          metricViews: [],
          measures: [],
          dimensions: [],
          filters: [],
          generatedAt: "2026-07-24T05:00:00.000Z",
        }),
      },
    ]);
  });

  it("fails an all-invalid automatic run without persisting zero recommendations", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [],
      validationFailures: [failure],
    });

    await expect(runDashboardRecommendations(context, "run-1")).rejects.toMatchObject({
      name: "DashboardValidationError",
      validationFailures: [failure],
    });

    expect(mocks.saveRecommendations).not.toHaveBeenCalled();
    expect(mocks.failJob).toHaveBeenCalledWith(
      "run-1",
      "Dashboard validation failed for 1 domain",
      [failure],
    );
  });

  it("persists valid siblings and returns failures for mixed automatic domains", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [recommendation],
      validationFailures: [failure],
    });

    await expect(runDashboardRecommendations(context, "run-1")).resolves.toEqual({
      recommendationCount: 1,
      validationFailures: [failure],
    });

    expect(mocks.saveRecommendations).toHaveBeenCalledWith(
      "run-1",
      [recommendation],
      undefined,
      undefined,
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("persists all-valid automatic domains without validation failures", async () => {
    mocks.runDashboardEngine.mockResolvedValue({
      recommendations: [recommendation],
      validationFailures: [],
    });

    await expect(runDashboardRecommendations(context, "run-1")).resolves.toEqual({
      recommendationCount: 1,
      validationFailures: [],
    });

    expect(mocks.saveRecommendations).toHaveBeenCalledOnce();
    expect(mocks.failJob).not.toHaveBeenCalled();
  });
});
