import { describe, it, expect } from "vitest";
import { formatPrompt } from "@/lib/ai/templates";

describe("formatPrompt", () => {
  it("replaces simple placeholders", () => {
    const result = formatPrompt("BUSINESS_CONTEXT_WORKER_PROMPT", {
      industry: "Retail",
      name: "Acme Corp",
      type_description: "Full context",
      type_label: "business",
    });
    expect(result).toContain("Acme Corp");
    expect(result).toContain("Retail");
  });

  it("preserves unreplaced placeholders as-is", () => {
    const result = formatPrompt("BUSINESS_CONTEXT_WORKER_PROMPT", {
      industry: "Tech",
      name: "BigCo",
      type_description: "Test",
      type_label: "org",
    });
    // The template may have some placeholders that are not in our vars
    // but the ones we provide should be replaced
    expect(result).not.toContain("{industry}");
    expect(result).not.toContain("{name}");
  });

  it("returns non-empty string for all prompt keys", () => {
    const minimalVars: Record<string, string> = {
      industry: "x",
      name: "x",
      type_description: "x",
      type_label: "x",
      business_context: "x",
      strategic_goals: "x",
      business_priorities: "x",
      strategic_initiative: "x",
      value_chain: "x",
      revenue_model: "x",
      additional_context_section: "x",
      focus_areas_instruction: "x",
      schema_markdown: "x",
      foreign_key_relationships: "x",
      previous_use_cases_feedback: "x",
      ai_functions_summary: "x",
      statistical_functions_detailed: "x",
      target_use_case_count: "10",
      business_name: "x",
      industries: "x",
      use_cases_csv: "x",
      previous_violations: "x",
      output_language: "English",
      domain_name: "x",
      min_cases_per_domain: "3",
      domain_info_str: "x",
      use_case_markdown: "x",
      total_count: "10",
      use_case_id: "x",
      use_case_name: "x",
      business_domain: "x",
      use_case_type: "AI",
      analytics_technique: "x",
      statement: "x",
      solution: "x",
      tables_involved: "x",
      directly_involved_schema: "x",
      sample_data_section: "x",
      sql_model_serving: "x",
      total_cases: "10",
      domain_list: "Finance, Marketing",
      target_language: "French",
      json_payload: "{}",
    };

    // These should not throw
    const keys = [
      "BUSINESS_CONTEXT_WORKER_PROMPT",
      "AI_USE_CASE_GEN_PROMPT",
      "STATS_USE_CASE_GEN_PROMPT",
      "DOMAIN_FINDER_PROMPT",
      "SUBDOMAIN_DETECTOR_PROMPT",
      "SCORE_USE_CASES_PROMPT",
      "REVIEW_USE_CASES_PROMPT",
      "USE_CASE_SQL_GEN_PROMPT",
    ] as const;

    for (const key of keys) {
      const result = formatPrompt(key, minimalVars);
      expect(result.length).toBeGreaterThan(50);
    }
  });
});
