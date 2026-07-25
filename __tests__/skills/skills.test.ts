import { describe, it, expect, beforeEach } from "vitest";
import {
  clearRegistry,
  getAllSkills,
  getSkillsForIntent,
  getSkillsForGeniePass,
  getSkillsForPipelineStep,
  getChunksForIntent,
  getChunksForGeniePass,
  registerSkill,
} from "@/lib/skills/registry";
import {
  resolveForIntent,
  resolveForGeniePass,
  resolveForPipelineStep,
} from "@/lib/skills/resolver";
import { EMPTY_RESOLVED_SKILLS } from "@/lib/skills/types";

// Import static skills (self-register on import)
import "@/lib/skills/content";

describe("Skill Registry", () => {
  it("registers all static skills", () => {
    const skills = getAllSkills();
    expect(skills.length).toBeGreaterThanOrEqual(8);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("databricks-sql-patterns");
    expect(ids).toContain("databricks-data-modeling");
    expect(ids).toContain("databricks-ai-functions");
    expect(ids).toContain("databricks-sql-scripting");
    expect(ids).toContain("databricks-dashboard-sql");
    expect(ids).toContain("genie-design");
    expect(ids).toContain("metric-view-patterns");
    expect(ids).toContain("system-tables");
  });

  it("returns skills for technical intent", () => {
    const skills = getSkillsForIntent("technical");
    expect(skills.length).toBeGreaterThan(0);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("databricks-sql-patterns");
    expect(ids).toContain("system-tables");
  });

  it("returns skills for business intent", () => {
    const skills = getSkillsForIntent("business");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("databricks-sql-patterns");
    expect(ids).toContain("genie-design");
  });

  it("returns skills for dashboard intent", () => {
    const skills = getSkillsForIntent("dashboard");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("metric-view-patterns");
  });

  it("documents GRID_V1 as the dashboard layout contract", () => {
    const dashboardSkill = getAllSkills().find((skill) => skill.id === "databricks-dashboard-sql")!;
    const layoutRules = dashboardSkill.chunks.find((chunk) => chunk.id === "dash-layout-rules")!.content;

    expect(layoutRules).toContain("12-Column GRID_V1");
    expect(layoutRules).toContain("width=12");
    expect(layoutRules).not.toContain("6-Column Grid");
  });

  it("returns skills for exploration intent", () => {
    const skills = getSkillsForIntent("exploration");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("system-tables");
  });

  it("returns skills for instructions Genie pass", () => {
    const skills = getSkillsForGeniePass("instructions");
    expect(skills.length).toBeGreaterThan(0);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("genie-design");
    expect(ids).toContain("databricks-sql-patterns");
  });

  it("returns skills for semanticExpressions Genie pass", () => {
    const skills = getSkillsForGeniePass("semanticExpressions");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("metric-view-patterns");
  });

  it("returns skills for benchmarks Genie pass", () => {
    const skills = getSkillsForGeniePass("benchmarks");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("genie-design");
  });

  it("returns skills for trustedAssets Genie pass", () => {
    const skills = getSkillsForGeniePass("trustedAssets");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("databricks-sql-patterns");
  });

  it("returns skills for metricViews Genie pass", () => {
    const skills = getSkillsForGeniePass("metricViews");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("metric-view-patterns");
  });

  it("returns skills for columnIntelligence Genie pass", () => {
    const skills = getSkillsForGeniePass("columnIntelligence");
    expect(skills.length).toBeGreaterThan(0);
  });

  it("returns skills for sql-generation pipeline step", () => {
    const skills = getSkillsForPipelineStep("sql-generation");
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("databricks-sql-patterns");
  });

  it("collects chunks for an intent", () => {
    const chunks = getChunksForIntent("technical");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.title).toBeTruthy();
      expect(chunk.content.length).toBeGreaterThan(50);
      expect(["rules", "patterns", "anti-patterns", "examples", "vocabulary", "kpis"]).toContain(
        chunk.category,
      );
    }
  });

  it("collects chunks for a Genie pass", () => {
    const chunks = getChunksForGeniePass("instructions");
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("Skill Content Snapshots", () => {
  it("databricks-sql-patterns has expected chunks", () => {
    const skills = getAllSkills().find((s) => s.id === "databricks-sql-patterns");
    expect(skills).toBeDefined();
    expect(skills!.chunks.length).toBe(5);
    expect(skills!.chunks.map((c) => c.id)).toMatchInlineSnapshot(`
      [
        "sql-window-recipes",
        "sql-cte-patterns",
        "sql-date-idioms",
        "sql-lambda-patterns",
        "sql-query-anti-patterns",
      ]
    `);
  });

  it("genie-design has expected chunks", () => {
    const skills = getAllSkills().find((s) => s.id === "genie-design");
    expect(skills).toBeDefined();
    expect(skills!.chunks.length).toBe(9);
    expect(skills!.chunks.map((c) => c.id)).toMatchInlineSnapshot(`
      [
        "genie-table-selection",
        "genie-descriptions",
        "genie-snippet-rules",
        "genie-join-patterns",
        "genie-date-filters",
        "genie-question-style",
        "genie-sample-questions",
        "genie-instruction-anti-patterns",
        "genie-best-practices",
      ]
    `);
  });

  it("metric-view-patterns has expected chunks", () => {
    const skills = getAllSkills().find((s) => s.id === "metric-view-patterns");
    expect(skills).toBeDefined();
    expect(skills!.chunks.length).toBe(10);
    expect(skills!.chunks.map((c) => c.id)).toMatchInlineSnapshot(`
      [
        "mv-yaml-reference",
        "mv-best-practices",
        "mv-query-rules",
        "mv-measure-patterns",
        "mv-dimension-patterns",
        "mv-join-patterns",
        "mv-semantic-metadata",
        "mv-gotchas",
        "mv-window-examples",
        "mv-validation-rules",
      ]
    `);
  });

  it("system-tables has expected chunks", () => {
    const skills = getAllSkills().find((s) => s.id === "system-tables");
    expect(skills).toBeDefined();
    expect(skills!.chunks.length).toBe(6);
    expect(skills!.chunks.map((c) => c.id)).toMatchInlineSnapshot(`
      [
        "systbl-catalog",
        "systbl-query-patterns",
        "systbl-governance",
        "systbl-jobs-pipelines",
        "systbl-storage-compute",
        "systbl-observability",
      ]
    `);
  });

  it("all chunk content is non-empty and under budget", () => {
    for (const skill of getAllSkills()) {
      for (const chunk of skill.chunks) {
        expect(chunk.content.length).toBeGreaterThan(50);
        if (chunk.maxCharBudget) {
          expect(chunk.content.length).toBeLessThanOrEqual(chunk.maxCharBudget);
        }
      }
    }
  });
});

describe("Skill Resolver", () => {
  it("resolves for technical intent with system overlay and context", () => {
    const result = resolveForIntent("technical");
    expect(result.totalChars).toBeGreaterThan(0);
    expect(result.systemOverlay.length).toBeGreaterThan(0);
    expect(result.contextSections.length).toBeGreaterThan(0);
  });

  it("resolves for business intent", () => {
    const result = resolveForIntent("business");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for dashboard intent", () => {
    const result = resolveForIntent("dashboard");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for exploration intent", () => {
    const result = resolveForIntent("exploration");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("returns empty for navigation intent (no skills registered)", () => {
    const result = resolveForIntent("navigation");
    expect(result).toEqual(EMPTY_RESOLVED_SKILLS);
  });

  it("resolves for instructions Genie pass", () => {
    const result = resolveForGeniePass("instructions");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for semanticExpressions Genie pass", () => {
    const result = resolveForGeniePass("semanticExpressions");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for benchmarks Genie pass", () => {
    const result = resolveForGeniePass("benchmarks");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for trustedAssets Genie pass", () => {
    const result = resolveForGeniePass("trustedAssets");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for metricViews Genie pass", () => {
    const result = resolveForGeniePass("metricViews");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for columnIntelligence Genie pass", () => {
    const result = resolveForGeniePass("columnIntelligence");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("resolves for sql-generation pipeline step", () => {
    const result = resolveForPipelineStep("sql-generation");
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("respects character budget", () => {
    const result = resolveForIntent("technical", {
      systemBudget: 200,
      contextBudget: 500,
    });
    expect(result.systemOverlay.length).toBeLessThanOrEqual(200);
    const contextChars = result.contextSections.reduce((s, sec) => s + sec.content.length, 0);
    expect(contextChars).toBeLessThanOrEqual(500);
  });

  it("partitions rules/anti-patterns into system overlay", () => {
    const result = resolveForIntent("technical");
    expect(result.systemOverlay).toContain("Anti-Pattern");
  });
});

describe("Skill Registry -- clearRegistry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("clears all skills", () => {
    expect(getAllSkills().length).toBe(0);
  });

  it("returns empty resolved skills after clearing", () => {
    const result = resolveForIntent("technical");
    expect(result).toEqual(EMPTY_RESOLVED_SKILLS);
  });

  it("allows re-registration after clearing", () => {
    registerSkill({
      id: "test-skill",
      name: "Test Skill",
      description: "Test",
      relevance: { intents: ["technical"] },
      chunks: [
        { id: "test-chunk", title: "Test", content: "Test content here", category: "patterns" },
      ],
    });
    expect(getAllSkills().length).toBe(1);
    const result = resolveForIntent("technical");
    expect(result.totalChars).toBeGreaterThan(0);
  });
});
