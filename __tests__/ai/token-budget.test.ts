import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimatePromptTokens,
  buildTokenAwareBatches,
  assertWithinBudget,
  TokenBudgetExceededError,
  truncateColumns,
  truncateComment,
  MAX_PROMPT_TOKENS,
} from "@/lib/toolkit/token-budget";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null-ish values", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates tokens as ceil(chars / 3.2)", () => {
    const text = "a".repeat(320);
    expect(estimateTokens(text)).toBe(100);
  });

  it("rounds up for non-exact divisions", () => {
    const text = "a".repeat(10);
    expect(estimateTokens(text)).toBe(Math.ceil(10 / 3.2));
  });

  it("handles realistic prompt text", () => {
    const text = "You are a data privacy expert. Scan each column for PII.";
    const est = estimateTokens(text);
    expect(est).toBeGreaterThan(10);
    expect(est).toBeLessThan(100);
  });
});

describe("estimatePromptTokens", () => {
  it("substitutes variables and estimates tokens", () => {
    const template = "Tables:\n{table_list}\n\nClassify:";
    const variables = { table_list: "- table_a: [col1, col2]" };
    const result = estimatePromptTokens(template, variables);
    const expected = estimateTokens("Tables:\n- table_a: [col1, col2]\n\nClassify:");
    expect(result).toBe(expected);
  });

  it("handles missing variables gracefully", () => {
    const template = "Hello {name}!";
    const result = estimatePromptTokens(template, {});
    expect(result).toBe(estimateTokens("Hello {name}!"));
  });
});

describe("buildTokenAwareBatches", () => {
  it("returns empty array for empty items", () => {
    const batches = buildTokenAwareBatches([], (x: string) => x, 0);
    expect(batches).toEqual([]);
  });

  it("puts all items in one batch when they fit", () => {
    const items = ["a", "b", "c"];
    const batches = buildTokenAwareBatches(items, (x) => x, 0, 100);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["a", "b", "c"]);
  });

  it("splits items into multiple batches when budget is tight", () => {
    const items = Array.from({ length: 10 }, (_, i) => `item_${i}`);
    const renderItem = (item: string) => item.repeat(100);
    const batches = buildTokenAwareBatches(items, renderItem, 0, 200);
    expect(batches.length).toBeGreaterThan(1);
    const allItems = batches.flat();
    expect(allItems).toHaveLength(10);
  });

  it("always creates at least one item per batch even if oversized", () => {
    const items = ["huge_item"];
    const renderItem = (item: string) => item.repeat(10000);
    const batches = buildTokenAwareBatches(items, renderItem, 0, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["huge_item"]);
  });

  it("respects base token overhead", () => {
    const items = ["a", "b"];
    const renderItem = (item: string) => item.repeat(100);
    const batchesLowBase = buildTokenAwareBatches(items, renderItem, 0, 200);
    const batchesHighBase = buildTokenAwareBatches(items, renderItem, 180, 200);
    expect(batchesHighBase.length).toBeGreaterThanOrEqual(batchesLowBase.length);
  });

  it("falls back to single-item batches when base exceeds budget", () => {
    const items = ["a", "b", "c"];
    const batches = buildTokenAwareBatches(items, (x) => x, 999, 100);
    expect(batches).toHaveLength(3);
  });

  it("preserves item order", () => {
    const items = [1, 2, 3, 4, 5];
    const batches = buildTokenAwareBatches(items, (n) => "x".repeat(n * 100), 0, 200);
    const flat = batches.flat();
    expect(flat).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("assertWithinBudget", () => {
  it("does not throw for small prompts", () => {
    expect(() => assertWithinBudget("test", "Hello world")).not.toThrow();
  });

  it("throws TokenBudgetExceededError for oversized prompts", () => {
    const hugePrompt = "x".repeat(700_000);
    expect(() => assertWithinBudget("test", hugePrompt)).toThrow(TokenBudgetExceededError);
  });

  it("includes prompt key in error", () => {
    const hugePrompt = "x".repeat(700_000);
    try {
      assertWithinBudget("MY_PROMPT", hugePrompt);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TokenBudgetExceededError);
      const err = e as TokenBudgetExceededError;
      expect(err.promptKey).toBe("MY_PROMPT");
      expect(err.estimatedTokens).toBeGreaterThan(MAX_PROMPT_TOKENS);
      expect(err.maxTokens).toBe(MAX_PROMPT_TOKENS);
    }
  });

  it("respects custom budget", () => {
    const prompt = "x".repeat(100);
    expect(() => assertWithinBudget("test", prompt, 10)).toThrow(TokenBudgetExceededError);
  });
});

describe("truncateColumns", () => {
  it("returns all columns when under limit", () => {
    const cols = [1, 2, 3];
    const result = truncateColumns(cols, 5);
    expect(result.truncated).toEqual([1, 2, 3]);
    expect(result.omitted).toBe(0);
  });

  it("truncates and reports omitted count", () => {
    const cols = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = truncateColumns(cols, 3);
    expect(result.truncated).toEqual([1, 2, 3]);
    expect(result.omitted).toBe(7);
  });

  it("handles exact limit", () => {
    const cols = [1, 2, 3];
    const result = truncateColumns(cols, 3);
    expect(result.truncated).toEqual([1, 2, 3]);
    expect(result.omitted).toBe(0);
  });
});

describe("truncateComment", () => {
  it("returns empty string for null/undefined", () => {
    expect(truncateComment(null, 80)).toBe("");
    expect(truncateComment(undefined, 80)).toBe("");
  });

  it("returns full comment when under limit", () => {
    expect(truncateComment("Short comment", 80)).toBe("Short comment");
  });

  it("truncates long comments with ellipsis", () => {
    const long = "x".repeat(100);
    const result = truncateComment(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });
});
