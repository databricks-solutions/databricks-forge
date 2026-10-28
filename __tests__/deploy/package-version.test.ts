import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

describe("root package version", () => {
  it("keeps package.json and package-lock.json at the authoritative release", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));

    expect(pkg.version).toBe("1.1.0");
    expect(lock.version).toBe("1.1.0");
    expect(lock.packages[""].version).toBe("1.1.0");
  });
});
