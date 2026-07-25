import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const deployScript = readFileSync(join(repoRoot, "deploy.sh"), "utf8");

function extractFunction(name: string): string {
  const start = deployScript.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`Missing ${name} in deploy.sh`);

  let depth = 0;
  for (let index = start; index < deployScript.length; index += 1) {
    if (deployScript[index] === "{") depth += 1;
    if (deployScript[index] === "}") {
      depth -= 1;
      if (depth === 0) return deployScript.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated ${name} in deploy.sh`);
}

function collectLocalScriptDependencies(entrypoints: string[]): Set<string> {
  const scripts = new Set(entrypoints);
  const pending = [...entrypoints];

  while (pending.length > 0) {
    const script = pending.pop()!;
    const absoluteScript = join(repoRoot, script);
    expect(existsSync(absoluteScript), `${script} must exist`).toBe(true);
    const source = readFileSync(absoluteScript, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+\.mjs)["']/g)) {
      const dependency = relative(repoRoot, resolve(dirname(absoluteScript), match[1]));
      if (!scripts.has(dependency)) {
        scripts.add(dependency);
        pending.push(dependency);
      }
    }
  }

  return scripts;
}

function runUpload(
  mode: "zero-egress" | "diff" | "full",
  deleteBehavior:
    | "success"
    | "resource-missing"
    | "generic-not-found"
    | "generic-does-not-exist"
    | "missing-profile"
    | "auth"
    | "network" = "success",
) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "forge-upload-test-"));
  const wrapperDir = join(fixtureDir, "wrapper");
  execFileSync("mkdir", ["-p", wrapperDir]);
  writeFileSync(join(wrapperDir, "app.yaml"), "command: [bash, start.sh]\n");
  writeFileSync(join(wrapperDir, "start.sh"), "#!/usr/bin/env bash\n");
  const callLog = join(fixtureDir, "calls.log");

  const harness = `
set -uo pipefail
${extractFunction("upload_code")}
USER_EMAIL="owner@example.com"
APP_NAME="forge-test"
DEPLOY_WRAPPER="${wrapperDir}"
ARG_ZERO_EGRESS="${mode === "zero-egress" ? "true" : "false"}"
ARG_FULL_SYNC="${mode === "full" ? "true" : "false"}"
DELETE_BEHAVIOR="${deleteBehavior}"
CALL_LOG="${callLog}"
info() { :; }
ok() { :; }
warn() { :; }
die() { printf 'DIE:%s\\n' "$1"; exit 42; }
databricks() {
  printf 'CALL:%s\\n' "$*" >> "$CALL_LOG"
  printf 'CALL:%s\\n' "$*"
  if [ "$1 $2" = "workspace delete" ]; then
    case "$DELETE_BEHAVIOR" in
      resource-missing) printf 'Error: RESOURCE_DOES_NOT_EXIST: /Workspace/Users/owner@example.com/forge-test\\n' >&2; return 1 ;;
      generic-not-found) printf 'Error: authentication profile not found\\n' >&2; return 1 ;;
      generic-does-not-exist) printf 'Error: configuration file does not exist\\n' >&2; return 1 ;;
      missing-profile) printf 'Error: resolve: default auth: cannot configure default credentials\\n' >&2; return 1 ;;
      auth) printf 'Error: UNAUTHENTICATED: Invalid access token\\n' >&2; return 1 ;;
      network) printf 'Error: dial tcp: no such host\\n' >&2; return 1 ;;
    esac
  fi
  return 0
}
upload_code
`;
  const harnessPath = join(fixtureDir, "harness.sh");
  writeFileSync(harnessPath, harness);
  const result = spawnSync("bash", [harnessPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ...result,
    calls: readFileSync(callLog, "utf8").trim().split("\n"),
  };
}

describe("deploy.sh upload_code", () => {
  it("replaces the zero-egress workspace before importing wrapper files", () => {
    const result = runUpload("zero-egress");

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([
      "CALL:workspace delete /Workspace/Users/owner@example.com/forge-test/.git --recursive",
      "CALL:workspace delete /Workspace/Users/owner@example.com/forge-test --recursive",
      "CALL:workspace mkdirs /Workspace/Users/owner@example.com/forge-test",
      expect.stringContaining(
        "workspace import /Workspace/Users/owner@example.com/forge-test/app.yaml",
      ),
      expect.stringContaining(
        "workspace import /Workspace/Users/owner@example.com/forge-test/start.sh",
      ),
    ]);
  });

  it("accepts an already-missing zero-egress workspace", () => {
    const result = runUpload("zero-egress", "resource-missing");

    expect(result.status).toBe(0);
    expect(result.calls).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "workspace import /Workspace/Users/owner@example.com/forge-test/app.yaml",
        ),
      ]),
    );
  });

  it.each([
    ["generic-not-found", "authentication profile not found"],
    ["generic-does-not-exist", "configuration file does not exist"],
    ["missing-profile", "cannot configure default credentials"],
    ["auth", "Invalid access token"],
    ["network", "no such host"],
  ] as const)("stops zero-egress upload for %s cleanup errors", (deleteBehavior, message) => {
    const result = runUpload("zero-egress", deleteBehavior);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("DIE:");
    expect(result.stdout).toContain(message);
    expect(result.calls.join("\n")).not.toContain("CALL:workspace import");
  });

  it.each([
    [
      "diff",
      "CALL:sync --exclude-from .databricksignore . /Workspace/Users/owner@example.com/forge-test",
    ],
    [
      "full",
      "CALL:sync --full --exclude-from .databricksignore . /Workspace/Users/owner@example.com/forge-test",
    ],
  ] as const)("keeps %s source sync behavior unchanged", (mode, expectedCall) => {
    const result = runUpload(mode);

    expect(result.status).toBe(0);
    expect(result.calls).toContain(expectedCall);
    expect(result.calls).not.toContain(
      "CALL:workspace delete /Workspace/Users/owner@example.com/forge-test --recursive",
    );
  });
});

describe("deploy.sh zero-egress package assembly", () => {
  it("copies every startup project script and local dependency before creating the archive", () => {
    const startScript = readFileSync(join(repoRoot, "scripts/start.sh"), "utf8");
    const startupEntrypoints = Array.from(
      startScript.matchAll(/\bnode\s+(scripts\/[\w./-]+\.mjs)\b/g),
      (match) => match[1],
    );
    const requiredScripts = collectLocalScriptDependencies(startupEntrypoints);
    const assembly = extractFunction("assemble_zero_egress");
    const archiveIndex = assembly.indexOf('create_zero_egress_archive "$bundle_path"');

    expect(archiveIndex).toBeGreaterThan(0);
    const copiedProjectFiles = new Set<string>();
    for (const match of assembly
      .slice(0, archiveIndex)
      .matchAll(
        /cp\s+"?(?:\$SCRIPT_DIR\/)?((?:scripts|lib)\/[\w./-]+)"?\s+"\$DEPLOY_PKG\/((?:scripts(?:\/db)?)|(?:lib\/dbx))\/"/g,
      )) {
      copiedProjectFiles.add(`${match[2]}/${basename(match[1])}`);
    }

    expect([...requiredScripts].sort()).toEqual([
      "lib/dbx/model-admission.mjs",
      "scripts/check-endpoint-readiness.mjs",
      "scripts/db-preflight.mjs",
      "scripts/db/repair-sql.mjs",
      "scripts/db/repair.mjs",
      "scripts/provision-lakebase.mjs",
      "scripts/seed-benchmarks.mjs",
      "scripts/validate-endpoints.mjs",
    ]);
    for (const script of requiredScripts) {
      expect(copiedProjectFiles, `${script} must be copied to the same bundle path`).toContain(
        script,
      );
    }
    expect(assembly).toContain(
      'cp "$SCRIPT_DIR/lib/dbx/model-admission.mjs" "$DEPLOY_PKG/lib/dbx/"',
    );
  });

  it("copies the endpoint-admission helper and module from the script directory, not the caller cwd", () => {
    const assembly = extractFunction("assemble_zero_egress");
    const copyLines = assembly
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        /^(?:mkdir -p "\$DEPLOY_PKG\/lib\/dbx"|cp .*(?:check-endpoint-readiness|model-admission)\.mjs)/.test(
          line,
        ),
      );

    expect(copyLines).toHaveLength(3);

    const fixtureDir = mkdtempSync(join(tmpdir(), "forge-pkg-copy-"));
    const bundleDir = join(fixtureDir, "bundle");
    const unrelatedCwd = join(fixtureDir, "cwd");
    execFileSync("mkdir", ["-p", join(bundleDir, "scripts"), unrelatedCwd]);
    const harnessPath = join(fixtureDir, "harness.sh");
    writeFileSync(
      harnessPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `SCRIPT_DIR="${repoRoot}"`,
        `DEPLOY_PKG="${bundleDir}"`,
        ...copyLines,
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync("bash", [harnessPath], { cwd: unrelatedCwd, encoding: "utf8" });

    expect(result.stderr).not.toContain("No such file");
    expect(result.status).toBe(0);
    // The bundle-relative destinations are the deployed invocation contract:
    // start.sh runs `node scripts/check-endpoint-readiness.mjs`, which imports
    // `../lib/dbx/model-admission.mjs`.
    expect(existsSync(join(bundleDir, "scripts/check-endpoint-readiness.mjs"))).toBe(true);
    expect(existsSync(join(bundleDir, "lib/dbx/model-admission.mjs"))).toBe(true);
  });

  it("bundles the external runtime dependencies used by database preflight", () => {
    const assembly = extractFunction("assemble_zero_egress");
    const repairScript = readFileSync(join(repoRoot, "scripts/db/repair.mjs"), "utf8");

    expect(repairScript).toMatch(/from ["']pg["']/);
    expect(assembly).toContain("trace('pg')");
    expect(assembly).toContain("trace('prisma')");
  });
});
