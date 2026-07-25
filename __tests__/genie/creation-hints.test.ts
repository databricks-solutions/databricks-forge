import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fetchJoinHintsFromQueryHistory,
  fetchSensitivityTags,
  fetchTableImportance,
  gatherCreationHints,
} from "@/lib/genie/creation-hints";

vi.mock("@/lib/dbx/sql", () => ({
  executeSQL: vi.fn(),
}));

vi.mock("@/lib/queries/lineage", () => ({
  walkLineage: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({
  validateIdentifier: vi.fn((v: string) => v),
}));

import { executeSQL } from "@/lib/dbx/sql";
import { walkLineage } from "@/lib/queries/lineage";

describe("fetchJoinHintsFromQueryHistory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ranks join column pairs by occurrences", async () => {
    vi.mocked(executeSQL).mockResolvedValueOnce({
      rows: [
        [
          "SELECT * FROM main.sales.orders JOIN main.sales.customers ON main.sales.orders.customer_id = main.sales.customers.id",
        ],
        [
          "SELECT * FROM main.sales.orders JOIN main.sales.customers ON main.sales.orders.customer_id = main.sales.customers.id",
        ],
        [
          "SELECT * FROM main.sales.orders JOIN main.sales.products ON main.sales.orders.product_id = main.sales.products.id",
        ],
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const hints = await fetchJoinHintsFromQueryHistory({ catalog: "main", schema: "sales" });
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(hints[0].occurrences).toBeGreaterThanOrEqual(2);
    expect(hints[0].left.split(".").length).toBe(4);
    expect(hints[0].right.split(".").length).toBe(4);
  });

  it("returns [] when query.history is not accessible", async () => {
    vi.mocked(executeSQL).mockRejectedValueOnce(new Error("permission denied"));
    const hints = await fetchJoinHintsFromQueryHistory({ catalog: "main" });
    expect(hints).toEqual([]);
  });

  it("filters by tableFqns when provided", async () => {
    vi.mocked(executeSQL).mockResolvedValueOnce({
      rows: [
        [
          "SELECT * FROM main.sales.orders JOIN main.sales.customers ON main.sales.orders.customer_id = main.sales.customers.id",
        ],
        [
          "SELECT * FROM other.scope.foo JOIN other.scope.bar ON other.scope.foo.x = other.scope.bar.y",
        ],
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const hints = await fetchJoinHintsFromQueryHistory({
      catalog: "main",
      tableFqns: ["main.sales.orders"],
    });
    expect(hints.every((h) => h.left.includes("main.sales") || h.right.includes("main.sales"))).toBe(true);
  });
});

describe("fetchSensitivityTags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps rows into qualifiedColumn + tag", async () => {
    vi.mocked(executeSQL).mockResolvedValueOnce({
      rows: [
        ["main", "sales", "customers", "ssn", "PII", "high"],
        ["main", "sales", "customers", "email", "PII", null],
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const tags = await fetchSensitivityTags({ catalog: "main", schema: "sales" });
    expect(tags).toHaveLength(2);
    expect(tags[0].qualifiedColumn).toBe("main.sales.customers.ssn");
    expect(tags[0].tag).toContain("PII");
  });

  it("returns [] when column_tags is unreachable", async () => {
    vi.mocked(executeSQL).mockRejectedValueOnce(new Error("not found"));
    const tags = await fetchSensitivityTags({ catalog: "main" });
    expect(tags).toEqual([]);
  });
});

describe("fetchTableImportance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ranks tables by edge count", async () => {
    vi.mocked(walkLineage).mockResolvedValueOnce({
      edges: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { sourceTableFqn: "main.sales.orders", targetTableFqn: "main.sales.orders_summary" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { sourceTableFqn: "main.sales.orders", targetTableFqn: "main.analytics.daily_revenue" } as any,
      ],
      seedTables: ["main.sales.orders"],
      discoveredTables: ["main.sales.orders_summary", "main.analytics.daily_revenue"],
      upstreamDepth: 0,
      downstreamDepth: 1,
    });
    const ranked = await fetchTableImportance({
      catalog: "main",
      schema: "sales",
      tableFqns: ["main.sales.orders"],
    });
    expect(ranked[0].fqn).toBe("main.sales.orders");
    expect(ranked[0].edgeCount).toBeGreaterThanOrEqual(2);
  });

  it("returns [] when lineage walk throws", async () => {
    vi.mocked(walkLineage).mockRejectedValueOnce(new Error("boom"));
    const ranked = await fetchTableImportance({
      catalog: "main",
      schema: "sales",
      tableFqns: ["main.sales.orders"],
    });
    expect(ranked).toEqual([]);
  });
});

describe("gatherCreationHints", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates the three sub-hints in parallel and tolerates failures", async () => {
    vi.mocked(executeSQL)
      .mockRejectedValueOnce(new Error("query.history blocked"))
      .mockResolvedValueOnce({
        rows: [["main", "sales", "customers", "ssn", "PII", "high"]],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    vi.mocked(walkLineage).mockResolvedValueOnce({
      edges: [],
      seedTables: ["main.sales.orders"],
      discoveredTables: [],
      upstreamDepth: 0,
      downstreamDepth: 0,
    });
    const hints = await gatherCreationHints({
      catalog: "main",
      schema: "sales",
      tableFqns: ["main.sales.orders"],
    });
    expect(hints.joinHints).toEqual([]);
    expect(hints.tableImportance).toEqual([]);
    expect(hints.sensitivityTags.length).toBeGreaterThanOrEqual(1);
  });
});
