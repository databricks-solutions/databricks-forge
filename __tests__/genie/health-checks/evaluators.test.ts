import { describe, it, expect } from "vitest";
import {
  runEvaluator,
  resolvePath,
  scoreInstructionQuality,
} from "@/lib/genie/health-checks/evaluators";
import type { CheckDefinition } from "@/lib/genie/health-checks/types";
import { perfectSpace, emptySpace, duplicateIdSpace, emptySqlSpace } from "./fixtures/spaces";

function makeCheck(partial: Partial<CheckDefinition>): CheckDefinition {
  return {
    id: "test-check",
    category: "test",
    description: "Test check",
    severity: "warning",
    fixable: false,
    evaluator: "count",
    params: {},
    ...partial,
  };
}

describe("resolvePath", () => {
  it("resolves simple dot paths", () => {
    const vals = resolvePath(perfectSpace, "data_sources.tables");
    expect(vals).toHaveLength(1);
    expect(Array.isArray(vals[0])).toBe(true);
  });

  it("resolves array wildcard paths", () => {
    const vals = resolvePath(perfectSpace, "data_sources.tables[*].column_configs");
    expect(vals.length).toBeGreaterThan(0);
    expect(Array.isArray(vals[0])).toBe(true);
  });

  it("returns empty for missing paths", () => {
    expect(resolvePath(perfectSpace, "nonexistent.path")).toEqual([]);
  });

  it("handles null input", () => {
    expect(resolvePath({} as never, "foo")).toEqual([]);
  });
});

describe("count evaluator", () => {
  it("passes when count >= min", () => {
    const check = makeCheck({
      evaluator: "count",
      path: "data_sources.tables",
      params: { min: 1 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("Found 2");
  });

  it("fails when count < min", () => {
    const check = makeCheck({
      evaluator: "count",
      path: "data_sources.tables",
      params: { min: 1 },
    });
    const result = runEvaluator(emptySpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("need at least 1");
  });

  it("fails when count > max", () => {
    const check = makeCheck({
      evaluator: "count",
      path: "data_sources.tables",
      params: { min: 1, max: 1 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("exceeds maximum");
  });

  it("passes on empty array when min is 0", () => {
    const check = makeCheck({
      evaluator: "count",
      path: "data_sources.tables",
      params: { min: 0 },
    });
    const result = runEvaluator(emptySpace, check)!;
    expect(result.passed).toBe(true);
  });
});

describe("range evaluator", () => {
  it("passes when within range", () => {
    const check = makeCheck({
      evaluator: "range",
      path: "data_sources.tables",
      params: { min: 1, max: 30 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("fails below range", () => {
    const check = makeCheck({
      evaluator: "range",
      path: "data_sources.tables",
      params: { min: 5, max: 30 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(false);
  });

  it("warns above threshold", () => {
    const check = makeCheck({
      evaluator: "range",
      path: "data_sources.tables",
      params: { min: 1, max: 30, warn_above: 1 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("exceeds recommended");
  });
});

describe("exists evaluator", () => {
  it("passes for existing path", () => {
    const check = makeCheck({ evaluator: "exists", path: "instructions.text_instructions" });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("fails for non-existent path", () => {
    const check = makeCheck({ evaluator: "exists", path: "nonexistent.field" });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(false);
  });
});

describe("ratio evaluator", () => {
  it("passes when all items have field (100%)", () => {
    const check = makeCheck({
      evaluator: "ratio",
      path: "data_sources.tables",
      field: "description",
      params: { min_ratio: 0.8 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("100%");
  });

  it("vacuously passes when no items exist", () => {
    const check = makeCheck({
      evaluator: "ratio",
      path: "data_sources.tables",
      field: "description",
      params: { min_ratio: 0.8 },
    });
    const result = runEvaluator(emptySpace, check)!;
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("vacuously");
  });

  it("handles partial coverage", () => {
    const check = makeCheck({
      evaluator: "ratio",
      path: "instructions.sql_snippets.measures",
      field: "display_name",
      params: { min_ratio: 0.8 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });
});

describe("nested_ratio evaluator", () => {
  it("evaluates across nested arrays", () => {
    const check = makeCheck({
      evaluator: "nested_ratio",
      path: "data_sources.tables[*].column_configs",
      field: "description",
      params: { min_ratio: 0.5 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("handles empty nested arrays", () => {
    const check = makeCheck({
      evaluator: "nested_ratio",
      path: "data_sources.tables[*].column_configs",
      field: "description",
      params: { min_ratio: 0.5 },
    });
    const result = runEvaluator(emptySpace, check)!;
    expect(result.detail).toContain("No items");
  });
});

describe("pattern evaluator", () => {
  it("passes when all IDs match hex pattern", () => {
    const check = makeCheck({
      evaluator: "pattern",
      path: "__all_ids__",
      params: { regex: "^[a-f0-9]{32}$" },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("fails on invalid IDs", () => {
    const badSpace = {
      ...emptySpace,
      data_sources: { tables: [{ id: "not-a-hex-id", identifier: "cat.sch.t1" }] },
    };
    const check = makeCheck({
      evaluator: "pattern",
      path: "__all_ids__",
      params: { regex: "^[a-f0-9]{32}$" },
    });
    const result = runEvaluator(badSpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("invalid");
  });

  it("passes on empty values (no IDs to check)", () => {
    const check = makeCheck({
      evaluator: "pattern",
      path: "__all_ids__",
      params: { regex: "^[a-f0-9]{32}$" },
    });
    const noIdSpace = { version: 2, config: {}, data_sources: {}, instructions: {} };
    const result = runEvaluator(noIdSpace, check)!;
    expect(result.passed).toBe(true);
  });
});

describe("unique evaluator", () => {
  it("passes when all IDs are unique", () => {
    const check = makeCheck({ evaluator: "unique", path: "__all_ids__" });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("fails when IDs are duplicated", () => {
    const check = makeCheck({ evaluator: "unique", path: "__all_ids__" });
    const result = runEvaluator(duplicateIdSpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("duplicate");
  });
});

describe("no_empty_field evaluator", () => {
  it("passes when all SQL fields are populated", () => {
    const check = makeCheck({
      evaluator: "no_empty_field",
      paths: [
        "instructions.sql_snippets.measures[*].sql",
        "instructions.sql_snippets.filters[*].sql",
      ],
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("fails when SQL fields are empty", () => {
    const check = makeCheck({
      evaluator: "no_empty_field",
      paths: [
        "instructions.sql_snippets.measures[*].sql",
        "instructions.sql_snippets.filters[*].sql",
      ],
    });
    const result = runEvaluator(emptySqlSpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("empty SQL");
  });
});

describe("conditional_count evaluator", () => {
  it("skips when condition is not met", () => {
    const check = makeCheck({
      evaluator: "conditional_count",
      condition_path: "data_sources.tables",
      condition_min: 2,
      path: "instructions.join_specs",
      params: { min: 1 },
    });
    // Single table space -- condition not met, so check is skipped (passes)
    const singleTableSpace = {
      ...emptySpace,
      data_sources: {
        tables: [{ id: "00000000000000000000000000000001", identifier: "cat.sch.t1" }],
      },
    };
    const result = runEvaluator(singleTableSpace, check)!;
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("skipped");
  });

  it("evaluates when condition is met", () => {
    const check = makeCheck({
      evaluator: "conditional_count",
      condition_path: "data_sources.tables",
      condition_min: 2,
      path: "instructions.join_specs",
      params: { min: 1 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(true);
  });

  it("fails when condition met but count insufficient", () => {
    const check = makeCheck({
      evaluator: "conditional_count",
      condition_path: "data_sources.tables",
      condition_min: 2,
      path: "instructions.join_specs",
      params: { min: 5 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(false);
  });
});

describe("unregistered evaluator", () => {
  it("returns null for unknown type", () => {
    const check = makeCheck({ evaluator: "unknown_type" as never });
    const result = runEvaluator(perfectSpace, check);
    expect(result).toBeNull();
  });
});

describe("scoreInstructionQuality", () => {
  it("returns zero for empty input", () => {
    const score = scoreInstructionQuality("");
    expect(score.total).toBe(0);
    expect(score.specificity).toBe(0);
    expect(score.structure).toBe(0);
    expect(score.clarity).toBe(0);
  });

  it("scores higher for structured instructions with references", () => {
    const richInstruction = `## Revenue Calculations
- **Total Revenue**: Always use \`SUM(CAST(o.total AS DECIMAL(18,2)))\` from \`catalog.schema.orders\`
- **Average Order Value**: Use \`catalog.schema.orders.total / catalog.schema.orders.quantity\`

### Filters
- Use \`status = 'active'\` to exclude cancelled orders
- Always filter by \`order_date\` for time-based queries

### Important Rules
- Never include refunded orders in revenue calculations
- Ensure all monetary values use DECIMAL(18,2)`;

    const score = scoreInstructionQuality(richInstruction);
    expect(score.total).toBeGreaterThan(60);
    expect(score.specificity).toBeGreaterThan(15);
    expect(score.structure).toBeGreaterThan(15);
  });

  it("scores lower for vague instructions", () => {
    const vagueInstruction =
      "Use appropriate queries for relevant data as needed. Various things should be handled correctly when applicable.";
    const score = scoreInstructionQuality(vagueInstruction);
    expect(score.total).toBeLessThan(30);
  });

  it("rewards SQL keywords in instructions", () => {
    const sqlRich =
      "Always use SELECT with WHERE clause and JOIN for cross-table queries. Use GROUP BY for aggregations.";
    const noSql = "The data is about orders and customers in the retail business.";
    const sqlScore = scoreInstructionQuality(sqlRich);
    const noSqlScore = scoreInstructionQuality(noSql);
    expect(sqlScore.specificity).toBeGreaterThan(noSqlScore.specificity);
  });

  it("rewards structured formatting", () => {
    const structured = `## Section
- Point 1
- Point 2

**Important**: Use this format.`;
    const flat = "Point 1 Point 2 Important Use this format.";
    const structScore = scoreInstructionQuality(structured);
    const flatScore = scoreInstructionQuality(flat);
    expect(structScore.structure).toBeGreaterThan(flatScore.structure);
  });
});

describe("instruction_quality evaluator", () => {
  it("fails when no instructions exist", () => {
    const check = makeCheck({
      evaluator: "instruction_quality",
      path: "instructions.text_instructions",
      params: { min_score: 40 },
    });
    const result = runEvaluator(emptySpace, check)!;
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("No instructions");
  });

  it("evaluates instruction quality for perfectSpace", () => {
    const check = makeCheck({
      evaluator: "instruction_quality",
      path: "instructions.text_instructions",
      params: { min_score: 10 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result).not.toBeNull();
    expect(result.detail).toContain("Quality:");
  });

  it("respects min_score threshold", () => {
    const check = makeCheck({
      evaluator: "instruction_quality",
      path: "instructions.text_instructions",
      params: { min_score: 99 },
    });
    const result = runEvaluator(perfectSpace, check)!;
    expect(result.passed).toBe(false);
  });
});
