import { describe, it, expect } from "vitest";
import {
  extractEntityCandidates,
  extractEntityCandidatesFromSchema,
} from "@/lib/genie/entity-extraction";
import type { SampleDataCache } from "@/lib/genie/types";

function makeSampleCache(
  entries: Record<string, { columns: string[]; columnTypes: string[]; rows: unknown[][] }>,
): SampleDataCache {
  const cache = new Map() as SampleDataCache;
  for (const [fqn, data] of Object.entries(entries)) {
    cache.set(fqn, data);
  }
  return cache;
}

describe("extractEntityCandidates", () => {
  it("identifies low-cardinality string columns", () => {
    const sampleData = makeSampleCache({
      "cat.schema.orders": {
        columns: ["order_id", "status_code", "amount"],
        columnTypes: ["string", "string", "double"],
        rows: [
          ["uuid-1", "SHIPPED", 100],
          ["uuid-2", "PENDING", 200],
          ["uuid-3", "SHIPPED", 150],
          ["uuid-4", "CANCELLED", 50],
          ["uuid-5", "PENDING", 300],
        ],
      },
    });

    const result = extractEntityCandidates({
      tableFqns: ["cat.schema.orders"],
      sampleData,
    });

    const statusCol = result.find((c) => c.columnName === "status_code");
    expect(statusCol).toBeDefined();
    expect(statusCol!.sampleValues).toContain("SHIPPED");
    expect(statusCol!.distinctCount).toBe(3);
  });

  it("excludes UUID-like columns", () => {
    const sampleData = makeSampleCache({
      "cat.schema.users": {
        columns: ["user_id", "region_code"],
        columnTypes: ["string", "string"],
        rows: [
          ["550e8400-e29b-41d4-a716-446655440000", "US"],
          ["6ba7b810-9dad-11d1-80b4-00c04fd430c8", "EU"],
        ],
      },
    });

    const result = extractEntityCandidates({
      tableFqns: ["cat.schema.users"],
      sampleData,
    });

    expect(result.find((c) => c.columnName === "user_id")).toBeUndefined();
    expect(result.find((c) => c.columnName === "region_code")).toBeDefined();
  });

  it("excludes PII-classified columns", () => {
    const sampleData = makeSampleCache({
      "cat.schema.customers": {
        columns: ["email", "country_code"],
        columnTypes: ["string", "string"],
        rows: [
          ["user@test.com", "US"],
          ["other@test.com", "UK"],
        ],
      },
    });

    const result = extractEntityCandidates({
      tableFqns: ["cat.schema.customers"],
      sampleData,
      piiClassifications: [
        {
          tableFqn: "cat.schema.customers",
          columnName: "email",
          classification: "PII" as const,
          confidence: "high" as const,
          reason: "email",
          regulation: null,
        },
      ],
    });

    expect(result.find((c) => c.columnName === "email")).toBeUndefined();
    expect(result.find((c) => c.columnName === "country_code")).toBeDefined();
  });

  it("skips non-string columns", () => {
    const sampleData = makeSampleCache({
      "cat.schema.metrics": {
        columns: ["metric_id", "value"],
        columnTypes: ["int", "double"],
        rows: [
          [1, 100.5],
          [2, 200.3],
        ],
      },
    });

    const result = extractEntityCandidates({
      tableFqns: ["cat.schema.metrics"],
      sampleData,
    });

    expect(result).toHaveLength(0);
  });

  it("assigns high confidence to hint-named columns with low cardinality ratio", () => {
    const sampleData = makeSampleCache({
      "cat.schema.products": {
        columns: ["product_type", "description"],
        columnTypes: ["string", "string"],
        rows: [
          ["Electronics", "Some long unique description 1"],
          ["Electronics", "Another unique description 2"],
          ["Clothing", "Yet another description 3"],
          ["Electronics", "Description 4"],
          ["Food", "Description 5"],
          ["Clothing", "Description 6"],
          ["Food", "Description 7"],
          ["Electronics", "Description 8"],
          ["Clothing", "Description 9"],
          ["Food", "Description 10"],
        ],
      },
    });

    const result = extractEntityCandidates({
      tableFqns: ["cat.schema.products"],
      sampleData,
    });

    const typeCol = result.find((c) => c.columnName === "product_type");
    expect(typeCol).toBeDefined();
    expect(["high", "medium"]).toContain(typeCol!.confidence);
  });
});

describe("extractEntityCandidatesFromSchema", () => {
  it("identifies hint-named string columns", () => {
    const columns = [
      { tableFqn: "cat.schema.t1", columnName: "region_code", dataType: "string" },
      { tableFqn: "cat.schema.t1", columnName: "amount", dataType: "double" },
      { tableFqn: "cat.schema.t1", columnName: "status_type", dataType: "varchar(50)" },
    ];

    const result = extractEntityCandidatesFromSchema(columns, ["cat.schema.t1"]);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.columnName).sort()).toEqual(["region_code", "status_type"]);
    expect(result[0].confidence).toBe("low");
  });

  it("filters to specified tables only", () => {
    const columns = [
      { tableFqn: "cat.schema.t1", columnName: "region_code", dataType: "string" },
      { tableFqn: "cat.schema.t2", columnName: "status_code", dataType: "string" },
    ];

    const result = extractEntityCandidatesFromSchema(columns, ["cat.schema.t1"]);
    expect(result).toHaveLength(1);
    expect(result[0].tableFqn).toBe("cat.schema.t1");
  });
});
