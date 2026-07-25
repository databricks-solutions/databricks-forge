import { describe, it, expect, beforeEach } from "vitest";
import { resolveRegistry, clearRegistryCache } from "@/lib/genie/health-checks/registry";
import type { UserCheckOverride, UserCustomCheck } from "@/lib/genie/health-checks/types";

beforeEach(() => {
  clearRegistryCache();
});

describe("resolveRegistry", () => {
  it("loads defaults with no overrides", () => {
    const reg = resolveRegistry();
    expect(Object.keys(reg.categories)).toContain("data_sources");
    expect(Object.keys(reg.categories)).toContain("instructions");
    expect(Object.keys(reg.categories)).toContain("semantic_richness");
    expect(Object.keys(reg.categories)).toContain("quality_assurance");
    expect(reg.checks.length).toBeGreaterThan(0);
    expect(reg.validationErrors).toHaveLength(0);
  });

  it("all default checks have valid categories", () => {
    const reg = resolveRegistry();
    const validCats = new Set(Object.keys(reg.categories));
    for (const check of reg.checks) {
      expect(validCats.has(check.category)).toBe(true);
    }
  });

  it("override disables a built-in check", () => {
    const overrides: UserCheckOverride[] = [{ checkId: "tables-configured", enabled: false }];
    const reg = resolveRegistry(overrides);
    const check = reg.checks.find((c) => c.id === "tables-configured");
    expect(check?.enabled).toBe(false);
  });

  it("override changes threshold params", () => {
    const overrides: UserCheckOverride[] = [
      { checkId: "example-sqls-minimum", params: { min: 10 } },
    ];
    const reg = resolveRegistry(overrides);
    const check = reg.checks.find((c) => c.id === "example-sqls-minimum");
    expect(check?.params.min).toBe(10);
  });

  it("override changes severity", () => {
    const overrides: UserCheckOverride[] = [
      { checkId: "column-synonyms-defined", severity: "critical" },
    ];
    const reg = resolveRegistry(overrides);
    const check = reg.checks.find((c) => c.id === "column-synonyms-defined");
    expect(check?.severity).toBe("critical");
  });

  it("custom check added to existing category", () => {
    const customs: UserCustomCheck[] = [
      {
        id: "my-custom-check",
        category: "data_sources",
        description: "Custom check",
        severity: "info",
        evaluator: "count",
        path: "data_sources.tables",
        params: { min: 3 },
      },
    ];
    const reg = resolveRegistry(undefined, customs);
    const check = reg.checks.find((c) => c.id === "my-custom-check");
    expect(check).toBeDefined();
    expect(check?.category).toBe("data_sources");
    expect(reg.validationErrors).toHaveLength(0);
  });

  it("rejects custom check with invalid category", () => {
    const customs: UserCustomCheck[] = [
      {
        id: "bad-cat",
        category: "nonexistent_category",
        description: "Bad category",
        severity: "info",
        evaluator: "count",
        path: "some.path",
        params: {},
      },
    ];
    const reg = resolveRegistry(undefined, customs);
    expect(reg.validationErrors).toHaveLength(1);
    expect(reg.validationErrors[0]).toContain("invalid category");
    expect(reg.checks.find((c) => c.id === "bad-cat")).toBeUndefined();
  });

  it("rejects custom check with invalid evaluator", () => {
    const customs: UserCustomCheck[] = [
      {
        id: "bad-eval",
        category: "data_sources",
        description: "Bad evaluator",
        severity: "info",
        evaluator: "nonexistent" as never,
        path: "some.path",
        params: {},
      },
    ];
    const reg = resolveRegistry(undefined, customs);
    expect(reg.validationErrors).toHaveLength(1);
    expect(reg.validationErrors[0]).toContain("invalid evaluator");
  });

  it("applies category weight overrides", () => {
    const reg = resolveRegistry(undefined, undefined, {
      data_sources: 50,
      instructions: 50,
      semantic_richness: 0,
      quality_assurance: 0,
    });
    expect(reg.categories.data_sources.weight).toBe(50);
    expect(reg.categories.semantic_richness.weight).toBe(0);
  });
});
