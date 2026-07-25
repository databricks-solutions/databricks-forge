import { describe, it, expect } from "vitest";
import {
  resolveColumnBudget,
  scoreColumn,
  selectRepresentativeColumns,
  buildCompactColumnLine,
  computeAdaptiveColumnLimits,
  detectWideSchema,
  applyWideSchemaLimits,
  BATCH_ESTIMATION_COL_CAP,
  WIDE_TABLE_COLUMN_THRESHOLD,
  MIN_COLUMNS_PER_TABLE,
  WIDE_SCHEMA_FETCH_LIMITS,
  type ColumnScoreOptions,
} from "@/lib/toolkit/column-budget";
import type { ColumnInfo } from "@/lib/domain/types";
import type { EnrichedColumn } from "@/lib/metadata/types";

// ---------------------------------------------------------------------------
// Helper: build a minimal ColumnInfo
// ---------------------------------------------------------------------------

function col(
  name: string,
  dataType = "STRING",
  ordinal = 0,
  comment: string | null = null,
): ColumnInfo {
  return {
    tableFqn: "cat.schema.table",
    columnName: name,
    dataType,
    ordinalPosition: ordinal,
    isNullable: true,
    comment,
  };
}

// ---------------------------------------------------------------------------
// resolveColumnBudget
// ---------------------------------------------------------------------------

describe("resolveColumnBudget", () => {
  it("returns default budget (zero-arg)", () => {
    const budget = resolveColumnBudget();
    expect(budget.maxColumnsPerTable).toBe(40);
    expect(budget.maxSampleColumns).toBe(0);
    expect(budget.maxColumnRowsPerScope).toBe(500_000);
    expect(budget.compactFormat).toBe(false);
  });

  it("returns a new object each call (no shared mutation)", () => {
    const a = resolveColumnBudget();
    const b = resolveColumnBudget();
    expect(a).not.toBe(b);
    a.maxColumnsPerTable = 999;
    expect(b.maxColumnsPerTable).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// scoreColumn
// ---------------------------------------------------------------------------

describe("scoreColumn", () => {
  it("scores a plain column at 0", () => {
    expect(scoreColumn(col("foo"))).toBe(0);
  });

  it("gives 25 points to a primary key (heuristic)", () => {
    expect(scoreColumn(col("id"))).toBe(25);
    expect(scoreColumn(col("pk"))).toBe(25);
  });

  it("gives 20 points to a foreign key (heuristic)", () => {
    expect(scoreColumn(col("customer_id"))).toBe(20);
  });

  it("gives 18 points to a measure (heuristic)", () => {
    expect(scoreColumn(col("total_amount"))).toBe(18);
    expect(scoreColumn(col("revenue_total"))).toBe(18);
  });

  it("gives 12 points to a timestamp (heuristic)", () => {
    expect(scoreColumn(col("created_at"))).toBe(12);
  });

  it("gives 12 points to a timestamp data type with generic name", () => {
    expect(scoreColumn(col("event_time", "TIMESTAMP"))).toBe(12);
  });

  it("gives 10 points to a flag (heuristic)", () => {
    expect(scoreColumn(col("is_active"))).toBe(10);
  });

  it("gives 15 points for having a comment", () => {
    expect(scoreColumn(col("foo", "STRING", 0, "Some description"))).toBe(15);
  });

  it("gives 25 (15 + 10) points for a comment with a business keyword", () => {
    expect(scoreColumn(col("foo", "STRING", 0, "Tracks customer revenue"))).toBe(25);
  });

  it("stacks comment + heuristic scores", () => {
    const score = scoreColumn(col("total_amount", "DECIMAL", 0, "Monthly revenue total"));
    expect(score).toBe(18 + 15 + 10);
  });

  it("gives 30 points for prior LLM classification", () => {
    const enriched = new Map<string, EnrichedColumn>([
      [
        "nps_quartile",
        {
          name: "nps_quartile",
          dataType: "INT",
          ordinalPosition: 0,
          isNullable: true,
          comment: null,
          inferredRole: "measure",
          inferredFkTarget: null,
        },
      ],
    ]);
    const score = scoreColumn(col("nps_quartile", "INT"), { enrichedColumns: enriched });
    expect(score).toBe(30);
  });

  it("gives 5 bonus points for explicit FK constraint", () => {
    const opts: ColumnScoreOptions = {
      fkColumnNames: new Set(["customer_id"]),
    };
    const score = scoreColumn(col("customer_id"), opts);
    expect(score).toBe(20 + 5);
  });

  it("stacks all three tiers for maximum score", () => {
    const enriched = new Map<string, EnrichedColumn>([
      [
        "total_amount",
        {
          name: "total_amount",
          dataType: "DECIMAL",
          ordinalPosition: 0,
          isNullable: true,
          comment: "Total revenue amount",
          inferredRole: "measure",
          inferredFkTarget: null,
        },
      ],
    ]);
    const score = scoreColumn(col("total_amount", "DECIMAL", 0, "Total revenue amount"), {
      enrichedColumns: enriched,
    });
    // Tier 1: 30 (prior LLM) + Tier 2: 15 (comment) + 10 (business keyword "revenue") + Tier 3: 18 (measure)
    expect(score).toBe(30 + 15 + 10 + 18);
  });
});

// ---------------------------------------------------------------------------
// selectRepresentativeColumns
// ---------------------------------------------------------------------------

describe("selectRepresentativeColumns", () => {
  it("returns all columns when under budget", () => {
    const columns = [col("a", "STRING", 0), col("b", "INT", 1)];
    const result = selectRepresentativeColumns(columns, 10);
    expect(result.selected).toHaveLength(2);
    expect(result.omittedCount).toBe(0);
    expect(result.omittedHints).toEqual([]);
  });

  it("returns all columns when maxCount is 0 (no cap)", () => {
    const columns = [col("a"), col("b"), col("c")];
    const result = selectRepresentativeColumns(columns, 0);
    expect(result.selected).toHaveLength(3);
  });

  it("selects highest-scoring columns when over budget", () => {
    const columns = [
      col("random_col_1", "STRING", 0),
      col("random_col_2", "STRING", 1),
      col("id", "INT", 2),
      col("customer_id", "INT", 3),
      col("total_amount", "DECIMAL", 4),
      col("created_at", "TIMESTAMP", 5),
      col("is_active", "BOOLEAN", 6),
      col("random_col_3", "STRING", 7),
    ];

    const result = selectRepresentativeColumns(columns, 3);
    expect(result.selected).toHaveLength(3);
    expect(result.omittedCount).toBe(5);
    expect(result.omittedHints.length).toBeGreaterThan(0);
    expect(result.omittedHints.length).toBeLessThanOrEqual(3);

    const selectedNames = result.selected.map((c) => c.columnName);
    expect(selectedNames).toContain("id");
    expect(selectedNames).toContain("customer_id");
    expect(selectedNames).toContain("total_amount");
  });

  it("provides up to 3 omitted hints", () => {
    const columns = Array.from({ length: 50 }, (_, i) => col(`col_${i}`, "STRING", i));
    const result = selectRepresentativeColumns(columns, 5);
    expect(result.omittedCount).toBe(45);
    expect(result.omittedHints.length).toBeLessThanOrEqual(3);
  });

  it("handles a 1200-column table with a limited budget", () => {
    const columns: ColumnInfo[] = [
      col("id", "INT", 0),
      col("customer_id", "INT", 1),
      col("order_date", "DATE", 2),
      col("total_amount", "DECIMAL", 3),
      col("is_active", "BOOLEAN", 4),
      col("status_code", "STRING", 5),
      ...Array.from({ length: 1194 }, (_, i) => col(`data_field_${i}`, "STRING", i + 6)),
    ];

    const result = selectRepresentativeColumns(columns, 25);
    expect(result.selected).toHaveLength(25);
    expect(result.omittedCount).toBe(1175);

    const selectedNames = result.selected.map((c) => c.columnName);
    expect(selectedNames).toContain("id");
    expect(selectedNames).toContain("customer_id");
    expect(selectedNames).toContain("total_amount");
    expect(selectedNames).toContain("is_active");
  });

  it("stable sorts by ordinal position when scores are equal", () => {
    const columns = [col("zzz", "STRING", 0), col("aaa", "STRING", 1), col("mmm", "STRING", 2)];
    const result = selectRepresentativeColumns(columns, 3);
    expect(result.selected.map((c) => c.columnName)).toEqual(["zzz", "aaa", "mmm"]);
  });

  it("respects prior LLM enrichments in scoring", () => {
    const enriched = new Map<string, EnrichedColumn>([
      [
        "nps_quartile",
        {
          name: "nps_quartile",
          dataType: "INT",
          ordinalPosition: 5,
          isNullable: true,
          comment: null,
          inferredRole: "measure",
          inferredFkTarget: null,
        },
      ],
    ]);

    const columns = [
      col("random1", "STRING", 0),
      col("random2", "STRING", 1),
      col("random3", "STRING", 2),
      col("random4", "STRING", 3),
      col("random5", "STRING", 4),
      col("nps_quartile", "INT", 5),
    ];

    const result = selectRepresentativeColumns(columns, 1, { enrichedColumns: enriched });
    expect(result.selected[0].columnName).toBe("nps_quartile");
  });
});

// ---------------------------------------------------------------------------
// buildCompactColumnLine
// ---------------------------------------------------------------------------

describe("buildCompactColumnLine", () => {
  it("formats name(type)", () => {
    expect(buildCompactColumnLine({ columnName: "total_amount", dataType: "DECIMAL" })).toBe(
      "total_amount(DECIMAL)",
    );
  });

  it("handles complex type names", () => {
    expect(buildCompactColumnLine({ columnName: "tags", dataType: "ARRAY<STRING>" })).toBe(
      "tags(ARRAY<STRING>)",
    );
  });
});

// ---------------------------------------------------------------------------
// detectWideSchema
// ---------------------------------------------------------------------------

describe("detectWideSchema", () => {
  it("returns false when no tables exceed threshold", () => {
    const colsByTable = new Map<string, unknown[]>([
      ["table_a", Array(50)],
      ["table_b", Array(30)],
    ]);
    const info = detectWideSchema(colsByTable);
    expect(info.hasWideTables).toBe(false);
    expect(info.wideTableCount).toBe(0);
    expect(info.maxColumnCount).toBe(50);
  });

  it("returns true when a table reaches the threshold", () => {
    const colsByTable = new Map<string, unknown[]>([
      ["narrow", Array(20)],
      ["wide", Array(WIDE_TABLE_COLUMN_THRESHOLD)],
    ]);
    const info = detectWideSchema(colsByTable);
    expect(info.hasWideTables).toBe(true);
    expect(info.wideTableCount).toBe(1);
    expect(info.maxColumnCount).toBe(WIDE_TABLE_COLUMN_THRESHOLD);
  });

  it("counts multiple wide tables", () => {
    const colsByTable = new Map<string, unknown[]>([
      ["wide_a", Array(200)],
      ["wide_b", Array(150)],
      ["narrow", Array(10)],
    ]);
    const info = detectWideSchema(colsByTable);
    expect(info.hasWideTables).toBe(true);
    expect(info.wideTableCount).toBe(2);
    expect(info.maxColumnCount).toBe(200);
  });

  it("handles empty map", () => {
    const info = detectWideSchema(new Map());
    expect(info.hasWideTables).toBe(false);
    expect(info.maxColumnCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeAdaptiveColumnLimits
// ---------------------------------------------------------------------------

function makeTables(names: string[]): Array<{ fqn: string }> {
  return names.map((fqn) => ({ fqn }));
}

function makeColumnsByTable(
  entries: Array<[string, number]>,
): Map<string, Array<{ columnName: string }>> {
  const map = new Map<string, Array<{ columnName: string }>>();
  for (const [fqn, count] of entries) {
    map.set(
      fqn,
      Array.from({ length: count }, (_, i) => ({ columnName: `col_${i}` })),
    );
  }
  return map;
}

describe("computeAdaptiveColumnLimits", () => {
  it("no trimming when all columns fit in the token budget", () => {
    const tables = makeTables(["a", "b"]);
    const cols = makeColumnsByTable([
      ["a", 10],
      ["b", 5],
    ]);
    // ~15 columns * 12 tokens + 2 * 20 overhead = 220 tokens needed
    const result = computeAdaptiveColumnLimits(tables, cols, 5_000);
    expect(result.trimmed).toBe(false);
    expect(result.totalBefore).toBe(15);
    expect(result.totalAfter).toBe(15);
    expect(result.trimDetails).toHaveLength(0);
    expect(result.limits.get("a")).toBe(10);
    expect(result.limits.get("b")).toBe(5);
  });

  it("trims one wide table among narrow ones", () => {
    const tables = makeTables(["narrow1", "narrow2", "wide"]);
    const cols = makeColumnsByTable([
      ["narrow1", 5],
      ["narrow2", 8],
      ["wide", 200],
    ]);
    // Budget for ~50 total columns: 50 * 12 + 3 * 20 = 660
    const result = computeAdaptiveColumnLimits(tables, cols, 660);
    expect(result.trimmed).toBe(true);
    expect(result.trimDetails.length).toBeGreaterThanOrEqual(1);

    const wideDetail = result.trimDetails.find((d) => d.fqn === "wide");
    expect(wideDetail).toBeDefined();
    expect(wideDetail!.original).toBe(200);
    expect(wideDetail!.kept).toBeLessThan(200);
    expect(wideDetail!.kept).toBeGreaterThanOrEqual(MIN_COLUMNS_PER_TABLE);

    // Narrow tables should keep all their columns
    expect(result.limits.get("narrow1")).toBe(5);
    expect(result.limits.get("narrow2")).toBe(8);
  });

  it("distributes budget fairly among all wide tables", () => {
    const tables = makeTables(["wide_a", "wide_b"]);
    const cols = makeColumnsByTable([
      ["wide_a", 100],
      ["wide_b", 100],
    ]);
    // Very small budget
    const result = computeAdaptiveColumnLimits(tables, cols, 500);
    expect(result.trimmed).toBe(true);
    expect(result.trimDetails).toHaveLength(2);

    const limitA = result.limits.get("wide_a")!;
    const limitB = result.limits.get("wide_b")!;
    expect(limitA).toBeGreaterThanOrEqual(MIN_COLUMNS_PER_TABLE);
    expect(limitB).toBeGreaterThanOrEqual(MIN_COLUMNS_PER_TABLE);
  });

  it("enforces minimum floor of MIN_COLUMNS_PER_TABLE even when budget is tiny", () => {
    const tables = makeTables(["t"]);
    const cols = makeColumnsByTable([["t", 50]]);
    // Budget for ~3 columns: 3 * 12 + 20 = 56 -- but floor is 10
    const result = computeAdaptiveColumnLimits(tables, cols, 56);
    expect(result.trimmed).toBe(true);
    expect(result.limits.get("t")).toBe(MIN_COLUMNS_PER_TABLE);
  });

  it("handles empty tables gracefully", () => {
    const result = computeAdaptiveColumnLimits([], new Map(), 10_000);
    expect(result.trimmed).toBe(false);
    expect(result.totalBefore).toBe(0);
    expect(result.totalAfter).toBe(0);
  });

  it("narrow tables donate surplus to wide table", () => {
    const tables = makeTables(["n1", "n2", "wide"]);
    const cols = makeColumnsByTable([
      ["n1", 3],
      ["n2", 3],
      ["wide", 80],
    ]);
    // Budget large enough for narrow tables but not wide: 3 tables * fair share
    // 86 total cols * 12 + 3 * 20 = 1092; budget = 600
    const result = computeAdaptiveColumnLimits(tables, cols, 600);
    expect(result.trimmed).toBe(true);
    // Narrow tables keep everything
    expect(result.limits.get("n1")).toBe(3);
    expect(result.limits.get("n2")).toBe(3);
    // Wide table gets remaining budget (including surplus from narrow tables)
    const wideLimit = result.limits.get("wide")!;
    expect(wideLimit).toBeGreaterThan(MIN_COLUMNS_PER_TABLE);
    expect(wideLimit).toBeLessThan(80);
  });
});

// ---------------------------------------------------------------------------
// WIDE_SCHEMA_FETCH_LIMITS
// ---------------------------------------------------------------------------

describe("WIDE_SCHEMA_FETCH_LIMITS", () => {
  it("has expected fetch-level limits", () => {
    expect(WIDE_SCHEMA_FETCH_LIMITS.maxColumnRowsPerScope).toBe(200_000);
    expect(WIDE_SCHEMA_FETCH_LIMITS.maxSampleColumns).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// BATCH_ESTIMATION_COL_CAP
// ---------------------------------------------------------------------------

describe("BATCH_ESTIMATION_COL_CAP", () => {
  it("exposes a positive integer cap below the wide-table threshold", () => {
    expect(Number.isInteger(BATCH_ESTIMATION_COL_CAP)).toBe(true);
    expect(BATCH_ESTIMATION_COL_CAP).toBeGreaterThan(0);
    // Cap should be below the wide-table threshold so that batch sizing
    // doesn't explode on very wide tables.
    expect(BATCH_ESTIMATION_COL_CAP).toBeLessThanOrEqual(WIDE_TABLE_COLUMN_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// applyWideSchemaLimits
// ---------------------------------------------------------------------------

describe("applyWideSchemaLimits", () => {
  it("returns a clone of the budget when no wide tables detected", () => {
    const base = resolveColumnBudget();
    const result = applyWideSchemaLimits(base, false);
    expect(result).not.toBe(base);
    expect(result.maxColumnRowsPerScope).toBe(base.maxColumnRowsPerScope);
    expect(result.maxSampleColumns).toBe(base.maxSampleColumns);
  });

  it("tightens maxSampleColumns and maxColumnRowsPerScope when wide schema detected", () => {
    const base = resolveColumnBudget();
    const result = applyWideSchemaLimits(base, true);
    expect(result.maxColumnRowsPerScope).toBeLessThanOrEqual(
      WIDE_SCHEMA_FETCH_LIMITS.maxColumnRowsPerScope,
    );
    // maxSampleColumns on the default budget is 0 (disabled). The wide-schema
    // cap should turn sampling on with the wide-schema cap.
    expect(result.maxSampleColumns).toBe(WIDE_SCHEMA_FETCH_LIMITS.maxSampleColumns);
  });

  it("never raises an already-tighter sample-column cap", () => {
    const tighter = { ...resolveColumnBudget(), maxSampleColumns: 5 };
    const result = applyWideSchemaLimits(tighter, true);
    expect(result.maxSampleColumns).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeAdaptiveColumnLimits -- budget enforcement (C1)
// ---------------------------------------------------------------------------

describe("computeAdaptiveColumnLimits budget enforcement", () => {
  it("never returns a total column count whose tokens exceed the budget unless floor-only is impossible", () => {
    const tables = makeTables(["a", "b", "c"]);
    const cols = makeColumnsByTable([
      ["a", 40],
      ["b", 40],
      ["c", 40],
    ]);
    const budget = 2_000;
    const result = computeAdaptiveColumnLimits(tables, cols, budget);

    const TOKENS_PER_COLUMN = 12;
    const TOKENS_PER_TABLE = 20;
    const totalTokens = Array.from(result.limits.values()).reduce(
      (sum, limit) => sum + TOKENS_PER_TABLE + limit * TOKENS_PER_COLUMN,
      0,
    );
    if (!result.budgetImpossible) {
      expect(totalTokens).toBeLessThanOrEqual(budget);
    }
  });

  it("flags budgetImpossible when even floor-only limits exceed the budget", () => {
    const tables = makeTables(["a", "b", "c", "d", "e"]);
    const cols = makeColumnsByTable([
      ["a", 100],
      ["b", 100],
      ["c", 100],
      ["d", 100],
      ["e", 100],
    ]);
    // Floor alone: 5 tables * (20 + 10 * 12) = 700 tokens. Give 300.
    const result = computeAdaptiveColumnLimits(tables, cols, 300);
    expect(result.budgetImpossible).toBe(true);
    // Every table collapses to the floor.
    for (const t of tables) {
      expect(result.limits.get(t.fqn)).toBe(MIN_COLUMNS_PER_TABLE);
    }
  });

  it("uses corrective pass when fair-share math over-allocates", () => {
    // Setup where redistribution can overshoot by rounding up.
    const tables = makeTables(["w1", "w2", "w3"]);
    const cols = makeColumnsByTable([
      ["w1", 50],
      ["w2", 50],
      ["w3", 50],
    ]);
    // Budget chosen so corrective pass kicks in; total is still >= floor.
    const budget = 900;
    const result = computeAdaptiveColumnLimits(tables, cols, budget);

    const TOKENS_PER_COLUMN = 12;
    const TOKENS_PER_TABLE = 20;
    const totalTokens = Array.from(result.limits.values()).reduce(
      (sum, limit) => sum + TOKENS_PER_TABLE + limit * TOKENS_PER_COLUMN,
      0,
    );
    // After corrective pass the total should fit (or be flagged impossible).
    if (!result.budgetImpossible) {
      expect(totalTokens).toBeLessThanOrEqual(budget);
    }
    // Every kept count stays >= floor (or the original column count if smaller).
    for (const t of tables) {
      const floor = Math.min(MIN_COLUMNS_PER_TABLE, 50);
      expect(result.limits.get(t.fqn)!).toBeGreaterThanOrEqual(floor);
    }
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("backward compatibility", () => {
  it("old serialized generationOptions with largeSchemaMode are harmless", () => {
    const old = JSON.stringify({ largeSchemaMode: true, estateScanEnabled: false });
    const parsed = JSON.parse(old);
    // The field is ignored -- resolveColumnBudget takes no args
    expect(parsed.largeSchemaMode).toBe(true);
    const budget = resolveColumnBudget();
    expect(budget.maxColumnsPerTable).toBe(40);
  });
});
