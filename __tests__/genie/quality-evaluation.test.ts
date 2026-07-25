import { describe, expect, it } from "vitest";
import { determineQualityGate } from "@/lib/genie/assembler";
import { deterministicFallbackTitle } from "@/lib/genie/passes/title-generation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Fixture {
  domainHint: string;
  tables: string[];
  conversationSummary: string;
}

function loadFixture(name: string): Fixture {
  const path = resolve(process.cwd(), "__tests__/genie/fixtures", name);
  return JSON.parse(readFileSync(path, "utf-8")) as Fixture;
}

describe("genie quality evaluation corpus", () => {
  it("blocks deployment when joins are missing", () => {
    const gate = determineQualityGate(82, ["no_validated_joins"]);
    expect(gate.gateDecision).toBe("block");
  });

  it("produces non-generic fallback titles for fixtures", () => {
    const fixtures = ["bakehouse-schema.json", "commerce-schema.json"].map(loadFixture);
    for (const fx of fixtures) {
      const title = deterministicFallbackTitle(fx.domainHint, fx.domainHint, fx.tables);
      expect(title.toLowerCase()).not.toContain("analytics analytics");
      expect(title.toLowerCase()).not.toContain("tables");
      expect(title.length).toBeGreaterThan(8);
    }
  });
});
