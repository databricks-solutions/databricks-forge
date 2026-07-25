import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readRepoFile = (path: string) => readFileSync(join(repoRoot, path), "utf8");

const deploy = readRepoFile("deploy.sh");
const envExample = readRepoFile(".env.local.example");
const registry = readRepoFile("lib/dbx/model-registry.ts");
const docs = readRepoFile("AGENTS.md");

function runSelection(requirement: "required" | "optional", available = "") {
  return spawnSync(
    "bash",
    [
      "-c",
      `
        source scripts/deploy-endpoint-selection.sh
        probe_endpoint() { [ "$1" = "$AVAILABLE_ENDPOINT" ]; }
        select_endpoint_for_role "$REQUIREMENT" "first-endpoint second-endpoint"
      `,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        REQUIREMENT: requirement,
        AVAILABLE_ENDPOINT: available,
      },
      encoding: "utf8",
    },
  );
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-deploy-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Run a bash snippet with the repository's selection helper sourced, from a
 * working directory that is NOT the repository root, so relative-path sourcing
 * cannot accidentally succeed.
 */
function runFromForeignCwd(script: string) {
  return spawnSync("bash", ["-c", script], {
    cwd: makeTempDir(),
    env: { ...process.env, REPO_ROOT: repoRoot },
    encoding: "utf8",
  });
}

describe("deploy helper sourcing and assignment safety", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the selection helper from the script directory, not the caller cwd", () => {
    // Exercise deploy.sh's own resolution lines rather than a re-implementation.
    const scriptDirLine = deploy.split("\n").find((line) => /^SCRIPT_DIR=/.test(line.trim()));
    const sourceLine = deploy
      .split("\n")
      .find((line) => /^source .*deploy-endpoint-selection\.sh/.test(line.trim()));

    expect(scriptDirLine, "deploy.sh must derive SCRIPT_DIR from BASH_SOURCE").toBeDefined();
    expect(scriptDirLine).toContain("BASH_SOURCE");
    expect(sourceLine, "deploy.sh must source the helper via SCRIPT_DIR").toBeDefined();
    expect(sourceLine).toContain("SCRIPT_DIR");

    const harnessDir = makeTempDir();
    const harness = join(harnessDir, "harness.sh");
    writeFileSync(
      harness,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `BASH_SOURCE_OVERRIDE="${join(repoRoot, "deploy.sh")}"`,
        `SCRIPT_DIR="$(cd "$(dirname "$BASH_SOURCE_OVERRIDE")" && pwd)"`,
        sourceLine ?? "",
        'probe_endpoint() { [ "$1" = "second-endpoint" ]; }',
        'select_endpoint_for_role optional "first-endpoint second-endpoint"',
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(harness, 0o755);

    const result = spawnSync("bash", [harness], {
      cwd: makeTempDir(),
      encoding: "utf8",
    });

    expect(result.stderr).not.toContain("No such file");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("second-endpoint");
  });

  it("runs deploy.sh by absolute path from an unrelated working directory", () => {
    const result = spawnSync("bash", [join(repoRoot, "deploy.sh"), "--help"], {
      cwd: makeTempDir(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("No such file");
  });

  it("assigns endpoint values as data, never as evaluated shell syntax", () => {
    const marker = join(makeTempDir(), "pwned");
    const hostileEndpoint = `$(touch ${marker})\`touch ${marker}\``;
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
        source "$REPO_ROOT/scripts/deploy-endpoint-selection.sh"
        assign_endpoint_var TARGET_ENDPOINT "$HOSTILE"
        printf '%s' "$TARGET_ENDPOINT"
      `,
      ],
      {
        cwd: makeTempDir(),
        env: { ...process.env, REPO_ROOT: repoRoot, HOSTILE: hostileEndpoint },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(hostileEndpoint);
    expect(existsSync(marker)).toBe(false);
  });

  it("preserves a command-substitution-looking candidate through role selection", () => {
    // Fallback chains are whitespace-separated, so the hostile literal must be
    // a single word; `$(id)` proves the value is never expanded because the
    // expanded form would contain "uid=".
    const hostileEndpoint = "$(id)`id`";
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
        source "$REPO_ROOT/scripts/deploy-endpoint-selection.sh"
        probe_endpoint() { [ "$1" = "$HOSTILE" ]; }
        resolved="$(select_endpoint_for_role required "$HOSTILE")"
        assign_endpoint_var SELECTED "$resolved"
        printf '%s' "$SELECTED"
      `,
      ],
      {
        cwd: makeTempDir(),
        env: { ...process.env, REPO_ROOT: repoRoot, HOSTILE: hostileEndpoint },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(hostileEndpoint);
    expect(result.stdout).not.toContain("uid=");
  });

  it("rejects invalid target variable names", () => {
    const result = runFromForeignCwd(`
      source "$REPO_ROOT/scripts/deploy-endpoint-selection.sh"
      if assign_endpoint_var '1BAD; rm -rf /' value; then echo "accepted"; else echo "rejected"; fi
    `);

    expect(result.stdout.trim()).toBe("rejected");
  });

  it("no longer evaluates endpoint role assignments through eval", () => {
    expect(deploy).not.toMatch(/eval\s+"\$varname=/);
    expect(deploy).toContain("assign_endpoint_var");
  });
});

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
    expect(envExample).toContain("# Primary model (defaults to databricks-claude-opus-4-7)");
    expect(envExample).toContain("# DATABRICKS_REVIEW_ENDPOINT=databricks-gpt-5-4");
    expect(docs).toContain(
      "Review endpoint (`serving-endpoint-review`) defaults to `databricks-gpt-5-4`",
    );
  });

  it("selects the first proven available fallback", () => {
    const result = runSelection("optional", "second-endpoint");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("second-endpoint");
  });

  it("retains the first candidate only for required roles after total probe failure", () => {
    const result = runSelection("required");
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("first-endpoint");
  });

  it("leaves optional roles unbound after total probe failure", () => {
    const result = runSelection("optional");
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
  });

  it("uses the extracted selection helper for deploy role probing", () => {
    expect(deploy).toContain('source "$SCRIPT_DIR/scripts/deploy-endpoint-selection.sh"');
    expect(deploy).toContain("select_endpoint_for_role");
  });
});
