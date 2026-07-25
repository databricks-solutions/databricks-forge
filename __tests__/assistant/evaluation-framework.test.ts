import { describe, it, expect } from "vitest";
import { scoreAssistantResponse } from "@/lib/assistant/evaluation";

describe("Ask Forge evaluation framework", () => {
  it("scores grounded and cited responses highly (tech persona)", () => {
    const result = scoreAssistantResponse({
      question: "Which finance tables have stale writes?",
      answer:
        "The most stale tables are `main.finance.ar_ledger` and `main.finance.ap_invoice` [1].",
      sourceCount: 3,
      retrievalTopScore: 0.82,
      sqlBlocks: [
        "SELECT table_fqn, last_write_timestamp FROM main.ops.table_health WHERE domain = 'finance';",
      ],
      persona: "tech",
    });

    expect(result.overallScore).toBeGreaterThan(80);
    expect(result.findings).toHaveLength(0);
  });

  it("flags missing citations and low retrieval confidence (tech persona)", () => {
    const result = scoreAssistantResponse({
      question: "What should we optimize next?",
      answer: "You should optimize several large tables this week.",
      sourceCount: 2,
      retrievalTopScore: 0.41,
      sqlBlocks: [],
      persona: "tech",
    });

    expect(result.citationScore).toBe(0);
    expect(result.groundingScore).toBe(60);
    expect(result.findings.some((f) => f.includes("no citation markers"))).toBe(true);
  });

  it("penalizes unsafe SQL actions", () => {
    const result = scoreAssistantResponse({
      question: "Can you clean up old data?",
      answer: "Use this maintenance statement [1].",
      sourceCount: 1,
      retrievalTopScore: 0.7,
      sqlBlocks: [
        "DELETE FROM main.sales.orders WHERE order_date < date_sub(current_date(), 365);",
      ],
      persona: "tech",
    });

    expect(result.actionSafetyScore).toBe(0);
    expect(result.findings.some((f) => f.includes("Unsafe SQL proposal"))).toBe(true);
  });

  it("does not penalise business persona for omitting citations", () => {
    const result = scoreAssistantResponse({
      question: "What revenue insights can we get from our data?",
      answer: "Your data supports several revenue tracking capabilities.",
      sourceCount: 3,
      retrievalTopScore: 0.75,
      sqlBlocks: [],
      persona: "business",
    });

    expect(result.citationScore).toBe(100);
    expect(result.findings.every((f) => !f.includes("citation"))).toBe(true);
  });

  it("uses persona-specific scoring weights", () => {
    const base = {
      question: "What tables exist?",
      answer: "Here are the tables.",
      sourceCount: 3,
      retrievalTopScore: 0.8,
      sqlBlocks: [],
    };

    const businessResult = scoreAssistantResponse({ ...base, persona: "business" });
    const techResult = scoreAssistantResponse({ ...base, persona: "tech" });

    // Business gets citationScore = 100 (exempt), tech gets 0 (no markers)
    expect(businessResult.citationScore).toBe(100);
    expect(techResult.citationScore).toBe(0);
    // Business overall should be higher since it's not penalised for citations
    expect(businessResult.overallScore).toBeGreaterThan(techResult.overallScore);
  });
});
