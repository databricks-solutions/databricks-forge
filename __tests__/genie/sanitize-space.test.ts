import { describe, it, expect } from "vitest";
import { sanitizeSerializedSpace } from "@/lib/dbx/genie";

describe("sanitizeSerializedSpace", () => {
  it("uppercases lowercase benchmark answer format", () => {
    const input = JSON.stringify({
      benchmarks: {
        questions: [
          { id: "q1", question: ["Q?"], answer: [{ format: "sql", content: ["SELECT 1"] }] },
        ],
      },
    });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.benchmarks.questions[0].answer[0].format).toBe("SQL");
  });

  it("leaves already-uppercase format untouched", () => {
    const input = JSON.stringify({
      benchmarks: {
        questions: [
          { id: "q1", question: ["Q?"], answer: [{ format: "SQL", content: ["SELECT 1"] }] },
        ],
      },
    });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.benchmarks.questions[0].answer[0].format).toBe("SQL");
  });

  it("handles benchmarks with no answer", () => {
    const input = JSON.stringify({
      benchmarks: {
        questions: [{ id: "q1", question: ["Q?"] }],
      },
    });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.benchmarks.questions[0].answer).toBeUndefined();
  });

  it("collapses multiple text_instructions into one", () => {
    const input = JSON.stringify({
      instructions: {
        text_instructions: [
          { id: "i1", content: ["First instruction"] },
          { id: "i2", content: ["Second instruction"] },
          { id: "i3", content: ["Third instruction"] },
        ],
      },
    });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.instructions.text_instructions).toHaveLength(1);
    expect(result.instructions.text_instructions[0].id).toBe("i1");
    expect(result.instructions.text_instructions[0].content).toEqual([
      "First instruction",
      "Second instruction",
      "Third instruction",
    ]);
  });

  it("leaves single text_instruction unchanged", () => {
    const input = JSON.stringify({
      instructions: {
        text_instructions: [{ id: "i1", content: ["Only one"] }],
      },
    });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.instructions.text_instructions).toHaveLength(1);
  });

  it("handles space with no benchmarks or instructions", () => {
    const input = JSON.stringify({ version: 2, config: {} });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.version).toBe(2);
  });

  it("returns raw string for invalid JSON", () => {
    const raw = "not valid json at all";
    expect(sanitizeSerializedSpace(raw)).toBe(raw);
  });

  it("applies both fixes simultaneously", () => {
    const input = JSON.stringify({
      benchmarks: {
        questions: [
          { id: "q1", question: ["Q?"], answer: [{ format: "sql", content: ["SELECT 1"] }] },
        ],
      },
      instructions: {
        text_instructions: [
          { id: "i1", content: ["A"] },
          { id: "i2", content: ["B"] },
        ],
      },
    });
    const result = JSON.parse(sanitizeSerializedSpace(input));
    expect(result.benchmarks.questions[0].answer[0].format).toBe("SQL");
    expect(result.instructions.text_instructions).toHaveLength(1);
    expect(result.instructions.text_instructions[0].content).toEqual(["A", "B"]);
  });
});
