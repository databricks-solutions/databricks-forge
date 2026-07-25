import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const startScript = readFileSync(join(process.cwd(), "scripts/start.sh"), "utf8");
const readinessScript = join(process.cwd(), "scripts/check-endpoint-readiness.mjs");
const ENDPOINT_ENV_KEYS = [
  "DATABRICKS_SERVING_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_FAST",
  "DATABRICKS_REVIEW_ENDPOINT",
  "DATABRICKS_SERVING_ENDPOINT_REASONING_2",
  "DATABRICKS_SERVING_ENDPOINT_GENERATION",
  "DATABRICKS_SERVING_ENDPOINT_SQL",
  "DATABRICKS_SERVING_ENDPOINT_LIGHTWEIGHT",
  "DATABRICKS_ALLOWED_MODELS",
  "FORGE_ENDPOINT_VALIDATION_STATE",
  "FORGE_VALIDATED_ENDPOINTS",
] as const;

function runReadiness(overrides: Record<string, string>) {
  const env = { ...process.env };
  for (const key of ENDPOINT_ENV_KEYS) delete env[key];
  Object.assign(env, overrides);
  return spawnSync(process.execPath, [readinessScript], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

describe("start.sh endpoint validation contract", () => {
  it("exports both validation state and the allowlist even when the allowlist is empty", () => {
    expect(startScript).toContain('export FORGE_ENDPOINT_VALIDATION_STATE="$VALIDATION_STATE"');
    expect(startScript).toContain('export FORGE_VALIDATED_ENDPOINTS="$VALIDATED_ENDPOINTS"');
  });

  it("executes the shared readiness gate after exporting validation state", () => {
    expect(startScript).toContain("node scripts/check-endpoint-readiness.mjs");
  });

  it("fails completed startup when the allowlist admits only a fast endpoint that failed probing", () => {
    const result = runReadiness({
      DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
      DATABRICKS_SERVING_ENDPOINT_FAST: "databricks-claude-sonnet-4-6",
      DATABRICKS_ALLOWED_MODELS: "databricks-claude-sonnet-4-6",
      FORGE_ENDPOINT_VALIDATION_STATE: "completed",
      FORGE_VALIDATED_ENDPOINTS: "databricks-claude-opus-4-7",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/zero runtime-admitted required endpoints/i);
  });

  it("allows completed startup when a validated required endpoint survives runtime admission", () => {
    const result = runReadiness({
      DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
      DATABRICKS_SERVING_ENDPOINT_FAST: "databricks-claude-sonnet-4-6",
      DATABRICKS_ALLOWED_MODELS: "databricks-claude-opus-4-7",
      FORGE_ENDPOINT_VALIDATION_STATE: "completed",
      FORGE_VALIDATED_ENDPOINTS: "databricks-claude-opus-4-7",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 runtime-admitted required endpoint/i);
  });

  it.each(["auth_skipped", "not_run"])(
    "preserves runtime candidates and does not fail when state is %s",
    (state) => {
      const result = runReadiness({
        DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
        DATABRICKS_ALLOWED_MODELS: "databricks-claude-sonnet-4-6",
        FORGE_ENDPOINT_VALIDATION_STATE: state,
        FORGE_VALIDATED_ENDPOINTS: "",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/preserved for runtime failover/i);
    },
  );

  it("does not expose credentials in readiness output", () => {
    const result = runReadiness({
      DATABRICKS_SERVING_ENDPOINT: "databricks-claude-opus-4-7",
      FORGE_ENDPOINT_VALIDATION_STATE: "completed",
      FORGE_VALIDATED_ENDPOINTS: "",
      DATABRICKS_CLIENT_SECRET: "do-not-print-this",
    });

    expect(`${result.stdout}${result.stderr}`).not.toContain("do-not-print-this");
  });
});
