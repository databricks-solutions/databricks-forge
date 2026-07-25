import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readRepoFile = (path: string) => readFileSync(join(repoRoot, path), "utf8");

const deploy = readRepoFile("deploy.sh");
const envExample = readRepoFile(".env.local.example");
const registry = readRepoFile("lib/dbx/model-registry.ts");
const docs = readRepoFile("AGENTS.md");

describe("deploy model defaults", () => {
  it("keeps deploy defaults and fallback chains compatible with the model registry", () => {
    expect(deploy).toContain('DEFAULT_ENDPOINT="databricks-claude-opus-4-7"');
    expect(deploy).toContain('DEFAULT_REVIEW_ENDPOINT="databricks-gpt-5-4"');
    expect(deploy).toContain('DEFAULT_REASONING_ENDPOINT_2="databricks-gemini-3-flash"');

    expect(deploy).toContain(
      '"databricks-claude-opus-4-7 databricks-claude-opus-4-6 databricks-claude-opus-4-5 databricks-gpt-5-4 databricks-claude-sonnet-4-6"',
    );
    expect(deploy).toContain(
      '"databricks-gpt-5-4 databricks-claude-opus-4-7 databricks-claude-opus-4-6 databricks-claude-sonnet-4-6"',
    );
    expect(deploy).not.toMatch(
      /databricks-claude-opus-4-8|databricks-gpt-5-5|databricks-gemini-3-5-flash/,
    );

    for (const model of [
      "databricks-claude-opus-4-7",
      "databricks-gpt-5-4",
      "databricks-gemini-3-flash",
    ]) {
      expect(registry).toContain(`"${model}"`);
    }
  });

  it("documents the same primary and review defaults everywhere", () => {
    expect(deploy).toContain(
      "--endpoint NAME             Premium model endpoint    (default: databricks-claude-opus-4-7)",
    );
    expect(deploy).toContain(
      "--review-endpoint NAME      Review model endpoint     (default: databricks-gpt-5-4)",
    );
    expect(envExample).toContain(
      "# Primary model (defaults to databricks-claude-opus-4-7)",
    );
    expect(envExample).toContain("# DATABRICKS_REVIEW_ENDPOINT=databricks-gpt-5-4");
    expect(docs).toContain(
      "Review endpoint (`serving-endpoint-review`) defaults to `databricks-gpt-5-4`",
    );
  });
});
