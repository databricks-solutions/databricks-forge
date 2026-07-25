import { describe, expect, it } from "vitest";
import {
  validateExclusionPattern,
  validatePatternCode,
  type PatternValidationErrorCode,
} from "@/lib/domain/scope-selection";
import en from "@/messages/en.json";
import ptBR from "@/messages/pt-BR.json";
import es from "@/messages/es.json";

describe("stable pattern validation codes", () => {
  const cases: Array<[string, PatternValidationErrorCode]> = [
    ["", "empty"],
    ["   ", "empty"],
    ["*", "match_all"],
    ["bad pattern", "invalid_characters"],
    ["x".repeat(201), "too_long"],
  ];

  it.each(cases)("maps %j to %s", (pattern, code) => {
    expect(validatePatternCode(pattern)).toBe(code);
  });

  it("returns null for every supported valid pattern shape", () => {
    for (const pattern of ["*_fact", "gold_*", "dim-??", "cat.schema"]) {
      expect(validatePatternCode(pattern)).toBeNull();
    }
  });

  it("preserves the legacy English compatibility wrapper", () => {
    expect(validateExclusionPattern("")).toBe("Pattern cannot be empty");
    expect(validateExclusionPattern("*")).toBe(
      "Pattern '*' would exclude everything -- be more specific",
    );
    expect(validateExclusionPattern("bad pattern")).toBe(
      "Pattern can only contain letters, numbers, _, -, ., *, ?",
    );
    expect(validateExclusionPattern("x".repeat(201))).toBe(
      "Pattern is too long (max 200 characters)",
    );
    expect(validateExclusionPattern("gold_*")).toBeNull();
  });
});

describe("localized pattern validation messages", () => {
  const catalogs = { en, "pt-BR": ptBR, es };
  const codes: PatternValidationErrorCode[] = [
    "empty",
    "match_all",
    "invalid_characters",
    "too_long",
  ];

  for (const [locale, messages] of Object.entries(catalogs)) {
    it(`${locale} defines a non-empty message for every validation code`, () => {
      const validation = messages.estate_explorer.includePatterns.validation;
      for (const code of codes) {
        expect(validation[code].trim(), `${locale}:${code}`).not.toBe("");
      }
    });
  }
});
