import { describe, expect, it } from "vitest";
import {
  applyInstructionCharBudget,
  sanitizeInstructionText,
} from "@/lib/genie/passes/instruction-generation";
import { defaultGenieEngineConfig } from "@/lib/genie/types";

describe("instruction-generation", () => {
  it("strips marketing boilerplate lines", () => {
    const input = [
      "The Bakehouse Dataset simulates a bakery franchise business.",
      "Building Data Pipelines with Delta Live Tables",
      "Focus analysis on customer retention and revenue trends.",
    ].join("\n");
    const output = sanitizeInstructionText(input);
    expect(output).toContain("Focus analysis on customer retention and revenue trends.");
    expect(output.toLowerCase()).not.toContain("delta live tables");
    expect(output.toLowerCase()).not.toContain("simulates a bakery franchise");
  });

  it("keeps core instruction blocks under budget", () => {
    const cfg = defaultGenieEngineConfig();
    cfg.glossary = Array.from({ length: 12 }).map((_, i) => ({
      term: `term_${i}`,
      definition: "definition",
      synonyms: [],
    }));
    const blocks = [
      "core-1".repeat(200),
      "core-2".repeat(200),
      "core-3".repeat(200),
      "core-4".repeat(200),
      "optional-block".repeat(800),
    ];
    const output = applyInstructionCharBudget(blocks, "optional-block".repeat(800), cfg);
    expect(output[0]).toContain("core-1");
    expect(output[1]).toContain("core-2");
    const total = output.reduce((sum, b) => sum + b.length, 0);
    expect(total).toBeLessThanOrEqual(3000);
  });
});
