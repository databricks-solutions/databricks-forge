import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const deployPath = join(repoRoot, "deploy.sh");
const deployScript = readFileSync(deployPath, "utf8");

function writeSourceableDeployScript(fixtureDir: string): string {
  const sourceablePath = join(fixtureDir, "deploy-functions.sh");
  writeFileSync(sourceablePath, deployScript.replace(/\nmain\s*$/, "\n"));
  return sourceablePath;
}

function runYamlTrapFlow(exitMode: "success" | "error" | "signal" = "success") {
  const fixtureDir = mkdtempSync(join(tmpdir(), "forge-yaml-trap-"));
  const sourceableDeployPath = writeSourceableDeployScript(fixtureDir);
  const appYaml = join(fixtureDir, "app.yaml");
  const wrapperYaml = join(fixtureDir, "wrapper-app.yaml");
  copyFileSync(join(repoRoot, "app.yaml"), appYaml);
  const baseline = readFileSync(appYaml, "utf8");

  const harness = `
set -euo pipefail
source "${sourceableDeployPath}"
cd "${fixtureDir}"
APP_NAME="forge-pr270"
LAKEBASE_ENDPOINT_PATH="projects/forge-pr270/branches/production/endpoints/primary"
LAKEBASE_BRANCH="projects/forge-pr270/branches/production"
USER_EMAIL="owner@example.com"
LAKEBASE_BOOTSTRAP_USER=""
SEED_BENCHMARKS="false"
SEED_BENCHMARKS_ALL_INDUSTRIES="false"
SEED_BENCHMARK_INDUSTRIES=""
BENCHMARK_ADMINS=""
ENABLE_METRIC_VIEWS="true"
ENABLE_FABRIC="false"
ENABLE_DEMO_MODE="false"
DISABLE_USER_ISOLATION="false"
MAX_PIPELINE_PER_USER=""
MAX_SCANS_PER_USER=""
MAX_GENIE_DEPLOYS_PER_USER=""
MAX_DEMO_ENGINES_PER_USER=""
REASONING_ENDPOINT_2=""
GENERATION_ENDPOINT=""
SQL_ENDPOINT=""
LIGHTWEIGHT_ENDPOINT=""
ALLOWED_MODELS=""
BUDGET_POLICY_ID=""
CUSTOM_TAGS_JSON=""
if declare -F install_app_yaml_restore_traps >/dev/null; then
  install_app_yaml_restore_traps
else
  trap restore_app_yaml EXIT
fi
prepare_app_yaml
# Reproduce a Bash 4+ shell/runtime where the parent's visible EXIT handler is
# active in a command-substitution subshell. macOS Bash 3.2 has no BASHPID, so
# the fixture supplies the distinct process identity exposed by newer Bash.
# Only the deployment-shell owner may move the backup.
probe=$(BASHPID="representative-child"; trap restore_app_yaml EXIT; printf probe)
cp app.yaml "${wrapperYaml}"
case "${exitMode}" in
  success) exit 0 ;;
  error) false ;;
  signal) kill -TERM "$$"; sleep 1 ;;
esac
`;
  const harnessPath = join(fixtureDir, "harness.sh");
  writeFileSync(harnessPath, harness);
  const result = spawnSync("bash", [harnessPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return {
    baseline,
    fixtureDir,
    localYaml: readFileSync(appYaml, "utf8"),
    result,
    wrapperYaml: existsSync(wrapperYaml) ? readFileSync(wrapperYaml, "utf8") : "",
  };
}

function runDeployReadiness(
  mode: "running" | "crashed" | "stale-crashed-then-running" | "timeout",
) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "forge-deploy-ready-"));
  const sourceableDeployPath = writeSourceableDeployScript(fixtureDir);
  const callLog = join(fixtureDir, "calls.log");
  const statusCountFile = join(fixtureDir, "status-count");
  writeFileSync(statusCountFile, "0");
  const harness = `
set -uo pipefail
source "${sourceableDeployPath}"
APP_NAME="forge-pr270"
WORKSPACE_PATH="/Workspace/Users/owner@example.com/forge-pr270"
DEPLOY_READINESS_MAX_ATTEMPTS=3
DEPLOY_READINESS_POLL_SECONDS=0
CALL_LOG="${callLog}"
STATUS_COUNT_FILE="${statusCountFile}"
info() { :; }
ok() { printf 'OK:%s\\n' "\${1:-}"; }
die() { printf 'DIE:%b\\n' "$1"; exit 42; }
sleep() { :; }
databricks() {
  printf 'CALL:%s\\n' "$*" >> "$CALL_LOG"
  if [ "$1 $2" = "apps deploy" ]; then
    printf '{"deployment_id":"dep-123"}\\n'
    return 0
  fi
  if [ "$1 $2" = "apps get-deployment" ]; then
    count=$(<"$STATUS_COUNT_FILE")
    count=$((count + 1))
    printf '%s' "$count" > "$STATUS_COUNT_FILE"
    case "${mode}" in
      running|crashed) printf '{"status":{"state":"SUCCEEDED"}}\\n' ;;
      stale-crashed-then-running)
        if [ "$count" -eq 1 ]; then
          printf '{"status":{"state":"PENDING"}}\\n'
        else
          printf '{"status":{"state":"SUCCEEDED"}}\\n'
        fi
        ;;
      timeout) printf '{"status":{"state":"IN_PROGRESS"}}\\n' ;;
    esac
    return 0
  fi
  if [ "$1 $2" = "apps get" ]; then
    case "${mode}" in
      running) printf '{"active_deployment":{"deployment_id":"dep-123","status":{"state":"SUCCEEDED"}},"app_status":{"state":"RUNNING"}}\\n' ;;
      crashed) printf '{"active_deployment":{"deployment_id":"dep-123","status":{"state":"SUCCEEDED"}},"app_status":{"state":"CRASHED"}}\\n' ;;
      stale-crashed-then-running)
        count=$(<"$STATUS_COUNT_FILE")
        if [ "$count" -eq 1 ]; then
          printf '{"active_deployment":{"deployment_id":"dep-old","status":{"state":"SUCCEEDED"}},"app_status":{"state":"CRASHED"}}\\n'
        else
          printf '{"active_deployment":{"deployment_id":"dep-123","status":{"state":"SUCCEEDED"}},"app_status":{"state":"RUNNING"}}\\n'
        fi
        ;;
      timeout) printf '{"active_deployment":{"deployment_id":"dep-old","status":{"state":"SUCCEEDED"}},"app_status":{"state":"STARTING"}}\\n' ;;
    esac
    return 0
  fi
  return 1
}
deploy_app
`;
  const harnessPath = join(fixtureDir, "harness.sh");
  writeFileSync(harnessPath, harness);
  const result = spawnSync("bash", [harnessPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ...result,
    calls: existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n") : [],
  };
}

function runArchiveCreation(platform: "Darwin" | "Linux", tarStatus = 0) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "forge-archive-test-"));
  const sourceableDeployPath = writeSourceableDeployScript(fixtureDir);
  const packageDir = join(fixtureDir, "package");
  const wrapperDir = join(fixtureDir, "wrapper");
  const callLog = join(fixtureDir, "calls.log");
  mkdirSync(packageDir);
  mkdirSync(wrapperDir);
  const harness = `
set -uo pipefail
source "${sourceableDeployPath}"
DEPLOY_PKG="${packageDir}"
CALL_LOG="${callLog}"
uname() { printf '${platform}\\n'; }
tar() {
  printf 'COPYFILE_DISABLE=%s tar %s\\n' "\${COPYFILE_DISABLE:-}" "$*" >> "$CALL_LOG"
  return ${tarStatus}
}
die() { printf 'DIE:%s\\n' "$1"; exit 42; }
create_zero_egress_archive "${join(wrapperDir, "bundle.tar.gz")}"
`;
  const harnessPath = join(fixtureDir, "harness.sh");
  writeFileSync(harnessPath, harness);
  const result = spawnSync("bash", [harnessPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ...result,
    calls: existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n") : [],
  };
}

describe("deploy.sh app.yaml restoration ownership", () => {
  it("keeps generated instance env through command substitutions and restores the working tree", () => {
    const flow = runYamlTrapFlow();

    expect(flow.result.status).toBe(0);
    expect(flow.wrapperYaml).toContain('value: "forge-pr270"');
    expect(flow.wrapperYaml).toContain(
      'value: "projects/forge-pr270/branches/production/endpoints/primary"',
    );
    expect(flow.wrapperYaml).toContain("FORGE_METRIC_VIEWS_ENABLED");
    expect(flow.localYaml).toBe(flow.baseline);
  });

  it.each(["error", "signal"] as const)("restores the working tree on %s exit", (exitMode) => {
    const flow = runYamlTrapFlow(exitMode);

    expect(flow.result.status).not.toBe(0);
    expect(flow.localYaml).toBe(flow.baseline);
  });
});

describe("deploy.sh zero-egress archive portability", () => {
  it("disables xattr pax metadata when Darwin creates the archive", () => {
    const result = runArchiveCreation("Darwin");

    expect(result.status).toBe(0);
    expect(deployScript).toMatch(
      /assemble_zero_egress\(\)[\s\S]*create_zero_egress_archive "\$bundle_path"/,
    );
    expect(result.calls).toEqual([
      expect.stringMatching(/^COPYFILE_DISABLE=1 tar --no-xattrs -czf /),
    ]);
  });

  it("does not pass the BSD-only no-xattrs flag on Linux", () => {
    const result = runArchiveCreation("Linux");

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([expect.stringMatching(/^COPYFILE_DISABLE=1 tar -czf /)]);
    expect(result.calls.join("\n")).not.toContain("--no-xattrs");
  });

  it("keeps archive creation failures fatal", () => {
    const result = runArchiveCreation("Darwin", 2);

    expect(result.status).toBe(42);
    expect(result.stdout).toContain("Failed to create zero-egress archive");
  });
});

describe("deploy.sh post-deploy readiness", () => {
  it("returns only after the submitted deployment is active and RUNNING", () => {
    const result = runDeployReadiness("running");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("running");
    expect(result.calls).toContain("CALL:apps get-deployment forge-pr270 dep-123 --output json");
    expect(result.calls).toContain("CALL:apps get forge-pr270 --output json");
  });

  it("fails clearly when the app crashes", () => {
    const result = runDeployReadiness("crashed");

    expect(result.status).toBe(42);
    expect(result.stdout).toContain("dep-123");
    expect(result.stdout).toContain("CRASHED");
    expect(result.stdout).toContain("databricks apps logs forge-pr270 --follow");
  });

  it("ignores a stale crashed active deployment while the replacement is pending", () => {
    const result = runDeployReadiness("stale-crashed-then-running");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deployment dep-123 running");
    expect(
      result.calls.filter((call) =>
        call.startsWith("CALL:apps get-deployment forge-pr270 dep-123"),
      ),
    ).toHaveLength(2);
  });

  it("fails after bounded condition polling times out", () => {
    const result = runDeployReadiness("timeout");

    expect(result.status).toBe(42);
    expect(result.stdout).toContain("dep-123");
    expect(result.stdout).toContain("timed out");
    expect(
      result.calls.filter((call) =>
        call.startsWith("CALL:apps get-deployment forge-pr270 dep-123"),
      ),
    ).toHaveLength(3);
  });

  it("keeps workspace sync in the foreground before deployment", () => {
    const uploadStart = deployScript.indexOf("upload_code() {");
    const uploadEnd = deployScript.indexOf("\n}\n", uploadStart);
    const upload = deployScript.slice(uploadStart, uploadEnd);

    expect(upload).toContain("databricks sync");
    expect(upload).not.toMatch(/databricks sync[^\n]*&/);
    expect(deployScript.indexOf("upload_code", deployScript.indexOf("main() {"))).toBeLessThan(
      deployScript.indexOf("deploy_app", deployScript.indexOf("main() {")),
    );
  });
});
