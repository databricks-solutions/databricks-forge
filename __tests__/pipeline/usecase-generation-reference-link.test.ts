/**
 * Tests for the use-case-generation parser's handling of the new
 * `reference_use_case_name` field.
 *
 * The parser persists this string verbatim onto `ForgeUseCase` and the
 * Data Gap engine joins on it. To keep the column clean we validate the
 * LLM output against the known master-repo titles for the run's industry
 * and drop hallucinated values.
 *
 * Tests exercise `normalizeReferenceUseCaseName` directly because it is
 * the pure pivot point; integration coverage of the surrounding LLM call
 * lives in the `data-gap-bridge` and `data-gap-attribution` suites.
 */

import { describe, it, expect } from "vitest";

import { normalizeReferenceUseCaseName } from "@/lib/pipeline/steps/usecase-generation";

const ALLOWED = new Map<string, string>([
  ["customer lifetime value modeling", "Customer Lifetime Value Modeling"],
  ["real-time fraud detection", "Real-Time Fraud Detection"],
]);

describe("normalizeReferenceUseCaseName", () => {
  it("returns the canonical master-repo casing on exact match", () => {
    expect(
      normalizeReferenceUseCaseName("Customer Lifetime Value Modeling", ALLOWED),
    ).toBe("Customer Lifetime Value Modeling");
  });

  it("normalises minor LLM casing drift to canonical casing", () => {
    expect(
      normalizeReferenceUseCaseName("customer lifetime value modeling", ALLOWED),
    ).toBe("Customer Lifetime Value Modeling");
    expect(
      normalizeReferenceUseCaseName("CUSTOMER LIFETIME VALUE MODELING", ALLOWED),
    ).toBe("Customer Lifetime Value Modeling");
  });

  it("trims surrounding whitespace before lookup", () => {
    expect(
      normalizeReferenceUseCaseName("  Real-Time Fraud Detection  ", ALLOWED),
    ).toBe("Real-Time Fraud Detection");
  });

  it("returns null for hallucinated titles not in the allow-list", () => {
    expect(
      normalizeReferenceUseCaseName("Customer Loyalty Tiering with Behavioural Cohorts", ALLOWED),
    ).toBeNull();
  });

  it("returns null for explicit null / empty / 'none' / 'n/a'", () => {
    expect(normalizeReferenceUseCaseName(null, ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName(undefined, ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName("", ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName("   ", ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName("null", ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName("None", ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName("n/a", ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName("N/A", ALLOWED)).toBeNull();
  });

  it("returns null for non-string inputs (numbers, objects, arrays)", () => {
    expect(normalizeReferenceUseCaseName(123, ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName({}, ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName([], ALLOWED)).toBeNull();
    expect(normalizeReferenceUseCaseName(true, ALLOWED)).toBeNull();
  });

  it("passes the trimmed value through when the allow-list is empty", () => {
    // Industries without a master-repo enrichment have no allow-list. The
    // parser preserves the LLM's value (trimmed) so the Data Gap backfill
    // or fuzzy matcher can still try downstream.
    const empty = new Map<string, string>();
    expect(
      normalizeReferenceUseCaseName("  Some Industry Reference  ", empty),
    ).toBe("Some Industry Reference");
    expect(normalizeReferenceUseCaseName(null, empty)).toBeNull();
    expect(normalizeReferenceUseCaseName("", empty)).toBeNull();
    expect(normalizeReferenceUseCaseName("none", empty)).toBeNull();
  });
});
