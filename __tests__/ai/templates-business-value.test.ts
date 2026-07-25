/**
 * FINANCIAL_QUANTIFICATION_PROMPT (Master Repo v2) snapshot tests.
 *
 * These verify the prompt now exposes the canonical economic patterns + the
 * industry reference cases, and that the documented output JSON schema
 * surfaces the new `economic_pattern_name`, `economic_impact_category`, and
 * `economic_formula_vars` fields.
 */

import { describe, it, expect } from "vitest";

import { FINANCIAL_QUANTIFICATION_PROMPT } from "@/lib/ai/templates-business-value";

describe("FINANCIAL_QUANTIFICATION_PROMPT", () => {
  it("declares all 7 required placeholders", () => {
    const placeholders = [
      "{business_name}",
      "{industries}",
      "{revenue_model}",
      "{strategic_goals}",
      "{value_chain}",
      "{estate_context}",
      "{economic_patterns_context}",
      "{industry_reference_cases}",
      "{use_cases_json}",
    ];
    for (const p of placeholders) {
      expect(FINANCIAL_QUANTIFICATION_PROMPT).toContain(p);
    }
  });

  it("instructs the model to pick from canonical economic patterns", () => {
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/canonical patterns/i);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/economic_pattern_name/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/economic_impact_category/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/economic_formula_vars/);
  });

  it("documents the 5 impact categories", () => {
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/Cost/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/Revenue/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/Productivity \/ Capacity/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/Risk \/ Loss Avoidance/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/Cash \/ Working Capital/);
  });

  it("preserves the legacy value_type contract", () => {
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/cost_savings/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/revenue_uplift/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/efficiency_gain/);
    expect(FINANCIAL_QUANTIFICATION_PROMPT).toMatch(/risk_reduction/);
  });
});
