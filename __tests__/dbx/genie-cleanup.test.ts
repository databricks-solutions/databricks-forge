import { describe, it, expect } from "vitest";
import {
  enforceConstraints,
  cleanConfig,
  MAX_TABLES_PER_SPACE,
  MAX_STRING_FIELD_CHARS,
} from "@/lib/dbx/genie-cleanup";
import { sanitizeIds } from "@/lib/dbx/genie-id-sanitizer";
import { validateFieldPath } from "@/lib/dbx/genie-field-paths";

// ---------------------------------------------------------------------------
// enforceConstraints
// ---------------------------------------------------------------------------

describe("enforceConstraints -- table cap", () => {
  it("caps tables at MAX_TABLES_PER_SPACE", () => {
    const tables = Array.from({ length: MAX_TABLES_PER_SPACE + 7 }, (_, i) => ({
      identifier: `cat.sch.t${i}`,
    }));
    const space = { data_sources: { tables } };
    const result = enforceConstraints(space);
    expect(result.tablesDropped).toBe(7);
    expect(space.data_sources.tables).toHaveLength(MAX_TABLES_PER_SPACE);
  });

  it("does not modify tables under the cap", () => {
    const tables = Array.from({ length: 5 }, (_, i) => ({ identifier: `cat.sch.t${i}` }));
    const space = { data_sources: { tables } };
    const result = enforceConstraints(space);
    expect(result.tablesDropped).toBe(0);
    expect(space.data_sources.tables).toHaveLength(5);
  });
});

describe("enforceConstraints -- empty SQL benchmark drops", () => {
  it("drops benchmarks whose answer SQL is whitespace only", () => {
    const space = {
      benchmarks: {
        questions: [
          {
            id: "k",
            question: ["Q?"],
            answer: [{ format: "SQL", content: ["   \n\t"] }],
          },
          {
            id: "g",
            question: ["G?"],
            answer: [{ format: "SQL", content: ["SELECT 1"] }],
          },
        ],
      },
    };
    const result = enforceConstraints(space);
    expect(result.benchmarksDropped).toBe(1);
    expect(space.benchmarks.questions).toHaveLength(1);
    expect(space.benchmarks.questions[0].id).toBe("g");
  });

  it("retains benchmarks with no answer block", () => {
    const space = {
      benchmarks: { questions: [{ id: "q1", question: ["Q?"] }] },
    };
    const result = enforceConstraints(space);
    expect(result.benchmarksDropped).toBe(0);
    expect(space.benchmarks.questions).toHaveLength(1);
  });
});

describe("enforceConstraints -- example_question_sqls empty drop", () => {
  it("drops example_question_sqls with whitespace-only SQL", () => {
    const space = {
      instructions: {
        example_question_sqls: [
          { id: "a", question: ["A?"], sql: ["   "] },
          { id: "b", question: ["B?"], sql: ["SELECT 1"] },
          { id: "c", question: ["C?"], sql: [""] },
        ],
      },
    };
    const result = enforceConstraints(space);
    expect(result.trustedAssetsDropped).toBe(2);
    expect(space.instructions.example_question_sqls).toHaveLength(1);
  });
});

describe("enforceConstraints -- ID dedup with collision suffix", () => {
  it("renames duplicate IDs across measures and filters with _dup_N", () => {
    const space = {
      instructions: {
        sql_snippets: {
          measures: [{ id: "shared", alias: "m1" }],
          filters: [{ id: "shared", display_name: "f1" }],
        },
      },
    };
    const result = enforceConstraints(space);
    expect(result.duplicateIdsRenamed).toBe(1);
    const measureId = (space.instructions.sql_snippets.measures[0] as { id: string }).id;
    const filterId = (space.instructions.sql_snippets.filters[0] as { id: string }).id;
    const ids = [measureId, filterId];
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("shared");
    expect(ids).toContain("shared_dup_2");
  });

  it("supports multiple duplicates -- _dup_2, _dup_3, ...", () => {
    const space = {
      instructions: {
        sql_snippets: {
          measures: [
            { id: "k", alias: "m1" },
            { id: "k", alias: "m2" },
            { id: "k", alias: "m3" },
          ],
        },
      },
    };
    enforceConstraints(space);
    const ids = (space.instructions.sql_snippets.measures as { id: string }[]).map((m) => m.id);
    expect(ids).toEqual(["k", "k_dup_2", "k_dup_3"]);
  });
});

describe("enforceConstraints -- idempotent", () => {
  it("running twice is a no-op", () => {
    const tables = Array.from({ length: MAX_TABLES_PER_SPACE + 3 }, (_, i) => ({
      identifier: `cat.sch.t${i}`,
    }));
    const space = { data_sources: { tables } };
    enforceConstraints(space);
    const second = enforceConstraints(space);
    expect(second.tablesDropped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cleanConfig
// ---------------------------------------------------------------------------

describe("cleanConfig -- string truncation", () => {
  it("truncates strings longer than MAX_STRING_FIELD_CHARS", () => {
    const longString = "x".repeat(MAX_STRING_FIELD_CHARS + 100);
    const space = {
      instructions: {
        text_instructions: [{ id: "t1", content: [longString] }],
      },
    };
    const result = cleanConfig(space);
    expect(result.stringsTruncated).toBe(1);
    const truncated = (
      space.instructions.text_instructions[0] as { content: string[] }
    ).content[0];
    expect(truncated).toHaveLength(MAX_STRING_FIELD_CHARS);
  });

  it("does not truncate strings under the limit", () => {
    const space = {
      instructions: {
        text_instructions: [{ id: "t1", content: ["short content"] }],
      },
    };
    const result = cleanConfig(space);
    expect(result.stringsTruncated).toBe(0);
  });
});

describe("cleanConfig -- relationship_type normalization", () => {
  it("uppercases and replaces invalid chars in relationship_type", () => {
    const space = {
      instructions: {
        join_specs: [
          { id: "j1", left: { identifier: "a" }, right: { identifier: "b" }, sql: ["..."], relationship_type: "many to one" },
          { id: "j2", left: { identifier: "c" }, right: { identifier: "d" }, sql: ["..."], relationship_type: "one_to_many" },
        ],
      },
    };
    cleanConfig(space);
    expect(
      (space.instructions.join_specs[0] as { relationship_type: string }).relationship_type,
    ).toBe("MANY_TO_ONE");
    expect(
      (space.instructions.join_specs[1] as { relationship_type: string }).relationship_type,
    ).toBe("ONE_TO_MANY");
  });
});

describe("cleanConfig -- payload size warning", () => {
  it("flags payloadOversize when over threshold", () => {
    // Many strings under MAX_STRING_FIELD_CHARS (25k) each so none are
    // truncated, but the total payload exceeds the 3.5MB warning threshold.
    const chunk = "y".repeat(24_000);
    const text_instructions = Array.from({ length: 150 }, (_, i) => ({
      id: `t${i}`,
      content: [chunk],
    }));
    const space = { instructions: { text_instructions } };
    const result = cleanConfig(space);
    expect(result.stringsTruncated).toBe(0);
    expect(result.totalBytes).toBeGreaterThan(3_500_000);
    expect(result.payloadOversize).toBe(true);
  });

  it("does not flag small payloads", () => {
    const space = {
      instructions: { text_instructions: [{ id: "t1", content: ["small"] }] },
    };
    const result = cleanConfig(space);
    expect(result.payloadOversize).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeIds
// ---------------------------------------------------------------------------

describe("sanitizeIds", () => {
  it("replaces whitespace and non-alphanumeric chars in IDs", () => {
    const space = {
      instructions: {
        sql_snippets: {
          measures: [{ id: "my id has spaces!@#", alias: "m" }],
        },
      },
    };
    sanitizeIds(space);
    const id = (space.instructions.sql_snippets.measures[0] as { id: string }).id;
    expect(id).toBe("my_id_has_spaces");
  });

  it("truncates IDs longer than 64 chars", () => {
    const longId = "a".repeat(120);
    const space = {
      instructions: { sql_snippets: { measures: [{ id: longId, alias: "m" }] } },
    };
    sanitizeIds(space);
    const id = (space.instructions.sql_snippets.measures[0] as { id: string }).id;
    expect(id).toHaveLength(64);
  });

  it("uniquifies collisions across collections with _2, _3 suffixes", () => {
    const space = {
      instructions: {
        text_instructions: [{ id: "shared", content: ["x"] }],
        sql_snippets: {
          measures: [
            { id: "shared", alias: "m1" },
            { id: "shared", alias: "m2" },
          ],
        },
      },
    };
    sanitizeIds(space);
    const ids = [
      (space.instructions.text_instructions[0] as { id: string }).id,
      ...(space.instructions.sql_snippets.measures as { id: string }[]).map((m) => m.id),
    ];
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("shared");
    expect(ids).toContain("shared_2");
    expect(ids).toContain("shared_3");
  });

  it("preserves valid IDs untouched", () => {
    const original = "abc123_def-456";
    const space = {
      instructions: { sql_snippets: { measures: [{ id: original, alias: "m" }] } },
    };
    const result = sanitizeIds(space);
    expect(result.rewritten).toBe(0);
    const id = (space.instructions.sql_snippets.measures[0] as { id: string }).id;
    expect(id).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// validateFieldPath
// ---------------------------------------------------------------------------

describe("validateFieldPath", () => {
  it("accepts known leaf paths", () => {
    expect(validateFieldPath("data_sources.tables[].column_configs[].synonyms")).toBe(true);
    expect(validateFieldPath("instructions.sql_snippets.measures[].sql")).toBe(true);
    expect(validateFieldPath("benchmarks.questions[].answer[].content")).toBe(true);
  });

  it("normalizes numeric indices to []", () => {
    expect(validateFieldPath("data_sources.tables[3].column_configs[0].synonyms")).toBe(true);
  });

  it("rejects unknown paths", () => {
    expect(validateFieldPath("not_a_field")).toBe(false);
    expect(validateFieldPath("instructions.sql_snippets.totally_made_up")).toBe(false);
  });

  it("rejects malformed inputs", () => {
    expect(validateFieldPath("")).toBe(false);
    expect(validateFieldPath(null as unknown as string)).toBe(false);
  });
});
