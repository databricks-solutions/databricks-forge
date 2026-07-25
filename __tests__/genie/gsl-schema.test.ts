import { describe, expect, it } from "vitest";
import {
  GSL_SECTIONS,
  GSL_MAX_CHARS,
  GSL_SUMMARY_VERBATIM,
  buildGsl,
  parseGsl,
  renderGsl,
  mergeGslSections,
  validateGsl,
  gslPromptInstructions,
} from "@/lib/genie/gsl-schema";

const fullBlock = buildGsl({
  purpose: "Answer questions about North America retail sales.",
  disambiguation:
    "If 'sales' could mean revenue or order count, ask the user which they want.",
  dataQualityNotes: "Treat NULL prices as missing data, never as zero.",
  constraints: "Use only `retail.sales.orders` and `retail.sales.line_items`.",
});

describe("validateGsl", () => {
  it("accepts a full canonical block", () => {
    const v = validateGsl(fullBlock);
    expect(v.valid).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.empty).toEqual([]);
    expect(v.outOfOrder).toEqual([]);
    expect(v.summaryVerbatim).toBe(true);
  });

  it("flags missing sections", () => {
    const partial = ["## PURPOSE", "Answer questions.", "", "## CONSTRAINTS", "x"].join("\n");
    const v = validateGsl(partial);
    expect(v.valid).toBe(false);
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it("flags out-of-order sections", () => {
    const reversed = [
      "## CONSTRAINTS",
      "x",
      "## DATA QUALITY NOTES",
      "y",
      "## DISAMBIGUATION",
      "z",
      "## PURPOSE",
      "p",
      "## Instructions you must follow when providing summaries",
      GSL_SUMMARY_VERBATIM,
    ].join("\n");
    const v = validateGsl(reversed);
    expect(v.valid).toBe(false);
    expect(v.outOfOrder.length).toBeGreaterThan(0);
  });

  it("flags empty sections", () => {
    const empty = [
      "## PURPOSE",
      "",
      "## DISAMBIGUATION",
      "ok",
      "## DATA QUALITY NOTES",
      "ok",
      "## CONSTRAINTS",
      "ok",
      "## Instructions you must follow when providing summaries",
      GSL_SUMMARY_VERBATIM,
    ].join("\n");
    const v = validateGsl(empty);
    expect(v.valid).toBe(false);
    expect(v.empty).toContain("## PURPOSE");
  });

  it("flags oversize content as a soft signal", () => {
    const big = fullBlock + "\n" + "x".repeat(GSL_MAX_CHARS);
    const v = validateGsl(big);
    expect(v.oversize).toBe(true);
  });
});

describe("parseGsl / renderGsl", () => {
  it("round-trips the canonical block", () => {
    const parsed = parseGsl(fullBlock);
    expect(parsed.sections["## PURPOSE"]).toMatch(/North America retail/);
    const rendered = renderGsl(parsed);
    const reparsed = parseGsl(rendered);
    for (const sec of GSL_SECTIONS) {
      expect(reparsed.sections[sec]).toBe(parsed.sections[sec]);
    }
  });

  it("returns null for sections that aren't in the input", () => {
    const partial = "## PURPOSE\n\nA\n";
    const parsed = parseGsl(partial);
    expect(parsed.sections["## PURPOSE"]).toBe("A");
    expect(parsed.sections["## CONSTRAINTS"]).toBeNull();
  });
});

describe("mergeGslSections", () => {
  it("preserves untouched sections when patching one", () => {
    const merged = mergeGslSections(fullBlock, {
      "## CONSTRAINTS": "Use only `tax.lookup`.",
    });
    const parsed = parseGsl(merged);
    expect(parsed.sections["## CONSTRAINTS"]).toContain("tax.lookup");
    expect(parsed.sections["## PURPOSE"]).toMatch(/North America retail/);
  });

  it("inserts a missing section when supplied", () => {
    const minus = mergeGslSections(fullBlock, {
      "## DATA QUALITY NOTES": "",
    });
    const reapplied = mergeGslSections(minus, {
      "## DATA QUALITY NOTES": "Coerce booleans carefully.",
    });
    const parsed = parseGsl(reapplied);
    expect(parsed.sections["## DATA QUALITY NOTES"]).toBe("Coerce booleans carefully.");
  });
});

describe("gslPromptInstructions", () => {
  it("references all five canonical sections", () => {
    const prompt = gslPromptInstructions();
    for (const sec of GSL_SECTIONS) expect(prompt).toContain(sec);
  });
});
