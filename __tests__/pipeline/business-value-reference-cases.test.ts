/**
 * Unit tests for `buildIndustryReferenceCases` in the Business Value step.
 *
 * Pre-fix, the helper only consumed the free-form `BusinessContext.industries`
 * string (e.g. "Banking & Payments"), normalised each token to a slug, and
 * tried to resolve it via `resolveIndustryId()`. That silently produced
 * `(no industry reference cases available)` for many valid runs even though
 * `run.config.industry` already carries a canonical id (the pipeline
 * auto-detects it earlier in `pipeline/engine.ts`), which then disabled the
 * new economic-pattern grounding in `FINANCIAL_QUANTIFICATION_PROMPT`.
 *
 * These tests pin the new contract: the canonical id wins, the free-text
 * path stays available as a fallback, and both sources are de-duplicated by
 * canonical id.
 */

import { describe, it, expect } from "vitest";

import { buildIndustryReferenceCases } from "@/lib/pipeline/steps/business-value-analysis";
import { getMasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-registry";

describe("buildIndustryReferenceCases", () => {
  it("emits a populated block when only the canonical industry id is given", () => {
    // `banking` is a registered Master Repo industry; its enrichment ships
    // with at least one calibrated reference case.
    const out = buildIndustryReferenceCases({ canonicalIndustryId: "banking" });
    expect(out).toMatch(/^Industry: banking/m);
    // Reference rows are formatted as "  * <name> -> <pattern> | formula:".
    expect(out).toMatch(/^\s+\*.*->.*\|\s+formula:/m);
    expect(out).not.toContain("(no industry reference cases available)");
  });

  it("emits a populated block from a single-word free-text industry", () => {
    // Sanity check that the legacy free-text path is still wired up for
    // tokens that normalise cleanly to a registered id.
    const out = buildIndustryReferenceCases({ freeText: "Retail" });
    expect(out).toMatch(/^Industry: Retail/m);
  });

  it(
    "regression: rescues runs whose free-text contains noise (e.g. 'Banking & Payments') " +
      "by leaning on the canonical industry id",
    () => {
      // Pre-fix repro: the free-text path normalises to `banking--payments`
      // which is not a registered id, so `getMasterRepoEnrichment()` returns
      // undefined and the prompt collapses to the placeholder. Once
      // `run.config.industry` is threaded through, the canonical-id tier
      // recovers the block.
      const freeOnly = buildIndustryReferenceCases({
        freeText: "Banking & Payments",
      });
      expect(freeOnly).toBe("(no industry reference cases available)");

      const withCanonical = buildIndustryReferenceCases({
        canonicalIndustryId: "banking",
        freeText: "Banking & Payments",
      });
      expect(withCanonical).toMatch(/^Industry: banking/m);
      expect(withCanonical).not.toContain("(no industry reference cases available)");
    },
  );

  it("prefers the canonical industry id even when free-text disagrees", () => {
    // If free-text resolves to a different industry, the canonical id is
    // still emitted first. Both blocks should appear when both sources
    // succeed, but the canonical one comes first because it is the highest-
    // signal source.
    const out = buildIndustryReferenceCases({
      canonicalIndustryId: "retail",
      freeText: "Banking",
    });
    const retailIdx = out.indexOf("Industry: retail");
    const bankingIdx = out.indexOf("Industry: Banking");
    expect(retailIdx).toBeGreaterThanOrEqual(0);
    expect(bankingIdx).toBeGreaterThan(retailIdx);
  });

  it("dedupes when canonical id and free-text resolve to the same industry", () => {
    const out = buildIndustryReferenceCases({
      canonicalIndustryId: "retail",
      freeText: "Retail",
    });
    const matches = out.match(/^Industry:/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("falls back to the legacy free-text path when no canonical id is set", () => {
    // Reproduces the pre-fix scenario for legacy runs that pre-date
    // auto-detection of `run.config.industry`.
    const out = buildIndustryReferenceCases({
      canonicalIndustryId: null,
      freeText: "Retail",
    });
    expect(out).toMatch(/^Industry: Retail/m);
  });

  it("emits the placeholder string when neither source resolves", () => {
    const out = buildIndustryReferenceCases({
      canonicalIndustryId: null,
      freeText: "an industry that does not exist xyz",
    });
    expect(out).toBe("(no industry reference cases available)");
  });

  it("emits the placeholder string when both sources are absent", () => {
    expect(buildIndustryReferenceCases({})).toBe(
      "(no industry reference cases available)",
    );
  });

  it("self-checks: at least one calibrated reference case ships in `banking` enrichment", () => {
    // Guard against an upstream master-repo regeneration silently dropping
    // the reference cases used by the prompt grounding above.
    const enrichment = getMasterRepoEnrichment("banking");
    expect(enrichment).toBeDefined();
    if (!enrichment) return;
    const calibrated = enrichment.useCases.filter(
      (uc) => uc.economicPatternName && uc.economicFormula && uc.benchmarkImpact,
    );
    expect(calibrated.length).toBeGreaterThan(0);
  });

  describe("prompt-trim caps (regression: BV $0 fix)", () => {
    // The financial-quantification prompt previously embedded up to 30
    // reference cases per industry across an unbounded number of industries,
    // which empirically correlated with the "empty content" failure mode on
    // smaller classification models. The new defaults are: max 2 industries
    // x max 8 cases each = max 16 reference rows.

    it("caps reference cases per industry to 8 by default", () => {
      const out = buildIndustryReferenceCases({ canonicalIndustryId: "banking" });
      const caseLines = out.split("\n").filter((line) => line.startsWith("  *"));
      expect(caseLines.length).toBeLessThanOrEqual(8);
    });

    it("respects an explicit per-industry cap", () => {
      const out = buildIndustryReferenceCases({
        canonicalIndustryId: "banking",
        maxCasesPerIndustry: 3,
      });
      const caseLines = out.split("\n").filter((line) => line.startsWith("  *"));
      expect(caseLines.length).toBeLessThanOrEqual(3);
    });

    it("caps total industries to 2 by default even when more are present in free-text", () => {
      const out = buildIndustryReferenceCases({
        canonicalIndustryId: "banking",
        // Three additional industries in free-text; default cap should
        // drop everything past the second resolved one.
        freeText: "Retail, Manufacturing, Healthcare, Insurance",
      });
      const industryHeaders = (out.match(/^Industry:/gm) ?? []).length;
      expect(industryHeaders).toBeLessThanOrEqual(2);
    });

    it("respects an explicit max-industries cap", () => {
      const out = buildIndustryReferenceCases({
        canonicalIndustryId: "banking",
        freeText: "Retail, Manufacturing",
        maxIndustries: 1,
      });
      const industryHeaders = (out.match(/^Industry:/gm) ?? []).length;
      expect(industryHeaders).toBe(1);
    });

    it("is shorter than the legacy unbounded output for a multi-industry run", () => {
      const trimmed = buildIndustryReferenceCases({
        canonicalIndustryId: "banking",
        freeText: "Retail, Manufacturing, Healthcare",
      });
      const looselyCapped = buildIndustryReferenceCases({
        canonicalIndustryId: "banking",
        freeText: "Retail, Manufacturing, Healthcare",
        maxIndustries: 10,
        maxCasesPerIndustry: 30,
      });
      // Default trim should be strictly smaller than the loose-capped block.
      expect(trimmed.length).toBeLessThan(looselyCapped.length);
    });
  });
});
