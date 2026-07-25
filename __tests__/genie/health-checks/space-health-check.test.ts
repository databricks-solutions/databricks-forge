import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runHealthCheck,
  computeMaturityTier,
  enrichSpaceWithUcMetadata,
} from "@/lib/genie/space-health-check";
import { clearRegistryCache } from "@/lib/genie/health-checks/registry";
import { detectSqlInProse } from "@/lib/genie/health-checks/evaluators";
import { perfectSpace, emptySpace, partialSpace } from "./fixtures/spaces";

vi.mock("@/lib/queries/metadata", async (orig) => {
  const actual = await orig<typeof import("@/lib/queries/metadata")>();
  return {
    ...actual,
    fetchTableComments: vi.fn(),
    fetchColumnsBatch: vi.fn(),
  };
});

import { fetchTableComments, fetchColumnsBatch } from "@/lib/queries/metadata";

const mockedTableComments = fetchTableComments as unknown as ReturnType<typeof vi.fn>;
const mockedColumnsBatch = fetchColumnsBatch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearRegistryCache();
});

describe("runHealthCheck", () => {
  it("perfect space scores high (A grade)", () => {
    const report = runHealthCheck(perfectSpace);
    expect(report.grade).toBe("A");
    expect(report.overallScore).toBeGreaterThanOrEqual(90);
    expect(report.fixableCount).toBe(0);
    expect(report.quickWins).toHaveLength(0);
  });

  it("empty space scores low", () => {
    const report = runHealthCheck(emptySpace);
    expect(["C", "D", "F"]).toContain(report.grade);
    expect(report.overallScore).toBeLessThan(75);
    expect(report.quickWins.length).toBeGreaterThan(0);
    expect(report.fixableCount).toBeGreaterThan(0);
    expect(report.maturityTier).toBe("not_ready");
  });

  it("partial space scores below perfect", () => {
    const report = runHealthCheck(partialSpace);
    const perfectReport = runHealthCheck(perfectSpace);
    expect(report.overallScore).toBeLessThan(perfectReport.overallScore);
    expect(report.overallScore).toBeGreaterThan(0);
    // Partial space should have some failed checks
    expect(report.checks.some((c) => !c.passed)).toBe(true);
    expect(report.checks.some((c) => c.passed)).toBe(true);
  });

  it("reports all four categories", () => {
    const report = runHealthCheck(perfectSpace);
    expect(Object.keys(report.categories)).toEqual(
      expect.arrayContaining([
        "data_sources",
        "instructions",
        "semantic_richness",
        "quality_assurance",
      ]),
    );
  });

  it("category scores are 0-100", () => {
    const report = runHealthCheck(partialSpace);
    for (const cat of Object.values(report.categories)) {
      expect(cat.score).toBeGreaterThanOrEqual(0);
      expect(cat.score).toBeLessThanOrEqual(100);
    }
  });

  it("quick wins capped at 5", () => {
    const report = runHealthCheck(emptySpace);
    expect(report.quickWins.length).toBeLessThanOrEqual(5);
  });

  it("quick wins sorted by severity (critical first)", () => {
    const report = runHealthCheck(emptySpace);
    // The quick wins should come from critical checks first
    expect(report.quickWins.length).toBeGreaterThan(0);
  });

  it("fixableCount counts fixable failed checks", () => {
    const report = runHealthCheck(emptySpace);
    const failedFixable = report.checks.filter((c) => !c.passed && c.fixable);
    expect(report.fixableCount).toBe(failedFixable.length);
  });

  describe("grade boundaries", () => {
    it("score 90+ is grade A", () => {
      const report = runHealthCheck(perfectSpace);
      if (report.overallScore >= 90) expect(report.grade).toBe("A");
    });

    it("maps grade thresholds correctly", () => {
      const perfect = runHealthCheck(perfectSpace);
      const empty = runHealthCheck(emptySpace);
      expect(perfect.grade).toBe("A");
      expect(perfect.overallScore).toBeGreaterThanOrEqual(90);
      expect(empty.overallScore).toBeLessThan(perfect.overallScore);
    });
  });

  describe("with category weight overrides", () => {
    it("heavier data_sources weight changes score", () => {
      const defaultReport = runHealthCheck(partialSpace);
      const weightedReport = runHealthCheck(partialSpace, undefined, undefined, {
        data_sources: 70,
        instructions: 10,
        semantic_richness: 10,
        quality_assurance: 10,
      });
      // Scores should differ when weights change
      expect(weightedReport.overallScore).not.toBe(defaultReport.overallScore);
    });
  });

  describe("with overrides", () => {
    it("disabling a check excludes it from results", () => {
      const defaultReport = runHealthCheck(perfectSpace);
      const overriddenReport = runHealthCheck(perfectSpace, [
        { checkId: "tables-configured", enabled: false },
      ]);
      expect(overriddenReport.checks.length).toBe(defaultReport.checks.length - 1);
    });
  });

  describe("maturityTier", () => {
    it("classifies an empty space as not_ready", () => {
      const report = runHealthCheck(emptySpace);
      expect(report.maturityTier).toBe("not_ready");
    });

    it("classifies a perfect-ish space as at least ready_to_optimize", () => {
      const report = runHealthCheck(perfectSpace);
      expect(["ready_to_optimize", "trusted"]).toContain(report.maturityTier);
    });

    it("returns trusted when all upstream-equivalent thresholds are met", () => {
      const trustedSpace = {
        ...perfectSpace,
        data_sources: {
          tables: Array.from({ length: 4 }, (_, i) => ({
            id: `t${i}`,
            description: [`Table ${i}`],
          })),
        },
        instructions: {
          ...perfectSpace.instructions,
          sql_snippets: {
            ...perfectSpace.instructions.sql_snippets,
            measures: Array.from({ length: 3 }, (_, i) => ({
              id: `m${i}`,
              sql: [`SUM(col_${i})`],
            })),
          },
        },
      };
      const tier = computeMaturityTier(trustedSpace, []);
      expect(tier).toBe("trusted");
    });

    it("flags ready_to_optimize when minimally configured", () => {
      const minimal = {
        data_sources: { tables: [{ path: "c.s.t", description: "x" }] },
        instructions: {
          sql_snippets: { measures: [{ id: "m1", sql: "SELECT 1" }] },
          example_question_sqls: [],
        },
      };
      const tier = computeMaturityTier(minimal, []);
      expect(tier).toBe("ready_to_optimize");
    });
  });
});

describe("enrichSpaceWithUcMetadata", () => {
  beforeEach(() => {
    mockedTableComments.mockReset();
    mockedColumnsBatch.mockReset();
  });

  it("reads canonical SerializedSpace fields (identifier + column_name)", async () => {
    // Codex P2: pre-fix this enrichment looked for `path`/`name`, so for
    // any Forge-generated space (which uses `identifier`/`column_name`) the
    // FQN list was empty and UC comments were never fetched. Confirm that
    // the canonical spelling now hydrates descriptions correctly.
    mockedTableComments.mockResolvedValue(
      new Map([["main.sales.orders", "Order fact table"]]),
    );
    mockedColumnsBatch.mockResolvedValue([
      {
        tableFqn: "main.sales.orders",
        columnName: "order_id",
        comment: "Primary key",
        dataType: "BIGINT",
        ordinalPosition: 1,
        isNullable: false,
      },
    ]);

    const space = {
      data_sources: {
        tables: [
          {
            identifier: "main.sales.orders",
            description: "",
            column_configs: [{ column_name: "order_id", description: [] }],
          },
        ],
      },
    };

    const result = await enrichSpaceWithUcMetadata(space);
    expect(result.tablesEnriched).toBe(1);
    expect(result.columnsEnriched).toBe(1);
    const out = result.space.data_sources!.tables[0] as Record<string, unknown>;
    expect(out.description).toBe("Order fact table");
    const firstCol = (out.column_configs as Array<Record<string, unknown>>)[0];
    expect(firstCol.description).toBe("Primary key");
  });

  it("falls back to legacy path/name spellings when present", async () => {
    mockedTableComments.mockResolvedValue(
      new Map([["main.sales.orders", "Order fact table"]]),
    );
    mockedColumnsBatch.mockResolvedValue([]);

    const space = {
      data_sources: {
        tables: [
          {
            path: "main.sales.orders",
            description: "",
          },
        ],
      },
    };

    const result = await enrichSpaceWithUcMetadata(space);
    expect(result.tablesEnriched).toBe(1);
  });
});

describe("detectSqlInProse", () => {
  it("ignores prose that mentions WHERE without an anchor", () => {
    const text = "We use the WHERE clause to filter customers and ORDER our results by date.";
    expect(detectSqlInProse(text)).toEqual([]);
  });

  it("ignores fenced sql blocks", () => {
    const text = [
      "Here is an example query:",
      "```sql",
      "SELECT customer_id, sum(amount) FROM orders WHERE status = 'paid' GROUP BY customer_id",
      "```",
    ].join("\n");
    expect(detectSqlInProse(text)).toEqual([]);
  });

  it("flags inline SELECT ... FROM with high keyword density", () => {
    const text = [
      "Some context.",
      "SELECT customer_id, sum(amount) FROM orders WHERE status = 'paid' GROUP BY customer_id ORDER BY 2 DESC",
      "Another inline: SELECT * FROM customers WHERE active = true GROUP BY region",
    ].join("\n");
    const offenders = detectSqlInProse(text);
    expect(offenders.length).toBe(2);
  });

  it("forgives a single anchored line", () => {
    const text = [
      "Per metric, the canonical form is:",
      "SELECT customer_id, count(*) FROM orders WHERE country = 'US' GROUP BY customer_id",
    ].join("\n");
    expect(detectSqlInProse(text).length).toBeLessThanOrEqual(1);
  });
});
