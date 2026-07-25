import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = [".superpowers/", ".claude/", "docs/superpowers/"];
const historicalPrefix = "docs/release-notes/";
const activeTextExtensions = /\.(?:md|json|ya?ml|mjs|cjs|js|jsx|ts|tsx|sh|txt)$/;
const internalRegistry = ["npm-proxy.dev", "databricks.com"].join(".");
const personalValues = [
  ["github.com", "althrussell", "databricks-forge"].join("/"),
  ["althrussell", "github", "io/databricks-forge"].join("."),
  ["al", "thrussell@databricks.com"].join("."),
];
const violations = [];

for (const file of files) {
  if (forbiddenPaths.some((prefix) => file.startsWith(prefix))) {
    violations.push(`${file}: excluded internal path`);
    continue;
  }

  if (!activeTextExtensions.test(file)) continue;
  const text = readFileSync(file, "utf8");

  if (text.includes(internalRegistry)) {
    violations.push(`${file}: internal npm registry URL`);
  }

  if (!file.startsWith(historicalPrefix)) {
    for (const value of personalValues) {
      if (text.includes(value)) violations.push(`${file}: ${value}`);
    }
  }
}

const appYaml = readFileSync("app.yaml", "utf8");
for (const value of [
  "LAKEBASE_BOOTSTRAP_USER",
  'value: "forge-demo"',
  'FORGE_DEMO_MODE_ENABLED\n    value: "true"',
]) {
  if (appYaml.includes(value)) violations.push(`app.yaml: ${value}`);
}

if (violations.length > 0) {
  console.error("Public release guard failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Public release guard passed (${files.length} files checked).`);
