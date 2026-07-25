import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineContext } from "@/lib/domain/types";
import type { ActivityAction } from "@/lib/lakebase/activity-log";

const mocks = vi.hoisted(() => ({
  runGenieEngine: vi.fn(),
  saveGenieRecommendations: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/genie/engine", () => ({
  EngineCancelledError: class EngineCancelledError extends Error {},
  runGenieEngine: mocks.runGenieEngine,
}));
vi.mock("@/lib/genie/recommend", () => ({ generateGenieRecommendations: vi.fn() }));
vi.mock("@/lib/lakebase/genie-recommendations", () => ({
  saveGenieRecommendations: mocks.saveGenieRecommendations,
}));
vi.mock("@/lib/lakebase/genie-engine-config", () => ({
  getGenieEngineConfig: vi.fn(async () => ({ config: {}, version: 2 })),
}));
vi.mock("@/lib/lakebase/metadata-cache", () => ({ loadMetadataForRun: vi.fn() }));
vi.mock("@/lib/lakebase/activity-log", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runGenieRecommendations } from "@/lib/pipeline/steps/genie-recommendations";

const release2Actions = [
  "metric_view_improve_planned",
  "semantic_manifest_built",
  "dashboard_draft_deployed",
  "dashboard_readback_failed",
  "dashboard_published",
  "dashboard_publish_failed",
  "dashboard_improved",
] satisfies ActivityAction[];

describe("semantic uplift activities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveGenieRecommendations.mockResolvedValue(undefined);
    mocks.runGenieEngine.mockResolvedValue({
      recommendations: [{ domain: "Sales" }],
      passOutputs: [
        {
          domain: "Sales",
          semanticAssetManifest: { version: "1", domain: "Sales" },
          metricViewProposals: [{ classification: "improve" }],
        },
      ],
      failedDomains: [],
    });
  });

  it("declares every Release 2 lifecycle action", () => {
    expect(release2Actions).toHaveLength(7);
  });

  it("records one structured manifest and improve outcome only after persistence", async () => {
    const context = {
      run: { runId: "run-1", ownerEmail: "owner@example.com" },
      ownerEmail: "owner@example.com",
      useCases: [{ id: "uc-1" }],
      metadata: { tables: [], columns: [] },
    } as unknown as PipelineContext;

    await runGenieRecommendations(context, "run-1", undefined, undefined, undefined, {
      allowLegacyFallback: false,
      requireSemanticManifests: true,
    });

    expect(mocks.logActivity).toHaveBeenCalledTimes(2);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "semantic_manifest_built",
      expect.objectContaining({
        userId: "owner@example.com",
        resourceId: "run-1",
        metadata: expect.objectContaining({ domains: ["Sales"], manifestCount: 1 }),
      }),
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "metric_view_improve_planned",
      expect.objectContaining({
        userId: "owner@example.com",
        resourceId: "run-1",
        metadata: expect.objectContaining({ improveCount: 1 }),
      }),
    );
    expect(mocks.logActivity.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.saveGenieRecommendations.mock.invocationCallOrder[0],
    );
  });
});
