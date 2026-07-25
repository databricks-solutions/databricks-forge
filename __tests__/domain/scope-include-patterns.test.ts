import { describe, it, expect } from "vitest";
import {
  matchesIncludePatterns,
  shouldKeepTable,
} from "@/lib/domain/scope-selection";

describe("inclusion patterns", () => {
  it("keeps everything when no include patterns", () => {
    expect(matchesIncludePatterns("main.sales.orders", [])).toBe(true);
  });

  it("keeps only tables matching a pattern on any segment", () => {
    expect(matchesIncludePatterns("main.sales.orders_fact", ["*_fact"])).toBe(true);
    expect(matchesIncludePatterns("main.gold.revenue", ["gold"])).toBe(true);
    expect(matchesIncludePatterns("main.sales.orders", ["*_fact"])).toBe(false);
  });

  it("shouldKeepTable: exclusion wins over inclusion", () => {
    // matches include but is excluded by pattern → dropped
    expect(
      shouldKeepTable("main.sales.orders_fact", {
        includePatterns: ["*_fact"],
        excludePatterns: ["*orders*"],
      }),
    ).toBe(false);
    // matches include, not excluded → kept
    expect(
      shouldKeepTable("main.gold.sales_fact", {
        includePatterns: ["*_fact"],
        excludePatterns: ["*tmp*"],
      }),
    ).toBe(true);
    // explicit schema exclusion cascades
    expect(
      shouldKeepTable("main.staging.sales_fact", {
        includePatterns: ["*_fact"],
        excludes: ["main.staging"],
      }),
    ).toBe(false);
  });
});
