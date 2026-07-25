import { describe, expect, it } from "vitest";
import {
  closestIndustryMatch,
  levenshtein,
  normalizeIndustryId,
} from "@/lib/demo/research-engine/industry-match";

const REGISTRY: Array<{ id: string; name: string }> = [
  { id: "automotive-mobility", name: "Automotive & Mobility" },
  { id: "banking", name: "Banking & Payments" },
  { id: "capital-markets", name: "Capital Markets" },
  { id: "consumer-goods", name: "Consumer Goods" },
  { id: "energy-utilities", name: "Energy & Utilities" },
  { id: "games", name: "Games" },
  { id: "healthcare", name: "Healthcare" },
  { id: "life-sciences", name: "Life Sciences" },
  { id: "media-advertising", name: "Media & Advertising" },
  { id: "real-money-gaming", name: "Real Money Gaming" },
  { id: "retail", name: "Retail" },
];

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("retail", "retail")).toBe(0);
  });
  it("returns the longer length for empty inputs", () => {
    expect(levenshtein("", "retail")).toBe(6);
    expect(levenshtein("retail", "")).toBe(6);
  });
  it("counts substitutions, insertions, deletions", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("retail", "retal")).toBe(1);
  });
});

describe("normalizeIndustryId", () => {
  it("returns null for empty input", () => {
    expect(normalizeIndustryId("", REGISTRY)).toBeNull();
  });
  it("matches an exact id", () => {
    expect(normalizeIndustryId("retail", REGISTRY)).toBe("retail");
  });
  it("kebab-cases free-form input", () => {
    expect(normalizeIndustryId("Real Money Gaming", REGISTRY)).toBe("real-money-gaming");
    expect(normalizeIndustryId("Capital_Markets", REGISTRY)).toBe("capital-markets");
  });
  it("matches by name substring", () => {
    expect(normalizeIndustryId("Banking", REGISTRY)).toBe("banking");
  });
  it("returns null when nothing fits (degenerate LLM output)", () => {
    expect(normalizeIndustryId("xyz-no-such-industry", REGISTRY)).toBeNull();
  });
});

describe("closestIndustryMatch", () => {
  it("returns null when both inputs are empty", () => {
    expect(closestIndustryMatch("", "", REGISTRY)).toBeNull();
    expect(closestIndustryMatch(undefined, null, REGISTRY)).toBeNull();
  });

  it("returns null when the registry is empty", () => {
    expect(closestIndustryMatch("retail", "Retail", [])).toBeNull();
  });

  it("snaps a slightly mistyped id back to the closest registered id", () => {
    // Codex's worry: LLM returns 'retial' (typo). Closest = retail, NOT
    // automotive-mobility (which is alphabetically first).
    const match = closestIndustryMatch("retial", "Retail", REGISTRY);
    expect(match?.id).toBe("retail");
  });

  it("snaps an abbreviation to the closest semantically-related industry", () => {
    // 'rmg' is closer to 'real-money-gaming' than to 'retail' or 'games'
    // when comparing against the id space.
    const match = closestIndustryMatch("rmg", "Real Money Gaming", REGISTRY);
    expect(match?.id).toBe("real-money-gaming");
  });

  it("uses the rawName when rawId is unhelpful", () => {
    // Hostile LLM output: an unrecognised id paired with a recognisable name.
    const match = closestIndustryMatch("zzz", "Capital Markets", REGISTRY);
    expect(match?.id).toBe("capital-markets");
  });

  it("uses the rawId when rawName is unhelpful", () => {
    const match = closestIndustryMatch("life-sciences", "????", REGISTRY);
    expect(match?.id).toBe("life-sciences");
  });

  it("does NOT default to the first alphabetical entry for typos", () => {
    // Regression guard for the Codex P2: a recognisable-but-misspelt input
    // must never resolve to automotive-mobility purely because it sits at
    // index 0 of the registry.
    const match = closestIndustryMatch("healthcre", "Healthcre", REGISTRY);
    expect(match?.id).toBe("healthcare");
    expect(match?.id).not.toBe("automotive-mobility");
  });

  it("never invents an id outside the registry", () => {
    const match = closestIndustryMatch("hospitality", "Hotels & Hospitality", REGISTRY);
    expect(REGISTRY.map((o) => o.id)).toContain(match?.id);
  });
});
