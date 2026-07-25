import { describe, it, expect } from "vitest";
import {
  buildIndustrySkillChunks,
  buildIndustrySkillSections,
  buildDomainQuestionPatterns,
} from "@/lib/skills/content/industry-enrichment";

describe("Industry Enrichment", () => {
  it("returns skill chunks for banking", () => {
    const chunks = buildIndustrySkillChunks("banking");
    expect(chunks.length).toBeGreaterThan(0);

    const kpiChunk = chunks.find((c) => c.id.startsWith("industry-kpis-"));
    expect(kpiChunk).toBeDefined();
    expect(kpiChunk!.content).toContain("Banking");
    expect(kpiChunk!.category).toBe("kpis");
  });

  it("returns entity chunks for banking", () => {
    const chunks = buildIndustrySkillChunks("banking");
    const entityChunk = chunks.find((c) => c.id.startsWith("industry-entities-"));
    expect(entityChunk).toBeDefined();
    expect(entityChunk!.category).toBe("vocabulary");
  });

  it("returns persona chunks for banking", () => {
    const chunks = buildIndustrySkillChunks("banking");
    const personaChunk = chunks.find((c) => c.id.startsWith("industry-personas-"));
    expect(personaChunk).toBeDefined();
    expect(personaChunk!.category).toBe("vocabulary");
  });

  it("returns business value chunks for banking", () => {
    const chunks = buildIndustrySkillChunks("banking");
    const valueChunk = chunks.find((c) => c.id.startsWith("industry-value-"));
    expect(valueChunk).toBeDefined();
    expect(valueChunk!.category).toBe("kpis");
  });

  it("returns empty array for unknown industry", () => {
    const chunks = buildIndustrySkillChunks("nonexistent-industry");
    expect(chunks).toEqual([]);
  });

  it("returns sections for insurance", () => {
    const sections = buildIndustrySkillSections("insurance");
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.title).toBeTruthy();
      expect(section.content.length).toBeGreaterThan(10);
    }
  });

  it("returns domain question patterns for banking", () => {
    const patterns = buildDomainQuestionPatterns("banking");
    expect(patterns).toContain("Banking");
    expect(patterns).toContain("?");
  });

  it("returns empty string for unknown industry in question patterns", () => {
    const patterns = buildDomainQuestionPatterns("nonexistent");
    expect(patterns).toBe("");
  });

  it("works for all built-in industries", () => {
    const industries = [
      "banking",
      "insurance",
      "hls",
      "rcg",
      "manufacturing",
      "energy-utilities",
      "water-utilities",
      "communications",
      "media-advertising",
      "digital-natives",
      "games",
      "rail-transport",
      "automotive-mobility",
      "sports-betting",
      "superannuation",
    ];

    for (const id of industries) {
      const chunks = buildIndustrySkillChunks(id);
      expect(chunks.length).toBeGreaterThan(0);
    }
  });
});
