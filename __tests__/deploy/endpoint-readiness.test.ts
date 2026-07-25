import { describe, expect, it } from "vitest";

import {
  evaluateEndpointReadiness,
  findKnownModelKey,
  runtimeAdmittedEndpointNames,
} from "../../lib/dbx/model-admission.mjs";

describe("runtime endpoint admission contract", () => {
  it("applies known-model admission and the customer allowlist in registry order", () => {
    const env = {
      DATABRICKS_SERVING_ENDPOINT: "unknown-custom-endpoint",
      DATABRICKS_SERVING_ENDPOINT_FAST: "databricks-claude-sonnet-4-6",
      DATABRICKS_REVIEW_ENDPOINT: "databricks-gpt-5-4",
      DATABRICKS_ALLOWED_MODELS: "databricks-gpt-5-4",
    };

    expect(runtimeAdmittedEndpointNames(env)).toEqual(["databricks-gpt-5-4"]);
  });

  it("preserves legacy custom endpoint names that contain a known model key", () => {
    const customName = "customer-databricks-claude-opus-4-7-prod";
    expect(findKnownModelKey(customName)).toBe("databricks-claude-opus-4-7");
    expect(
      runtimeAdmittedEndpointNames({
        DATABRICKS_SERVING_ENDPOINT: customName,
      }),
    ).toEqual([customName]);
  });

  it("matches registry fallback when an allowlist filters every admitted endpoint", () => {
    expect(
      runtimeAdmittedEndpointNames({
        DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
        DATABRICKS_SERVING_ENDPOINT_FAST: "databricks-claude-sonnet-4-6",
        DATABRICKS_ALLOWED_MODELS: "not-configured",
      }),
    ).toEqual(["databricks-claude-opus-4-7"]);
  });

  it("keeps the embedding endpoint outside chat admission and the required-role gate", () => {
    const env = {
      DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
      DATABRICKS_EMBEDDING_ENDPOINT: "databricks-qwen3-embedding-0-6b",
      FORGE_ENDPOINT_VALIDATION_STATE: "completed",
      FORGE_VALIDATED_ENDPOINTS: "databricks-claude-opus-4-7,databricks-qwen3-embedding-0-6b",
    };

    // The embedding endpoint is probed for existence by validate-endpoints, so it
    // can appear in FORGE_VALIDATED_ENDPOINTS, but it is never admitted to the
    // chat/review pool and never counts toward the required-role startup gate.
    expect(runtimeAdmittedEndpointNames(env)).toEqual(["databricks-claude-opus-4-7"]);
    expect(evaluateEndpointReadiness(env)).toMatchObject({
      shouldStart: true,
      admittedRequiredCount: 1,
      usableRequiredCount: 1,
    });
  });

  it("does not let a configured embedding endpoint satisfy the required LLM gate", () => {
    const env = {
      DATABRICKS_EMBEDDING_ENDPOINT: "databricks-qwen3-embedding-0-6b",
      FORGE_ENDPOINT_VALIDATION_STATE: "completed",
      FORGE_VALIDATED_ENDPOINTS: "databricks-qwen3-embedding-0-6b",
    };

    // With no chat endpoint configured, admission falls back to the default
    // required chat model, which the validated set does not contain.
    expect(runtimeAdmittedEndpointNames(env)).toEqual(["databricks-claude-opus-4-7"]);
    expect(evaluateEndpointReadiness(env)).toMatchObject({
      shouldStart: false,
      usableRequiredCount: 0,
    });
  });

  it("fails readiness when an allowlist retains no validated required LLM endpoint", () => {
    expect(
      evaluateEndpointReadiness({
        DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
        DATABRICKS_EMBEDDING_ENDPOINT: "databricks-qwen3-embedding-0-6b",
        DATABRICKS_ALLOWED_MODELS: "databricks-qwen3-embedding-0-6b",
        FORGE_ENDPOINT_VALIDATION_STATE: "completed",
        FORGE_VALIDATED_ENDPOINTS: "databricks-qwen3-embedding-0-6b",
      }),
    ).toMatchObject({
      state: "completed",
      shouldStart: false,
      usableRequiredCount: 0,
    });
  });

  it("fails completed readiness when validated names miss admitted required endpoints", () => {
    expect(
      evaluateEndpointReadiness({
        DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
        DATABRICKS_SERVING_ENDPOINT_FAST: "databricks-claude-sonnet-4-6",
        DATABRICKS_ALLOWED_MODELS: "databricks-claude-sonnet-4-6",
        FORGE_ENDPOINT_VALIDATION_STATE: "completed",
        FORGE_VALIDATED_ENDPOINTS: "databricks-claude-opus-4-7",
      }),
    ).toMatchObject({
      state: "completed",
      shouldStart: false,
      admittedCount: 1,
      admittedRequiredCount: 1,
      usableRequiredCount: 0,
    });
  });
});
