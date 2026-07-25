import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({
  runGenieEngine: vi.fn(),
  generateLegacy: vi.fn(),
  saveRecommendations: vi.fn(),
  getConfig: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/lib/genie/engine", async () => {
  class EngineCancelledError extends Error {
    constructor() {
      super("Genie Engine generation was cancelled");
      this.name = "EngineCancelledError";
    }
  }
  return {
    EngineCancelledError,
    runGenieEngine: mocks.runGenieEngine,
  };
});

vi.mock("@/lib/genie/recommend", () => ({
  generateGenieRecommendations: mocks.generateLegacy,
}));

vi.mock("@/lib/lakebase/genie-recommendations", () => ({
  saveGenieRecommendations: mocks.saveRecommendations,
}));

vi.mock("@/lib/lakebase/genie-engine-config", () => ({
  getGenieEngineConfig: mocks.getConfig,
}));

vi.mock("@/lib/lakebase/metadata-cache", () => ({
  loadMetadataForRun: vi.fn(),
}));

vi.mock("@/lib/lakebase/activity-log", () => ({
  logActivity: mocks.logActivity,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { EngineCancelledError } from "@/lib/genie/engine";
import { runGenieRecommendations } from "@/lib/pipeline/steps/genie-recommendations";

const context = {
  run: { runId: "run-1", config: {} },
  metadata: { tables: [], columns: [] },
  useCases: [{ id: "uc-1" }],
  sampleData: null,
  discoveryResult: null,
} as unknown as PipelineContext;

describe("pipeline Genie semantic contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockResolvedValue({
      config: { questionComplexity: "medium" },
      version: 1,
    });
    mocks.saveRecommendations.mockResolvedValue(undefined);
  });

  it("fails closed without legacy fallback when primary generation fails", async () => {
    mocks.runGenieEngine.mockRejectedValue(new Error("primary failed"));

    await expect(
      runGenieRecommendations(context, "run-1", undefined, undefined, undefined, {
        allowLegacyFallback: false,
        requireSemanticManifests: true,
      }),
    ).rejects.toThrow("primary failed");

    expect(mocks.generateLegacy).not.toHaveBeenCalled();
    expect(mocks.saveRecommendations).not.toHaveBeenCalled();
  });

  it("rejects zero recommendations in the pipeline semantic stage", async () => {
    mocks.runGenieEngine.mockResolvedValue({
      recommendations: [],
      passOutputs: [],
      failedDomains: [],
    });

    await expect(
      runGenieRecommendations(context, "run-1", undefined, undefined, undefined, {
        allowLegacyFallback: false,
        requireSemanticManifests: true,
      }),
    ).rejects.toThrow("no persisted domain semantic manifests");

    expect(mocks.saveRecommendations).not.toHaveBeenCalled();
  });

  it("threads the job signal into the primary engine", async () => {
    const controller = new AbortController();
    mocks.runGenieEngine.mockResolvedValue({
      recommendations: [{ domain: "Sales" }],
      passOutputs: [{ domain: "Sales", semanticAssetManifest: { version: "1" } }],
      failedDomains: [],
    });

    await runGenieRecommendations(context, "run-1", undefined, undefined, undefined, {
      signal: controller.signal,
      allowLegacyFallback: false,
      requireSemanticManifests: true,
    });

    expect(mocks.runGenieEngine).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("fails closed when any primary semantic domain fails", async () => {
    mocks.runGenieEngine.mockResolvedValue({
      recommendations: [{ domain: "Sales" }],
      passOutputs: [{ domain: "Sales", semanticAssetManifest: { version: "1" } }],
      failedDomains: [{ domain: "Finance", error: "metric-view validation failed" }],
    });

    await expect(
      runGenieRecommendations(context, "run-1", undefined, undefined, undefined, {
        allowLegacyFallback: false,
        requireSemanticManifests: true,
      }),
    ).rejects.toThrow("incomplete domain output");

    expect(mocks.saveRecommendations).not.toHaveBeenCalled();
    expect(mocks.generateLegacy).not.toHaveBeenCalled();
  });

  it("rethrows cancellation and never enters legacy fallback", async () => {
    mocks.runGenieEngine.mockRejectedValue(new EngineCancelledError());

    await expect(
      runGenieRecommendations(context, "run-1", undefined, undefined, undefined, {
        allowLegacyFallback: true,
        requireSemanticManifests: true,
      }),
    ).rejects.toBeInstanceOf(EngineCancelledError);

    expect(mocks.generateLegacy).not.toHaveBeenCalled();
    expect(mocks.saveRecommendations).not.toHaveBeenCalled();
  });
});
