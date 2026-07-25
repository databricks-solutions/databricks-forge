import { describe, it, expect, vi } from "vitest";
import { extractContentText } from "@/lib/dbx/model-serving";

vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  const log = {
    info: fn,
    warn: fn,
    debug: fn,
    error: fn,
    child: () => log,
    timed: fn,
    context: {},
  };
  return {
    logger: { info: fn, warn: fn, debug: fn, error: fn },
    createScopedLogger: () => log,
    apiLogger: () => log,
  };
});

vi.mock("@/lib/dbx/model-registry", () => ({
  getModelCapabilities: () => ({
    supportsJsonMode: false,
    supportsTemperature: true,
    maxOutputTokens: 8192,
    defaultMaxTokens: 4096,
  }),
}));

describe("extractContentText", () => {
  it("returns plain string content unchanged", () => {
    expect(extractContentText("Hello world")).toBe("Hello world");
  });

  it("returns empty string for null", () => {
    expect(extractContentText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractContentText(undefined)).toBe("");
  });

  it("converts number to string", () => {
    expect(extractContentText(42)).toBe("42");
  });

  it("extracts text from Gemini-style reasoning model array (type:text blocks)", () => {
    const geminiContent = [
      { type: "reasoning", reasoning: "internal chain of thought..." },
      { type: "text", text: "The answer is 42" },
    ];
    expect(extractContentText(geminiContent)).toBe("The answer is 42");
  });

  it("joins multiple text blocks from array", () => {
    const content = [
      { type: "text", text: "Part 1. " },
      { type: "reasoning", reasoning: "thinking..." },
      { type: "text", text: "Part 2." },
    ];
    expect(extractContentText(content)).toBe("Part 1. Part 2.");
  });

  it("handles array of plain strings", () => {
    const content = ["Hello", " ", "world"];
    expect(extractContentText(content)).toBe("Hello world");
  });

  it("handles mixed array of strings and text objects", () => {
    const content = ["Prefix: ", { type: "text", text: "the answer" }];
    expect(extractContentText(content)).toBe("Prefix: the answer");
  });

  it("falls back to .text extraction when no type:text blocks found", () => {
    const content = [{ text: "fallback content", other: "data" }];
    expect(extractContentText(content)).toBe("fallback content");
  });

  it("returns empty string for empty array", () => {
    expect(extractContentText([])).toBe("");
  });

  it("handles reasoning-only array (no text blocks) by extracting .text fields", () => {
    const content = [
      { type: "reasoning", reasoning: "deep thought", text: "exposed reasoning text" },
    ];
    expect(extractContentText(content)).toBe("exposed reasoning text");
  });

  it("skips blocks without text property in fallback", () => {
    const content = [{ type: "reasoning", reasoning: "no text field here" }];
    expect(extractContentText(content)).toBe("");
  });
});
