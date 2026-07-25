import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const deploy = readRepoFile("deploy.sh");
const appYaml = readRepoFile("app.yaml");

describe("Databricks App user authorization scopes", () => {
  it("retains Genie scope but excludes the workspace-rejected dashboards scope everywhere", () => {
    const scopeLines = deploy.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) return false;
      return trimmed.startsWith("APP_SCOPES=") || /["']user_api_scopes["']\s*:/.test(trimmed);
    });

    expect(scopeLines).toHaveLength(3);
    for (const line of scopeLines) {
      expect(line).toMatch(/["']dashboards\.genie["']/);
      expect(line).not.toMatch(/["']dashboards["']/);
    }
  });

  it("documents the verified Apps scope constraint", () => {
    expect(appYaml).toContain("files.files, dashboards.genie");
    expect(appYaml).not.toContain("files.files, dashboards, dashboards.genie");
    expect(readRepoFile("docs/DEPLOYMENT.md")).toContain(
      "`dashboards` is not accepted as a Databricks Apps user authorization scope",
    );
  });

  it("binds the selected SQL warehouse to the app service principal with CAN_USE", () => {
    expect(deploy).toContain(
      "{'name': 'sql-warehouse', 'sql_warehouse': {'id': os.environ['WAREHOUSE_ID'], 'permission': 'CAN_USE'}}",
    );
  });
});
