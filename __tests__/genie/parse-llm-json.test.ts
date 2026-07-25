import { describe, it, expect } from "vitest";
import { parseLLMJson } from "@/lib/toolkit/parse-llm-json";

describe("parseLLMJson", () => {
  it("parses plain JSON object", () => {
    expect(parseLLMJson('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("parses plain JSON array", () => {
    expect(parseLLMJson("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("handles BOM prefix", () => {
    expect(parseLLMJson('\uFEFF{"a": 1}')).toEqual({ a: 1 });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseLLMJson('  \n  {"a": 1}  \n  ')).toEqual({ a: 1 });
  });

  it("extracts JSON from ```json fences", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(parseLLMJson(input)).toEqual({ key: "value" });
  });

  it("extracts JSON from ``` fences without language tag", () => {
    const input = "```\n[1, 2]\n```";
    expect(parseLLMJson(input)).toEqual([1, 2]);
  });

  it("extracts JSON from fences with preamble text", () => {
    const input = 'Here is the result:\n\n```json\n{"status": "ok"}\n```\n\nDone.';
    expect(parseLLMJson(input)).toEqual({ status: "ok" });
  });

  it("extracts JSON from fences with leading newlines (production bug)", () => {
    const input = '\n\n```json\n[{"col": "id", "desc": "Primary key"}]\n```';
    expect(parseLLMJson(input)).toEqual([{ col: "id", desc: "Primary key" }]);
  });

  it("handles missing closing fence", () => {
    const input = '```json\n{"key": "value"}';
    expect(parseLLMJson(input)).toEqual({ key: "value" });
  });

  it("falls back to bracket matching when fences contain invalid JSON", () => {
    const input = 'Some text before {"key": "value"} and after';
    expect(parseLLMJson(input)).toEqual({ key: "value" });
  });

  it("bracket-matches arrays", () => {
    const input = "Result: [1, 2, 3] end";
    expect(parseLLMJson(input)).toEqual([1, 2, 3]);
  });

  it("prefers the outermost brackets", () => {
    const input = 'prefix {"outer": {"inner": 1}} suffix';
    expect(parseLLMJson(input)).toEqual({ outer: { inner: 1 } });
  });

  it("throws SyntaxError for non-JSON input", () => {
    expect(() => parseLLMJson("just plain text")).toThrow(SyntaxError);
  });

  it("throws SyntaxError for empty string", () => {
    expect(() => parseLLMJson("")).toThrow(SyntaxError);
  });

  it("handles nested fenced JSON with extra whitespace", () => {
    const input = '```json\n  {\n    "a": 1,\n    "b": [2, 3]\n  }\n```';
    expect(parseLLMJson(input)).toEqual({ a: 1, b: [2, 3] });
  });

  it("handles Windows-style line endings in fences", () => {
    const input = '```json\r\n{"key": "value"}\r\n```';
    expect(parseLLMJson(input)).toEqual({ key: "value" });
  });

  describe("truncation recovery", () => {
    it("recovers truncated array with complete elements", () => {
      const input = '{"items": [{"a": 1}, {"b": 2}, {"c": 3';
      const result = parseLLMJson(input) as { items: unknown[] };
      expect(result.items).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("recovers truncated object mid-string-value", () => {
      const input =
        '{"queries": [{"question": "What is revenue?", "sql": "SELECT SUM(amount)"}, {"question": "Truncated quer';
      const result = parseLLMJson(input) as { queries: unknown[] };
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0]).toEqual({
        question: "What is revenue?",
        sql: "SELECT SUM(amount)",
      });
    });

    it("recovers truncated nested structure", () => {
      const input =
        '{"benchmarks": [{"question": "Q1", "sql": "SELECT 1", "alt": ["a", "b"]}, {"question": "Q2", "sql": "SELECT';
      const result = parseLLMJson(input) as { benchmarks: unknown[] };
      expect(result.benchmarks).toHaveLength(1);
      expect(result.benchmarks[0]).toEqual({
        question: "Q1",
        sql: "SELECT 1",
        alt: ["a", "b"],
      });
    });

    it("recovers when truncated right after a complete element comma", () => {
      const input = '{"data": [{"x": 1},';
      const result = parseLLMJson(input) as { data: unknown[] };
      expect(result.data).toEqual([{ x: 1 }]);
    });

    it("still throws for completely invalid input", () => {
      expect(() => parseLLMJson("just plain text")).toThrow();
    });

    it("still throws for empty truncation", () => {
      expect(() => parseLLMJson("{")).toThrow();
    });
  });
});
